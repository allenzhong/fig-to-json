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

  return {
    colors: [...colors.entries()].map(([name, value]) => ({ name, value })),
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

  // Extract color fills
  if (node.fills && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === "SOLID" && fill.color) {
        const { r, g, b, a = 1 } = fill.color;
        const hex = rgbToHex(r, g, b);
        const name = node.name || "unnamed";
        acc.colors.set(hex, name);
      }
    }
  }

  // Extract typography
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    const key = `${s.fontFamily}-${s.fontSize}-${s.fontWeight}`;
    if (!acc.typography.has(key)) {
      acc.typography.set(key, {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeightPx || s.lineHeight,
        letterSpacing: s.letterSpacing,
      });
    }
  }

  // Extract spacing values from auto-layout
  if (node.itemSpacing !== undefined) acc.spacing.add(node.itemSpacing);
  if (node.paddingLeft !== undefined) acc.spacing.add(node.paddingLeft);
  if (node.paddingRight !== undefined) acc.spacing.add(node.paddingRight);
  if (node.paddingTop !== undefined) acc.spacing.add(node.paddingTop);
  if (node.paddingBottom !== undefined) acc.spacing.add(node.paddingBottom);

  // Recurse
  for (const value of Object.values(node)) {
    walkForTokens(value, acc, depth + 1);
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
