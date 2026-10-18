// RSP v1 —— 资源源协议的唯一真相源。
//
// 只放「跨宿主共享」的契约：Lunac 插件、iOS / Android 独立应用、AI 工具都读这一份。
// 不要在这里引入 DOM / Node / Tauri 类型；它必须能在任何运行时里 import。

export const RSP_VERSION = 1 as const;

export type SourceKind = "comic" | "novel" | "anime" | "tv";

export type SourceEngine = "declarative" | "js" | "builtin";

export type RspErrorCode =
  | "network"
  | "parse"
  | "auth"
  | "blocked"
  | "unsupported"
  | "unknown";

/** 统一的来源错误。UI / AI / 日志都按 `code` 展示，不再各自猜文案。 */
export class RspError extends Error {
  readonly code: RspErrorCode;
  readonly sourceId?: string;

  constructor(code: RspErrorCode, message: string, sourceId?: string) {
    super(message);
    this.name = "RspError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

export interface WorkRef {
  sourceId: string;
  workId: string;
  kind: SourceKind;
}

export interface Work {
  ref: WorkRef;
  title: string;
  altTitles?: string[];
  author?: string;
  cover?: string;
  description?: string;
  tags?: string[];
  status?: "ongoing" | "completed" | "unknown";
  updatedAt?: number;
  extra?: Record<string, unknown>;
}

export interface Chapter {
  id: string;
  workId: string;
  title: string;
  index: number;
  group?: string;
  publishedAt?: number;
}

export interface ComicPage {
  index: number;
  url: string;
  headers?: Record<string, string>;
}

export interface TextChapter {
  chapterId: string;
  format: "text" | "html" | "epub";
  content: string;
}

export interface Playback {
  url: string;
  type: "hls" | "mp4" | "dash" | "webview";
  headers?: Record<string, string>;
  subtitles?: { label: string; url: string; lang?: string }[];
  duration?: number;
}

export interface Paged<T> {
  items: T[];
  maxPage?: number;
  next?: string | null;
}

// ── 声明式规则 ──────────────────────────────────────────────────
// 选择器三选一；`jsonPath` 用于 API 型来源，`xpath` 兼容 Kazumi 规则。
export interface Selector {
  css?: string;
  xpath?: string;
  jsonPath?: string;
}

export interface FieldExtractor {
  selector: Selector;
  /** 取属性（如 href / src / data-src）；不写 = 取文本。 */
  attr?: string;
  /** 明确取文本（与 attr 二选一）。 */
  text?: boolean;
  /** 从取到的值里再抽一段（第一个捕获组）。 */
  regex?: string;
  /** 把抽取结果套进模板；`@value` 为占位符。 */
  template?: string;
}

export interface HttpRequestTemplate {
  method: "GET" | "POST";
  /** 相对 `manifest.baseUrl` 或绝对 URL；`@keyword` / `@page` / `@workUrl` 为占位符。 */
  url: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

export interface ListRule {
  request: HttpRequestTemplate;
  list: Selector;
  fields: Record<string, FieldExtractor>;
  paging?: {
    type: "page" | "next";
    param?: string;
    start?: number;
  };
}

export interface DeclarativeRule {
  search?: ListRule;
  chapters?: ListRule;
  pages?: ListRule;
  play?: ListRule;
  content?: ListRule;
}

// ── 清单 ────────────────────────────────────────────────────────
export interface SourceManifest {
  rsp: typeof RSP_VERSION;
  /** 目录名 / 唯一 id：`[a-z0-9._-]`，不以 `.` 开头。 */
  id: string;
  name: string;
  version: string;
  kind: SourceKind[];
  engine: SourceEngine;
  /** 相对来源包根目录；`declarative` 指向规则 JSON。 */
  entry: string;
  baseUrl?: string;
  homepage?: string;
  license?: string;
  minHost?: string;
  headers?: Record<string, string>;
  capabilities: RspCapability[];
  rateLimit?: { rps: number; burst: number };
  nsfw?: boolean;
}

export type RspCapability =
  | "search"
  | "explore"
  | "detail"
  | "chapters"
  | "pages"
  | "content"
  | "play"
  | "auth";

export interface ResourceSource {
  manifest: SourceManifest;
  search?(query: string, page?: number, options?: SourceCallOptions): Promise<Paged<Work>>;
  explore?(section?: string, page?: number, options?: SourceCallOptions): Promise<Paged<Work>>;
  detail?(ref: WorkRef, options?: SourceCallOptions): Promise<Work>;
  chapters?(ref: WorkRef, options?: SourceCallOptions): Promise<Chapter[]>;
  pages?(chapter: Chapter, options?: SourceCallOptions): Promise<ComicPage[]>;
  content?(chapter: Chapter, options?: SourceCallOptions): Promise<TextChapter>;
  play?(chapter: Chapter, options?: SourceCallOptions): Promise<Playback[]>;
}

/** 所有来源调用共用的取消 / 超时选项。 */
export interface SourceCallOptions {
  /** 切换页面 / 新搜索 / 离开详情时取消旧请求。 */
  signal?: AbortSignal;
  /** 单次请求超时；缺省由网络客户端补 8s。 */
  timeoutMs?: number;
}
