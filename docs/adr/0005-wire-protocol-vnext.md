# 0005. Wire protocol vNext (breaking)

- Status: accepted
- Related: ADR-0004, ADR-0006
- Supersedes: ADR-0003

## Context

The v1 wire protocol (shared port `5742`, UDP broadcast types, JSON + trailing `^` frames, initiator TCP server) cannot cleanly express Presence, dial-in Session, binary File Transfer, or heartbeat without accumulating patches. The product accepts a breaking Protocol Version bump.

## Decision

- **Breaking upgrade**: no dual-stack compatibility with the pre-refactor wire protocol; both peers must speak the same Protocol Version.
- **Framing**: length-prefixed frames (e.g. 4-byte big-endian length + payload). Control messages may use JSON payloads; File Transfer uses binary chunks on the same Session — not Base64-inside-JSON and not `^` delimiters. Streaming and disk ownership are defined by ADR-0006.
- **Discovery transport** (see ADR-0004):
  - Primary: UDP multicast/broadcast **discovery request** from the finder; Presence peers **unicast** reply with TCP address and candidate identity fields.
  - Every discovery request carries a fresh UUID `queryId`. A unicast response is a strict, non-announce `hello` that echoes that exact `queryId`; a finder accepts it only while the matching search is active. An optional announce is a separate `hello` variant and carries no `queryId`.
  - Optional: low-frequency UDP announce/multicast to accelerate find (not sole path).
  - Supplementary: subnet-oriented probing of the Presence TCP door when UDP means are weak.
  - Use an address from the administratively scoped IPv4 Local Scope block (`239.255.0.0/16`) for application discovery; broadcast may supplement it.
  - The receiver derives a Device Endpoint address from each UDP packet's source and combines distinct addresses that advertise the same Device UUID. No additional endpoint list is trusted from the UDP payload.
- **This generation is plaintext** (no TLS). Encryption is a future Protocol Version / ADR; leave version fields so peers can refuse mismatched generations cleanly. Lightweight TCP-side checks (Device UUID, Protocol Version, accept/refuse) still apply — UDP must not be trusted alone.
- Default ports (overridable later if needed): UDP discovery `5742`, TCP Presence/Session door `5743`, multicast group `239.255.57.42`. Heartbeat constants live in `@syncer/protocol`.
- `@syncer/protocol` is the single source of truth for schemas, UDP/TCP codecs, constants, shared wire-facing types, and platform-neutral lifecycle rules. Platform adapters provide bytes and sockets; they do not assemble wire JSON independently. Its generated `dist` is not versioned; every clean build installs, typechecks, builds, and tests the package before either client is verified.
- Supplementary TCP probing uses each interface's real IPv4 netmask and a centrally bounded host budget. Discovery also targets the calculated subnet broadcast address, so broader subnets do not require unbounded address materialization.

## Consequences

- Old desktop/mobile builds will not interoperate with vNext builds.
- Delayed or unrelated unicast replies cannot populate a later Discovery result set; optional announces remain independently rate-limited candidates.
- Multi-interface replies can produce several Device Endpoints for one Available Device without changing the wire message schema.
- Shared protocol module across desktop and mobile becomes valuable to avoid divergent codecs.
- Client verification cannot depend on an ignored or previously generated local protocol `dist`.
- ADR-0003 remains as historical record of the superseded baseline.

## Alternatives considered

- Dual-protocol transition window — rejected: doubles state machines during the hardest rewrite.
- TLS in this generation — deferred: certificate trust on Electron + RN would dominate the connectivity rewrite.
- WebSocket / Socket.IO framing — rejected: unnecessary given a dedicated TCP Session door.

## References

- [RFC 5771: IANA Guidelines for IPv4 Multicast Address Assignments](https://www.rfc-editor.org/rfc/rfc5771.html)
- [IANA IPv4 Multicast Address Space Registry](https://www.iana.org/assignments/multicast-addresses/multicast-addresses.xhtml)
