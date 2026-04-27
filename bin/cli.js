#!/usr/bin/env node

/**
 * fig-to-json CLI
 *
 * Usage:
 *   fig-to-json <input.fig> [--out <file-or-dir>] [--raw] [--tokens] [--images] [--compact]
 *
 * Examples:
 *   fig-to-json design.fig                         # -> stdout
 *   fig-to-json design.fig --out ./output          # -> ./output/design.json
 *   fig-to-json design.fig --out design.json       # -> ./design.json
 *   fig-to-json design.fig --out ./output --tokens # -> also extract tokens.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFigFile, extractImages } from "../src/fig-parser.js";
import { cleanTree, extractTokens } from "../src/tree-cleaner.js";

// ─── Argument parsing (no dependencies) ──────────────────────────────

const args = process.argv.slice(2);
const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../package.json"
);
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

function parseArgs(argv) {
  const options = {
    inputFile: null,
    out: null,
    raw: false,
    tokens: false,
    images: false,
    compact: false,
    help: false,
    version: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      case "--raw":
        options.raw = true;
        break;
      case "--tokens":
        options.tokens = true;
        break;
      case "--images":
        options.images = true;
        break;
      case "--compact":
        options.compact = true;
        break;
      case "--out":
      case "-o":
        if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
          throw new Error(`${arg} requires a file or directory path`);
        }
        options.out = argv[++i];
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(
      `Unexpected argument: ${positional[1]}. Use --out <file-or-dir> for output.`
    );
  }

  options.inputFile = positional[0] || null;
  return options;
}

// ─── Help ────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
fig-to-json - Offline Figma .fig to JSON converter

USAGE
  fig-to-json <input.fig> [--out <file-or-dir>] [flags]

FLAGS
  -o, --out <path>  Write JSON to a file or directory instead of stdout
  --raw            Output raw decoded data (no cleanup/stripping)
  --tokens         Also write design tokens to tokens.json
  --images         Also extract embedded images to images/
  --compact        Minified JSON output
  -v, --version    Show the package version
  -h, --help       Show this help

EXAMPLES
  fig-to-json design.fig
  fig-to-json design.fig --out ./output
  fig-to-json design.fig --out ./output/design.json --compact
  fig-to-json design.fig --out ./output --tokens --images

SECURITY
  This tool makes ZERO network calls. All processing is local.
  Verify with: strace -e network fig-to-json design.fig
`);
}

// ─── Main ────────────────────────────────────────────────────────────

function resolveOutput(inputFile, outPath) {
  if (!outPath) {
    return {
      mode: "stdout",
      jsonPath: null,
      outputDir: null,
      sidecarDir: null,
    };
  }

  if (outPath.toLowerCase().endsWith(".json")) {
    const jsonPath = path.resolve(outPath);
    return {
      mode: "file",
      jsonPath,
      outputDir: path.dirname(jsonPath),
      sidecarDir: path.dirname(jsonPath),
    };
  }

  const outputDir = path.resolve(outPath);
  const inputName = path.basename(inputFile, path.extname(inputFile));

  return {
    mode: "directory",
    jsonPath: path.join(outputDir, `${inputName}.json`),
    outputDir,
    sidecarDir: outputDir,
  };
}

function validateOptions(options, outputTarget) {
  if (!options.inputFile) {
    throw new Error("Missing input file. Run fig-to-json --help for usage.");
  }

  if (!fs.existsSync(options.inputFile)) {
    throw new Error(`File not found: ${options.inputFile}`);
  }

  if (!fs.statSync(options.inputFile).isFile()) {
    throw new Error(`Input path is not a file: ${options.inputFile}`);
  }

  if (path.extname(options.inputFile).toLowerCase() !== ".fig") {
    throw new Error(`Input file must use the .fig extension: ${options.inputFile}`);
  }

  if (options.images && !outputTarget.sidecarDir) {
    throw new Error("--images requires --out so image files have a destination directory");
  }
}

async function main() {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    console.log(packageJson.version);
    return;
  }

  const outputTarget = resolveOutput(options.inputFile, options.out);
  validateOptions(options, outputTarget);

  const fileBuffer = fs.readFileSync(options.inputFile);
  const indent = options.compact ? 0 : 2;

  console.error(
    `Parsing: ${options.inputFile} (${(fileBuffer.length / 1024).toFixed(1)} KB)`
  );

  // Parse
  const parsed = await parseFigFile(fileBuffer, { raw: options.raw });

  console.error(`File type: ${parsed.__meta.fileType}`);
  console.error(`Version: ${parsed.__meta.version}`);
  console.error(`ZIP container: ${parsed.__meta.isZipContainer}`);

  if (parsed.__meta.embeddedImages.length > 0) {
    console.error(`Embedded images: ${parsed.__meta.embeddedImages.length}`);
  }

  // Clean (unless raw mode)
  let output;
  if (options.raw) {
    output = parsed;
  } else {
    output = {
      ...parsed,
      document: cleanTree(parsed.document),
    };
  }

  // Extract tokens
  let tokens = null;
  if (options.tokens) {
    tokens = extractTokens(output.document);
    console.error(
      `Tokens: ${tokens.colors.length} colors, ${tokens.typography.length} type styles, ${tokens.spacing.length} spacing values`
    );
  }

  // Output
  if (outputTarget.mode === "stdout") {
    process.stdout.write(JSON.stringify(output, null, indent));
  } else {
    fs.mkdirSync(outputTarget.outputDir, { recursive: true });
    fs.writeFileSync(outputTarget.jsonPath, JSON.stringify(output, null, indent));
    console.error(`Written: ${outputTarget.jsonPath}`);

    // Tokens
    if (tokens) {
      const tokensPath = path.join(outputTarget.sidecarDir, "tokens.json");
      fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, indent));
      console.error(`Written: ${tokensPath}`);
    }

    // Images
    if (options.images) {
      const images = await extractImages(fileBuffer);
      if (images.size > 0) {
        const imgDir = path.join(outputTarget.sidecarDir, "images");
        fs.mkdirSync(imgDir, { recursive: true });
        for (const [name, data] of images) {
          const imgPath = path.join(imgDir, path.basename(name));
          fs.writeFileSync(imgPath, data);
          console.error(`Image: ${imgPath}`);
        }
      }
    }

    console.error(`\nDone.`);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  if (process.env.FIG_TO_JSON_DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
