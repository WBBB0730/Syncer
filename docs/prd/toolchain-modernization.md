# toolchain-modernization

**依赖与脚手架现代化**

## Problem Statement

Syncer 桌面端与移动端长期停留在已过时的脚手架与运行时（Electron 13 + Vue CLI、RN 0.72 裸工程），依赖难以升级，安全模型（渲染进程 Node 集成）不符合现状，阻碍重启开发与维护。

## Solution

用官方推荐脚手架重建两端工程并迁回既有业务：桌面端 electron-vite（Vue 3 + Pinia + 安全 IPC），移动端 Expo development build（本地 prebuild / run）；保留局域网 Discovery / Session 协议与产品能力，补齐 CONTEXT / DESIGN / ADR / PRD 文档。打包走本地，CI 用 GitHub Actions。

## User Stories

- 作为维护者，我可以在新脚手架上启动桌面端开发服务器并完成类型检查。
- 作为维护者，我可以在 Expo development build 流程下安装依赖并完成 TypeScript 检查。
- 作为用户，我仍能在同一 Wi-Fi 下完成 Device Discovery、建立 Session，并进行 Text Transfer / File Transfer / Command / Find Device（协议兼容旧行为）。
- 作为维护者，我可以在仓库文档中查到领域术语、视觉约定与关键架构决策。

## Implementation Decisions

- 采用方案 B：新建脚手架目录后迁入业务，旧工程保留为 `*-legacy` 对照。
- 桌面：主进程承载 UDP/TCP 与系统能力；preload 暴露窄 API；Pinia + Ant Design Vue；`@nut-tree-fork/nut-js` 替代 robotjs。
- 移动：Expo SDK 57 + `expo-dev-client`；保留 tcp-socket / udp；本地打包，不使用 EAS。
- CI：GitHub Actions 做类型检查与桌面编译验证；安装包不在 EAS 产出。
- 协议端口与消息类型不在本 PRD 内变更（见 ADR-0003）。

## Testing Decisions

- 桌面：`npm run typecheck`；`npx electron-vite build` / 本地 `npm run build:win`。
- 移动：`npx tsc --noEmit`；本地 `npx expo prebuild` / `expo run:android`。
- CI 流水线见 `.github/workflows/ci.yml`。
- Windows 环境不强制验证 iOS。
- 联调以同网 Discovery + 文本收发为冒烟标准；完整双端真机联调依赖本机网络与权限。

## Out of Scope

- 传输加密、大文件流式传输、剪贴板自动同步、设置页、心跳与开机自启。
- 重写产品信息架构或更换品牌视觉体系。
- 删除 legacy 目录（可在确认新栈稳定后另做清理）。

## Further Notes

- 移动端接收文件目录可能从公共 Downloads 变为应用文档目录，需在后续版本评估是否恢复用户可见路径。
- 桌面托盘常驻与关闭即隐藏行为需保留。
