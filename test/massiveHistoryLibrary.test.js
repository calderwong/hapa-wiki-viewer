const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createContext,
  chunkRef,
  chunkSlug,
  importChunks,
  getStatus,
} = require('../scripts/massivehistory-library');

function makeFixture() {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-mh-source-'));
  const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-mh-wiki-'));
  const chunksDir = path.join(sourceRoot, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });
  const chunk1 = path.join(chunksDir, 'massivehistory_chunk_0001_p0001-0002.md');
  const chunk2 = path.join(chunksDir, 'massivehistory_chunk_0002_p0003-0004.md');
  fs.writeFileSync(chunk1, `---\nchunk: 1\npages: 1-2\n---\n# First Chunk\nHapa Protocol and Thor notes.\n`);
  fs.writeFileSync(chunk2, `---\nchunk: 2\npages: 3-4\n---\n# Second Chunk\nCards and Overwatch notes.\n`);
  fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), JSON.stringify({
    source: '/tmp/massivehistory.pdf',
    pages: 4,
    chunk_count: 2,
    chunks: [
      { chunk: 1, file: chunk1, start_page: 1, end_page: 2, pages: 2, chars: 80, sha256_16: 'aaa111' },
      { chunk: 2, file: chunk2, start_page: 3, end_page: 4, pages: 2, chars: 80, sha256_16: 'bbb222' },
    ],
  }));
  const raw = path.join(wikiRoot, 'Raw', 'massivehistory');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'massivehistory_programmatic_review.json'), JSON.stringify({
    reviews: [
      {
        chunk: 1,
        dominant_categories: 'systems_protocol, lore_canon',
        categories: { systems_protocol: 2, lore_canon: 1 },
        names: { Thor: 1 },
        systems: { 'Hapa Protocol': 1 },
      },
    ],
  }));
  fs.writeFileSync(path.join(raw, 'massivehistory_summary.json'), JSON.stringify({
    top_names: [['Thor', 1]],
    top_systems: [['Hapa Protocol', 1]],
    category_counts: { systems_protocol: 2 },
  }));
  return { sourceRoot, wikiRoot };
}

test('MassiveHistory chunk helpers create stable refs and slugs', () => {
  const chunk = { chunk: 7, start_page: 223, end_page: 256 };
  assert.equal(chunkRef(chunk), 'mh:0007');
  assert.equal(chunkSlug(chunk), 'MassiveHistory/Chunks/mh-0007-p0223-0256');
});

test('MassiveHistory import writes chunk pages, index pages, and machine index', () => {
  const { sourceRoot, wikiRoot } = makeFixture();
  const ctx = createContext({ sourceRoot, wikiRoot });
  const result = importChunks(ctx);
  assert.equal(result.chunks, 2);
  assert.ok(fs.existsSync(path.join(wikiRoot, 'MassiveHistory', 'Index.md')));
  assert.ok(fs.existsSync(path.join(wikiRoot, 'MassiveHistory', 'Reference Map.md')));
  assert.ok(fs.existsSync(path.join(wikiRoot, 'Raw', 'massivehistory', 'massivehistory-chunk-index.json')));
  const chunkPage = fs.readFileSync(path.join(wikiRoot, 'MassiveHistory', 'Chunks', 'mh-0001-p0001-0002.md'), 'utf8');
  assert.match(chunkPage, /Stable ref: `mh:0001`/);
  assert.match(chunkPage, /Original Chunk Text/);
  assert.equal(getStatus(ctx).importedChunks, 2);
});
