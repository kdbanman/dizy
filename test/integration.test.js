// Full pipeline over the real fixture pair: validate → extract → match.
// The after-variant applies six edit types (word edits, heading text edit,
// h2→h3 promotion, added block, removed block, CSS tweak); the diff must
// report exactly those, with the unchanged majority matching exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { validateSource } from '../src/validate.js';
import { extractBlocks } from '../src/blocks.js';
import { matchBlocks, summarize } from '../src/diff.js';

const dom = new JSDOM().window;
const read = (p) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');

test('stint exemplar docs are dizy 0.1 conformant', () => {
  for (const file of ['concept.html', 'architecture.html', 'concept-after.html']) {
    const { errors } = validateSource(read(file), dom);
    assert.deepEqual(errors, [], `${file} should have no errors`);
  }
});

test('the dizy spec docs validate against themselves', () => {
  for (const file of ['diffable-html.html', 'architecture.html']) {
    const src = readFileSync(new URL(`../spec/${file}`, import.meta.url), 'utf8');
    const { errors } = validateSource(src, dom);
    assert.deepEqual(errors, [], `spec/${file} should have no errors`);
  }
});

test('fixture pair diff reports exactly the injected edits', () => {
  const before = validateSource(read('concept.html'), dom);
  const after = validateSource(read('concept-after.html'), dom);
  const oldBlocks = extractBlocks(before.doc.body);
  const newBlocks = extractBlocks(after.doc.body);
  const ops = matchBlocks(oldBlocks, newBlocks);
  const s = summarize(ops);

  // Injected: thesis word edits (modified), heading text edit (modified),
  // h2→h3 promotion (modified), one added paragraph, one removed pull quote.
  assert.equal(s.modified, 3, `expected 3 modified, got ${JSON.stringify(s)}`);
  assert.equal(s.added, 1);
  assert.equal(s.removed, 1);
  // The unchanged majority must match exactly — no over-marking.
  assert.ok(s.same > 30, `expected the unchanged majority to match, got ${s.same}`);

  const modified = ops.filter((o) => o.type === 'modified');
  const texts = modified.map((o) => oldBlocks[o.oldIndex].tokens.slice(0, 4).join(' '));
  assert.ok(texts.some((t) => t.startsWith('A quiet')), 'thesis rewording detected');
  assert.ok(texts.some((t) => t.startsWith('One person')), 'heading edit detected');
  assert.ok(texts.some((t) => t.startsWith('Monochrome')), 'heading promotion detected');
});

test('identical fixture diffed against itself is all-same', () => {
  const a = validateSource(read('architecture.html'), dom);
  const b = validateSource(read('architecture.html'), dom);
  const ops = matchBlocks(extractBlocks(a.doc.body), extractBlocks(b.doc.body));
  const s = summarize(ops);
  assert.equal(s.modified + s.added + s.removed, 0);
  assert.ok(s.same > 20);
});
