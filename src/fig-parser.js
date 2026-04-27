/**
 * fig-parser.js
 *
 * Core .fig file parser. Extracts the Kiwi schema embedded in the file
 * (never hardcoded), handles both deflate and zstandard compression,
 * and decodes the scenegraph into a plain JS object.
 *
 * Security: zero network calls, pure computation.
 */

import pako from "pako";
import * as fzstd from "fzstd";
import * as kiwi from "kiwi-schema";

// ─── File format constants ───────────────────────────────────────────
const HEADERS = {
  "fig-kiwi": "DESIGN",
  "fig-jam.": "FIGJAM",
  "fig-deck": "SLIDES",
};

// ─── Low-level binary readers ────────────────────────────────────────

function readUint32LE(buf, offset) {
  return (
    (buf[offset]) |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
}

// ─── Decompression ───────────────────────────────────────────────────

/**
 * Try deflate (pako) first, fall back to zstandard (fzstd).
 * Newer Figma files use zstd for the data chunk.
 */
function decompress(chunk) {
  // Check for zstd magic bytes: 0x28 0xB5 0x2F 0xFD
  if (
    chunk.length >= 4 &&
    chunk[0] === 0x28 &&
    chunk[1] === 0xb5 &&
    chunk[2] === 0x2f &&
    chunk[3] === 0xfd
  ) {
    return fzstd.decompress(chunk);
  }

  // Try deflate (raw, no header)
  try {
    return pako.inflateRaw(chunk);
  } catch {
    // Try with header
    try {
      return pako.inflate(chunk);
    } catch {
      // Last resort: try zstd anyway
      return fzstd.decompress(chunk);
    }
  }
}

// ─── ZIP container handling ──────────────────────────────────────────

/**
 * Modern .fig files are ZIP containers with:
 *   - A binary fig-kiwi file (the actual design data)
 *   - A metadata.json
 *   - Embedded images
 *
 * We use fflate for ZIP extraction (lightweight, zero-dep).
 */
async function extractFromZip(bytes) {
  const { unzipSync } = await import("fflate");
  const files = unzipSync(bytes);

  // Find the main fig-kiwi binary (usually named without extension or 'canvas.fig')
  let figBinary = null;
  const images = {};
  let metadata = null;

  for (const [name, data] of Object.entries(files)) {
    const header = data.length >= 8
      ? String.fromCharCode(...data.slice(0, 8))
      : "";

    if (HEADERS[header]) {
      figBinary = { name, data, type: HEADERS[header] };
    } else if (name.endsWith(".json")) {
      try {
        metadata = JSON.parse(new TextDecoder().decode(data));
      } catch {
        // not valid JSON, skip
      }
    } else if (
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".svg") ||
      name.endsWith(".webp")
    ) {
      images[name] = data;
    }
  }

  return { figBinary, metadata, images };
}

// ─── Schema + data chunk extraction ──────────────────────────────────

/**
 * Parse the raw fig-kiwi binary into schema and data chunks.
 *
 * File layout:
 *   [0..7]    header ("fig-kiwi")
 *   [8..11]   version (uint32 LE)
 *   [12..15]  schema chunk length (uint32 LE)
 *   [16..16+schemaLen]  compressed schema
 *   [16+schemaLen..16+schemaLen+3]  data chunk length
 *   [...]     compressed data
 */
function extractChunks(figBytes) {
  const header = String.fromCharCode(...figBytes.slice(0, 8));
  const fileType = HEADERS[header];

  if (!fileType) {
    throw new Error(
      `Unknown file header: "${header}". Expected one of: ${Object.keys(HEADERS).join(", ")}`
    );
  }

  const version = readUint32LE(figBytes, 8);

  let offset = 12;

  // Schema chunk
  const schemaLen = readUint32LE(figBytes, offset);
  offset += 4;
  const schemaCompressed = figBytes.slice(offset, offset + schemaLen);
  offset += schemaLen;

  // Data chunk
  const dataLen = readUint32LE(figBytes, offset);
  offset += 4;
  const dataCompressed = figBytes.slice(offset, offset + dataLen);

  return {
    fileType,
    version,
    schemaCompressed,
    dataCompressed,
  };
}

