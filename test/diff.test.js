import test from 'node:test';
import assert from 'node:assert/strict';
import { lcs, diceSimilarity, matchBlocks, wordDiff, matchRows, lineDiff, summarize } from '../src/diff.js';

const mkBlocks = (specs) => specs.map((s, index) => ({
  index,
  tag: s.tag || 'p',
  id: s.id || null,
  tokens: s.text.split(/\s+/).filter(Boolean),
  hash: s.hash ?? hashOf(s),
}));
const hashOf = (s) => {
  let h = 0;
  for (const c of (s.tag || 'p') + '|' + s.text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

test('lcs finds in-order common subsequence', () => {
  const pairs = lcs([1, 2, 3, 4], [2, 4, 5], (a, b) => a === b);
  assert.deepEqual(pairs, [[1, 0], [3, 1]]);
});

test('lcs of disjoint sequences is empty', () => {
  assert.deepEqual(lcs([1], [2], (a, b) => a === b), []);
});

test('dice similarity basics', () => {
  assert.equal(diceSimilarity(['a', 'b'], ['a', 'b']), 1);
  assert.equal(diceSimilarity(['a'], ['b']), 0);
  const half = diceSimilarity(['a', 'b'], ['a', 'c']);
  assert.ok(half === 0.5);
  assert.equal(diceSimilarity([], []), 1);
});

test('identical docs produce all-same ops', () => {
  const a = mkBlocks([{ text: 'one' }, { text: 'two' }]);
  const b = mkBlocks([{ text: 'one' }, { text: 'two' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(summarize(ops), { same: 2, modified: 0, added: 0, removed: 0 });
});

test('inserted block is added without disturbing neighbors', () => {
  const a = mkBlocks([{ text: 'alpha beta' }, { text: 'gamma delta' }]);
  const b = mkBlocks([{ text: 'alpha beta' }, { text: 'brand new block' }, { text: 'gamma delta' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type), ['same', 'added', 'same']);
});

test('reworded block matches as modified via similarity', () => {
  const a = mkBlocks([{ text: 'the quick brown fox jumps over the lazy dog' }]);
  const b = mkBlocks([{ text: 'the quick brown fox leaps over the sleepy dog' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type), ['modified']);
});

test('dissimilar replacement is removed + added, not modified', () => {
  const a = mkBlocks([{ text: 'completely original sentence about databases' }]);
  const b = mkBlocks([{ text: 'unrelated prose regarding gardening tips today' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type).sort(), ['added', 'removed']);
});

test('same id forces a match even when text diverges', () => {
  const a = mkBlocks([{ text: 'old words entirely', id: 's1', tag: 'section' }]);
  const b = mkBlocks([{ text: 'new words utterly different', id: 's1', tag: 'section' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type), ['modified']);
});

test('heading promotion h2->h3 still matches', () => {
  const a = mkBlocks([{ text: 'Monochrome and quiet', tag: 'h2' }]);
  const b = mkBlocks([{ text: 'Monochrome and quiet', tag: 'h3' }]);
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type), ['modified']);
});

test('different tags block fuzzy matching', () => {
  const a = mkBlocks([{ text: 'shared words here today', tag: 'p' }]);
  const b = mkBlocks([{ text: 'shared words here today', tag: 'table' }]);
  // different hash because tag differs; different tag prevents fuzzy pair
  const ops = matchBlocks(a, b);
  assert.deepEqual(ops.map((o) => o.type).sort(), ['added', 'removed']);
});

test('wordDiff yields exclusive-end intervals per side', () => {
  const oldT = 'a quiet minimal tracker'.split(' ');
  const newT = 'a calm minimal tracker'.split(' ');
  const { removed, added } = wordDiff(oldT, newT);
  assert.deepEqual(removed, [[1, 2]]);
  assert.deepEqual(added, [[1, 2]]);
});

test('wordDiff on pure insertion marks only added side', () => {
  const { removed, added } = wordDiff(['x', 'y'], ['x', 'mid', 'y']);
  assert.deepEqual(removed, []);
  assert.deepEqual(added, [[1, 2]]);
});

test('matchRows keeps later rows aligned across an insertion', () => {
  const oldRows = [['name', 'qty'], ['bolts', '4'], ['nuts', '9']];
  const newRows = [['name', 'qty'], ['washers', '2'], ['bolts', '4'], ['nuts', '9']];
  const ops = matchRows(oldRows, newRows);
  assert.deepEqual(ops.map((o) => o.type), ['same', 'added', 'same', 'same']);
});

test('matchRows pairs edited row as modified', () => {
  const ops = matchRows([['bolts', '4', 'steel']], [['bolts', '5', 'steel']]);
  assert.deepEqual(ops.map((o) => o.type), ['modified']);
});

test('lineDiff classifies lines', () => {
  const out = lineDiff('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(out.map((l) => l.type), ['same', 'removed', 'added', 'same']);
});
