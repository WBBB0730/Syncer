# 0004. Presence + dial-in Session model

- Status: accepted
- Supersedes: ADR-0003 (session initiation and discovery posture only; wire framing in ADR-0005)
- Related: ADR-0005, ADR-0006

## Context

UDP broadcast search and “initiator opens a temporary TCP server” made Discovery unreliable and Session liveness unclear. Product still needs a long-lived **Session** for Text Transfer, File Transfer, Command, and Find Device (not LocalSend-style request-per-transfer).

A pure “B continuously broadcasts, A only listens” model wastes LAN traffic, makes find latency depend on announce period, and complicates stale-device handling. Opening the TCP server only after a UDP hit adds races (listen not ready, firewall, concurrent finders).

## Decision

- **Presence** while `available`: always-on TCP door (probe / Connection Request) **and** a UDP discovery listener that can answer queries. Optional **low-frequency** UDP announce/multicast may accelerate Discovery but must not be the only mechanism.
- **Discovery** (user-facing one “查找”):
  1. Primary: finder sends UDP multicast/broadcast discovery **request**; peers with Presence **unicast** reply with identity hints + TCP `ip:port` (+ version/capabilities as needed).
  2. Supplementary: low-frequency peer announce; subnet-oriented probing of the TCP door when UDP means are weak.
- **Trust boundary**: UDP outcomes are **candidates** only (`Available Device`). Device UUID / Protocol Version / accept-or-refuse happen on the TCP connection before or as it becomes a Session. This generation remains plaintext (ADR-0005); strong crypto is a later version.
- **Connection Request**: initiator dials the peer’s already-listening TCP door; accept (or Whitelist) upgrades that connection to **Session**. Never “open TCP server only after receiving discovery.”
- A pending **Connection Request** has one shared timeout. Expiry clears the pending request and closes its transport; it is not a user refusal and therefore does not emit refusal UI.
- **One-to-one**: `connected` turns Presence off so others cannot Discovery this Device.
- **Liveness**: application-level heartbeat; an intentional or unexpected disconnect returns to `available`, and an unexpected disconnect emits an explicit signal. Heartbeat expiry counts unanswered scheduled intervals rather than wall-clock delay, so a scheduler gap or device sleep does not create an immediate false timeout when execution resumes.
- **Bounded disconnect**: an intentional disconnect attempts to send the protocol message for a finite interval, then closes the transport regardless of write progress. Shutdown therefore cannot wait indefinitely for an unresponsive peer.
- **Connection Status lifecycle** is one cross-platform protocol state machine: `available → connecting → connected`; refusal, failure, cancellation, intentional disconnect, or unexpected loss returns to `available`.
- Only `available` exposes general Presence. While `connecting` or `connected`, the TCP door must not identify the Device to probes or accept another Connection Request.
- **Runtime supervision**: each client owns Presence and Discovery as one `RestartableRuntime`. Start, stop, restart, rollback, and concurrent failure signals are serialized so the application never treats a half-started listener set as available. An unexpected TCP or UDP listener failure invalidates the runtime and starts cancellable exponential recovery; retries continue while the runtime is desired, with delay capped at 30 seconds, and explicit shutdown cancels them.
- A socket upgraded from the Presence door transfers ownership to the Session. Restarting Presence or Discovery must not destroy that active Session transport.
- File Transfer stays on the same Session; streaming, disk staging, validation, and cleanup are defined by ADR-0006.

## Consequences

- Both ends must run the Presence TCP door and UDP discovery listener when discoverable.
- Desktop and mobile keep platform socket, timer, persistence, and UI adapters, while sharing lifecycle types and pure transition rules to prevent semantic drift.
- Listener recovery is automatic and has bounded retry pressure, while application shutdown remains deterministic and cancels outstanding recovery work.
- Wire format, ports, and encryption are decided in ADR-0005.
- Custom UDP discovery is the Syncer default (Electron + RN); mDNS/DNS-SD may be a later desktop enhancement, not the sole required path.

## Alternatives considered

- Temporary TCP server opened only after UDP hit — rejected: races and multi-finder complexity.
- Continuous announce as the only discovery mechanism — rejected: traffic, latency tied to period, stale entries.
- LocalSend-style HTTP-only, no long Session — rejected: breaks Command / Find Device product shape.
- Socket.IO as main channel — rejected: does not solve Discovery; awkward dual-role server on RN; heavy for LAN P2P.
- mDNS/DNS-SD as mandatory primary — deferred: uneven RN/Android support; keep as optional enhancement.
