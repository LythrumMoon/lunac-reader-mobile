import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RspError,
  convertKazumiRule,
  validateSourceManifest,
} from "../src/index.js";

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

test("Kazumi XPath 规则 → RSP 搜索 + 章节", () => {
  const out = convertKazumiRule(fixture("kazumi-xpath.json"));
  assert.equal(out.manifest.id, "kazumi.fixture-xpath");
  assert.deepEqual(out.manifest.kind, ["anime"]);
  assert.equal(out.manifest.engine, "declarative");
  assert.deepEqual(out.manifest.capabilities, ["search", "chapters"]);

  assert.equal(out.rule.search?.request.url, "https://fixture.example/search?query=@keyword");
  assert.equal(out.rule.search?.list.xpath, "//div[@class='item']");
  assert.deepEqual(out.rule.search?.fields.id, {
    selector: { xpath: "//div[@class='item']/a" },
    attr: "href",
  });
  assert.deepEqual(out.rule.search?.fields.title, {
    selector: { xpath: "//div[@class='item']/a" },
    text: true,
  });

  assert.equal(out.rule.chapters?.request.url, "@workUrl");
  assert.equal(out.rule.chapters?.list.xpath, "//ul[@id='chapters']");
  assert.deepEqual(out.rule.chapters?.fields.id, {
    selector: { xpath: "//li/a" },
    attr: "href",
  });
});

test("Kazumi API 规则 → JSONPath 搜索", () => {
  const out = convertKazumiRule(fixture("kazumi-api.json"));
  assert.equal(out.manifest.id, "kazumi.fixture-api");
  assert.equal(out.rule.search?.request.method, "GET");
  assert.deepEqual(out.rule.search?.request.query, { wd: "@keyword" });
  assert.equal(out.rule.search?.list.jsonPath, "$.list[*]");
  assert.deepEqual(out.rule.search?.fields.id, {
    selector: { jsonPath: "$.id" },
    template: "https://api-fixture.example/work/@value/",
  });
  assert.deepEqual(out.rule.search?.fields.title, {
    selector: { jsonPath: "$.name" },
    text: true,
  });
  assert.equal(out.rule.chapters?.request.url, "@workUrl");
});

test("缺少搜索配置时抛 unsupported", () => {
  assert.throws(
    () => convertKazumiRule({ name: "No Search", version: "1.0" }),
    (error: unknown) =>
      error instanceof RspError && error.code === "unsupported",
  );
});

test("不支持的字段进入 warnings，不静默丢弃", () => {
  const out = convertKazumiRule({
    name: "Warnings",
    version: "1.0",
    searchURL: "https://example.com/s?q=@keyword",
    searchList: "//li",
    useWebview: true,
    muliSources: true,
    adBlocker: true,
  });
  assert.equal(out.warnings.length, 3);
  assert.ok(out.warnings.some((w) => w.includes("useWebview")));
  assert.ok(out.warnings.some((w) => w.includes("muliSources")));
  assert.ok(out.warnings.some((w) => w.includes("adBlocker")));
});

test("searchURL 不含 @keyword 时给出 warning", () => {
  const out = convertKazumiRule({
    name: "No Placeholder",
    version: "1.0",
    searchURL: "https://example.com/search",
    searchList: "//li",
  });
  assert.ok(out.warnings.some((w) => w.includes("@keyword")));
});

test("清单校验：合法 / 非法 id / 缺 capabilities", () => {
  const valid = validateSourceManifest({
    rsp: 1,
    id: "demo.comic",
    name: "Demo",
    version: "1.0.0",
    kind: ["comic"],
    engine: "declarative",
    entry: "rule.json",
    capabilities: ["search", "chapters"],
  });
  assert.equal(valid.id, "demo.comic");
  assert.equal(valid.nsfw, false);

  assert.throws(
    () =>
      validateSourceManifest({
        rsp: 1,
        id: "Bad Id",
        name: "Bad",
        version: "1",
        kind: ["comic"],
        engine: "declarative",
        entry: "rule.json",
        capabilities: ["search"],
      }),
    (error: unknown) => error instanceof RspError && error.code === "parse",
  );

  assert.throws(
    () =>
      validateSourceManifest({
        rsp: 1,
        id: "demo",
        name: "Demo",
        version: "1",
        kind: ["comic"],
        engine: "declarative",
        entry: "rule.json",
      }),
    (error: unknown) => error instanceof RspError && error.code === "parse",
  );
});
