# Syncer

同一 Wi-Fi 下的多设备互联协作工具，支持 Windows、Android 与 iOS。

[下载最新版](https://github.com/WBBB0730/Syncer/releases/tag/v1.0.0)

- 桌面端：Electron 43 + Vue 3（electron-vite）
- 移动端：Expo SDK 57 development build（本地打包）+ `react-native-udp` / `react-native-tcp-socket`
- 协议：`packages/syncer-protocol`（v2：UDP 查询发现 + 常驻 TCP Presence 门 + 长度前缀帧）

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
| Windows 桌面端    | Windows 10                     |
| Android 移动端    | Android 10（API 29）           |
| iOS 移动端        | iOS 16.4                       |
| JavaScript 工具链 | Node.js 22.18+（22.x）或 24.3+ |
| Android 构建      | JDK 17 + Android SDK           |
| iOS 构建          | macOS + Xcode 26.4             |

以下命令均从仓库根目录开始执行。干净检出后必须先安装、检查并构建共享协议；两个客户端都从该构建产物解析 `@syncer/protocol`。

### 共享协议

```bash
cd packages/syncer-protocol
npm ci
npm run typecheck
npm test
```

### 桌面端

```bash
cd syncer-desktop
npm ci
npm run lint
npm run typecheck
npm test
npm run dev
```

Windows 打包：`npm run build:win`

### 移动端

需要 Expo development build（不能用 Expo Go 跑满功能），本地打包：

```bash
cd syncer-mobile
npm ci
npm run lint
npm run typecheck
npm test
npx expo-doctor@latest
npx expo prebuild --clean --platform android --no-install
npx expo run:android
```

`android/` 与 `ios/` 是 [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/) 的生成目录，不提交到仓库；原生权限、正式签名和本地存储模块都由 `app.json`、config plugin 与本地 Expo module 重建。不要直接修改生成目录。

正式版 Android 构建不会使用调试签名；构建前需提供以下环境变量：

- `SYNCER_ANDROID_KEYSTORE_FILE`
- `SYNCER_ANDROID_KEYSTORE_PASSWORD`
- `SYNCER_ANDROID_KEY_ALIAS`
- `SYNCER_ANDROID_KEY_PASSWORD`

iOS 需在 macOS 上使用 Xcode 26.4 或更高版本及 CocoaPods 构建：

```bash
cd syncer-mobile
npm ci
npx expo prebuild --clean --platform ios --no-install
npx expo run:ios
```

真机上的 Discovery 与 Presence 还需要 Apple 为 App ID 开通 [Multicast Networking Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast)，并由签名证书与 provisioning profile 携带该能力。仓库声明 entitlement，但无法代替 Apple 侧的申请与签名配置；Windows 本地环境和无签名 Simulator 构建都不能验证这项真机能力。

### CI

GitHub Actions（`.github/workflows/ci.yml`）从干净检出开始，在 Node.js 22.18 与 24.3 上验证 JavaScript 工具链；覆盖协议测试与 Session 冒烟、桌面 lint/typecheck/build、Windows 桌面适配器与网络测试、unpacked 包原生模块及确定性启动、Expo Doctor、移动端 typecheck/协调器测试/Metro 打包、Android 存储模块的 JVM 测试/Lint/Release AAR/完整 debug 应用构建、Android 10 模拟器上的 MediaStore 集成测试，以及在 macOS 26 与 Xcode 26.4 上进行的 iOS 存储核心 Swift 测试和干净 CNG 输出的无签名 Simulator 构建。发布安装包仍在本地执行（桌面 `npm run build:win`，移动端对应 release 构建）；iOS 真机局域网与签名能力仍需在具备相应 provisioning profile 的设备上验证。

## 已完成的功能

- 查找、连接同一 Wi-Fi 下的设备
- 设备重命名
- 设备白名单（设置后自动接受连接请求）
- 发送、接收文本，并复制到剪贴板
- 发送、接收文件，并保存到本地
- 查看接收文件历史
- 控制桌面端按下按键（如方向键、音量控制等）
- 查找移动端设备（响铃 + 振动）

## 待完成的功能

（欢迎在 Issue 里提出建议！）

- 设置（如：文本 / 文件是否自动接收）
- 数据传输加密（TLS / 下一代 Protocol Version）
- 更大文件与断点续传
- 直接访问对方设备上的文件
- 自动监听并同步剪贴板
- 开机自启动等

网络栈 vNext（Presence、主动 Discovery 与 Session 心跳）见 `docs/prd/network-stack-vnext.md`；跨端流式 File Transfer 与 Android 公共下载保存分别见 ADR-0006、ADR-0007。
