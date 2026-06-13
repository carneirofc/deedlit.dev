/**
 * Cross-service ID scheme (TypeScript reference implementation).
 *
 * The canonical cross-service id of an image is the SHA-256 of its raw bytes
 * (lowercase hex). The Qdrant point id is `uuid5(NAMESPACE, sha256-hex)`.
 *
 * This is one of two reference copies (the other is `deedlit.vision/id_scheme.py`).
 * Both are pinned to the shared vectors in `id-scheme/vectors.json` and MUST NOT
 * diverge. See `id-scheme/README.md`.
 */
import { createHash } from "node:crypto";

/** Frozen canonical namespace = uuid5(URL_NAMESPACE, "https://deedlit.dev/id-scheme/v1"). Never change. */
export const NAMESPACE = "697124e2-0736-5d17-812d-590ba305cb45";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** RFC 4122 v5 (SHA-1 namespaced) UUID — matches Python's `uuid.uuid5`. */
export function uuid5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/** Derive the Qdrant point id from an image's SHA-256 (lowercase hex). */
export function pointIdForSha256(sha256hex: string): string {
  return uuid5(NAMESPACE, sha256hex.toLowerCase());
}
