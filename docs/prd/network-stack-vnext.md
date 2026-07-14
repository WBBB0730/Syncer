# network-stack-vnext

**局域网网络栈重构（Presence + Session vNext）**

## Problem Statement

同一 Wi-Fi 下经常 Discovery 不到 Device，多网卡环境还会把查询发到错误接口或因另一个网段已有结果而跳过目标网段；TCP 用 `^` 分帧与 Base64 塞文件既脆又难传大文件。根因是「点一下才广播 + 发起方临时开 server」的旧模型，而不是缺几个补丁。

## Solution

保留 Syncer 的长连接 Session 产品形态，按「常驻可拨号 + 主动查询发现」重构：

- **Presence**：`available` 时常驻 TCP 门 + 常驻 UDP discovery 监听（可应答查询）；可选低频主动宣告仅作加速
- **Discovery**：主路径为查找方携带本次 `queryId` 的 UDP 查询、对端回显同一 `queryId` 并单播回复 TCP 地址；仅匹配当前查询的应答进入结果；辅以低频宣告与网段 TCP 探测；对用户仍是一次「查找」
- **多网卡**：桌面端在每个活动 IPv4 接口上加入并发送组播，同时发送各子网定向广播；每个没有 Discovery 结果覆盖的子网独立进入有限 TCP 探测
- **多路径**：同一 Device UUID 的多个 Device Endpoint 合并到一个 Available Device；发起方在发送 Connection Request 前逐个验证，发送后不再换路重试
- **信任边界**：UDP 只产生 Available Device 候选；身份与是否接受连接在 TCP / Session 握手中确认
- **Connection Request**：发起方拨号敲对方已在听的门；接受或 Whitelist 后升级为 **Session**（禁止收到发现后再临时开 TCP server）
- **Session**：文本 / File Transfer / Command / Find Device 同通道；应用层心跳按未应答调度次数判定，不把休眠或调度停顿直接当作连续超时；主动断开等待有明确上限
- **File Transfer**：发送端分块读取，接收端写入应用私有临时文件，校验完成后再交给平台保存，不在内存或 IPC 中保留整文件 Base64
- **一对一**：`connected` 关闭 Presence
- **自动恢复**：Presence 与 Discovery 作为一个可重启运行时统一启停；TCP/UDP 任一监听异常都会触发串行回滚与可取消的指数重试，重试间隔有上限
- **线协议 breaking**：长度前缀帧；本代明文；不与旧版互通

## User Stories

- 作为用户，我点「查找」后，同一局域网内其他 Syncer 设备应较快出现在 Available Device 列表（不依赖等待对方下一次周期广播）。
- 作为用户，我点连接后仍先经 Connection Request（或 Whitelist），再进入可收发的 Session。
- 作为用户，我的电脑同时启用以太网、热点和虚拟网卡时，一个网卡上的结果不会阻止 Syncer 查找另一个网卡上的 Device。
- 作为用户，目标 Device 的一个地址不可达但另一个 Device Endpoint 可达时，Syncer 会自动尝试可达路径，且对端只收到一次 Connection Request。
- 作为用户，Connection Request 超时、目标不可达、对端忙或协议不匹配时，我会看到明确原因，而不是永久等待。
- 作为用户，Session 意外断开时我会得到明确提示，并立即回到可被发现和重新连接的状态。
- 作为用户，我在 Session 内仍能发送文本、文件、Command、Find Device，且文件不会因整包 Base64 或整文件内存副本而占用成倍内存。
- 作为移动端用户，我可以通过紧凑的媒体控制区向 Windows 或 macOS 桌面端发送播放、切歌、静音与音量 Command。
- 作为被查找的移动端用户，我可以从应用弹窗停止响铃；Android 可以从系统通知直接停止，iOS 26 及以上优先使用可直接停止并可打开 App 的系统 AlarmKit，其他 iOS 情况从普通通知进入 App。停止后，发起端的“正在查找”弹窗同步关闭。
- 作为用户，我已与一台设备建立 Session 时，其他设备的 Discovery 不应再找到我。

## Implementation Decisions

