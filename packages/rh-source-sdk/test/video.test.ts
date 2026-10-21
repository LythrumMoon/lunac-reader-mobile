import assert from "node:assert/strict";
import { test } from "node:test";

import type { SourceManifest } from "../src/contract.js";
import { createMockHost } from "../src/mock-host.js";
import { createVideoSource, looksLikeVideo } from "../src/video-source.js";

const manifest: SourceManifest = {
  rsp: 1,
  id: "demo.videoext",
  name: "Demo VideoExt",
  version: "1.0.0",
  kind: ["anime"],
  engine: "js",
  entry: "source.js",
  baseUrl: "https://demo.test",
  capabilities: ["search", "chapters", "play"],
};

const SCRIPT = `
// ignore
import { VideoDetail } from "./core/core/uzVideo.js";
// ignore
const appConfig = { webSite: "https://demo.test" };

async function searchVideo(args) {
  const res = await req(appConfig.webSite + "/search?wd=" + encodeURIComponent(args.searchWord));
  const $ = cheerio.load(res.data);
  const data = $("div.list > div.item").map((index, element) => ({
    vod_id: $(element).find("a").attr("href"),
    vod_name: $(element).find(".name").text(),
    vod_pic: $(element).find("img").attr("data-src"),
  })).get();
  return JSON.stringify({ data });
}

async function getVideoDetail(args) {
  return JSON.stringify({
    data: {
      vod_name: "星海",
      vod_blurb: "一段简介",
      vod_class: "冒险,奇幻",
      vod_director: "导演甲",
      vod_play_from: "线路1$$$线路2",
      vod_play_url: "第1集$https://demo.test/c1.m3u8#第2集$https://demo.test/c2.m3u8$$$第1集$https://cdn.test/d1.mp4",
    },
  });
}

async function getVideoPlayUrl(args) {
  return JSON.stringify({
    urls: [{ name: "高清", url: args.url, headers: { Referer: "https://demo.test" } }],
  });
}
`;

const SEARCH_HTML = `
<html><body>
  <div class="list">
    <div class="item">
      <a href="/vod/1"><span class="name">星海 &amp; 山海</span><img data-src="/img/1.jpg"></a>
    </div>
    <div class="item">
      <a href="/vod/2"><span class="name">风起</span><img data-src="https://cdn.test/2.jpg"></a>
    </div>
  </div>
</body></html>`;

function envelope(body: string): string {
  return JSON.stringify({
    ok: true,
    response: {
      url: "https://demo.test/",
      status: 200,
      headers: { "content-type": "text/html" },
      body,
    },
  });
}

function host() {
  return createMockHost({
    allowEval: true,
    engineRequest: (optionsJson: string) => {
      const options = JSON.parse(optionsJson) as { url: string };
      if (options.url.includes("/search")) return envelope(SEARCH_HTML);
      return JSON.stringify({ ok: false, error: `unexpected: ${options.url}` });
    },
  });
}

test("视频源识别：显式函数 / BaseCode1，且不误伤漫画源 与 createSource", () => {
  assert.equal(looksLikeVideo(SCRIPT), true);
  assert.equal(looksLikeVideo("//#BaseCode1#"), true);
  assert.equal(looksLikeVideo("class X extends ComicSource {}"), false);
  assert.equal(looksLikeVideo("function createSource(rsp) { return {}; }"), false);
});

test("视频源：剥离 import 块，搜索走 req + cheerio", async () => {
  const source = createVideoSource({ manifest, script: SCRIPT }, { host: host() });
  const page = await source.search!("星海", 1);

  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items[0], {
    ref: { sourceId: "demo.videoext", workId: "/vod/1", kind: "anime" },
    title: "星海 & 山海",
    author: undefined,
    cover: "https://demo.test/img/1.jpg",
    description: undefined,
    tags: undefined,
    status: undefined,
  });
  assert.equal(page.items[1]?.cover, "https://cdn.test/2.jpg");
});

test("视频源：detail 补简介 / 标签 / 作者", async () => {
  const source = createVideoSource({ manifest, script: SCRIPT }, { host: host() });
  const work = await source.detail!({
    sourceId: "demo.videoext",
    workId: "/vod/1",
    kind: "anime",
  });
  assert.equal(work.description, "一段简介");
  assert.deepEqual(work.tags, ["冒险", "奇幻"]);
  assert.equal(work.author, "导演甲");
});

