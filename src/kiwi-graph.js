/**
 * Kiwi .fig files are a flat `document.nodeChanges` graph keyed by guid,
 * not a REST-style `children` tree. Layer `name` is often stale;
 * visible copy lives on `textData.characters`.
 */

export function guidToId(guid) {
  if (!guid || typeof guid !== "object") return null;
  if (guid.sessionID == null && guid.localID == null) return null;
  return `${guid.sessionID}:${guid.localID}`;
}

export function indexNodeChanges(document) {
  const nodes = document?.nodeChanges;
  if (!Array.isArray(nodes)) return null;

  const byId = new Map();
  const children = new Map();

  for (const node of nodes) {
    const id = guidToId(node.guid);
    if (!id) continue;
    byId.set(id, node);
    const parentId = guidToId(node.parentIndex?.guid);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(node);
  }

  return { byId, children, nodes };
}

export function descendants(index, startId) {
  const out = [];
  const stack = [startId];
  const seen = new Set();

  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kids = index.children.get(id) || [];
    for (const child of kids) {
      const cid = guidToId(child.guid);
      out.push(child);
      if (cid) stack.push(cid);
    }
  }

  return out;
}

function frameSize(node) {
  const size = node.size || {};
  const w = size.x ?? node.width ?? node.absoluteBoundingBox?.width;
  const h = size.y ?? node.height ?? node.absoluteBoundingBox?.height;
  return { w, h };
}

function collectRestPagesAndScreens(node, pages, screens, parent = null) {
  if (!node || typeof node !== "object") return;
  const type = node.type;
  const id = node.id || guidToId(node.guid);
  if (type === "CANVAS" || type === "PAGE") {
    pages.push({
      id,
      name: node.name,
      child_count: Array.isArray(node.children) ? node.children.length : 0,
    });
  }
  const { w, h } = frameSize(node);
  if (type === "FRAME" && w === 1920 && h === 1080) {
    screens.push({
      id,
      name: node.name,
      parent_id: parent?.id || guidToId(parent?.guid),
      parent_name: parent?.name,
      parent_type: parent?.type,
      w,
      h,
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectRestPagesAndScreens(child, pages, screens, node);
    }
  }
}

export function extractOutline(document) {
  const index = indexNodeChanges(document);
  if (!index) {
    const pages = [];
    const screens = [];
    collectRestPagesAndScreens(document, pages, screens);
    return { pages, screens, node_count: null, format: "rest" };
  }

  const pages = index.nodes
    .filter((n) => n.type === "CANVAS")
    .map((n) => {
      const id = guidToId(n.guid);
      return {
        id,
        name: n.name,
        child_count: (index.children.get(id) || []).length,
      };
    });

  const screens = index.nodes
    .filter((n) => {
      if (n.type !== "FRAME") return false;
      const { w, h } = frameSize(n);
      return w === 1920 && h === 1080;
    })
    .map((n) => {
      const parent = index.byId.get(guidToId(n.parentIndex?.guid));
      const { w, h } = frameSize(n);
      return {
        id: guidToId(n.guid),
        name: n.name,
        parent_id: guidToId(n.parentIndex?.guid),
        parent_name: parent?.name,
        parent_type: parent?.type,
        w,
        h,
      };
    });

  return {
    pages,
    screens,
    node_count: index.nodes.length,
    format: "kiwi",
  };
}

function textRecord(node) {
  const characters =
    node.textData?.characters ??
    node.characters ??
    null;
  if (!characters) return null;
  const font = node.fontName || {};
  const style = node.style || {};
  const size = node.size || {};
  return {
    t: characters,
    layer: node.name,
    font: [font.family || style.fontFamily, font.style]
      .filter(Boolean)
      .join(" "),
    size: node.fontSize ?? style.fontSize,
    box: {
      x: size.x ?? node.width,
      y: size.y ?? node.height,
    },
  };
}

export function extractNodeCopy(document, nodeId) {
  const index = indexNodeChanges(document);
  if (!index) {
    return { id: nodeId, error: "document is not a kiwi nodeChanges graph" };
  }

  const root = index.byId.get(nodeId);
  if (!root) {
    return { id: nodeId, error: "node not found" };
  }

  const nodes = [root, ...descendants(index, nodeId)];
  const texts = [];
  const seen = new Set();
  for (const node of nodes) {
    const rec = textRecord(node);
    if (!rec || seen.has(rec.t)) continue;
    seen.add(rec.t);
    texts.push(rec);
  }

  return {
    id: nodeId,
    name: root.name,
    type: root.type,
    count: texts.length,
    texts,
  };
}

export function slugName(name) {
  return String(name || "screen")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "screen";
}
