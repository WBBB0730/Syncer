# Syncer

同一 Wi-Fi 下的多设备互联协作工具，支持 Windows、macOS、Android 与 iOS。

[下载最新版](https://github.com/WBBB0730/Syncer/releases/latest)

- 桌面端：Electron 43 + Vue 3（electron-vite）
- 移动端：Expo SDK 57 development build（本地打包）+ `react-native-udp` / `react-native-tcp-socket`
- 协议：`packages/syncer-protocol`（v3：UDP 查询发现 + 常驻 TCP Presence 门 + 长度前缀帧）

### 注意：Android 安装后请允许后台运行

- MIUI：应用信息 → 省电策略 → 无限制

## 仓库结构

| 路径 / 基线                                                  | 说明                                    |
| ------------------------------------------------------------ | --------------------------------------- |
| `syncer-desktop/`                                            | 桌面端（electron-vite）                 |
| `syncer-mobile/`                                             | 移动端（Expo）                          |
| `packages/syncer-protocol/`                                  | 共享线协议（zod schema、分帧、常量）    |
| [`6355611`](https://github.com/WBBB0730/Syncer/tree/6355611) | 重构开始前 `origin/main` 的固定迁移基线 |
| `CONTEXT.md`                                                 | 领域术语                                |
| `DESIGN.md`                                                  | 视觉与交互约定                          |
| `docs/adr/`                                                  | 架构决策                                |
| `docs/prd/`                                                  | 产品需求                                |

## 开发

支持边界与开发环境：

| 目标              | 最低要求                       |
| ----------------- | ------------------------------ |
| Windows 桌面端    | Windows 10（x64）              |
| macOS 桌面端      | macOS 14（x64 / arm64）        |
| Android 移动端    | Android 10（API 29）           |
| iOS 移动端        | iOS 16.4                       |
| JavaScript 工具链 | Node.js 22.18+（22.x）或 24.3+ |
| Android 构建      | JDK 17 + Android SDK           |
| iOS 构建          | macOS + Xcode 26.4             |

项目统一使用 pnpm workspace 和根目录的单一 lockfile。以下命令均从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
```

### 共享协议

```bash
pnpm --filter @syncer/protocol typecheck
pnpm --filter @syncer/protocol test
```

### 桌面端

```bash
pnpm --filter syncer-desktop lint
pnpm --filter syncer-desktop typecheck
pnpm --filter syncer-desktop test
pnpm --filter syncer-desktop dev
```

Windows 打包：`pnpm --filter syncer-desktop build:win`

macOS x64/arm64 打包：`pnpm --filter syncer-desktop build:mac`

macOS 首次使用媒体 Command 时，需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许 Syncer；Discovery 与 Session 还需要允许本地网络访问。CI 会验证 DMG 内经过 ad-hoc 签名的应用包，面向用户分发前仍需改用 Developer ID、启用 Hardened Runtime 并完成 Apple notarization。

### 移动端

需要 Expo development build（不能用 Expo Go 跑满功能），本地打包：

```bash
pnpm --filter syncer-mobile lint
pnpm --filter syncer-mobile typecheck
pnpm --filter syncer-mobile test
pnpm --filter syncer-mobile exec pnpm dlx expo-doctor@latest
pnpm --filter syncer-mobile exec expo prebuild --clean --platform android --no-install
pnpm --filter syncer-mobile exec expo run:android
```

`android/` 与 `ios/` 是 [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/) 的生成目录，不提交到仓库；原生权限、正式签名和本地存储模块都由 `app.json`、config plugin 与本地 Expo module 重建。不要直接修改生成目录。

Android 使用两个相互独立的发布身份：正式版为 `com.wbbb.syncer`，Beta 为 `com.wbbb.syncer.beta`。本地未设置 `SYNCER_RELEASE_CHANNEL` 时默认生成 Beta；正式版构建需设置 `SYNCER_RELEASE_CHANNEL=production`。

Android release 构建不会使用调试签名；构建前需提供以下环境变量：

- `SYNCER_ANDROID_KEYSTORE_FILE`
- `SYNCER_ANDROID_KEYSTORE_PASSWORD`
- `SYNCER_ANDROID_KEY_ALIAS`
- `SYNCER_ANDROID_KEY_PASSWORD`

iOS 需在 macOS 上使用 Xcode 26.4 或更高版本及 CocoaPods 构建：

```bash
pnpm --filter syncer-mobile exec expo prebuild --clean --platform ios --no-install
pnpm --filter syncer-mobile exec expo run:ios
```

真机上的 Discovery 与 Presence 还需要 Apple 为 App ID 开通 [Multicast Networking Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast)，并由签名证书与 provisioning profile 携带该能力。仓库声明 entitlement，但无法代替 Apple 侧的申请与签名配置；Windows 本地环境和无签名 Simulator 构建都不能验证这项真机能力。

### 版本与发布

版本由 [bumpp](https://github.com/antfu-collective/bumpp) 统一更新根项目、桌面端和移动端；共享协议 `@syncer/protocol` 保持独立版本。执行 `pnpm release <version>` 会创建并推送对应的 `v<version>` tag。

- `v1.0.0`：构建 `com.wbbb.syncer` Android release APK 和 Windows 生产安装包，并发布正式 GitHub Release。
- `v1.0.0-beta.0`：使用独立签名构建 `com.wbbb.syncer.beta` Android release APK 和 Windows 生产安装包，并发布 GitHub Prerelease。

GitHub Actions 在 `main` push 与 pull request 上运行协议、桌面端、移动端和原生构建检查，并生成包含 ad-hoc 签名应用包的 macOS x64/arm64 DMG 进行验证；只有上述版本 tag 会触发 Android 与 Windows 自动发布。默认分支 CI 维护可供 tag 发布恢复的 pnpm、Gradle 与 Electron 构建缓存，其中 pull request 和 tag 不写入共享的 Gradle 或 Electron 缓存；所有工作流在无缓存时仍须能从干净检出完成。Android 正式版与 Beta 各自配置 `SYNCER_ANDROID_PRODUCTION_*` 和 `SYNCER_ANDROID_BETA_*` 四个 Actions secrets，后缀均为 `KEYSTORE_BASE64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`；macOS 与 iOS 暂不进入自动发布。

## 已完成的功能

- 查找、连接同一 Wi-Fi 下的设备
- 设备重命名
- 设备白名单（设置后自动接受连接请求）
- 发送、接收文本，并复制到剪贴板
- 发送、接收文件，并保存到本地
- 查看接收文件历史
- 控制 Windows/macOS 桌面端的常用媒体键
- 查找移动端设备（Android 通知可直接停止；iOS 26+ 优先使用可直接停止的 AlarmKit，其他情况回退普通响铃通知）

## 待完成的功能

（欢迎在 Issue 里提出建议！）

- 设置（如：文本 / 文件是否自动接收）
- 数据传输加密（TLS / 下一代 Protocol Version）
- 更大文件与断点续传
- 直接访问对方设备上的文件
- 自动监听并同步剪贴板
- 开机自启动等

网络栈 vNext（Presence、主动 Discovery 与 Session 心跳）见 `docs/prd/network-stack-vnext.md`；跨端流式 File Transfer 与 Android 公共下载保存分别见 ADR-0006、ADR-0007。
