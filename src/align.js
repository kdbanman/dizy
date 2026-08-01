// Pane alignment (issue #6): chunked spacer insertion, the CodeMirror
// merge-view model generalized to blocks. Both panes sit full-height in
// one shared scroll container, so a single native scrollbar scrolls both
// and no scroll-sync code exists. For every matched pair (same/modified),
// a spacer in the lagging pane brings the pair to the same y.

import { findBlock } from './render.js';

function topWithin(el, doc) {
  return el.getBoundingClientRect().top - doc.body.getBoundingClientRect().top;
}

export function insertSpacers(leftDoc, rightDoc, ops) {
  clearSpacers(leftDoc);
  clearSpacers(rightDoc);
  for (const op of ops) {
    if (op.type !== 'same' && op.type !== 'modified') continue;
    const leftEl = findBlock(leftDoc, op.oldIndex);
    const rightEl = findBlock(rightDoc, op.newIndex);
    if (!leftEl || !rightEl) continue;
    // Live reads: earlier spacers already shifted layout, so each delta
    // is measured against current truth and the loop self-corrects.
    const delta = topWithin(rightEl, rightDoc) - topWithin(leftEl, leftDoc);
    if (Math.abs(delta) < 1) continue;
    if (delta > 0) insertSpacer(leftDoc, leftEl, delta);
    else insertSpacer(rightDoc, rightEl, -delta);
  }
}

function insertSpacer(doc, beforeEl, height) {
  const spacer = doc.createElement('div');
  spacer.className = 'dizy-spacer';
  spacer.style.height = `${Math.round(height)}px`;
  beforeEl.parentNode.insertBefore(spacer, beforeEl);
}

export function clearSpacers(doc) {
  for (const s of [...doc.querySelectorAll('.dizy-spacer')]) s.remove();
}

export function sizePane(iframe) {
  const doc = iframe.contentDocument;
  if (!doc || !doc.documentElement) return;
  iframe.style.height = `${doc.documentElement.scrollHeight}px`;
}

// Aligns both panes and sizes the iframes; call on load and on resize.
export function layoutPanes(leftFrame, rightFrame, ops) {
  const leftDoc = leftFrame.contentDocument;
  const rightDoc = rightFrame.contentDocument;
  insertSpacers(leftDoc, rightDoc, ops);
  sizePane(leftFrame);
  sizePane(rightFrame);
}

// y-offset of a change within the shared scroll container, for navigation.
export function changeOffset(containerEl, frame, blockEl) {
  const frameTop = frame.getBoundingClientRect().top;
  const containerTop = containerEl.getBoundingClientRect().top;
  return frameTop - containerTop + containerEl.scrollTop +
    blockEl.getBoundingClientRect().top -
    frame.contentDocument.body.getBoundingClientRect().top;
}
