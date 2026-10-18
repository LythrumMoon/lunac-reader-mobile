// Lunac 宿主 API v3 契约。
//
// 插件侧只依赖这份类型；宿主未实现时由 mock-host 顶替（见 `mock-host.ts`）。
// 这里同样不 import DOM / Node / Tauri —— 移动端独立应用要能复用。

import { RspError } from "./contract.js";

export const HOST_API_VERSION = 3 as const;

export type HostCapability =
  | "net.request"
  | "media.proxy"
  | "storage.plugin"
  | "engine.eval";

export interface HostRequestInit {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  /** 默认 15000ms。 */
  timeoutMs?: number;
  /** 响应体截断上限，默认 8MB。 */
  maxBytes?: number;
  /** 默认 text；json 会做一次 JSON.parse。 */
  as?: "text" | "json" | "base64";
  /** 取消信号；宿主命令本身不可中断，但调用方会立刻收到取消。 */
  signal?: AbortSignal;
}

export interface HostResponse {
  /** 跟随重定向后的最终地址。 */
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** `as: "json"` 时的解析结果；解析失败抛 `parse`。 */
  json?: unknown;
}

export interface NetApi {
  request(init: HostRequestInit): Promise<HostResponse>;
}

export interface MediaApi {
  /**
   * 把需要 Referer / UA / Cookie 的媒体地址换成宿主本地代理地址。
   * mock 宿主直接返回原地址。
   */
  proxy(
    url: string,
    options?: { headers?: Record<string, string>; sourceId?: string; ttlMs?: number },
  ): string | Promise<string>;
}

export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface EngineApi {
  /** 在沙箱内执行来源脚本；超时 / 内存 / 文件系统由宿主负责。 */
  eval(code: string, options?: { timeoutMs?: number; args?: unknown }): Promise<unknown>;
}

export interface LunacHostV3 {
  apiVersion: number;
  net: NetApi;
  media: MediaApi;
  storage: StorageApi;
  engine: EngineApi;
}

type HostScope = { __lunac_host?: Partial<LunacHostV3> };

/** 宿主注入的桥；在非 Lunac 运行时返回 undefined。 */
export function findHost(scope: unknown = globalThis): Partial<LunacHostV3> | undefined {
  const host = (scope as HostScope | undefined)?.__lunac_host;
  return host && typeof host === "object" ? host : undefined;
}

export function hasHostV3(scope: unknown = globalThis): boolean {
  const host = findHost(scope);
  return !!host && host.apiVersion === HOST_API_VERSION;
}

/** 取 v3 宿主；缺失或版本低时抛 `unsupported`，调用方据此降级为只读本地书库。 */
export function requireHostV3(scope: unknown = globalThis): LunacHostV3 {
  const host = findHost(scope);
  if (!host) {
    throw new RspError("unsupported", "宿主未注入 __lunac_host", undefined);
  }
  if (host.apiVersion !== HOST_API_VERSION) {
    throw new RspError(
      "unsupported",
      `宿主 API 版本 ${String(host.apiVersion)}，需要 ${HOST_API_VERSION}`,
      undefined,
    );
  }
  if (!host.net || !host.media || !host.storage || !host.engine) {
    throw new RspError("unsupported", "宿主 API v3 能力不全", undefined);
  }
  return host as LunacHostV3;
}
