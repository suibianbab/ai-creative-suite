import { createHash } from "node:crypto";

// rembg inference costs ~25s per 1920×2560 image on this machine; repeated
// previews of the same source used to pay it every time. Cache masks keyed
// by the sha256 of the exact bytes sent to the provider (M2 latency; the
// design doc's async-pre-generation risk mitigation, synchronously).
const maxEntries = 8;

const cache = new Map(); // hash -> { bytes, contentType }

export function cachedSubjectMask(maskProvider) {
  return async (bytes, contentType) => {
    const key = createHash("sha256").update(bytes).digest("hex");
    const hit = cache.get(key);
    if (hit) {
      // LRU refresh
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const response = await fetch(maskProvider, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(70_000),
    });
    const result = {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: response.ok ? Buffer.from(await response.arrayBuffer()) : null,
    };
    if (!result.ok || !result.contentType.startsWith("image/png"))
      return result;
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, result);
    return result;
  };
}