// ─── Blob handling ───────────────────────────────────────────────────

/**
 * Convert binary blobs in the decoded data to base64 strings
 * so the JSON is fully serializable.
 */
function convertBlobsToBase64(obj, depth = 0) {
  if (depth > 100) return obj; // guard against circular refs

  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
    const bytes = obj instanceof ArrayBuffer ? new Uint8Array(obj) : obj;
    return {
      __type: "blob",
      encoding: "base64",
      length: bytes.length,
      data: uint8ToBase64(bytes),
    };
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertBlobsToBase64(item, depth + 1));
  }

  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBlobsToBase64(value, depth + 1);
    }
    return result;
  }

  return obj;
}

function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa
    ? globalThis.btoa(binary)
    : Buffer.from(bytes).toString("base64");
}

// ─── Main parse function ─────────────────────────────────────────────

/**
 * Parse a .fig file buffer into a JSON-serializable object.
 *
 * @param {Uint8Array|Buffer} fileBuffer - Raw .fig file bytes
 * @param {object} options
 * @param {boolean} options.includeBlobs - Convert blobs to base64 (default: true)
 * @param {boolean} options.raw - Return raw decoded data without cleanup (default: false)
 * @returns {Promise<object>} Parsed design data
 */
export async function parseFigFile(fileBuffer, options = {}) {
  const { includeBlobs = true, raw = false } = options;
  const bytes = new Uint8Array(fileBuffer);

  // Step 1: Check if ZIP container
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let figBytes;
  let metadata = null;
  let imageList = [];

  if (isZip) {
    const extracted = await extractFromZip(bytes);
    if (!extracted.figBinary) {
      throw new Error("ZIP container does not contain a valid .fig binary");
    }
    figBytes = new Uint8Array(extracted.figBinary.data);
    metadata = extracted.metadata;
    imageList = Object.keys(extracted.images);
  } else {
    figBytes = bytes;
  }

  // Step 2: Extract compressed chunks
  const { fileType, version, schemaCompressed, dataCompressed } =
    extractChunks(figBytes);

  // Step 3: Decompress
  const schemaBytes = decompress(schemaCompressed);
  const dataBytes = decompress(dataCompressed);

  // Step 4: Decode and compile schema FROM THE FILE (not hardcoded)
  const schema = kiwi.decodeBinarySchema(schemaBytes);
  const compiledSchema = kiwi.compileSchema(schema);
  const decodeMessage = compiledSchema.decodeMessage;

  if (typeof decodeMessage !== "function") {
    throw new Error("Embedded schema does not define a top-level Message decoder");
  }

  // Step 5: Decode data using the file's own schema
  let decoded;
  try {
    decoded = decodeMessage.call(compiledSchema, dataBytes);
  } catch (err) {
    throw new Error(`Failed to decode data with embedded schema: ${err.message}`);
  }

  // Step 6: Process blobs
  if (!raw && includeBlobs) {
    decoded = convertBlobsToBase64(decoded);
  }

  // Step 7: Assemble result
  const result = {
    __meta: {
      fileType,
      version,
      parsedAt: new Date().toISOString(),
      isZipContainer: isZip,
      embeddedImages: imageList,
    },
    ...(metadata ? { metadata } : {}),
    document: decoded,
  };

  return result;
}

/**
 * Extract embedded images from a .fig ZIP container.
 *
 * @param {Uint8Array|Buffer} fileBuffer - Raw .fig file bytes
 * @returns {Promise<Map<string, Uint8Array>>} Map of filename → image bytes
 */
export async function extractImages(fileBuffer) {
  const bytes = new Uint8Array(fileBuffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!isZip) {
    return new Map();
  }

  const { images } = await extractFromZip(bytes);
  return new Map(Object.entries(images));
}
