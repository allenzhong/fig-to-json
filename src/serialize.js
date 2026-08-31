/**
 * JSON helpers for kiwi-decoded .fig data.
 * kiwi-schema emits BigInt; JSON.stringify throws without a replacer.
 */

export function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return { __type: "Uint8Array", length: value.length };
  }
  return value;
}

export function jsonStringify(value, space = 2) {
  return JSON.stringify(value, jsonReplacer, space);
}

/**
 * Walk a decoded tree and replace BigInt / leftover typed arrays
 * so the result is JSON.stringify-safe without a replacer.
 */
export function toJsonSafe(value, depth = 0) {
  if (depth > 250) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return { __type: "Uint8Array", length: value.length };
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJsonSafe(item, depth + 1);
    }
    return out;
  }
  return value;
}
