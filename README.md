# fig-to-json

Offline Figma `.fig` file to JSON converter for Node.js.

**Zero network calls. Extracts schema from the file itself. Minimal dependencies.**

Built for environments where the Figma API, MCP, and plugins are restricted, such as banks, government, and other regulated industries.

## Why this exists

Figma's `.fig` files use the Kiwi binary format with an embedded schema. Most existing Node.js parsers bundle a hardcoded schema that goes stale when Figma updates their format. This tool extracts the schema from the file itself, so it can adapt to different Figma file versions.

## Install

```bash
git clone git@github.com:allenzhong/fig-to-json.git
cd fig-to-json
npm install
```

Run locally:

```bash
node bin/cli.js --help
```

After package installation, use the CLI:

```bash
fig-to-json --help
```

## CLI Usage

Get a `.fig` file from Figma with `File -> Save local copy...`.

```bash
# Print JSON to stdout
fig-to-json design.fig

# Write to an output directory as ./output/design.json
fig-to-json design.fig --out ./output

# Write to a specific file
fig-to-json design.fig --out ./design.json

# Raw mode: no cleanup, all decoded Figma internals preserved
fig-to-json design.fig --out ./output --raw

# Also extract design tokens to tokens.json
fig-to-json design.fig --out ./output --tokens

# Also extract embedded images to images/
fig-to-json design.fig --out ./output --images

# Compact JSON
fig-to-json design.fig --out ./output/design.json --compact

# Pipe to jq for specific nodes
fig-to-json design.fig | jq '.document'
```

Status messages are written to stderr, so stdout stays pipe-safe JSON.

## Library Usage

```javascript
import fs from "fs";
import { parseFigFile, cleanTree, extractTokens } from "fig-to-json";

const buffer = fs.readFileSync("design.fig");
const data = await parseFigFile(buffer);

const cleaned = cleanTree(data.document);
const tokens = extractTokens(cleaned);

fs.writeFileSync("design.json", JSON.stringify(cleaned, null, 2));
fs.writeFileSync("tokens.json", JSON.stringify(tokens, null, 2));
```

## Output Structure

```text
output/
├── design.json          # Full design tree
├── tokens.json          # Extracted design tokens, with --tokens
└── images/              # Embedded images, with --images
    ├── image1.png
    └── image2.jpg
```

### `design.json` shape

```json
{
  "__meta": {
    "fileType": "DESIGN",
    "version": 6,
    "parsedAt": "2026-04-24T...",
    "isZipContainer": true,
    "embeddedImages": ["images/abc.png"]
  },
  "metadata": {},
  "document": {
    "type": "DOCUMENT",
    "children": [
      {
        "type": "CANVAS",
        "name": "Page 1",
        "children": []
      }
    ]
  }
}
```

### `tokens.json` shape

```json
{
  "colors": [
    { "name": "#3366ff", "value": "PrimaryButton" }
  ],
  "typography": [
    {
      "name": "Inter-16-400",
      "fontFamily": "Inter",
      "fontSize": 16,
      "fontWeight": 400,
      "lineHeight": 24
    }
  ],
  "spacing": [4, 8, 12, 16, 24, 32]
}
```

## Pipeline: `.fig` to React components

```bash
# Step 1: Convert
fig-to-json design.fig --out ./output --tokens

# Step 2: Feed to an LLM
cat output/design.json | your-llm-cli "Generate React components using these tokens..."

# Or use jq to extract a specific frame first
cat output/design.json | jq '.document.children[0].children[] | select(.name == "LoginCard")' > login-card.json
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
- Very large files may need `--max-old-space-size` for Node.js.

## How it works

1. Detect if the file is a ZIP container or raw fig-kiwi binary.
2. If ZIP, extract the main binary, metadata, and embedded images.
3. Read the file header to determine type: design, FigJam, or slides.
4. Extract compressed schema and data chunks.
5. Decompress each chunk with deflate or zstandard.
6. Decode the schema from the file itself.
7. Use the schema to decode the data chunk into a JavaScript object.
8. Optionally clean the tree, extract tokens, and write sidecar assets.

## License

MIT
