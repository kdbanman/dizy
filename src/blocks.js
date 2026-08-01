// Leaf-block extraction (issue #6). A validated doc's body flattens to a
// linear sequence of leaf blocks; because dizy docs promise reading order
// = DOM order, this sequence is a faithful representation for alignment.

const CONTAINER_TAGS = new Set([
  'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div',
  'blockquote', 'figure', 'details',
]);
const LEAF_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'hr', 'ul', 'ol', 'dl',
  'table', 'figcaption', 'summary',
]);

// Walks text nodes so tokenization matches the highlight pass exactly
// (a word split across inline elements stays two tokens in both).
export function textTokens(el) {
  const tokens = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        for (const t of child.data.split(/\s+/)) if (t) tokens.push(t);
      } else if (child.nodeType === 1) {
        walk(child);
      }
    }
  };
  walk(el);
  return tokens;
}

// FNV-1a over tag + normalized tokens + salient attributes. Attribute
// changes alone must change the hash so href/class edits register as
// "modified" rather than silently matching.
export function blockHash(el) {
  let h = 0x811c9dc5;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  };
  mix(el.tagName.toLowerCase());
  for (const t of textTokens(el)) mix(t);
  mix(attrSignature(el));
  return h >>> 0;
}

export function attrSignature(root) {
  const parts = [];
  const visit = (el) => {
    const names = [];
    for (const a of el.attributes) names.push(`${a.name.toLowerCase()}=${a.value}`);
    names.sort();
    parts.push(el.tagName.toLowerCase() + '|' + names.join('|'));
    for (const child of el.children) visit(child);
  };
  visit(root);
  return parts.join('~');
}

export function extractBlocks(body) {
  const blocks = [];
  const walk = (el, path) => {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (LEAF_TAGS.has(tag)) {
        push(child, tag, path);
      } else if (CONTAINER_TAGS.has(tag)) {
        if (hasBlockChildren(child)) {
          walk(child, path + '/' + tag + (child.id ? '#' + child.id : ''));
        } else {
          push(child, tag, path); // container with only inline content = leaf
        }
      } else {
        push(child, tag, path); // stray inline at block level; treat as leaf
      }
    }
  };
  const push = (el, tag, path) => {
    blocks.push({
      el,
      tag,
      path,
      id: el.id || null,
      tokens: textTokens(el),
      hash: blockHash(el),
      index: blocks.length,
    });
  };
  walk(body, '');
  return blocks;
}

function hasBlockChildren(el) {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase();
    if (LEAF_TAGS.has(tag) || CONTAINER_TAGS.has(tag)) return true;
  }
  return false;
}

// Tags each leaf block element with its sequence index so panes can find
// blocks after serialization round-trips through srcdoc.
export function stampBlocks(blocks) {
  for (const b of blocks) b.el.setAttribute('data-dizy-block', String(b.index));
}
