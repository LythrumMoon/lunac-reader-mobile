import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeclarativeRule, SourceManifest } from "../src/contract.js";
import { RspError } from "../src/contract.js";
import { createDeclarativeSource } from "../src/executor.js";
import type { NetApi } from "../src/host.js";
import { createMockHost } from "../src/mock-host.js";

const manifest: SourceManifest = {
  rsp: 1,
  id: "demo.api",
  name: "Demo API",
  version: "1.0.0",
  kind: ["comic"],
  engine: "declarative",
  entry: "rule.json",
  baseUrl: "https://api.test",
  capabilities: ["search", "chapters", "pages", "play"],
  headers: { "User-Agent": "ResourceHub/0.1" },
};

const rule: DeclarativeRule = {
  search: {
    request: { method: "GET", url: "/search", query: { q: "@keyword", page: "@page" } },
    list: { jsonPath: "$.data[*]" },
    fields: {
      id: { selector: { jsonPath: "id" } },
      title: { selector: { jsonPath: "title" } },
      cover: { selector: { jsonPath: "cover" } },
      tags: { selector: { jsonPath: "tags" }, template: "@value" },
    },
  },
  chapters: {
    request: { method: "GET", url: "@workUrl" },
    list: { jsonPath: "$.chapters[*]" },
    fields: {
      id: { selector: { jsonPath: "id" } },
      title: { selector: { jsonPath: "title" } },
    },
  },
  pages: {
    request: { method: "GET", url: "@chapterUrl" },
    list: { jsonPath: "$.images[*]" },
    fields: { url: { selector: { jsonPath: "src" } } },
  },
  play: {
    request: { method: "GET", url: "@chapterUrl" },
    list: { jsonPath: "$.episodes[*]" },
    fields: { url: { selector: { jsonPath: "url" } } },
  },
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("执行器：JSON 搜索映射为 Work，并带分页与 manifest headers", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      data: [
        { id: "1", title: "星海", cover: "/img/1.jpg", tags: "科幻,冒险" },
        { id: "2", title: "山海", cover: "https://cdn.test/2.jpg" },
      ],
    });
  }) as unknown as typeof fetch;

  const source = createDeclarativeSource(
    { manifest, rule },
    { host: createMockHost({ fetchImpl }) },
  );
  const page = await source.search!("星海", 2);

  assert.equal(
    calls[0]?.url,
    "https://api.test/search?q=%E6%98%9F%E6%B5%B7&page=2",
  );
  assert.deepEqual(calls[0]?.init?.headers, { "User-Agent": "ResourceHub/0.1" });
  assert.equal(page.next, "3");
  assert.deepEqual(page.items[0], {
    ref: { sourceId: "demo.api", workId: "1", kind: "comic" },
    title: "星海",
    author: undefined,
    cover: "https://api.test/img/1.jpg",
    description: undefined,
    tags: ["科幻", "冒险"],
  });
  assert.equal(page.items[1]?.cover, "https://cdn.test/2.jpg");
});

test("执行器：403 → blocked", async () => {
  const fetchImpl = (async () =>
    new Response("denied", { status: 403 })) as unknown as typeof fetch;
  const source = createDeclarativeSource(
    { manifest, rule },
    { host: createMockHost({ fetchImpl }) },
  );
  await assert.rejects(
    source.search!("x"),
    (error: unknown) => error instanceof RspError && error.code === "blocked",
  );
});

test("执行器：章节使用 @workUrl，图片使用 @chapterUrl 并解析相对地址", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    seen.push(String(url));
    if (String(url).endsWith("/comic/1")) {
      return jsonResponse({ chapters: [{ id: "/c/1", title: "第 1 话" }] });
    }
    return jsonResponse({ images: [{ src: "/p/1.jpg" }, { src: "https://cdn.test/2.jpg" }] });
  }) as unknown as typeof fetch;

  const source = createDeclarativeSource(
    { manifest, rule },
    { host: createMockHost({ fetchImpl }) },
  );
  const chapters = await source.chapters!({
    sourceId: "demo.api",
    workId: "/comic/1",
    kind: "comic",
  });
  assert.deepEqual(chapters, [
    { id: "/c/1", workId: "/comic/1", title: "第 1 话", index: 0 },
  ]);
  assert.equal(seen[0], "https://api.test/comic/1");

  const pages = await source.pages!(chapters[0]);
  assert.equal(seen[1], "https://api.test/c/1");
  assert.deepEqual(
    pages.map((page) => page.url),
    ["https://api.test/p/1.jpg", "https://cdn.test/2.jpg"],
  );
});

test("执行器：把 signal / timeoutMs 透传给网络层", async () => {
  const seen: Parameters<NetApi["request"]>[0][] = [];
  const net: NetApi = {
    async request(init) {
      seen.push(init);
      return {
        url: init.url,
        status: 200,
        headers: {},
        body: JSON.stringify({ data: [] }),
      };
    },
  };
  const source = createDeclarativeSource(
    { manifest, rule },
    { host: createMockHost(), net },
  );
  const controller = new AbortController();

  await source.search!("x", 1, { signal: controller.signal, timeoutMs: 1_234 });

  assert.equal(seen[0]?.timeoutMs, 1_234);
  assert.equal(seen[0]?.signal, controller.signal);
});

test("执行器：播放地址按扩展名推断 hls / mp4", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      episodes: [{ url: "https://cdn.test/a.m3u8" }, { url: "https://cdn.test/b.mp4" }],
    })) as unknown as typeof fetch;
  const source = createDeclarativeSource(
    { manifest, rule },
    { host: createMockHost({ fetchImpl }) },
  );
  const playback = await source.play!({
    id: "/c/1",
    workId: "/comic/1",
    title: "第 1 话",
    index: 0,
  });
  assert.deepEqual(
    playback.map((item) => item.type),
    ["hls", "mp4"],
  );
});

test("执行器：未声明的能力抛 unsupported", async () => {
  const source = createDeclarativeSource(
    { manifest, rule: {} },
    { host: createMockHost() },
  );
  await assert.rejects(
    source.search!("x"),
    (error: unknown) => error instanceof RspError && error.code === "unsupported",
  );
});
