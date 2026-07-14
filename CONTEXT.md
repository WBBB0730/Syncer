# Syncer

局域网内多设备互联协作的领域语境：Device 彼此发现、建立 Session，并交换文本、文件与控制意图。

## Language

### 设备与身份

**Device**：参与 Syncer 协作的一台终端，类型为 desktop 或 mobile。
_Avoid_: 节点、客户端、主机

**Device Name**：用户为 Device 设置的显示名称。
_Avoid_: 昵称、别名、hostname

**Device UUID**：用于长期区分 Device 的唯一身份标识。
_Avoid_: ID、token、session id

### 发现与连接

**Presence**：Device 当前愿意被其他 Device 发现并接收 Connection Request 的状态；Presence 不代表已经建立 Session。
_Avoid_: 心跳、在线、已连接

**Discovery**：查找当前具有 Presence 的 Device 的行为，其结果是 Available Device。
_Avoid_: 配对、蓝牙发现、连接

**Available Device**：经 Discovery 得到、尚未与本机建立 Session 的候选 Device；它不是可信关系，也不是已连接状态。
_Avoid_: 在线设备、好友、联系人

**Device Endpoint**：Available Device 可用于 TCP 拨号的一组 IPv4 地址与端口；一个 Available Device 至少有一个、也可有多个 Device Endpoint。
_Avoid_: 连接地址、主 IP

**Connection Request**：一台 Device 向另一台 Device 提出的建立 Session 的请求。
_Avoid_: 邀请、配对请求、Session

**Whitelist**：按 Device UUID 记录、允许自动接受 Connection Request 的名单。
_Avoid_: White List、信任列表、好友列表、黑名单

**Session**：两台 Device 同意建立的持续协作关系，承载 Text Transfer、File Transfer、Command 与 Find Device；它不是一次传输本身。
_Avoid_: 通话、房间、频道、一次性会话

**Connection Status**：Device 与 Session 相关的用户可感知状态，包括 `available`、`connecting` 与 `connected`。
_Avoid_: online/offline、idle/busy

### 传输与控制

**Text Transfer**：在 Session 中向另一台 Device 发送的一段纯文本。
_Avoid_: 消息、聊天、IM

**File Transfer**：在 Session 中向另一台 Device 发送的一个或多个文件。
_Avoid_: 附件、上传、云同步

**Receive History**：本机已经保存的接收文件记录。
_Avoid_: 下载列表、日志、缓存

**Command**：mobile 向 desktop 发出的按键控制意图。
_Avoid_: 快捷键、宏、脚本

**Find Device**：一个 Device 请求 mobile 发出声音与振动，以帮助用户找到该 mobile。
_Avoid_: 寻机、响铃模式、定位（GPS）

## Flagged ambiguities

**「连接」**：可能指 Available Device、Connection Request 或 Session；文档与代码应使用对应的规范术语。

**「同步」**：产品名 Syncer 不表示云端双向同步；当前领域描述的是用户明确发起的 Transfer 或控制行为。

## Example dialogue

**Dev**：Discovery 找到的 Device 已经和我连接了吗？

**Expert**：没有。它只是 Available Device；双方接受 Connection Request 后才形成 Session。

**Dev**：同一个 Available Device 为什么会显示多个地址？

**Expert**：一台 Device 可能通过多个网卡被发现，因此会有多个 Device Endpoint；它们仍属于同一个 Device UUID。

**Dev**：Presence 和 Session 有什么区别？

**Expert**：Presence 表示 Device 愿意被发现并接收请求，Session 表示两台 Device 已建立持续协作关系。

**Dev**：File Transfer 会创建新的 Session 吗？

**Expert**：不会。File Transfer 是现有 Session 中的一种协作行为。

**Dev**：Command 和 Find Device 是同一种能力吗？

**Expert**：不是。Command 是 mobile 对 desktop 的按键控制意图；Find Device 是一个 Device 请求 mobile 帮助用户找到设备。
