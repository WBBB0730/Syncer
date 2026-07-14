# toolchain-modernization

**依赖与脚手架现代化**

## Problem Statement

Syncer 桌面端与移动端长期停留在已过时的脚手架与运行时（Electron 13 + Vue CLI、RN 0.72 裸工程），依赖难以升级，安全模型（渲染进程 Node 集成）不符合现状，阻碍重启开发与维护。继续兼容已经退出当前工具链支持范围的操作系统，会迫使项目保留同样过时的运行时与分支实现。

## Solution

用官方推荐脚手架重建两端工程并迁回既有产品能力：桌面端采用 Electron 43 + electron-vite（Vue 3 + Pinia + 安全 IPC），移动端采用 Expo SDK 57 development build（本地 prebuild / run）。支持边界统一为 Windows 10+、Android 10 / API 29+ 与 iOS 16.4+；开发工具链要求 Node.js 22.18+（22.x）或 24.3+，iOS 构建要求 Xcode 26.4+。共享协议先独立安装、检查、测试与构建，再验证两个客户端；网络行为与线协议由 `network-stack-vnext` PRD 及其 ADR 定义。

## User Stories

- 作为维护者，我可以从干净检出开始，按文档顺序构建共享协议并完成桌面端类型检查与编译。
- 作为维护者，我可以在 Expo development build 流程下安装依赖并完成移动端 TypeScript 检查。
- 作为维护者，我可以删除并重新生成 `android/` 与 `ios/`，而不丢失权限、签名入口或本地原生模块配置。
- 作为用户，我仍能在同一 Wi-Fi 下完成 Discovery、建立 Session，并进行 Text Transfer、File Transfer、Command 与 Find Device；同代互通规则以 `network-stack-vnext` 为准。
- 作为维护者，我可以在仓库文档中查到领域术语、视觉约定、迁移基线与关键架构决策。

## Implementation Decisions

- 采用方案 B：在新脚手架中迁入业务；迁移前基线固定为重构开始前 `origin/main` 的 commit `6355611`，本地 `*-legacy` 目录不作为版本化基线。
- 项目使用 pnpm workspace 与根目录单一 lockfile，统一声明 Node.js 22.18+（22.x）或 24.3+；不为已停止维护的 Node.js 23、React Native 不支持的 Node.js 24.0–24.2 或已放弃的客户端系统维持兼容分支。
- 桌面：Windows 10+，Electron 43；主进程承载 UDP/TCP 与系统能力；preload 只暴露窄 API；Pinia + Ant Design Vue；生产 renderer 使用受限的 `app://./` 自定义协议；旧 renderer `localStorage` 的五项产品数据在网络启动前一次性原子迁移；Windows 端通过带类型的 `@nut-tree-fork/libnut-win32` 公共 API 执行 Command 按键。接收文件发布使用 Koffi 提供 FFI 边界并调用系统原子无覆盖移动，具体持久化语义见 ADR-0006。
- 移动：Expo SDK 57 + `expo-dev-client`；最低 Android 10 / API 29 与 iOS 16.4；保留 tcp-socket / udp；不使用 EAS。
- `syncer-mobile/android/` 与 `syncer-mobile/ios/` 仅为 CNG 输出，不进入版本库。权限、最低系统版本、Android 正式签名、iOS entitlement、启动资源与本地 Expo module 都必须从 `app.json`、config plugin 或模块源码在干净 prebuild 中重建。
- iOS 真机 Discovery / Presence 依赖 Apple 批准的 Multicast Networking Entitlement 及包含该能力的 provisioning profile；仓库只能声明配置，不能代替外部申请与签名。
- 网络与 Session 模型遵循 ADR-0004，线协议遵循 ADR-0005，File Transfer 资源模型遵循 ADR-0006，Android 公共下载保存遵循 ADR-0007。
- Android 正式版使用 `com.wbbb.syncer` 与独立的 Production Key，Beta 使用 `com.wbbb.syncer.beta` 与独立的 Beta Key；两者可并存安装且不共享应用数据或签名身份，详见 ADR-0008。
- 版本由 bumpp 统一更新根项目、桌面端与移动端，共享协议保持独立版本；`main` push 与 pull request 触发持续集成，只在推送 `vX.Y.Z` 或 `vX.Y.Z-beta.N` tag 时触发自动发布。两种 tag 都生成 Android release APK 与 Windows 生产安装包，Beta 通过独立发布身份与 GitHub Prerelease 区分，iOS 不在当前自动发布范围内。

## Testing Decisions

- 协议：`pnpm --filter @syncer/protocol typecheck`、`pnpm --filter @syncer/protocol test`（测试命令会先构建协议，再运行帧、握手、Session 与 File Transfer 测试）。
- 桌面：`pnpm --filter syncer-desktop lint`、`typecheck`、`test`（旧数据迁移、renderer 协议边界、TCP 身份、原子持久化与接收文件暂存/发布适配器）及 `build:win`。
- 移动：`pnpm --filter syncer-mobile lint`、`typecheck`、`test`；本地使用 pnpm 调用 Expo Doctor、干净 prebuild 与对应平台的 run 命令。
- 持续集成在 `main` push 与 pull request 上执行协议、桌面端和移动端检查，从干净 CNG 项目运行 Android 原生模块检查与 Debug 构建，并在 Windows 上验证桌面端打包；pull request 不写入共享的 Gradle 或 Electron 缓存。
- 自动发布必须从干净检出安装冻结的 pnpm lockfile，并在各平台构建前先构建共享协议；两个平台都成功后才创建 GitHub Release。
- 默认分支持续集成维护可供 tag 发布恢复的 pnpm、Gradle 与 Electron 缓存，发布任务不写入共享的 Gradle 或 Electron 缓存；缓存是可丢弃的性能优化，不得成为构建正确性的前提。
- Windows 本地环境不验证 iOS。无签名 Simulator 构建不证明 Multicast Networking Entitlement 已获批，也不替代带正确 provisioning profile 的真机网络与权限联调。

## Out of Scope

- TLS / 端到端加密、断点续传、剪贴板自动同步、设置页与开机自启动。
- 重写产品信息架构或更换品牌视觉体系。
- 与重构前线协议互通；该取舍由 `network-stack-vnext` 与 ADR-0005 决定。
- 将本地 legacy 副本作为正式迁移基线，或改写固定基线 commit `6355611`。
- 为 Windows 10、Android 10 / API 29 或 iOS 16.4 以下系统保留旧运行时、旧存储路径或兼容回退。

## Further Notes

- Android 在保持现有一键保存交互的前提下写入公共 Downloads，具体决策见 ADR-0007。
- 桌面托盘常驻与关闭即隐藏行为需保留。
- 现代化只改变工程、运行时与内部边界，不改变既有功能、信息架构或界面表现。
