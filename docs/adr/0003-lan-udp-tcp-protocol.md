# 0003. LAN UDP discovery + TCP session protocol

- Status: accepted

## Context

Syncer must work offline on the same Wi-Fi without accounts or a central server. The original protocol is already deployed between desktop and mobile builds.

## Decision

Keep the existing wire protocol:

- Shared **Protocol Port** `5742` for UDP Discovery and TCP Session
- UDP types: `search`, `available`, `connect`, `refuse`
- TCP types: `accept`, `disconnect`, `text`, `file`, `command`, `ring`
- TCP **Frame Delimiter**: JSON payload + trailing `^`
- Outbound UDP always includes `uuid`, `name`, `device` (`desktop` | `mobile`)
- Initiator opens TCP server; acceptor connects and sends `accept`

## Consequences

- Cross-version compatibility depends on not changing frame format or type names casually.
- Encryption, large-file streaming, and heartbeat are future ADRs; they must version or negotiate without breaking this baseline.
- Same port for UDP and TCP is surprising but intentional and must remain documented.
