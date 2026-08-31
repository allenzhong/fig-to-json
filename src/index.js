/**
 * fig-to-json
 *
 * Offline Figma .fig → JSON converter.
 * Zero network calls. Extracts schema from the file itself.
 *
 * Usage:
 *   import { parseFigFile, cleanTree, extractTokens, jsonStringify } from "fig-to-json";
 *
 *   const data = await parseFigFile(fs.readFileSync('design.fig'));
 *   const clean = cleanTree(data.document);
 *   const tokens = extractTokens(clean);
 *   fs.writeFileSync("design.json", jsonStringify(data));
 */

export { parseFigFile, extractImages, sniffImageExt } from "./fig-parser.js";
export { cleanTree, extractTokens } from "./tree-cleaner.js";
export { jsonReplacer, jsonStringify, toJsonSafe } from "./serialize.js";
export {
  guidToId,
  indexNodeChanges,
  descendants,
  extractOutline,
  extractNodeCopy,
  slugName,
} from "./kiwi-graph.js";
