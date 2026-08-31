/**
 * Basic test — verifies parser, JSON serialization, kiwi graph, and tokens.
 * Run: node test/basic.test.js
 *
 * For real testing, place a .fig file in test/fixtures/
 */

import fs from "fs";
import path from "path";
import {
  parseFigFile,
  cleanTree,
  extractTokens,
  jsonStringify,
  toJsonSafe,
  guidToId,
  extractOutline,
  extractNodeCopy,
  sniffImageExt,
} from "../src/index.js";

const FIXTURES_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "fixtures"
);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log("\n--- Module import test ---");
assert(typeof parseFigFile === "function", "parseFigFile is a function");
assert(typeof cleanTree === "function", "cleanTree is a function");
assert(typeof extractTokens === "function", "extractTokens is a function");
assert(typeof jsonStringify === "function", "jsonStringify is a function");
assert(typeof extractOutline === "function", "extractOutline is a function");

console.log("\n--- JSON BigInt tests ---");
{
  const threw = (() => {
    try {
      JSON.stringify({ n: 99n });
      return false;
    } catch {
      return true;
    }
  })();
  assert(threw, "native JSON.stringify throws on BigInt");
  const encoded = jsonStringify({ n: 99n, ok: true });
  assert(encoded.includes('"99"'), "jsonStringify encodes BigInt as string");
  assert(JSON.parse(encoded).ok === true, "jsonStringify round-trips other fields");
  const safe = toJsonSafe({ id: 6n, nested: [1n] });
  assert(safe.id === "6" && safe.nested[0] === "1", "toJsonSafe converts nested BigInt");
}

console.log("\n--- cleanTree tests ---");
{
  const mockTree = {
    type: "FRAME",
    name: "TestFrame",
    visible: true,
    locked: false,
    opacity: 0.5,
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    pluginData: { foo: "bar" },
    children: [],
  };

  const cleaned = cleanTree(mockTree);
  assert(cleaned.type === "FRAME", "Preserves type");
  assert(cleaned.name === "TestFrame", "Preserves name");
  assert(cleaned.visible === undefined, "Strips default visible=true");
  assert(cleaned.locked === undefined, "Strips default locked=false");
  assert(cleaned.opacity === 0.5, "Keeps non-default opacity");
  assert(cleaned.pluginData === undefined, "Strips pluginData");
  assert(cleaned.children === undefined, "Strips empty children array");
}

console.log("\n--- extractTokens REST-style tests ---");
{
  const mockTree = {
    type: "FRAME",
    name: "Page",
    itemSpacing: 16,
    paddingLeft: 24,
    paddingTop: 24,
    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.8 } }],
    children: [
      {
        type: "TEXT",
        name: "Heading",
        style: {
          fontFamily: "Inter",
          fontSize: 24,
          fontWeight: 700,
          lineHeightPx: 32,
        },
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      },
    ],
  };

  const tokens = extractTokens(mockTree);
  assert(tokens.colors.length > 0, "Extracts colors");
  assert(tokens.colors[0].hex.startsWith("#"), "Color has hex");
  assert(tokens.typography.length > 0, "Extracts typography");
  assert(tokens.spacing.includes(16), "Extracts spacing 16");
  assert(tokens.spacing.includes(24), "Extracts spacing 24");
}

console.log("\n--- extractTokens kiwi-style tests ---");
{
  const kiwi = {
    type: "NODE_CHANGES",
    nodeChanges: [
      {
        type: "FRAME",
        name: "Overview",
        fillPaints: [
          {
            type: "SOLID",
            color: { r: 1, g: 0.9803921568627451, b: 0.9568627450980393, a: 1 },
          },
        ],
        stackSpacing: 12,
        guid: { sessionID: 6, localID: 11681 },
        size: { x: 1920, y: 1080 },
      },
      {
        type: "TEXT",
        name: "Stale layer title",
        guid: { sessionID: 6, localID: 200 },
        parentIndex: { guid: { sessionID: 6, localID: 11681 } },
        fontName: { family: "Inter", style: "Bold" },
        fontSize: 18,
        fillPaints: [
          { type: "SOLID", color: { r: 0, g: 0.172549, b: 0.0235294, a: 1 } },
        ],
        textData: { characters: "TikTok Command Center" },
      },
    ],
  };

  const tokens = extractTokens(kiwi);
  assert(
    tokens.colors.some((c) => c.hex.toUpperCase() === "#FFFAF4"),
    "Reads kiwi fillPaints canvas cream"
  );
  assert(
    tokens.typography.some((t) => t.fontFamily === "Inter" && t.fontSize === 18),
    "Reads kiwi fontName + fontSize"
  );
  assert(tokens.spacing.includes(12), "Reads kiwi stackSpacing");

  assert(guidToId({ sessionID: 6, localID: 11681 }) === "6:11681", "guidToId formats session:local");

  const outline = extractOutline(kiwi);
  assert(outline.format === "kiwi", "Outline detects kiwi graph");
  assert(outline.screens.length === 1, "Outline finds 1920×1080 frame");
  assert(outline.screens[0].id === "6:11681", "Outline screen id is guid");

  const copy = extractNodeCopy(kiwi, "6:11681");
  assert(copy.count === 1, "Copy finds one unique string");
  assert(copy.texts[0].t === "TikTok Command Center", "Copy uses textData.characters, not layer name");
}

console.log("\n--- hashed image sniff tests ---");
{
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  assert(sniffImageExt(png) === "png", "sniffs PNG magic");
  assert(sniffImageExt(jpg) === "jpg", "sniffs JPEG magic");
}

console.log("\n--- Integration test ---");

if (fs.existsSync(FIXTURES_DIR)) {
  const figFiles = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".fig"));

  if (figFiles.length === 0) {
    console.log("  ⊘ No .fig files in test/fixtures/ — skipping integration test");
    console.log("    Place a .fig file there and re-run to test real parsing.");
  } else {
    for (const file of figFiles) {
      const filePath = path.join(FIXTURES_DIR, file);
      console.log(`  Testing: ${file}`);

      try {
        const buf = fs.readFileSync(filePath);
        const result = await parseFigFile(buf);

        assert(result.__meta !== undefined, `${file}: has __meta`);
        assert(result.__meta.fileType !== undefined, `${file}: has fileType`);
        assert(result.document !== undefined, `${file}: has document`);
        assert(
          typeof jsonStringify(result) === "string",
          `${file}: document JSON.stringify-safe`
        );

        const cleaned = cleanTree(result.document);
        assert(typeof cleaned === "object", `${file}: cleanTree produces object`);

        const tokens = extractTokens(cleaned);
        assert(Array.isArray(tokens.colors), `${file}: tokens has colors array`);
        assert(tokens.colors.length > 0, `${file}: kiwi/REST tokens are non-empty`);

        console.log(
          `    File type: ${result.__meta.fileType}, version: ${result.__meta.version}`
        );
      } catch (err) {
        failed++;
        console.error(`  ✗ ${file}: ${err.message}`);
      }
    }
  }
} else {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  console.log("  ⊘ Created test/fixtures/ — place .fig files there for integration testing");
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
