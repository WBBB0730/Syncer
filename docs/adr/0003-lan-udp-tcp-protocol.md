# 0003. LAN UDP discovery + TCP session protocol

- Status: superseded by ADR-0004 and ADR-0005

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

- Historical baseline only. Presence / dial-in Session: ADR-0004. Wire vNext: ADR-0005.
- Cross-version compatibility with this baseline is intentionally abandoned by ADR-0005.
