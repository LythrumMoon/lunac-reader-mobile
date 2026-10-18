import {
  RSP_VERSION,
  RspError,
  type DeclarativeRule,
  type SourceEngine,
  type SourceKind,
  type SourceManifest,
} from "./contract.js";

/**
 * 规则仓库（Registry）—— 把三个上游生态的「索引」聚合到同一份清单里。
 *
 * **重要边界**：
 *  - 这里只记录**上游地址与元数据**，不复制上游的规则 / 脚本内容；
 *  - `license` / `attribution` 必须保留，**不得**为了「看起来像自己的」而抹掉；
 *  - 聚合可以做的是：统一字段、去重、版本比较、补 warnings。
 */

export type Upstream = "kazumi" | "venera" | "uzvideo" | "manual";

export interface RegistryEntry {
  /** 全局 id：`<upstream>.<slug>`，与 RSP 清单 id 同规则。 */
  id: string;
  name: string;
  upstream: Upstream;
  /** 上游自己的 key / name / fileName。 */
  upstreamId: string;
  version: string;
  kind: SourceKind[];
  engine: SourceEngine;
  /** 上游规则 / 脚本地址（只链接，不内嵌）。 */
  sourceUrl?: string;
  homepage?: string;
  license?: string;
  attribution?: string;
  warnings: string[];
  /**
   * 自建（`upstream: "manual"`）来源的内嵌规则，便于离线演示「导入 registry → 安装」。
   * **只允许放本仓库自有的规则**；上游 Kazumi / Venera / uzVideo 仍然只登记 `sourceUrl`，
   * 不得把它们的规则正文抄进来。
   */
  source?: { manifest: SourceManifest; rule: DeclarativeRule };
}

