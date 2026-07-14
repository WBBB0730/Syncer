/** Wire protocol generation — breaking vs pre-refactor builds. */
export const PROTOCOL_VERSION = 2

/** UDP discovery (query / reply / optional announce). */
export const UDP_PORT = 5742

/** Always-on Presence TCP door → upgrades to Session. */
export const TCP_PORT = 5743

/** IPv4 Local Scope address from the administratively scoped 239.255/16 block. */
export const MULTICAST_GROUP = '239.255.57.42'

export const BROADCAST_ADDRESS = '255.255.255.255'

export const DISCOVER_ROUNDS = 3
export const DISCOVER_INTERVAL_MS = 400

/** Optional low-frequency Presence announce (not the sole discovery path). */
export const ANNOUNCE_INTERVAL_MS = 15_000

export const HEARTBEAT_INTERVAL_MS = 5_000
export const HEARTBEAT_TIMEOUT_MS = 15_000
export const SESSION_DISCONNECT_TIMEOUT_MS = 1_000
export const FILE_TRANSFER_IDLE_TIMEOUT_MS = 30_000

/** Full budget for a single Device handshake, including the Presence hello exchange. */
export const HANDSHAKE_TIMEOUT_MS = 10_000
export const CONNECTION_REQUEST_TIMEOUT_MS = 30_000
export const MAX_PENDING_HANDSHAKES = 32

export const SUBNET_PROBE_CONCURRENCY = 32
/** Per-host budget for high-concurrency supplementary subnet probing only. */
export const SUBNET_PROBE_TIMEOUT_MS = 300
/** Bounds supplementary TCP probing to roughly ten timeout rounds. */
export const SUBNET_PROBE_MAX_HOSTS = SUBNET_PROBE_CONCURRENCY * 32
export const AVAILABLE_DEVICE_TTL_MS = 45_000
export const MAX_AVAILABLE_DEVICES = 256
export const MAX_DEVICE_ENDPOINTS = 8
export const MAX_PENDING_USER_INTERACTIONS = 32
export const DISCOVERY_EVENT_RATE_PER_SECOND = 128
export const DISCOVERY_EVENT_DEDUP_MS = 500
export const DISCOVERY_UI_FLUSH_MS = 50

export const FILE_CHUNK_BYTES = 64 * 1024
export const MAX_FRAME_BYTES = 1024 * 1024
export const MAX_TEXT_BYTES = 256 * 1024
export const MAX_FILE_NAME_BYTES = 255
export const MAX_FILES_PER_BATCH = 256
export const MAX_FILE_BYTES = 32 * 1024 ** 3
export const MAX_FILE_BATCH_BYTES = 64 * 1024 ** 3
export const MAX_STAGED_FILE_BATCHES = 8
export const MAX_STAGED_FILE_BYTES = MAX_FILE_BATCH_BYTES

export const FRAME_JSON = 0
export const FRAME_BINARY = 1
