/**
 * Basic test — verifies parser can handle the .fig file structure.
 * Run: node test/basic.test.js
 *
 * For real testing, place a .fig file in test/fixtures/
 */

import fs from "fs";
import path from "path";
import { parseFigFile, cleanTree, extractTokens } from "../src/index.js";

const FIXTURES_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "fixtures"
);

// ─── Test helpers ────────────────────────────────────────────────────

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

// ─── Unit tests ──────────────────────────────────────────────────────

console.log("\n--- Module import test ---");
assert(typeof parseFigFile === "function", "parseFigFile is a function");
assert(typeof cleanTree === "function", "cleanTree is a function");
assert(typeof extractTokens === "function", "extractTokens is a function");

console.log("\n--- cleanTree tests ---");
{
  const mockTree = {
    type: "FRAME",
    name: "TestFrame",
    visible: true, // default, should be stripped
    locked: false, // default, should be stripped
    opacity: 0.5, // non-default, should stay
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    pluginData: { foo: "bar" }, // should be stripped
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

console.log("\n--- extractTokens tests ---");
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
  assert(tokens.typography.length > 0, "Extracts typography");
  assert(tokens.spacing.includes(16), "Extracts spacing 16");
  assert(tokens.spacing.includes(24), "Extracts spacing 24");
}

// ─── Integration test (if fixture exists) ────────────────────────────

console.log("\n--- Integration test ---");

if (fs.existsSync(FIXTURES_DIR)) {
  const figFiles = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".fig"));

  if (figFiles.length === 0) {
    console.log("  ⊘ No .fig files in test/fixtures/ — skipping integration test");
    console.log('    Place a .fig file there and re-run to test real parsing.');
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

        const cleaned = cleanTree(result.document);
        assert(typeof cleaned === "object", `${file}: cleanTree produces object`);

        const tokens = extractTokens(cleaned);
        assert(Array.isArray(tokens.colors), `${file}: tokens has colors array`);

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

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
