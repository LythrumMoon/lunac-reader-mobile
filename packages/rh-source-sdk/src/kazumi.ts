import {
  RSP_VERSION,
  RspError,
  type DeclarativeRule,
  type FieldExtractor,
  type ListRule,
  type SourceManifest,
} from "./contract.js";
import { validateSourceManifest } from "./manifest.js";

/**
 * Kazumi 规则的公开字段（只声明我们用得到的部分）。
 *
 * **这是格式参照，不是依赖**：我们不 import Kazumi 的代码、不运行它的 XPath 引擎，
 * 只把这份 JSON 翻译成 RSP 的声明式规则。真实规则由用户自行导入。
 */
export interface KazumiRule {
  api?: string;
  type?: string;
  name?: string;
  version?: string;
  baseURL?: string;
  searchMode?: string;
  searchURL?: string;
  searchList?: string;
  searchName?: string;
  searchResult?: string;
  chapterRoads?: string;
  chapterResult?: string;
  searchApiConfig?: KazumiApiConfig;
  useWebview?: boolean;
  useNativePlayer?: boolean;
  muliSources?: boolean;
  useLegacyParser?: boolean;
  adBlocker?: boolean;
  usePost?: boolean;
  referer?: string;
  userAgent?: string;
  [key: string]: unknown;
}

export interface KazumiApiConfig {
  request?: {
    method?: string;
    url?: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  };
  listPath?: string;
  namePath?: string;
  sourcePath?: string;
  sourceTemplate?: string;
  [key: string]: unknown;
}

export interface KazumiConversion {
  manifest: SourceManifest;
  rule: DeclarativeRule;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 稳定短哈希：名字只有中文时也能生成合法 id。 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8);
}

function slugId(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `kazumi.${ascii || `source-${fnv1a(name)}`}`;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} 必须是非空字符串`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fail(message: string): never {
  throw new RspError("parse", message);
}

function textField(selector: FieldExtractor["selector"]): FieldExtractor {
  return { selector, text: true };
}

function hrefField(selector: FieldExtractor["selector"]): FieldExtractor {
  return { selector, attr: "href" };
}

/**
 * Kazumi JSON → RSP 声明式规则。
 *
 * 支持两种搜索模式：
 *  - `searchMode: "api"`：`searchApiConfig`（JSONPath）；
 *  - 其它：`searchURL` + `searchList/searchName/searchResult`（XPath）。
 *
 * 章节固定走 XPath：`chapterRoads` 为列表，`chapterResult` 为列表项里的链接。
 * 不支持的能力会写进 `warnings`，不静默丢弃。
 */
export function convertKazumiRule(raw: unknown): KazumiConversion {
  if (!isRecord(raw)) fail("Kazumi 规则必须是对象");
  const rule = raw as KazumiRule;
  const name = asString(rule.name, "name");
  const warnings: string[] = [];

  if (rule.type && rule.type !== "anime") {
    warnings.push(`Kazumi type=${rule.type}，本转换器按 anime 处理`);
  }
  if (rule.useWebview) {
    warnings.push("useWebview 需要宿主 WebView 嗅探，v1 不执行该字段");
  }
  if (rule.muliSources) {
    warnings.push("muliSources 多镜像暂不支持，只取主站");
  }
  if (rule.useLegacyParser) {
    warnings.push("useLegacyParser 暂不支持");
  }
  if (rule.adBlocker) {
    warnings.push("adBlocker 由宿主网络层处理，规则层忽略");
  }

  const search = convertSearch(rule, warnings);
  const chapters = convertChapters(rule);

  const manifestInput: Record<string, unknown> = {
    rsp: RSP_VERSION,
    id: slugId(name),
    name,
    version: optionalString(rule.version) ?? "0.0.0",
    kind: ["anime"],
    engine: "declarative",
    entry: "rule.json",
    baseUrl: optionalString(rule.baseURL) ?? "",
    homepage: optionalString(rule.baseURL) ?? "",
    license: "user-imported",
    capabilities: chapters ? ["search", "chapters"] : ["search"],
    nsfw: false,
  };

  const headers: Record<string, string> = {};
  if (rule.userAgent) headers["User-Agent"] = rule.userAgent;
  if (rule.referer) headers["Referer"] = rule.referer;
  if (Object.keys(headers).length > 0) manifestInput.headers = headers;

  return {
    manifest: validateSourceManifest(manifestInput),
    rule: { search, ...(chapters ? { chapters } : {}) },
    warnings,
  };
}

function convertSearch(rule: KazumiRule, warnings: string[]): ListRule {
  const config = rule.searchApiConfig;
  if ((rule.searchMode === "api" || config) && config) {
    const request = config.request;
    if (!isRecord(request)) fail("searchApiConfig.request 缺失");
    const url = asString(request.url, "searchApiConfig.request.url");
    const method = (optionalString(request.method) ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      fail(`searchApiConfig.request.method 不支持：${method}`);
    }
    const query = readStringMap(request.query, "searchApiConfig.request.query");
    const fields: Record<string, FieldExtractor> = {
      id: {
        selector: { jsonPath: optionalString(config.sourcePath) ?? "$.id" },
        ...(optionalString(config.sourceTemplate)
          ? { template: optionalString(config.sourceTemplate)!.replace(/@source/g, "@value") }
          : {}),
      },
      title: textField({ jsonPath: optionalString(config.namePath) ?? "$.name" }),
    };
    return {
      request: {
        method,
        url,
        ...(query ? { query } : {}),
        ...(readStringMap(request.headers, "searchApiConfig.request.headers")
          ? { headers: readStringMap(request.headers, "searchApiConfig.request.headers")! }
          : {}),
      },
      list: { jsonPath: optionalString(config.listPath) ?? "$.list[*]" },
      fields,
    };
  }

  const searchURL = optionalString(rule.searchURL);
  const searchList = optionalString(rule.searchList);
  if (!searchURL || !searchList) {
    throw new RspError(
      "unsupported",
      "Kazumi 规则缺少 searchURL/searchList（且没有 searchApiConfig）",
    );
  }
  if (!searchURL.includes("@keyword")) {
    warnings.push("searchURL 不含 @keyword，搜索词可能无法传入");
  }
  const nameSelector = { xpath: optionalString(rule.searchName) ?? searchList };
  const resultSelector = { xpath: optionalString(rule.searchResult) ?? optionalString(rule.searchName) ?? searchList };
  return {
    request: { method: "GET", url: searchURL },
    list: { xpath: searchList },
    fields: {
      id: hrefField(resultSelector),
      title: textField(nameSelector),
    },
  };
}

function convertChapters(rule: KazumiRule): ListRule | undefined {
  const roads = optionalString(rule.chapterRoads);
  const result = optionalString(rule.chapterResult);
  if (!roads || !result) return undefined;
  return {
    // `@workUrl` 由执行器替换为详情页 URL；Kazumi 的章节页就是详情页。
    request: { method: "GET", url: "@workUrl" },
    list: { xpath: roads },
    fields: {
      id: hrefField({ xpath: result }),
      title: textField({ xpath: result }),
    },
  };
}

function readStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail(`${field} 必须是对象`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") fail(`${field}.${k} 必须是字符串`);
    out[k] = v;
  }
  return out;
}
