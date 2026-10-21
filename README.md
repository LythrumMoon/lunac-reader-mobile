# Lunac Reader Mobile

「阅读」的移动端独立应用（Android APK / iOS 侧载），**不依赖 Lunac 宿主**，与 Windows 版「阅读」插件共享同一套资源源协议与阅读内核。

## 当前状态

本仓库先发布**共享内核**（纯 TypeScript、无宿主依赖）：

```
packages/rh-source-sdk/   RSP v1 数据契约、声明式规则执行器、规则格式转换、
                          聚合仓库解析、带缓存 / 限速 / 取消 / 超时的网络客户端
packages/rh-reader/       阅读控制器与上下框阅读器 UI（含跨章按需加载）
```

Tauri 2 移动端外壳（Android / iOS）尚未接入；接入后放在 `apps/mobile/`，直接复用上述包。

## 手机适配（2026-10-21）

- `rh-reader` 内置手机紧凑断点：`max-width:640px`，或 `max-height:480px` 且触屏
  （横屏手机）。上下框只留图标、动作按钮 44px、底部单行排布，页边距与安全区叠加。
- 左右分页支持**单指横滑翻页**（touch 事件实现；竖向 / 条漫模式不响应）。
- 横屏矮视口与 iPad HD 断点共存，桌面布局不受影响。


## 与 Windows 插件的关系

| 维度 | Windows「阅读」插件 | 本仓库（移动端） |
|---|---|---|
| 宿主 | Lunac 提供窗口、网络、存储、媒体代理、QuickJS | 应用内自建外壳与运行时 |
| 共享 | RSP v1、Host API v3 契约、`rh-source-sdk`、`rh-reader` | 同左 |
| 分发 | Lunac 插件目录 | Android APK；iOS 自签名 / LiveContainer + SideStore |
| App Store | 不适用 | 暂不提交；只做侧载 |

移动端不复制 Lunac 的 Rust 宿主，也不依赖 `__lunac_host` 桥。来源执行所需的网络、存储与媒体代理由移动端外壳按同一契约注入。

## 规则仓库

公开规则仓库：[LythrumMoon/lunac-rules](https://github.com/LythrumMoon/lunac-rules)

- 默认索引：`https://cdn.jsdelivr.net/gh/LythrumMoon/lunac-rules@main/index.json`
- 备选索引：`https://raw.githubusercontent.com/LythrumMoon/lunac-rules/main/index.json`

索引条目只提供地址，不复制规则正文；自建条目才允许内嵌 `source: { manifest, rule }`。

## 开发

```bash
npm install
npm run build
npm test
npm run typecheck
```

要求 Node.js 20+。`rh-reader` 依赖 DOM / `lib.dom`，在移动端 WebView 内运行。

## 合规

- 应用不内置任何第三方作品正文或盗版源；只提供协议、阅读器与用户自行导入的规则。
- 演示来源仅使用公版书目元数据与摘要。
- iOS 完整版只走自签名 / LiveContainer + SideStore，不提交 App Store。

## License

MIT，见 [LICENSE](./LICENSE)。第三方内容不适用本仓库的 MIT 许可。
