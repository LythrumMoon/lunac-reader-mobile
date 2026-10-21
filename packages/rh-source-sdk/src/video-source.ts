// 视频源（type 101）适配（2026-10-18）。
//
// 上游形态：一组全局函数 `getVideoPlayUrl` / `searchVideo` / `getVideoDetail`，
// 配合 `req` / `cheerio` / `UZUtils`。这里只翻译三条主链路：
//   searchVideo      → search
//   getVideoDetail   → chapters（vod_play_from / vod_play_url）
//   getVideoPlayUrl  → play
// 具体 API 由 `comic-shim.ts` 的 VIDEO_PRELUDE 在沙箱里补齐。

import {
  RspError,
  type Chapter,
  type Paged,
  type Playback,
  type ResourceSource,
  type SourceManifest,
  type Work,
} from "./contract.js";
import type { LunacHostV3 } from "./host.js";
import { toRspError } from "./js-source.js";
import { VIDEO_PRELUDE, VIDEO_RUNNER, COMIC_PRELUDE } from "./comic-shim.js";

export interface VideoSourceInput {
  manifest: SourceManifest;
  script: string;
}

const EVAL_TIMEOUT_MS = 30_000;

const UZ_METHODS = [
  "getClassList",
  "getSubclassList",
  "getVideoList",
  "getSubclassVideoList",
  "getVideoDetail",
  "getVideoPlayUrl",
  "searchVideo",
];

function hasMethod(script: string, name: string): boolean {
  return (
    new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(script) ||
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(script) ||
    new RegExp(`${name}\\s*[:=]\\s*(?:async\\s*)?function`).test(script)
  );
}

/** 上游脚本是否是 视频扩展形态（显式函数或 BaseCode1 模板）。 */
export function looksLikeVideo(script: string): boolean {
  if (/\/\/#BaseCode1#/.test(script)) return true;
  let hits = 0;
  for (const name of UZ_METHODS) if (hasMethod(script, name)) hits++;
  return hits >= 2;
}

/** 脚本是否提供首页 / 分类浏览，可接入总览 explore。 */
export function videoHasExplore(script: string): boolean {
  if (hasMethod(script, "getHome")) return true;
  return hasMethod(script, "getClassList") && hasMethod(script, "getVideoList");
}

/** 上游约定：成对的 `// ignore` 之间是本地开发代码，不入运行时。 */
function stripIgnored(script: string): string {
  const lines = script.split(/\r?\n/);
  const out: string[] = [];
  let ignoring = false;
  for (const line of lines) {
    if (/^\s*\/\/\s*ignore\s*$/.test(line)) {
      ignoring = !ignoring;
      continue;
    }
    if (!ignoring) out.push(line);
  }
  return out.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function absolute(baseUrl: string | undefined, value: string): string {
  if (!value) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function playbackType(url: string): Playback["type"] {
  const path = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  return "mp4";
}

export function createVideoSource(
  input: VideoSourceInput,
  deps: { host: LunacHostV3 },
): ResourceSource {
  const { manifest, script } = input;
  const { host } = deps;

  if (/\/\/#BaseCode1#/.test(script)) {
    throw new RspError(
      "unsupported",
      "视频源 BaseCode1 嗅探模板暂不支持，请导入 type 101 显式函数扩展",
      manifest.id,
    );
  }

  const runnable = stripIgnored(script);

  async function run(method: string, args: Record<string, unknown>): Promise<unknown> {
    const code = `${COMIC_PRELUDE}\n${VIDEO_PRELUDE}\n${runnable}\n${VIDEO_RUNNER}`;
    try {
      return await host.engine.eval(code, {
        timeoutMs: EVAL_TIMEOUT_MS,
        args: { ...args, method, defaultHeaders: manifest.headers ?? {} },
      });
    } catch (error) {
      throw toRspError(error, manifest);
    }
  }

  function workFrom(raw: unknown, index: number): Work {
    if (!isRecord(raw)) {
      throw new RspError("parse", `视频源 items[${index}] 不是对象`, manifest.id);
    }
    const workId = text(raw.id) ?? String(index);
    return {
      ref: { sourceId: manifest.id, workId, kind: manifest.kind[0] ?? "anime" },
      title: text(raw.title) ?? workId,
      author: text(raw.author),
      cover: text(raw.cover) ? absolute(manifest.baseUrl, text(raw.cover) as string) : undefined,
      description: text(raw.description),
      tags: Array.isArray(raw.tags)
        ? raw.tags.map((tag) => text(tag)).filter((tag): tag is string => Boolean(tag))
        : undefined,
      status: raw.status === "ongoing" || raw.status === "completed" ? raw.status : undefined,
    };
  }

  return {
    manifest,

    async detail(ref): Promise<Work> {
      const result = await run("detail", { workId: ref.workId });
      if (!isRecord(result) || !isRecord(result.work)) {
        throw new RspError("parse", "视频源 detail 返回了意外结构", manifest.id);
      }
      return workFrom(result.work, 0);
    },

    async search(query: string, page = 1): Promise<Paged<Work>> {
      const result = await run("search", { query, page });
      if (!isRecord(result) || !Array.isArray(result.items)) {
        throw new RspError("parse", "视频源 search 返回了意外结构", manifest.id);
      }
      return { items: result.items.map(workFrom), next: null };
    },

    async explore(section = "", page = 1): Promise<Paged<Work>> {
      if (!videoHasExplore(script)) {
        throw new RspError(
          "unsupported",
          "视频源没有实现 getHome / getClassList",
          manifest.id,
        );
      }
      const result = await run("explore", { section, page });
      if (!isRecord(result) || !Array.isArray(result.items)) {
        throw new RspError("parse", "视频源 explore 返回了意外结构", manifest.id);
      }
      return {
        items: result.items.map(workFrom),
        next: section ? String(page + 1) : null,
      };
    },

    async chapters(work): Promise<Chapter[]> {
      const result = await run("chapters", { workId: work.workId });
      if (!isRecord(result) || !Array.isArray(result.chapters)) {
        throw new RspError("parse", "视频源 chapters 返回了意外结构", manifest.id);
      }
      return result.chapters.map((raw, index) => {
        const item = isRecord(raw) ? raw : {};
        const id = text(item.id) ?? String(index);
        return {
          id,
          workId: work.workId,
          title: text(item.title) ?? id,
          index,
          group: text(item.group),
        };
      });
    },

    async play(chapter): Promise<Playback[]> {
      const result = await run("play", {
        workId: chapter.workId,
        chapterId: chapter.id,
      });
      if (!isRecord(result) || !Array.isArray(result.playbacks)) {
        throw new RspError("parse", "视频源 play 返回了意外结构", manifest.id);
      }
      const playbacks: Playback[] = result.playbacks.map((raw, index) => {
        const item = isRecord(raw) ? raw : {};
        const url = text(item.url) ?? text(raw) ?? "";
        if (!url) throw new RspError("parse", `视频源 play[${index}] 缺少 url`, manifest.id);
        const headers = isRecord(item.headers)
          ? Object.fromEntries(
              Object.entries(item.headers)
                .map(([key, value]) => [key, typeof value === "string" ? value : String(value)])
                .filter(([, value]) => value !== ""),
            )
          : undefined;
        return {
          url: absolute(manifest.baseUrl, url),
          type: playbackType(url),
          headers,
        };
      });
      if (!playbacks.length) {
        throw new RspError("unsupported", "视频源没有返回可播放地址", manifest.id);
      }
      return playbacks;
    },
  };
}
