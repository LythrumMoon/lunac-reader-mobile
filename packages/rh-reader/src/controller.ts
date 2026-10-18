import {
  READER_MODES,
  READER_SPEEDS,
  type ReaderChapter,
  type ReaderInitialState,
  type ReaderMode,
  type ReaderPage,
  type ReaderSnapshot,
} from "./types.js";

export type PageStep = "page" | "chapter" | "start" | "end";

/**
 * 阅读器状态机（纯状态，不碰 DOM / 定时器）。
 *
 * UI 负责：自动隐藏计时、自动播放计时、长按解锁；
 * 状态机只回答「现在第几章第几页、双框是否可见、是否锁定」。
 */
export class ReaderController {
  private chapters: ReaderChapter[];
  private state: ReaderSnapshot;

  constructor(chapters: ReaderChapter[], initial: ReaderInitialState = {}) {
    if (chapters.length === 0) {
      throw new Error("ReaderController 至少需要一章");
    }
    this.chapters = chapters;
    const chapterIndex = clamp(initial.chapterIndex ?? 0, 0, chapters.length - 1);
    const pageCount = chapters[chapterIndex].pages.length;
    const pageIndex = clamp(initial.pageIndex ?? 0, 0, Math.max(0, pageCount - 1));
    const speed = READER_SPEEDS.includes(initial.speed as (typeof READER_SPEEDS)[number])
      ? (initial.speed as number)
      : 1;
    this.state = {
      chapterIndex,
      pageIndex,
      pageCount,
      chapterCount: chapters.length,
      mode: initial.mode ?? "vertical",
      speed,
      locked: false,
      barsVisible: true,
      cropMode: initial.cropMode === true,
      autoplay: false,
    };
  }

  snapshot(): ReaderSnapshot {
    return { ...this.state };
  }

  get currentChapter(): ReaderChapter {
    return this.chapters[this.state.chapterIndex];
  }

  get currentPage(): ReaderPage {
    return this.currentChapter.pages[this.state.pageIndex];
  }

  get pageCount(): number {
    return this.state.pageCount;
  }

  setChapter(index: number, page = 0): boolean {
    if (index < 0 || index >= this.chapters.length) return false;
    this.state.chapterIndex = index;
    this.state.pageCount = this.chapters[index].pages.length;
    this.state.pageIndex = clamp(page, 0, Math.max(0, this.state.pageCount - 1));
    return true;
  }

  setPage(index: number): boolean {
    const next = clamp(index, 0, Math.max(0, this.state.pageCount - 1));
    if (next === this.state.pageIndex) return false;
    this.state.pageIndex = next;
    return true;
  }

  /** 进度条 0~1 → 页索引（四舍五入）。 */
  setProgress(ratio: number): boolean {
    if (this.state.pageCount <= 1) return false;
    const normalized = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    return this.setPage(Math.round(normalized * (this.state.pageCount - 1)));
  }

  progress(): number {
    if (this.state.pageCount <= 1) return 0;
    return this.state.pageIndex / (this.state.pageCount - 1);
  }

  nextPage(): PageStep {
    if (this.state.pageIndex < this.state.pageCount - 1) {
      this.state.pageIndex += 1;
      return "page";
    }
    if (this.state.chapterIndex < this.chapters.length - 1) {
      this.setChapter(this.state.chapterIndex + 1, 0);
      return "chapter";
    }
    return "end";
  }

  prevPage(): PageStep {
    if (this.state.pageIndex > 0) {
      this.state.pageIndex -= 1;
      return "page";
    }
    if (this.state.chapterIndex > 0) {
      const prev = this.state.chapterIndex - 1;
      this.setChapter(prev, this.chapters[prev].pages.length - 1);
      return "chapter";
    }
    return "start";
  }

  showBars(): void {
    if (!this.state.locked) this.state.barsVisible = true;
  }

  hideBars(): void {
    this.state.barsVisible = false;
  }

  toggleBars(): void {
    if (this.state.locked) return;
    this.state.barsVisible = !this.state.barsVisible;
  }

  /** 锁定 = 收起双框进入专注模式；再次调用 = 解锁并唤出双框。 */
  toggleLock(): boolean {
    this.state.locked = !this.state.locked;
    this.state.barsVisible = !this.state.locked;
    return this.state.locked;
  }

  unlock(): boolean {
    if (!this.state.locked) return false;
    this.state.locked = false;
    this.state.barsVisible = true;
    return true;
  }

  toggleAutoplay(): boolean {
    this.state.autoplay = !this.state.autoplay;
    return this.state.autoplay;
  }

  setAutoplay(value: boolean): void {
    this.state.autoplay = value;
  }

  cycleSpeed(): number {
    const index = READER_SPEEDS.indexOf(
      this.state.speed as (typeof READER_SPEEDS)[number],
    );
    const next = READER_SPEEDS[(index + 1) % READER_SPEEDS.length];
    this.state.speed = next;
    return next;
  }

  cycleMode(): ReaderMode {
    const index = READER_MODES.indexOf(this.state.mode);
    const next = READER_MODES[(index + 1) % READER_MODES.length];
    this.state.mode = next;
    return next;
  }

  toggleCrop(): boolean {
    this.state.cropMode = !this.state.cropMode;
    return this.state.cropMode;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
