// Pane assembly and highlight application (issues #4, #6).
//
// Each doc version renders in <iframe sandbox="allow-same-origin" srcdoc=…>:
// no allow-scripts means nothing executes inside; allow-same-origin means
// this parent can measure and mutate the pane DOM. The injected meta CSP
// (first child of head) blocks every subresource fetch the markup or CSS
// could declare. Sandbox blocks forms/popups/meta-refresh; the one gap —
// same-frame <a href> navigation — is closed by a capturing click handler.

import { textTokens } from './blocks.js';
import { wordDiff, matchRows } from './diff.js';

const PANE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'";

const PANE_STYLES = `
  .dizy-block-added { background: rgba(46, 160, 67, 0.14); box-shadow: -4px 0 0 rgba(46,160,67,.65); }
  .dizy-block-removed { background: rgba(248, 81, 73, 0.14); box-shadow: -4px 0 0 rgba(248,81,73,.65); }
  .dizy-block-modified { background: rgba(210, 153, 34, 0.10); box-shadow: -4px 0 0 rgba(210,153,34,.65); }
  tr.dizy-block-added td, tr.dizy-block-added th { background: rgba(46, 160, 67, 0.14); }
  tr.dizy-block-removed td, tr.dizy-block-removed th { background: rgba(248, 81, 73, 0.14); }
  tr.dizy-block-modified td, tr.dizy-block-modified th { background: rgba(210, 153, 34, 0.10); }
  .dizy-inline-added { background: rgba(46, 160, 67, 0.35); border-radius: 2px; }
  .dizy-inline-removed { background: rgba(248, 81, 73, 0.35); border-radius: 2px; text-decoration: line-through; text-decoration-thickness: 1px; }
  .dizy-spacer { border: 0; margin: 0; padding: 0; }
`;

export function buildSrcdoc(doc) {
  const headParts = [
    `<meta http-equiv="Content-Security-Policy" content="${PANE_CSP}">`,
    '<meta charset="utf-8">',
    '<base href="about:srcdoc">',
  ];
  for (const style of doc.head?.querySelectorAll('style') || []) {
    headParts.push(`<style>${style.textContent}</style>`);
  }
  headParts.push(`<style>${PANE_STYLES}</style>`);
  const bodyAttrs = [...(doc.body?.attributes || [])]
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('');
  return `<!DOCTYPE html><html><head>${headParts.join('')}</head>` +
    `<body${bodyAttrs}>${doc.body ? doc.body.innerHTML : ''}</body></html>`;
}

function escapeAttr(v) {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function createPane(srcdoc) {
  const iframe = document.createElement('iframe');
  iframe.className = 'dizy-pane';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('srcdoc', srcdoc);
  return iframe;
}

// Fragment links scroll in-frame (harmless, useful); everything else is
// inert. Sandbox already blocks popups/top-nav; this closes self-navigation.
export function neuterNavigation(paneDoc) {
  paneDoc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) e.preventDefault();
  }, true);
}

export function findBlock(paneDoc, index) {
  return paneDoc.querySelector(`[data-dizy-block="${index}"]`);
}

// Applies block classes and intra-block word highlights to both panes.
// oldBlocks/newBlocks are the block records from the *source* documents
// (token arrays reused for the word diff); panes hold parallel DOM stamped
// with the same data-dizy-block indices.
export function applyHighlights(leftDoc, rightDoc, ops, oldBlocks, newBlocks) {
  for (const op of ops) {
    if (op.type === 'same') continue;
    if (op.type === 'removed') {
      mark(findBlock(leftDoc, op.oldIndex), 'dizy-block-removed');
    } else if (op.type === 'added') {
      mark(findBlock(rightDoc, op.newIndex), 'dizy-block-added');
    } else if (op.type === 'modified') {
      const leftEl = findBlock(leftDoc, op.oldIndex);
      const rightEl = findBlock(rightDoc, op.newIndex);
      const oldBlock = oldBlocks[op.oldIndex];
      const newBlock = newBlocks[op.newIndex];
      if (oldBlock.tag === 'table' && newBlock.tag === 'table' && leftEl && rightEl) {
        highlightTable(leftEl, rightEl);
        continue;
      }
      mark(leftEl, 'dizy-block-modified');
      mark(rightEl, 'dizy-block-modified');
      const { removed, added } = wordDiff(oldBlock.tokens, newBlock.tokens);
      if (leftEl) wrapTokenIntervals(leftEl, removed, 'dizy-inline-removed');
      if (rightEl) wrapTokenIntervals(rightEl, added, 'dizy-inline-added');
    }
  }
}

function mark(el, cls) {
  if (el) el.classList.add(cls);
}

// Row-level LCS, then cell-wise word diff for modified rows.
function highlightTable(leftTable, rightTable) {
  const leftRows = [...leftTable.querySelectorAll('tr')];
  const rightRows = [...rightTable.querySelectorAll('tr')];
  const ops = matchRows(leftRows.map(textTokens), rightRows.map(textTokens));
  for (const op of ops) {
    if (op.type === 'same') continue;
    if (op.type === 'removed') mark(leftRows[op.oldIndex], 'dizy-block-removed');
    else if (op.type === 'added') mark(rightRows[op.newIndex], 'dizy-block-added');
    else {
      const lr = leftRows[op.oldIndex], rr = rightRows[op.newIndex];
      mark(lr, 'dizy-block-modified');
      mark(rr, 'dizy-block-modified');
      const lCells = [...lr.children], rCells = [...rr.children];
      const n = Math.max(lCells.length, rCells.length);
      for (let i = 0; i < n; i++) {
        const lc = lCells[i], rc = rCells[i];
        const lt = lc ? textTokens(lc) : [];
        const rt = rc ? textTokens(rc) : [];
        const { removed, added } = wordDiff(lt, rt);
        if (lc) wrapTokenIntervals(lc, removed, 'dizy-inline-removed');
        if (rc) wrapTokenIntervals(rc, added, 'dizy-inline-added');
      }
    }
  }
}

// Wraps the word tokens whose global (per-block) indices fall inside the
// intervals. Walks the block's text nodes with the same whitespace
// tokenization as blocks.textTokens, so indices line up by construction.
export function wrapTokenIntervals(blockEl, intervals, className) {
  if (!intervals.length) return;
  const inInterval = (idx) => intervals.some(([s, e]) => idx >= s && idx < e);
  const textNodes = [];
  const collect = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) textNodes.push(child);
      else if (child.nodeType === 1) collect(child);
    }
  };
  collect(blockEl);

  let tokenIdx = 0;
  for (const node of textNodes) {
    const matches = [...node.data.matchAll(/\S+/g)];
    if (!matches.length) continue;
    // Merge adjacent selected tokens into char ranges before splitting.
    const ranges = [];
    for (const m of matches) {
      if (inInterval(tokenIdx)) {
        const start = m.index, end = m.index + m[0].length;
        const last = ranges[ranges.length - 1];
        if (last && /^\s*$/.test(node.data.slice(last.end, start))) last.end = end;
        else ranges.push({ start, end });
      }
      tokenIdx++;
    }
    const doc = node.ownerDocument;
    for (const { start, end } of ranges.reverse()) {
      const tail = node.splitText(start);
      tail.splitText(end - start);
      const span = doc.createElement('span');
      span.className = className;
      tail.parentNode.replaceChild(span, tail);
      span.appendChild(tail);
    }
  }
}
