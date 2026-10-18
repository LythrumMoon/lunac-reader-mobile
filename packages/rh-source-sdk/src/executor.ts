// 声明式来源执行器：规则 + 宿主 API → RSP 的 ResourceSource。
//
// 只依赖 `host.ts` 的 net 能力；HTML 解析通过 `parseHtml` 注入，
// 浏览器默认用 DOMParser，Node / 测试可传入自己的实现或只用 JSON 规则。

import {
  RspError,
  type Chapter,
  type ComicPage,
  type DeclarativeRule,
  type ListRule,
  type Paged,
  type Playback,
  type ResourceSource,
  type SourceCallOptions,
  type SourceManifest,
  type TextChapter,
  type Work,
  type WorkRef,
} from "./contract.js";
import {
  buildRequestUrl,
  extractHtmlRows,
  extractJsonRows,
  interpolate,
  type RuleVars,
} from "./evaluate.js";
import type { LunacHostV3, NetApi } from "./host.js";

export interface DeclarativeSourceDeps {
  host: LunacHostV3;
  /** 覆盖 `host.net`（缓存 / 限速 / 取消）；缺省直接用宿主网络。 */
  net?: NetApi;
  /** HTML → DOM；默认 DOMParser（浏览器）。 */
  parseHtml?(html: string): ParentNode;
}

export interface DeclarativeSourceInput {
  manifest: SourceManifest;
  rule: DeclarativeRule;
}

function defaultParseHtml(html: string): ParentNode {
  if (typeof DOMParser === "undefined") {
    throw new RspError("unsupported", "当前运行时没有 DOMParser，无法解析 HTML 规则", undefined);
  }
  return new DOMParser().parseFromString(html, "text/html");
}

function resolveUrl(baseUrl: string | undefined, value: string): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || !baseUrl) return value;
  try {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(value.replace(/^\//, ""), base).toString();
  } catch {
    return value;
  }
}

function interpolateMap(
  values: Record<string, string> | undefined,
  vars: RuleVars,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    out[key] = interpolate(value, vars);
  }
  return out;
}

function statusError(status: number, url: string, sourceId: string): RspError {
  if (status === 401) return new RspError("auth", `需要登录：${url}`, sourceId);
  if (status === 403) return new RspError("blocked", `来源拒绝访问：${url}`, sourceId);
  return new RspError("network", `HTTP ${status}：${url}`, sourceId);
}

