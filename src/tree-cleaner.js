/**
 * tree-cleaner.js
 *
 * Transforms raw decoded Figma data into a clean, LLM-friendly
 * structure by stripping defaults, internal IDs, and noise.
 * Produces output optimized for HTML/CSS generation.
 */

// Properties to strip (internal Figma metadata, not useful for code gen)
const STRIP_KEYS = new Set([
  "pluginData",
  "pluginRelaunchData",
  "sharedPluginData",
  "exportSettings",
  "transitionNodeID",
  "transitionDuration",
  "transitionEasing",
  "reactions",
  "flowStartingPoints",
  "prototypeStartNodeID",
  "overriddenFields",
  "publishStatus",
  "componentPropertyDefinitions",
  "componentPropertyReferences",
  "documentColorProfile",
]);

// Default values that can be safely removed to reduce noise
const DEFAULTS = {
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "PASS_THROUGH",
  isMask: false,
  clipsContent: false,
  preserveRatio: false,
  strokeAlign: "INSIDE",
  strokeWeight: 0,
  cornerRadius: 0,
  rotation: 0,
};

/**
 * Clean a decoded Figma tree for LLM consumption.
 *
 * @param {object} decoded - Raw decoded data from parseFigFile
 * @param {object} options
 * @param {boolean} options.stripDefaults - Remove properties matching defaults
 * @param {boolean} options.stripBlobs - Remove binary blob data
 * @param {boolean} options.flattenSingleChild - Unwrap groups with single children
 * @returns {object} Cleaned tree
 */
export function cleanTree(decoded, options = {}) {
  const {
    stripDefaults = true,
    stripBlobs = true,
    flattenSingleChild = false,
  } = options;

  return walkNode(decoded, { stripDefaults, stripBlobs, flattenSingleChild });
}

function walkNode(node, opts, depth = 0) {
  if (!node || typeof node !== "object") return node;
  if (depth > 200) return node; // safety guard

  if (Array.isArray(node)) {
    return node
      .map((item) => walkNode(item, opts, depth + 1))
      .filter((item) => item !== undefined);
  }

  const cleaned = {};

  for (const [key, value] of Object.entries(node)) {
    // Strip internal keys
    if (STRIP_KEYS.has(key)) continue;

    // Strip blob data if requested
    if (
      opts.stripBlobs &&
      value &&
      typeof value === "object" &&
      value.__type === "blob"
    ) {
      cleaned[key] = { __type: "blob", length: value.length };
      continue;
    }

    // Strip default values
    if (opts.stripDefaults && key in DEFAULTS && value === DEFAULTS[key]) {
      continue;
    }

    // Strip empty arrays
    if (Array.isArray(value) && value.length === 0) continue;

    // Strip null/undefined
    if (value === null || value === undefined) continue;

    // Recurse into objects and arrays
    cleaned[key] = walkNode(value, opts, depth + 1);
  }

  // Flatten single-child groups
  if (
    opts.flattenSingleChild &&
    cleaned.type === "GROUP" &&
    Array.isArray(cleaned.children) &&
    cleaned.children.length === 1
  ) {
    return cleaned.children[0];
  }

  return cleaned;
}

/**
 * Extract a flat list of design tokens from a decoded tree.
 * Looks for variable bindings and style references.
 *
 * @param {object} tree - Cleaned or raw tree
 * @returns {object} { colors: [], typography: [], spacing: [] }
 */
export function extractTokens(tree) {
  const colors = new Map();
  const typography = new Map();
  const spacing = new Set();

  walkForTokens(tree, { colors, typography, spacing });

  const colorList = [...colors.entries()]
    .map(([hex, meta]) => ({
      hex,
      count: meta.count,
      sample: meta.sample,
      name: hex,
      value: meta.sample,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    colors: colorList,
    typography: [...typography.entries()].map(([name, value]) => ({
      name,
      ...value,
    })),
    spacing: [...spacing].sort((a, b) => a - b),
  };
}

function walkForTokens(node, acc, depth = 0) {
  if (!node || typeof node !== "object" || depth > 200) return;

  if (Array.isArray(node)) {
    node.forEach((item) => walkForTokens(item, acc, depth + 1));
    return;
  }

  collectSolidPaints(node.fillPaints, node, acc);
  collectSolidPaints(node.strokePaints, node, acc);
  collectSolidPaints(node.fills, node, acc);
  collectSolidPaints(node.strokes, node, acc);

  if (node.type === "TEXT") {
    const family = node.fontName?.family || node.style?.fontFamily;
    const fontStyle = node.fontName?.style;
    const fontSize = node.fontSize ?? node.style?.fontSize;
    const fontWeight = node.style?.fontWeight;
    if (family && fontSize != null) {
      const key = `${family}-${fontStyle || fontWeight || ""}-${fontSize}`;
      if (!acc.typography.has(key)) {
        acc.typography.set(key, {
          fontFamily: family,
          fontStyle: fontStyle,
          fontSize,
          fontWeight,
          lineHeight:
            node.lineHeight ??
            node.style?.lineHeightPx ??
            node.style?.lineHeight,
          letterSpacing: node.letterSpacing ?? node.style?.letterSpacing,
        });
      }
    }
  }

  for (const key of [
    "itemSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "stackSpacing",
    "stackCounterSpacing",
    "stackHorizontalPadding",
    "stackVerticalPadding",
    "stackPaddingRight",
    "stackPaddingBottom",
    "gridRowGap",
    "gridColumnGap",
  ]) {
    if (typeof node[key] === "number") acc.spacing.add(node[key]);
  }

  // Recurse
  for (const value of Object.values(node)) {
    walkForTokens(value, acc, depth + 1);
  }
}

function collectSolidPaints(paints, node, acc) {
  if (!Array.isArray(paints)) return;
  for (const fill of paints) {
    if (fill.type === "SOLID" && fill.color) {
      const { r, g, b } = fill.color;
      const hex = rgbToHex(r, g, b);
      const prev = acc.colors.get(hex) || { count: 0, sample: node.name || "unnamed" };
      prev.count += 1;
      if (!prev.sample) prev.sample = node.name || "unnamed";
      acc.colors.set(hex, prev);
    }
  }
}

function rgbToHex(r, g, b) {
  const to255 = (v) => Math.round((typeof v === "number" && v <= 1 ? v * 255 : v));
  return (
    "#" +
    [to255(r), to255(g), to255(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
