import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ReaderController,
  READER_MODES,
  READER_SPEEDS,
  resolveTapZone,
  type ReaderChapter,
} from "../src/index.js";

const chapters: ReaderChapter[] = [
  {
    id: "c1",
    title: "第一章",
    pages: [
      { id: "c1p1", kind: "text", content: "a" },
      { id: "c1p2", kind: "text", content: "b" },
      { id: "c1p3", kind: "text", content: "c" },
    ],
  },
  {
    id: "c2",
    title: "第二章",
    pages: [
      { id: "c2p1", kind: "text", content: "d" },
      { id: "c2p2", kind: "text", content: "e" },
    ],
  },
];

test("初始状态：双框可见、垂直模式、速度 1x", () => {
  const reader = new ReaderController(chapters);
  const state = reader.snapshot();
  assert.equal(state.barsVisible, true);
  assert.equal(state.locked, false);
  assert.equal(state.mode, "vertical");
  assert.equal(state.speed, 1);
  assert.equal(state.pageIndex, 0);
  assert.equal(state.pageCount, 3);
});

test("点击分区：上下模式 35/30/35", () => {
  assert.equal(resolveTapZone(50, 10, 100, 100, "vertical"), "prev");
  assert.equal(resolveTapZone(50, 50, 100, 100, "vertical"), "toggle");
  assert.equal(resolveTapZone(50, 90, 100, 100, "vertical"), "next");
  assert.equal(resolveTapZone(50, 34, 100, 100, "vertical"), "prev");
  assert.equal(resolveTapZone(50, 65, 100, 100, "vertical"), "next");
});

test("点击分区：左右模式 35/30/35", () => {
  assert.equal(resolveTapZone(10, 50, 100, 100, "paged"), "prev");
  assert.equal(resolveTapZone(50, 50, 100, 100, "paged"), "toggle");
  assert.equal(resolveTapZone(90, 50, 100, 100, "paged"), "next");
});

test("翻页跨章：最后一页的下一页进入下一章；第一页的上一页回到上一章末页", () => {
  const reader = new ReaderController(chapters, { chapterIndex: 0, pageIndex: 2 });
  assert.equal(reader.nextPage(), "chapter");
  assert.equal(reader.snapshot().chapterIndex, 1);
  assert.equal(reader.snapshot().pageIndex, 0);

  assert.equal(reader.prevPage(), "chapter");
  assert.equal(reader.snapshot().chapterIndex, 0);
  assert.equal(reader.snapshot().pageIndex, 2);

  assert.equal(reader.nextPage(), "chapter");
  assert.equal(reader.nextPage(), "page");
  assert.equal(reader.nextPage(), "end");
});

test("锁定：双框收起，toggleBars 被忽略；解锁恢复", () => {
  const reader = new ReaderController(chapters);
  assert.equal(reader.toggleLock(), true);
  assert.equal(reader.snapshot().barsVisible, false);
  reader.toggleBars();
  assert.equal(reader.snapshot().barsVisible, false);
  assert.equal(reader.toggleLock(), false);
  assert.equal(reader.snapshot().barsVisible, true);
});

test("速度 / 模式 / 裁剪 / 自动播放循环", () => {
  const reader = new ReaderController(chapters);
  assert.equal(reader.cycleSpeed(), 1.5);
  assert.equal(reader.cycleSpeed(), 2);
  assert.equal(reader.cycleSpeed(), 3);
  assert.equal(reader.cycleSpeed(), READER_SPEEDS[0]);

  assert.equal(reader.cycleMode(), READER_MODES[1]);
  assert.equal(reader.cycleMode(), READER_MODES[2]);
  assert.equal(reader.cycleMode(), READER_MODES[0]);

  assert.equal(reader.toggleCrop(), true);
  assert.equal(reader.toggleCrop(), false);

  assert.equal(reader.toggleAutoplay(), true);
  reader.setAutoplay(false);
  assert.equal(reader.snapshot().autoplay, false);
});

test("进度条：0 / 0.5 / 1 映射到页索引", () => {
  const reader = new ReaderController(chapters);
  reader.setProgress(0);
  assert.equal(reader.snapshot().pageIndex, 0);
  reader.setProgress(0.5);
  assert.equal(reader.snapshot().pageIndex, 1);
  reader.setProgress(1);
  assert.equal(reader.snapshot().pageIndex, 2);
  assert.equal(reader.progress(), 1);
});

test("setChapter 越界返回 false；单页章节进度为 0", () => {
  const reader = new ReaderController(chapters);
  assert.equal(reader.setChapter(9), false);
  assert.equal(reader.setChapter(1, 99), true);
  assert.equal(reader.snapshot().pageIndex, 1);
  reader.setChapter(0, 0);
  reader.setProgress(0.8);
  assert.equal(reader.snapshot().pageIndex, 2);
});