export interface RegistryBundle {
  rsp: typeof RSP_VERSION;
  generatedAt: string;
  entries: RegistryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slug(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (ascii) return ascii;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `source-${hash.toString(16).padStart(8, "0")}`;
}

function joinUrl(baseUrl: string, file: string): string | undefined {
  if (!file) return undefined;
  try {
    return new URL(file, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function versionParts(version: string): number[] {
  return version
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** 数字段比较；`1.10.0 > 1.9.0`，非数字段按 0。 */
export function compareVersion(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** KazumiRules/index.json → RegistryEntry[]。 */
export function fromKazumiIndex(
  raw: unknown,
  baseUrl: string,
  attribution = "KazumiRules",
): RegistryEntry[] {
  if (!Array.isArray(raw)) throw new RspError("parse", "Kazumi 索引必须是数组");
  const entries: RegistryEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const fileName = str(item.fileName) || `${name}.json`;
    entries.push({
      id: `kazumi.${slug(name)}`,
      name,
      upstream: "kazumi",
      upstreamId: name,
      version: str(item.version) || "0.0.0",
      kind: ["anime"],
      engine: "declarative",
      sourceUrl: joinUrl(baseUrl, fileName),
      homepage: baseUrl,
      license: "MIT",
      attribution,
      warnings: str(item.author) ? [`上游作者：${str(item.author)}`] : [],
    });
  }
  return entries;
}

/** venera_comic_source/index.json → RegistryEntry[]。 */
export function fromVeneraIndex(
  raw: unknown,
  baseUrl: string,
  attribution = "Venera comic sources",
): RegistryEntry[] {
  if (!Array.isArray(raw)) throw new RspError("parse", "Venera 索引必须是数组");
  const entries: RegistryEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    const key = str(item.key) || name;
    if (!name || !key) continue;
    const remote = str(item.url);
    const local = str(item.fileName);
    entries.push({
      id: `venera.${slug(key)}`,
      name,
      upstream: "venera",
      upstreamId: key,
      version: str(item.version) || "0.0.0",
      kind: ["comic"],
      engine: "js",
      sourceUrl: remote || joinUrl(baseUrl, local),
      homepage: baseUrl,
      // Venera 本体是 GPL-3.0；单个源脚本的许可以上游文件为准，默认按「未声明」处理。
      license: undefined,
      attribution,
      warnings: [
        "Venera 源为 JS 脚本；v1 只登记地址，不复制内容",
        "单个源脚本的许可以上游文件为准",
      ],
    });
  }
  return entries;
}

/**
 * uzVideo 扩展索引 → RegistryEntry[]。
 *
 * uzVideo 没有稳定的官方 index（扩展以 `uzAio.zip` 分发），所以这里接受一份
 * **用户/构建脚本整理出的条目数组**，字段尽量宽松。
 */
export function fromUzVideoIndex(
  raw: unknown,
  baseUrl: string,
  attribution = "uzVideo extensions",
): RegistryEntry[] {
  if (!Array.isArray(raw)) throw new RspError("parse", "uzVideo 索引必须是数组");
  const entries: RegistryEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const remote = str(item.url);
    const local = str(item.fileName);
    entries.push({
      id: `uzvideo.${slug(str(item.key) || name)}`,
      name,
      upstream: "uzvideo",
      upstreamId: str(item.key) || name,
      version: str(item.version) || "0.0.0",
      kind: ["anime"],
      engine: "js",
      sourceUrl: remote || joinUrl(baseUrl, local),
      homepage: baseUrl,
      // 上游仓库未见 LICENSE ⇒ 默认保留所有权利，只登记、不复制。
      license: undefined,
      attribution,
      warnings: [
        "uzVideo 扩展为 JS 脚本；上游未见 LICENSE，只登记地址、不复制内容",
        "v1 不执行该脚本",
      ],
    });
  }
  return entries;
}

/**
 * 合并三类索引：全局 id 去重、版本高者胜、warnings 合并。
 *
 * 传 `generatedAt` 是为了让测试可复现；生产调用可以省略。
 */
export function mergeRegistry(
  entries: RegistryEntry[],
  generatedAt = new Date().toISOString(),
): RegistryBundle {
  const byId = new Map<string, RegistryEntry>();
  for (const entry of entries) {
    if (!entry.id || !entry.name) continue;
    const current = byId.get(entry.id);
    if (!current) {
      byId.set(entry.id, { ...entry, warnings: [...entry.warnings] });
      continue;
    }
    const newer = compareVersion(entry.version, current.version) > 0 ? entry : current;
    const older = newer === entry ? current : entry;
    byId.set(entry.id, {
      ...newer,
      warnings: [...new Set([...older.warnings, ...newer.warnings])],
    });
  }
  return {
    rsp: RSP_VERSION,
    generatedAt,
    entries: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** 读取并校验一份 registry bundle（插件 / AI 工具共用）。 */
export function parseRegistry(raw: unknown): RegistryBundle {
  if (!isRecord(raw)) throw new RspError("parse", "registry 必须是对象");
  if (raw.rsp !== RSP_VERSION) throw new RspError("parse", `registry.rsp 必须是 ${RSP_VERSION}`);
  if (!Array.isArray(raw.entries)) throw new RspError("parse", "registry.entries 必须是数组");
  const entries: RegistryEntry[] = [];
  for (const item of raw.entries) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const name = str(item.name);
    if (!id || !name) continue;
    const embedded = item.source;
    const source =
      isRecord(embedded) && isRecord(embedded.manifest) && isRecord(embedded.rule)
        ? {
            manifest: embedded.manifest as unknown as SourceManifest,
            rule: embedded.rule as unknown as DeclarativeRule,
          }
        : undefined;
    entries.push({
      id,
      name,
      upstream: str(item.upstream) as Upstream || "manual",
      upstreamId: str(item.upstreamId) || id,
      version: str(item.version) || "0.0.0",
      kind: Array.isArray(item.kind) ? (item.kind as SourceKind[]) : ["anime"],
      engine: (str(item.engine) as SourceEngine) || "declarative",
      sourceUrl: str(item.sourceUrl) || undefined,
      homepage: str(item.homepage) || undefined,
      license: str(item.license) || undefined,
      attribution: str(item.attribution) || undefined,
      warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : [],
      source,
    });
  }
  return {
    rsp: RSP_VERSION,
    generatedAt: str(raw.generatedAt) || new Date().toISOString(),
    entries,
  };
}
