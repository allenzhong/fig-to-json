# fig-to-json

Offline Figma `.fig` file to JSON converter for Node.js.

**Zero network calls. Extracts schema from the file itself. Minimal dependencies.**

Built for environments where the Figma API, MCP, and plugins are restricted, such as banks, government, and other regulated industries.

## Why this exists

Figma's `.fig` files use the Kiwi binary format with an embedded schema. Most existing Node.js parsers bundle a hardcoded schema that goes stale when Figma updates their format. This tool extracts the schema from the file itself, so it can adapt to different Figma file versions.

Local `.fig` files are a **flat `nodeChanges` graph**, not the REST API tree. Layer names are often stale. Visible copy lives on `textData.characters`. Fills are `fillPaints`, type is `fontName` + `fontSize`. This package reads those kiwi fields.

## Install

The npm `1.0.4` tarball is a different build **without a CLI `bin`**. Use this git tree until `1.1.0` is published:

```bash
# from git (includes the CLI)
npx github:allenzhong/fig-to-json --help

git clone git@github.com:allenzhong/fig-to-json.git
cd fig-to-json
npm install
node bin/cli.js --help
```

After `1.1.0` is on npm:

```bash
npm i -g fig-to-json
fig-to-json --help
```

## CLI Usage

Get a `.fig` file from Figma with `File -> Save local copy...`.

```bash
# Print JSON to stdout
fig-to-json design.fig

# Write to an output directory as ./output/design.json
fig-to-json design.fig --out ./output

# Tokens, images, page/screen outline (no 140MB document dump)
fig-to-json design.fig --out ./output --tokens --images --outline --skip-json

# Unique visible copy per 1920×1080 frame
fig-to-json design.fig --out ./output --screens --skip-json

# One node (Figma id session:local, e.g. 6:11681)
fig-to-json design.fig --out ./output --node 6:11681 --skip-json

# Raw mode: no cleanup
fig-to-json design.fig --out ./output --raw

# Also extract embedded images to images/ (including hashed `images/<sha>` ZIP entries)
fig-to-json design.fig --out ./output --images
```

Status messages are written to stderr, so stdout stays pipe-safe JSON.

Large files:

```bash
NODE_OPTIONS=--max-old-space-size=8192 fig-to-json design.fig --out ./output --skip-json --tokens --outline --screens
```

## Library Usage

```javascript
import fs from "fs";
import {
  parseFigFile,
  cleanTree,
  extractTokens,
  extractOutline,
  extractNodeCopy,
  jsonStringify,
} from "fig-to-json";

const buffer = fs.readFileSync("design.fig");
const data = await parseFigFile(buffer);

// parseFigFile already converts BigInt so this will not throw
fs.writeFileSync("design.json", jsonStringify(data));

const tokens = extractTokens(data.document);
const outline = extractOutline(data.document);
const overview = extractNodeCopy(data.document, "6:11681");
```

Do **not** call `JSON.stringify(data)` without `jsonStringify` (or a BigInt replacer) on raw kiwi output. Native `JSON.stringify` throws `TypeError: BigInt value can't be serialized in JSON`.

## Output Structure

```text
output/
├── design.json          # Full design tree (omit with --skip-json)
├── tokens.json          # --tokens
├── outline.json         # --outline
├── screens/             # --screens
│   └── overview.json
└── images/              # --images
    ├── image1.png
    └── image2.jpg
```

### `tokens.json` shape

Colors are counted from kiwi `fillPaints` / `strokePaints` and REST `fills`:

```json
{
  "colors": [
    { "hex": "#FFFAF4", "count": 12, "sample": "Overview", "name": "#FFFAF4", "value": "Overview" }
  ],
  "typography": [
    {
      "name": "Inter-Bold-18",
      "fontFamily": "Inter",
      "fontStyle": "Bold",
      "fontSize": 18
    }
  ],
  "spacing": [4, 8, 12, 16, 24]
}
```

### Screen copy shape

`t` is `textData.characters` (what the user sees). `layer` is the layer name (often outdated).

```json
{
  "id": "6:11681",
  "name": "Overview",
  "count": 65,
  "texts": [
    { "t": "TikTok Command Center", "layer": "Executive Performance Overview", "font": "Inter Bold", "size": 18 }
  ]
}
```

## Pipeline: `.fig` to React components

```bash
fig-to-json design.fig --out ./output --tokens --outline --screens --skip-json

# Feed a single screen, not the 140MB dump
cat output/screens/overview.json | your-llm-cli "Implement this dashboard screen..."
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `pako` | Deflate decompression |
| `fzstd` | Zstandard decompression for newer `.fig` files |
| `kiwi-schema` | Kiwi binary format decoder |
| `fflate` | ZIP extraction for modern `.fig` containers |

All processing is local and all dependencies are pure JavaScript.

## Testing

```bash
npm test
```

For integration testing, place local `.fig` files in `test/fixtures/`. `.fig` files are ignored by git so private design files are not committed by accident.

## Security verification

```bash
# Verify zero network calls
strace -e network fig-to-json design.fig 2>&1 | grep -v "^---"

# Audit dependencies
npm audit
npm ls --all
```

## Known Limitations

- The `.fig` format is an unstable internal format, and Figma can change it without notice.
- Variable/token names are not always preserved.
- Some binary blob data, such as vector paths and gradients, is base64-encoded but not human-readable.
- Very large files may need `--max-old-space-size` and `--skip-json`.
- npm `fig-to-json@1.0.4` does not ship `bin/cli.js`. Use this git tree until 1.1.0 is published.

## How it works

1. Detect if the file is a ZIP container or raw fig-kiwi binary.
2. If ZIP, extract the main binary, metadata, and embedded images.
3. Read the file header to determine type: design, FigJam, or slides.
4. Extract compressed schema and data chunks.
5. Decompress each chunk with deflate or zstandard.
6. Decode the schema from the file itself.
7. Use the schema to decode the data chunk into a JavaScript object.
8. Convert BigInt / blobs so the result is JSON-serializable.
9. Optionally clean the tree, extract tokens, outline, screen copy, and sidecar assets.

## License

MIT
