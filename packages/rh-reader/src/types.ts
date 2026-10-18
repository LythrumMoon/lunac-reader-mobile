// 阅读器共享契约 —— 插件（Windows）与后续 iOS / Android 独立应用共用。
// 这里只放纯状态与几何，不依赖 DOM，方便单测与移动端复用。

export type ReaderMode = "vertical" | "paged" | "webtoon";

export type TapZone = "prev" | "next" | "toggle";

export type PageKind = "text" | "placeholder" | "image";

export interface ReaderPage {
  id: string;
  kind: PageKind;
  /** 文本页正文；图片页可放 URL。 */
  content?: string;
  /** 图片页说明 / 占位文案。 */
  caption?: string;
}

export interface ReaderChapter {
  id: string;
  title: string;
  pages: ReaderPage[];
  /** 内容尚未加载（跨章按需加载）；阅读器进入该章时调用 `loadChapter`。 */
  lazy?: boolean;
}

export interface ReaderSnapshot {
  chapterIndex: number;
  pageIndex: number;
  pageCount: number;
  chapterCount: number;
  mode: ReaderMode;
  speed: number;
  locked: boolean;
  barsVisible: boolean;
  cropMode: boolean;
  autoplay: boolean;
}

export interface ReaderInitialState {
  chapterIndex?: number;
  pageIndex?: number;
  mode?: ReaderMode;
  speed?: number;
  cropMode?: boolean;
}

export const READER_SPEEDS = [0.5, 1, 1.5, 2, 3] as const;

export const READER_MODES: ReaderMode[] = ["vertical", "paged", "webtoon"];

/**
 * 点击分区：
 *  - 上下模式（vertical / webtoon）：上 35% 上一页，中间 30% 唤出/收起双框，下 35% 下一页；
 *  - 左右模式（paged）：左 35% 上一页，中间 30% 唤出/收起双框，右 35% 下一页。
 *
 * 坐标单位为逻辑像素；宽高必须 > 0，否则按 toggle 处理。
 */
export function resolveTapZone(
  x: number,
  y: number,
  width: number,
  height: number,
  mode: ReaderMode,
): TapZone {
  if (width <= 0 || height <= 0) return "toggle";
  if (mode === "paged") {
    const ratio = x / width;
    if (ratio < 0.35) return "prev";
    if (ratio >= 0.65) return "next";
    return "toggle";
  }
  const ratio = y / height;
  if (ratio < 0.35) return "prev";
  if (ratio >= 0.65) return "next";
  return "toggle";
}
