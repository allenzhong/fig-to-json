/**
 * fig-to-json
 *
 * Offline Figma .fig → JSON converter.
 * Zero network calls. Extracts schema from the file itself.
 *
 * Usage:
 *   import { parseFigFile, cleanTree, extractTokens } from "fig-to-json";
 *
 *   const data = await parseFigFile(fs.readFileSync('design.fig'));
 *   const clean = cleanTree(data.document);
 *   const tokens = extractTokens(clean);
 */

export { parseFigFile, extractImages } from "./fig-parser.js";
export { cleanTree, extractTokens } from "./tree-cleaner.js";