test("视频源：章节按 vod_play_from / vod_play_url 展开", async () => {
  const source = createVideoSource({ manifest, script: SCRIPT }, { host: host() });
  const chapters = await source.chapters!({
    sourceId: "demo.videoext",
    workId: "/vod/1",
    kind: "anime",
  });

  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.group]),
    [
      ["线路1 · 第1集", "线路1"],
      ["线路1 · 第2集", "线路1"],
      ["线路2 · 第1集", "线路2"],
    ],
  );
  assert.ok(chapters[0]?.id.includes("https://demo.test/c1.m3u8"));
});

test("视频源 源：播放地址映射为 Playback（hls / mp4 + 请求头）", async () => {
  const source = createVideoSource({ manifest, script: SCRIPT }, { host: host() });
  const chapters = await source.chapters!({
    sourceId: "demo.videoext",
    workId: "/vod/1",
    kind: "anime",
  });
  const playbacks = await source.play!(chapters[0]!);

  assert.equal(playbacks.length, 1);
  assert.equal(playbacks[0]?.url, "https://demo.test/c1.m3u8");
  assert.equal(playbacks[0]?.type, "hls");
  assert.deepEqual(playbacks[0]?.headers, { Referer: "https://demo.test" });
});

const HOME_SCRIPT = `
async function getHome() {
  return JSON.stringify({
    data: [
      { vod_id: "/home/1", vod_name: "首页一", vod_pic: "/img/home-1.jpg" },
      { vod_id: "/home/2", vod_name: "首页二" },
    ],
  });
}
`;

const CLASS_SCRIPT = `
async function getClassList() {
  return JSON.stringify({
    class: [
      { type_id: "1", type_name: "电影" },
      { type_id: "2", type_name: "剧集" },
    ],
  });
}

async function getVideoList(args) {
  return JSON.stringify({
    data: [
      {
        vod_id: args.type_id + "-" + args.page,
        vod_name: "列表 " + args.type_id + " P" + args.page,
        vod_pic: "/img/" + args.type_id + "-" + args.page + ".jpg",
      },
    ],
  });
}
`;

test("视频源 源：getHome 拉取总览并映射为 Work", async () => {
  const source = createVideoSource({ manifest, script: HOME_SCRIPT }, { host: host() });
  const page = await source.explore!();

  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.title, "首页一");
  assert.equal(page.items[0]?.ref.workId, "/home/1");
  assert.equal(page.items[0]?.cover, "https://demo.test/img/home-1.jpg");
});

test("视频源 源：getHome 为空时退回分类列表", async () => {
  const script = `async function getHome() {
  return JSON.stringify({ data: [] });
}
${CLASS_SCRIPT}`;
  const source = createVideoSource({ manifest, script }, { host: host() });
  const page = await source.explore!();
  assert.deepEqual(
    page.items.map((item) => item.ref.workId),
    ["1-1", "2-1"],
  );
});

test("视频源 源：getClassList / getVideoList 聚合总览，并支持分区与分页", async () => {
  const source = createVideoSource({ manifest, script: CLASS_SCRIPT }, { host: host() });
  const overview = await source.explore!();
  assert.deepEqual(
    overview.items.map((item) => [item.ref.workId, item.title]),
    [
      ["1-1", "列表 1 P1"],
      ["2-1", "列表 2 P1"],
    ],
  );

  const section = await source.explore!("2", 3);
  assert.deepEqual(
    section.items.map((item) => [item.ref.workId, item.title, item.cover]),
    [["2-3", "列表 2 P3", "https://demo.test/img/2-3.jpg"]],
  );
});

test("视频源 源：没有浏览函数时 explore 给出 unsupported", async () => {
  const source = createVideoSource({ manifest, script: SCRIPT }, { host: host() });
  await assert.rejects(
    () => source.explore!(),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "unsupported",
  );
});

test("视频源 源：BaseCode1 模板给出可读错误", () => {
  assert.throws(
    () =>
      createVideoSource(
        { manifest, script: "//#BaseCode1#\nconst webSite = 'https://demo.test';" },
        { host: host() },
      ),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "unsupported",
  );
});
