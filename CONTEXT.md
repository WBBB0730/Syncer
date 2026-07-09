# Syncer

局域网多设备互联协作上下文：同一 Wi-Fi 下发现设备、建立连接，并在设备间传递文本、文件与控制指令。

## Language

### 设备与身份

**Device**：参与互联的一台终端，类型为 desktop 或 mobile。
_Avoid_: 节点、客户端、主机

**Device Name**：用户可编辑的设备显示名称，默认形如 `DESKTOP_*****` / `MOBILE_*****`。
_Avoid_: 昵称、别名、hostname

**Device UUID**：设备持久化唯一标识，用于识别白名单与连接目标。
_Avoid_: ID、token、session id

### 发现与连接

**Discovery**：通过 UDP 广播在同一局域网内查找可用 Device。
_Avoid_: 扫描、配对、蓝牙发现

**Available Device**：Discovery 后出现在列表中、尚未建立会话的 Device。
_Avoid_: 在线设备、好友、联系人

**Connection Request**：一方向另一方发起的建立会话请求。
_Avoid_: 邀请、握手请求、配对请求

**Whitelist**：按 Device UUID 记录的自动接受 Connection Request 的名单。
_Avoid_: 信任列表、好友列表、黑名单

**Session**：两端已建立 TCP 通道后的已连接状态，可收发业务消息。
_Avoid_: 通话、房间、频道

**Connection Status**：设备连接生命周期状态：`available`、`connecting`、`connected`。
_Avoid_: online/offline、idle/busy

### 传输

**Text Transfer**：在 Session 中发送一段纯文本，接收方可复制到剪贴板。
_Avoid_: 消息、聊天、IM

**File Transfer**：在 Session 中以 Base64 载荷发送一个或多个文件。
_Avoid_: 附件、上传、云同步

**Receive History**：本机已保存的接收文件记录。
_Avoid_: 下载列表、日志、缓存

**Command**：移动端向桌面端发送的按键控制指令（方向键、音量等）。
_Avoid_: 快捷键、宏、脚本

**Find Device**：桌面端触发移动端响铃与振动以便定位设备。
_Avoid_: 寻机、响铃模式、定位（GPS）

### 网络约定

**Protocol Port**：UDP 发现与 TCP 会话共用端口 `5742`。
_Avoid_: 服务端口、监听端口（单独指代时需标明 UDP/TCP）

**Frame Delimiter**：TCP 消息以 JSON 序列化并以 `^` 结尾作为分帧边界。
_Avoid_: 分隔符、包头、换行协议

## Flagged ambiguities

**「连接」**：口语中可能指 Discovery 结果、Connection Request 或已建立的 Session。文档与代码中应分别使用 Available Device、Connection Request、Session。

**「同步」**：产品名 Syncer 不表示云端双向同步；当前能力是显式收发，不是自动剪贴板/文件同步。

## Example dialogue

**Dev**：用户点「查找」之后，Available Device 列表是怎么来的？  
**Expert**：那是 Discovery：本机 UDP 广播 search，同一 Wi-Fi 上 status 为 available 的 Device 回复 available，于是出现在列表里。

**Dev**：点「连接」是不是立刻就能发文件？  
**Expert**：还没有。那只是发出 Connection Request；对方接受（或命中 Whitelist）后才会进入 Session，才能做 Text Transfer / File Transfer。

**Dev**：移动端的方向键和「查找设备」是一回事吗？  
**Expert**：不是。方向键是 Command，发给 desktop；查找设备是 Find Device，由 desktop 触发 mobile 响铃振动。
