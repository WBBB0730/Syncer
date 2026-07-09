# Syncer

同一 Wi-Fi 下的多设备互联协作工具，支持 Android 与 Windows。

[下载最新版](https://github.com/WBBB0730/Syncer/releases/tag/v1.0.0)

> 桌面端：Electron + Vue 3（electron-vite）  
> 移动端：Expo development build（本地打包）+ 自定义原生 UDP/TCP 模块

### 注意：Android 安装后请允许后台运行

- MIUI：应用信息 → 省电策略 → 无限制

## 仓库结构

| 目录 | 说明 |
|------|------|
| `syncer-desktop/` | 桌面端（electron-vite） |
| `syncer-mobile/` | 移动端（Expo） |
| `syncer-desktop-legacy/` / `syncer-mobile-legacy/` | 迁移前旧工程（对照用） |
| `CONTEXT.md` | 领域术语 |
| `DESIGN.md` | 视觉与交互约定 |
| `docs/adr/` | 架构决策 |
| `docs/prd/` | 产品需求 |

## 开发

### 桌面端

```bash
cd syncer-desktop
npm install
npm run dev
```

类型检查：`npm run typecheck`  
Windows 打包：`npm run build:win`

### 移动端

需要 Expo development build（不能用 Expo Go 跑满功能），本地打包：

```bash
cd syncer-mobile
npm install
npx expo prebuild
npx expo run:android
```

### CI

GitHub Actions（`.github/workflows/ci.yml`）在 PR / push 时跑桌面端 typecheck + `electron-vite build`，以及移动端 `tsc`。发布安装包在本地执行（桌面 `npm run build:win`，移动 `expo run:android` / 对应 release 构建）。

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
- 数据传输加密
- 支持发送大文件（目前只能发送约 100MB 以内的数据）
- 直接访问对方设备上的文件
- 自动监听并同步剪贴板
- 心跳机制、开机自启动等