- 领域与握手模型见 ADR-0004；线协议见 ADR-0005；术语见 `CONTEXT.md`。
- Discovery 时序：A 以新 UUID `queryId` 主动 UDP 查询 → B 在非 announce `hello` 中回显该 `queryId` 并单播回复 → A 仅接受当前查询的回复并拨号 B 的常驻 TCP；B 的低频 announce 是不携带 `queryId` 的独立变体。
- 手动 IP 不经过 UDP 轮询或网段扫描，直接 TCP 探测该地址；常规网段探测使用系统报告的真实 IPv4 子网掩码、子网定向广播与共享的有限探测预算。
- 桌面 UDP socket 按每个活动 LAN IPv4 地址维护组播成员关系，并串行切换组播出口；网络接口变化会在下一次查询或 announce 时刷新。
- Available Device 按 Device UUID 聚合有限数量的 Device Endpoint。拨号只在 TCP hello 前失败时切换下一路径；Connection Request 已发送或可能已发送后不再切换，避免重复请求。
- 保留长连接 Session；不采用 Socket.IO 作主通道；不采用 LocalSend 纯 HTTP 传完即散模型。
- 自定义 UDP discovery 为默认；mDNS/DNS-SD 不作为必选主路径（可作后续桌面增强）。
- File Transfer 留在 Session 内，采用长度前缀下的二进制分块与磁盘暂存，不另开 HTTP 旁路；资源与失败清理规则见 ADR-0006。
- 移动端用 Expo 官方 `expo-document-picker` 选择发送文件并复制到应用缓存，再由 `expo-file-system` 按块读取；系统选择器只负责授权与复制，原始文件名和 MIME 元数据随选择结果保留。
- Android 接受文件后通过 MediaStore 写入公共 Downloads，保持现有一键保存交互，见 ADR-0007。
- 桌面仍在主进程承载网络；移动端继续使用原生 UDP/TCP 能力（具体库可随实现调整）。
- 两端共享 `@syncer/protocol` 的编解码、线协议类型与纯状态转换，平台层只保留 socket、存储和 UI 适配。
- 两端通过共享 Session 生命周期 reducer 驱动 `available` / `connecting` / `connected`，并复用统一的握手、Connection Request 超时和 Discovery 限流参数。
- Protocol Version 3 增加跨平台媒体 Command。桌面端使用穷尽映射执行受支持按键；macOS 权限或原生注入失败只反馈错误，不得结束 Session。
- Find Device 的 start、stop 与接收端停止回执携带同一 UUID `requestId`。接收端弹窗与通知复用同一停止动作；发起端只在回执匹配当前请求时关闭对应弹窗，延迟到达的旧 stop 不影响新一轮查找，也不对远端停止消息回显。
- Android 在开始播放铃声前设置并校验媒体音量，停止时恢复原值；通知展示可在后台直接执行本地停止及回传状态的 action，点击正文进入 App。
- iOS 26 及以上在前台预先请求 AlarmKit 授权，收到 Find Device 后优先调度一次性系统 alarm，并提供系统停止与明确的打开 App 操作；调度成功时不得同时启动旧播放器、振动或普通通知。仅在系统不支持、未授权、后台无法首次授权，或调度失败且已确认清理对应 alarm 后，才回退现有播放器、振动与普通通知；回退方案不修改系统输出音量，也不展示无法可靠后台执行的停止按钮。AlarmKit 只负责接管已经收到的 Find Device，不能唤醒已被 iOS 挂起或终止、尚未收到局域网请求的 App。
- 两端通过共享 `RestartableRuntime` 串行协调 Presence 与 Discovery 的启动、停止、失败回滚和重启。异常监听关闭后持续重试，退避间隔从有限初值指数增长并封顶；应用显式停止时以 `AbortSignal` 取消恢复。
- Session 心跳累计逻辑上未收到 `pong` 的调度间隔，避免系统休眠或 JavaScript 调度停顿恢复后立即误判；主动 `disconnect` 的发送等待有界，超时后必须释放 transport。
- Presence 接受的连接升级为 Session 后转移 socket 所有权，监听运行时重启不得关闭已建立的 Session。
- 旧 ADR-0003 握手与线协议废弃；迁移前对照固定为重构开始前 `origin/main` 的 commit `6355611`，不要求互通。

