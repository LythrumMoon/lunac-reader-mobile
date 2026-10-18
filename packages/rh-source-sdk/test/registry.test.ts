import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareVersion,
  fromKazumiIndex,
  fromUzVideoIndex,
  fromVeneraIndex,
  mergeRegistry,
  parseRegistry,
  type RegistryEntry,
} from "../src/index.js";

test("Kazumi 索引 → registry 条目", () => {
  const entries = fromKazumiIndex(
    [{ name: "AGE", version: "1.5", author: "someone" }],
    "https://rules.example/",
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "kazumi.age");
  assert.equal(entries[0].engine, "declarative");
  assert.equal(entries[0].kind[0], "anime");
  assert.equal(entries[0].sourceUrl, "https://rules.example/AGE.json");
  assert.equal(entries[0].license, "MIT");
  assert.ok(entries[0].warnings.some((w) => w.includes("someone")));
});

test("Venera 索引 → registry 条目（只登记，不复制）", () => {
  const entries = fromVeneraIndex(
    [{ name: "MangaDex", key: "manga_dex", fileName: "manga_dex.js", version: "1.1.1" }],
    "https://venera.example/",
  );
  assert.equal(entries[0].id, "venera.manga_dex");
  assert.equal(entries[0].engine, "js");
  assert.equal(entries[0].kind[0], "comic");
  assert.equal(entries[0].sourceUrl, "https://venera.example/manga_dex.js");
  assert.equal(entries[0].license, undefined);
});

test("uzVideo 索引 → registry 条目（无 LICENSE，仅链接）", () => {
  const entries = fromUzVideoIndex(
    [{ name: "uz source", key: "uz-source", url: "https://uz.example/a.js", version: "2" }],
    "https://uz.example/",
  );
  assert.equal(entries[0].id, "uzvideo.uz-source");
  assert.equal(entries[0].engine, "js");
  assert.ok(entries[0].warnings.some((w) => w.includes("LICENSE")));
});

test("版本比较：1.10 > 1.9", () => {
  assert.ok(compareVersion("1.10.0", "1.9.0") > 0);
  assert.equal(compareVersion("1.0.0", "1.0"), 0);
  assert.ok(compareVersion("2.0.0", "10.0.0") < 0);
});

test("合并：同 id 保留高版本，warnings 取并集", () => {
  const base: RegistryEntry = {
    id: "kazumi.age",
    name: "AGE",
    upstream: "kazumi",
    upstreamId: "AGE",
    version: "1.9.0",
    kind: ["anime"],
    engine: "declarative",
    warnings: ["old"],
  };
  const newer: RegistryEntry = { ...base, version: "1.10.0", warnings: ["new"] };
  const bundle = mergeRegistry([base, newer], "2026-10-18T00:00:00.000Z");
  assert.equal(bundle.entries.length, 1);
  assert.equal(bundle.entries[0].version, "1.10.0");
  assert.deepEqual(bundle.entries[0].warnings.sort(), ["new", "old"]);
  assert.equal(bundle.generatedAt, "2026-10-18T00:00:00.000Z");
});

test("parseRegistry 保留自建来源的内嵌规则", () => {
  const parsed = parseRegistry({
    rsp: 1,
    generatedAt: "2026-10-18T00:00:00.000Z",
    entries: [
      {
        id: "demo.gutendex",
        name: "Demo",
        upstream: "manual",
        upstreamId: "demo.gutendex",
        version: "1.0.0",
        kind: ["novel"],
        engine: "declarative",
        warnings: [],
        source: {
          manifest: {
            rsp: 1,
            id: "demo.gutendex",
            name: "Demo",
            version: "1.0.0",
            kind: ["novel"],
            engine: "declarative",
            entry: "rule.json",
            capabilities: ["search"],
          },
          rule: { search: { request: { method: "GET", url: "/search" }, list: { jsonPath: "$" }, fields: {} } },
        },
      },
    ],
  });
  assert.equal(parsed.entries[0]?.source?.manifest.id, "demo.gutendex");
  assert.ok(parsed.entries[0]?.source?.rule);
});

test("parseRegistry 过滤无效条目并保留 attribution", () => {
  const parsed = parseRegistry({
    rsp: 1,
    generatedAt: "2026-10-18T00:00:00.000Z",
    entries: [
      {
        id: "kazumi.age",
        name: "AGE",
        upstream: "kazumi",
        upstreamId: "AGE",
        version: "1.5",
        kind: ["anime"],
        engine: "declarative",
        license: "MIT",
        attribution: "KazumiRules",
        warnings: [],
      },
      { id: "", name: "" },
    ],
  });
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].attribution, "KazumiRules");
  assert.equal(parsed.entries[0].license, "MIT");
});