export function createDeclarativeSource(
  input: DeclarativeSourceInput,
  deps: DeclarativeSourceDeps,
): ResourceSource {
  const { manifest, rule } = input;
  const sourceId = manifest.id;
  const parseHtml = deps.parseHtml ?? defaultParseHtml;
  const net = deps.net ?? deps.host.net;

  async function runList(
    listRule: ListRule,
    vars: RuleVars,
    options?: SourceCallOptions,
  ): Promise<Record<string, string>[]> {
    const url = buildRequestUrl(manifest.baseUrl, listRule.request, vars);
    const headers = {
      ...interpolateMap(manifest.headers, vars),
      ...interpolateMap(listRule.request.headers, vars),
    };
    const asJson = !!listRule.list.jsonPath;
    const response = await net.request({
      url,
      method: listRule.request.method,
      headers,
      body: listRule.request.body
        ? interpolate(listRule.request.body, vars)
        : undefined,
      timeoutMs: options?.timeoutMs ?? 8_000,
      signal: options?.signal,
    });
    if (response.status >= 400) {
      throw statusError(response.status, url, sourceId);
    }
    if (asJson) {
      let payload: unknown;
      try {
        payload = JSON.parse(response.body);
      } catch {
        throw new RspError("parse", `响应不是合法 JSON：${url}`, sourceId);
      }
      return extractJsonRows(payload, listRule, vars);
    }
    return extractHtmlRows(parseHtml(response.body), listRule, vars);
  }

  function baseVars(): RuleVars {
    return { sourceId };
  }

  function rowsToWorks(rows: Record<string, string>[]): Work[] {
    const kind = manifest.kind[0] ?? "comic";
    return rows
      .map((row, index): Work => {
        const id = row.id || row.url || String(index);
        return {
          ref: { sourceId, workId: id, kind },
          title: row.title || id,
          author: row.author || undefined,
          cover: resolveUrl(manifest.baseUrl, row.cover ?? ""),
          description: row.description || undefined,
          tags: row.tags
            ? row.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
            : undefined,
        };
      })
      .filter((work) => work.title !== "");
  }

  function chapterVars(ref: WorkRef): RuleVars {
    const workUrl = resolveUrl(manifest.baseUrl, ref.workId);
    return { ...baseVars(), workId: ref.workId, workUrl };
  }

  function chapterVarsFromChapter(chapter: Chapter): RuleVars {
    const chapterUrl = resolveUrl(manifest.baseUrl, chapter.id);
    return {
      ...baseVars(),
      workId: chapter.workId,
      workUrl: resolveUrl(manifest.baseUrl, chapter.workId),
      chapterId: chapter.id,
      chapterUrl,
    };
  }

  const source: ResourceSource = {
    manifest,
    async search(query: string, page = 1, options?: SourceCallOptions): Promise<Paged<Work>> {
      if (!rule.search) {
        throw new RspError("unsupported", `${sourceId} 没有 search 规则`, sourceId);
      }
      const rows = await runList(rule.search, { ...baseVars(), keyword: query, page }, options);
      const items = rowsToWorks(rows);
      return { items, next: rows.length > 0 ? String(page + 1) : null };
    },
    async chapters(ref: WorkRef, options?: SourceCallOptions): Promise<Chapter[]> {
      if (!rule.chapters) {
        throw new RspError("unsupported", `${sourceId} 没有 chapters 规则`, sourceId);
      }
      const rows = await runList(rule.chapters, chapterVars(ref), options);
      return rows.map((row, index) => ({
        id: row.id || row.url || String(index),
        workId: ref.workId,
        title: row.title || `${index + 1}`,
        index,
      }));
    },
    async pages(chapter: Chapter, options?: SourceCallOptions): Promise<ComicPage[]> {
      if (!rule.pages) {
        throw new RspError("unsupported", `${sourceId} 没有 pages 规则`, sourceId);
      }
      const rows = await runList(rule.pages, chapterVarsFromChapter(chapter), options);
      const headers = interpolateMap(manifest.headers, chapterVarsFromChapter(chapter));
      return rows.map((row, index) => ({
        index,
        url: resolveUrl(manifest.baseUrl, row.url || row.src || ""),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }));
    },
    async content(chapter: Chapter, options?: SourceCallOptions): Promise<TextChapter> {
      if (!rule.content) {
        throw new RspError("unsupported", `${sourceId} 没有 content 规则`, sourceId);
      }
      const rows = await runList(rule.content, chapterVarsFromChapter(chapter), options);
      const content = rows[0]?.content ?? rows[0]?.text ?? "";
      return { chapterId: chapter.id, format: "text", content };
    },
    async play(chapter: Chapter, options?: SourceCallOptions): Promise<Playback[]> {
      if (!rule.play) {
        throw new RspError("unsupported", `${sourceId} 没有 play 规则`, sourceId);
      }
      const rows = await runList(rule.play, chapterVarsFromChapter(chapter), options);
      const headers = interpolateMap(manifest.headers, chapterVarsFromChapter(chapter));
      return rows
        .map((row): Playback => {
          const url = resolveUrl(manifest.baseUrl, row.url || row.playUrl || "");
          const declared = row.type;
          const type: Playback["type"] =
            declared === "hls" || declared === "mp4" || declared === "dash" || declared === "webview"
              ? declared
              : /\.m3u8(\?|$)/i.test(url)
                ? "hls"
                : "mp4";
          return {
            url,
            type,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          };
        })
        .filter((playback) => playback.url !== "");
    },
  };

  return source;
}