## Testing Decisions

- 冒烟：双端同代构建下 Discovery → Connection Request → Session → 文本往返。
- 回归：Whitelist 自动接受；拒绝连接；主动断开；Find Device；Command（桌面）。
- Command：覆盖全部协议键的穷尽映射、Windows/macOS 媒体键、macOS 辅助功能拒绝，以及注入失败后 Session 仍可继续处理消息。
- Find Device：覆盖弹窗停止、Android 通知后台 action 停止回传、ack 失败后的通知重试、通知进入 App、匹配回执关闭发起端弹窗、过期回执不影响新请求、重复启动不会重建已关闭弹窗、启动失败回传停止、旧通知不影响新一轮响铃、Android 播放前的媒体音量校验及停止后的音量恢复。iOS 需分别在 26.0 与 26.1 以上真机覆盖 AlarmKit 授权、前后台调度、系统停止、打开 App、停止回执和孤立 alarm 清理，并在 iOS 16.4 及 AlarmKit 未授权场景验证只启用旧方案；AlarmKit 调度异常且清理结果不明确时不得启动旧方案造成双响。
- 稳定性：杀进程、关闭 Wi-Fi 或心跳超时造成 Session 中断后，应立即回到 `available` 并明确提示连接中断；覆盖调度停顿不会伪造超时，以及主动断开在 transport 不可写时仍能有界完成。
- Discovery：覆盖「查询-单播应答」主路径及 `queryId` 关联，拒绝上一次或无关查询的延迟回复；覆盖「组播弱、需网段探测」类环境；验证关闭周期 announce 时主动查询仍能找到设备。
- 桌面启动与恢复：验证 TCP/UDP 任一绑定失败会完整回滚且不展示可用主界面；异常关闭触发可取消的有界指数退避并最终恢复；监听重启不破坏已转移给 Session 的 socket；手动 IP 会直接 TCP 探测；渲染器重载可恢复且不会重复展示待处理文件。
- 多网卡：用包含以太网、Windows 热点和虚拟网卡的拓扑验证逐接口组播、定向广播、未覆盖子网探测及同一 Device UUID 的 Device Endpoint 合并；验证一个网段已有结果不会抑制其他网段。
- 连接失败：验证首个 Device Endpoint 不可达时会回退到下一路径，TCP 身份不匹配不会建立 Session，Connection Request 一旦发送便不再换路；超时、不可达、忙碌、拒绝和协议错误都结束等待并给出对应反馈。
- 单实例：Windows 或 macOS 打包产物连续启动两次时，第二个进程应退出并把控制权交给仍在运行的主实例，不能产生第二套 Presence/Discovery 监听与托盘。
- 文件：覆盖多分块与多文件，按声明大小验证接收字节、跨批次暂存预算、背压、断线/拒绝清理与部分发布重试，并以接收端最终字节内容而非“已发送”日志作为断言。
- Android：在支持下限 Android 10 / API 29 上覆盖 MediaStore `IS_PENDING` 一键保存、UTF-8 重名、精确字节数、部分成功、owned pending row 清理与历史 reopening；不保留 Android 9 文件系统路径。
- 自动发布流程不承担本节测试；这些场景按涉及平台在本地验证。

## Out of Scope

- TLS / 端到端加密（下一代 Protocol Version）。
- 通过 APNs 唤醒已挂起或终止的 iOS App，以及需要 Apple 特批 entitlement 的 Critical Alerts。
- 多 Session / 会议室式同时连接多台设备。
- 与重构前线协议的兼容层。
- 将 mDNS/SSDP 设为唯一发现机制。
- 剪贴板自动同步、开机自启、设置页大改、品牌视觉重做。
- Socket.IO / WebRTC 作为主通道。
- File Transfer 并行传输、断点续传与跨 Session 恢复。

## Further Notes

- 具体组播地址、端口号、心跳间隔、announce 周期、扫描并发与扫描预算属实现参数，应可配置或集中常量，但不得违背 ADR-0004 语义（查询-应答为主，announce 为辅）。
- README「待完成」中的心跳等项由本 PRD 吸收为 Session 存活能力；加密仍列未来工作。
