// App orchestration: URL/PAT input → GitHub fetch → validate → diff →
// side-by-side panes. Also a zero-API local mode for two files on disk.

import { GhClient, parsePrUrl, isHtmlPath, fetchPair } from './github.js';
import { validateSource } from './validate.js';
import { extractBlocks, stampBlocks } from './blocks.js';
import { matchBlocks, lineDiff, summarize } from './diff.js';
import { buildSrcdoc, createPane, neuterNavigation, applyHighlights, findBlock } from './render.js';
import { layoutPanes, changeOffset } from './align.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#pr-form'),
  url: $('#pr-url'),
  token: $('#pr-token'),
  status: $('#status'),
  rate: $('#rate'),
  files: $('#files'),
  viewer: $('#viewer'),
  chrome: $('#chrome-diff'),
  changes: $('#change-nav'),
  localOld: $('#local-old'),
  localNew: $('#local-new'),
};

let state = { client: null, pr: null, mergeBase: null, currentOps: null, frames: null };

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ref = parsePrUrl(els.url.value);
  if (!ref) return setStatus('That does not look like a GitHub PR URL.', 'error');
  await loadPr(ref).catch((err) => {
    setStatus(errorMessage(err), 'error');
    updateRate();
  });
});

async function loadPr(ref) {
  state.client = new GhClient(els.token.value.trim() || null);
  setStatus(`Loading ${ref.owner}/${ref.repo}#${ref.number}…`);
  const pr = await state.client.getPr(ref);
  state.pr = pr;
  state.mergeBase = await state.client.getMergeBaseSha(pr);
  const files = (await state.client.listFiles(pr)).filter((f) => isHtmlPath(f.filename));
  updateRate();
  els.files.replaceChildren();
  if (!files.length) {
    return setStatus('No HTML files changed in this PR.', 'error');
  }
  setStatus(`${pr.title} — ${files.length} HTML file${files.length > 1 ? 's' : ''} changed. Pick one:`);
  for (const file of files) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<span class="fname"></span> <span class="fstat ${file.status}">${file.status}</span>` +
      ` <span class="fcounts">+${file.additions} −${file.deletions}</span>`;
    btn.querySelector('.fname').textContent = file.filename;
    btn.addEventListener('click', () => {
      for (const b of els.files.querySelectorAll('button')) b.classList.remove('active');
      btn.classList.add('active');
      showFile(file).catch((err) => setStatus(errorMessage(err), 'error'));
    });
    li.appendChild(btn);
    els.files.appendChild(li);
  }
  files.length === 1 && els.files.querySelector('button').click();
}

async function showFile(file) {
  setStatus(`Fetching ${file.filename} at merge base and head…`);
  const { before, after } = await fetchPair(state.client, state.pr, state.mergeBase, file);
  updateRate();
  renderDiff(before, after, file.filename);
}

// ---------- local mode ----------

async function maybeRenderLocal() {
  const oldFile = els.localOld.files[0];
  const newFile = els.localNew.files[0];
  if (!oldFile || !newFile) return;
  const [before, after] = await Promise.all([oldFile.text(), newFile.text()]);
  els.files.replaceChildren();
  renderDiff(before, after, `${oldFile.name} → ${newFile.name}`);
}
els.localOld.addEventListener('change', maybeRenderLocal);
els.localNew.addEventListener('change', maybeRenderLocal);

// ---------- diff rendering ----------

function renderDiff(beforeText, afterText, label) {
  els.viewer.replaceChildren();
  els.chrome.replaceChildren();
  els.changes.replaceChildren();

  if (beforeText === null || afterText === null) {
    const text = beforeText ?? afterText;
    const which = beforeText === null ? 'added' : 'removed';
    const result = validateSource(text);
    if (result.errors.length) return renderFallback(beforeText || '', afterText || '', result.errors, label);
    const blocks = extractBlocks(result.doc.body);
    stampBlocks(blocks);
    const frame = createPane(buildSrcdoc(result.doc));
    frame.classList.add(`pane-${which}`);
    const wrap = paneColumn(which === 'added' ? 'after (new file)' : 'before (deleted file)', frame);
    els.viewer.appendChild(wrap);
    frame.addEventListener('load', () => {
      neuterNavigation(frame.contentDocument);
      frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
    });
    setStatus(`${label}: file ${which} in this PR.`);
    return;
  }

  const oldResult = validateSource(beforeText);
  const newResult = validateSource(afterText);
  const errors = [...oldResult.errors, ...newResult.errors];
  if (errors.length) return renderFallback(beforeText, afterText, errors, label);

  const oldBlocks = extractBlocks(oldResult.doc.body);
  const newBlocks = extractBlocks(newResult.doc.body);
  stampBlocks(oldBlocks);
  stampBlocks(newBlocks);
  const ops = matchBlocks(oldBlocks, newBlocks);
  state.currentOps = ops;

  const leftFrame = createPane(buildSrcdoc(oldResult.doc));
  const rightFrame = createPane(buildSrcdoc(newResult.doc));
  state.frames = { leftFrame, rightFrame };
  els.viewer.appendChild(paneColumn('before', leftFrame));
  els.viewer.appendChild(paneColumn('after', rightFrame));

  let loaded = 0;
  const onLoad = () => {
    if (++loaded < 2) return;
    neuterNavigation(leftFrame.contentDocument);
    neuterNavigation(rightFrame.contentDocument);
    applyHighlights(leftFrame.contentDocument, rightFrame.contentDocument, ops, oldBlocks, newBlocks);
    layoutPanes(leftFrame, rightFrame, ops);
    buildChangeNav(ops, oldBlocks, newBlocks, leftFrame, rightFrame);
    const s = summarize(ops);
    setStatus(`${label} — ${s.modified} modified, ${s.added} added, ${s.removed} removed ` +
      `(${s.same} unchanged blocks).`);
  };
  leftFrame.addEventListener('load', onLoad);
  rightFrame.addEventListener('load', onLoad);

  renderChromeDiff(oldResult.doc, newResult.doc);
  new ResizeObserver(() => {
    if (state.frames) layoutPanes(state.frames.leftFrame, state.frames.rightFrame, state.currentOps);
  }).observe(els.viewer);
}

function paneColumn(title, frame) {
  const col = document.createElement('div');
  col.className = 'pane-col';
  const h = document.createElement('div');
  h.className = 'pane-title';
  h.textContent = title;
  col.append(h, frame);
  return col;
}

// Title/meta/<style> changes affect everything, so they get their own
// compact panel instead of pretending to fit block alignment.
function renderChromeDiff(oldDoc, newDoc) {
  const chrome = (doc) => {
    const parts = [`title: ${doc.querySelector('title')?.textContent ?? ''}`];
    for (const m of doc.head.querySelectorAll('meta[name]')) {
      parts.push(`meta ${m.getAttribute('name')}: ${m.getAttribute('content') ?? ''}`);
    }
    for (const s of doc.head.querySelectorAll('style')) parts.push(s.textContent);
    return parts.join('\n');
  };
  const oldChrome = chrome(oldDoc);
  const newChrome = chrome(newDoc);
  if (oldChrome === newChrome) return;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Document chrome changed (title, metadata, or CSS)';
  const pre = document.createElement('pre');
  for (const line of lineDiff(oldChrome, newChrome)) {
    const span = document.createElement('span');
    span.className = `chrome-${line.type}`;
    span.textContent = (line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  ') + line.text + '\n';
    pre.appendChild(span);
  }
  details.append(summary, pre);
  els.chrome.appendChild(details);
}

function buildChangeNav(ops, oldBlocks, newBlocks, leftFrame, rightFrame) {
  const changes = ops.filter((op) => op.type !== 'same');
  if (!changes.length) return;
  let cursor = -1;
  const go = (dir) => {
    cursor = (cursor + dir + changes.length) % changes.length;
    const op = changes[cursor];
    const frame = op.type === 'removed' ? leftFrame : rightFrame;
    const doc = frame.contentDocument;
    const el = findBlock(doc, op.type === 'removed' ? op.oldIndex : (op.newIndex ?? op.oldIndex));
    if (!el) return;
    const container = els.viewer;
    container.scrollTo({ top: changeOffset(container, frame, el) - 60, behavior: 'smooth' });
    counter.textContent = `${cursor + 1} / ${changes.length}`;
  };
  const prev = document.createElement('button');
  prev.textContent = '↑ prev';
  const next = document.createElement('button');
  next.textContent = '↓ next';
  const counter = document.createElement('span');
  counter.textContent = `${changes.length} change${changes.length > 1 ? 's' : ''}`;
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  els.changes.append(prev, next, counter);
}

// Non-conformant docs never reach the rendered view: list violations and
// fall back to an honest plain-text diff.
function renderFallback(beforeText, afterText, errors, label) {
  const panel = document.createElement('div');
  panel.className = 'violations';
  const h = document.createElement('p');
  h.textContent = `${label}: not renderable as diffable HTML (dizy 0.1) — showing text diff. Violations:`;
  const ul = document.createElement('ul');
  for (const v of dedupe(errors).slice(0, 20)) {
    const li = document.createElement('li');
    li.textContent = `${v.rule} at ${v.where}: ${v.message}`;
    ul.appendChild(li);
  }
  panel.append(h, ul);
  const pre = document.createElement('pre');
  pre.className = 'text-diff';
  for (const line of lineDiff(beforeText || '', afterText || '')) {
    const span = document.createElement('span');
    span.className = `chrome-${line.type}`;
    span.textContent = (line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  ') + line.text + '\n';
    pre.appendChild(span);
  }
  els.viewer.replaceChildren(panel, pre);
  setStatus(`${label}: fell back to text diff (${errors.length} violation${errors.length > 1 ? 's' : ''}).`);
}

function dedupe(violations) {
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.rule}|${v.where}|${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setStatus(message, kind) {
  els.status.textContent = message;
  els.status.className = kind === 'error' ? 'error' : '';
}

function updateRate() {
  const rl = state.client?.rateLimit;
  if (!rl || rl.limit === null) return;
  const reset = rl.reset ? new Date(rl.reset * 1000).toLocaleTimeString() : '?';
  els.rate.textContent = `GitHub API: ${rl.remaining}/${rl.limit} requests left (resets ${reset})`;
  els.rate.classList.toggle('low', rl.remaining < 10);
}

function errorMessage(err) {
  if (err.rateLimited) {
    return 'GitHub rate limit exhausted (60/hr unauthenticated). Add a fine-grained token below for 5000/hr.';
  }
  if (err.status === 404) {
    return 'PR not found — check the URL, or add a token if the repo is private.';
  }
  return `${err.message}${err.detail ? ` — ${err.detail}` : ''}`;
}
