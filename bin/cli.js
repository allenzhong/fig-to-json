#!/usr/bin/env node

/**
 * fig-to-json CLI
 *
 * Usage:
 *   fig-to-json <input.fig> [--out <file-or-dir>] [--raw] [--tokens] [--images]
 *               [--outline] [--screens] [--node <id>] [--skip-json] [--compact]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFigFile, extractImages } from "../src/fig-parser.js";
import { cleanTree, extractTokens } from "../src/tree-cleaner.js";
import { jsonStringify } from "../src/serialize.js";
import { extractOutline, extractNodeCopy, slugName } from "../src/kiwi-graph.js";

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
    outline: false,
    screens: false,
    skipJson: false,
    node: null,
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
      case "--outline":
        options.outline = true;
        break;
      case "--screens":
        options.screens = true;
        break;
      case "--skip-json":
        options.skipJson = true;
        break;
      case "--node":
        if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
          throw new Error(`${arg} requires a node id (e.g. 6:11681)`);
        }
        options.node = argv[++i];
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

function printHelp() {
  console.log(`
fig-to-json - Offline Figma .fig to JSON converter

USAGE
  fig-to-json <input.fig> [--out <file-or-dir>] [flags]

FLAGS
  -o, --out <path>  Write JSON to a file or directory instead of stdout
  --raw             Output raw decoded data (no cleanup/stripping)
  --tokens          Write tokens.json (kiwi fillPaints + REST fills)
  --images          Extract embedded images to images/
  --outline         Write outline.json (pages + 1920×1080 screens)
  --screens         Write screens/<slug>.json copy dumps for each 1920 screen
  --node <id>       Write copy for one node (e.g. 6:11681) to <id>.json
  --skip-json       Do not write the full document JSON (use with sidecars)
  --compact         Minified JSON output
  -v, --version     Show the package version
  -h, --help        Show this help

EXAMPLES
  fig-to-json design.fig
  fig-to-json design.fig --out ./output
  fig-to-json design.fig --out ./output --tokens --images --outline
  fig-to-json design.fig --out ./output --screens --skip-json --node 6:11681

  Large files may need:
    NODE_OPTIONS=--max-old-space-size=8192 fig-to-json design.fig --out ./output

SECURITY
  This tool makes ZERO network calls. All processing is local.
`);
}

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

  const needsDir =
    options.images ||
    options.outline ||
    options.screens ||
    options.node ||
    options.skipJson;

  if (needsDir && !outputTarget.sidecarDir) {
    throw new Error("--out is required for --images, --outline, --screens, --node, and --skip-json");
  }
}

function writeJson(filePath, value, indent) {
  fs.writeFileSync(filePath, jsonStringify(value, indent));
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

  if (fileBuffer.length > 8 * 1024 * 1024) {
    console.error(
      `Large file (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB). If Node runs out of memory, retry with NODE_OPTIONS=--max-old-space-size=8192`
    );
  }

  console.error(
    `Parsing: ${options.inputFile} (${(fileBuffer.length / 1024).toFixed(1)} KB)`
  );

  const parsed = await parseFigFile(fileBuffer, { raw: options.raw });

  console.error(`File type: ${parsed.__meta.fileType}`);
  console.error(`Version: ${parsed.__meta.version}`);
  console.error(`ZIP container: ${parsed.__meta.isZipContainer}`);

  if (parsed.__meta.embeddedImages.length > 0) {
    console.error(`Embedded images: ${parsed.__meta.embeddedImages.length}`);
  }

  let output;
  if (options.raw) {
    output = parsed;
  } else {
    output = {
      ...parsed,
      document: cleanTree(parsed.document),
    };
  }

  const document = output.document;

  if (outputTarget.mode === "stdout") {
    process.stdout.write(jsonStringify(output, indent));
    return;
  }

  fs.mkdirSync(outputTarget.outputDir, { recursive: true });

  if (!options.skipJson) {
    writeJson(outputTarget.jsonPath, output, indent);
    console.error(`Written: ${outputTarget.jsonPath}`);
  }

  if (options.tokens) {
    const tokens = extractTokens(document);
    const tokensPath = path.join(outputTarget.sidecarDir, "tokens.json");
    writeJson(tokensPath, tokens, indent);
    console.error(
      `Tokens: ${tokens.colors.length} colors, ${tokens.typography.length} type styles, ${tokens.spacing.length} spacing values`
    );
    console.error(`Written: ${tokensPath}`);
  }

  if (options.outline || options.screens) {
    const outline = extractOutline(document);
    if (options.outline) {
      const outlinePath = path.join(outputTarget.sidecarDir, "outline.json");
      writeJson(outlinePath, outline, indent);
      console.error(
        `Outline: ${outline.pages.length} pages, ${outline.screens.length} 1920×1080 screens`
      );
      console.error(`Written: ${outlinePath}`);
    }
    if (options.screens) {
      const dir = path.join(outputTarget.sidecarDir, "screens");
      fs.mkdirSync(dir, { recursive: true });
      const used = new Set();
      for (const screen of outline.screens) {
        let slug = slugName(screen.name);
        if (used.has(slug)) slug = `${slug}_${screen.id.replace(":", "_")}`;
        used.add(slug);
        const copy = extractNodeCopy(document, screen.id);
        const filePath = path.join(dir, `${slug}.json`);
        writeJson(filePath, copy, indent);
      }
      console.error(`Written: ${dir} (${outline.screens.length} screens)`);
    }
  }

  if (options.node) {
    const copy = extractNodeCopy(document, options.node);
    const filePath = path.join(
      outputTarget.sidecarDir,
      `${options.node.replace(/[^a-zA-Z0-9]+/g, "_")}.json`
    );
    writeJson(filePath, copy, indent);
    console.error(`Written: ${filePath} (${copy.count ?? 0} unique strings)`);
  }

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

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  if (process.env.FIG_TO_JSON_DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
