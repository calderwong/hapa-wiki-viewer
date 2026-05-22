const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildWikiIndex, resolveWikiLink, normalizeSlug, extractMarkdownImages, extractMarkdownVideos, loadHapaMusicIndex } = require('../src/wikiIndexer');

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-wiki-test-'));
  fs.mkdirSync(path.join(root, 'Canon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), `---
title: Home
type: index
status: seed
tags: [home, start]
---
# Home
See [[Canon/World Bible]] and [[Cards/Card A|first card]].
![Portal visual](Assets/Visuals/portal.png)
<video controls src="Assets/Videos/demo.mp4"></video>
`);
  fs.writeFileSync(path.join(root, 'Canon', 'World Bible.md'), `# World Bible
Connects to [[README|home]].
`);
  fs.mkdirSync(path.join(root, 'Cards'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Cards', 'Card A.md'), `---
card_id: card-123
retrieval_id: sqlite:cards/card-123
---
# Card A
Wisdom card.
`);
  fs.mkdirSync(path.join(root, 'Raw', 'Music'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Raw', 'Music', 'hapa-music-page-index.json'), JSON.stringify({
    generatedAt: '2026-05-22T00:00:00.000Z',
    stats: { songs: 1 },
    songs: [{
      id: 'song-1',
      title: 'Hapa Protocol Hymn',
      localPath: '/tmp/hapa-protocol-hymn.mp3',
      audioUrl: 'file:///tmp/hapa-protocol-hymn.mp3',
      pageSlugs: ['Cards/Card A'],
      topics: ['hapa', 'protocol', 'wisdom'],
      explanation: 'Directly mapped to Card A for test coverage.',
      lyricExcerpt: 'Hapa protocol wisdom card memory signal',
    }]
  }, null, 2));
  return root;
}

test('normalizeSlug creates stable app ids from relative markdown paths', () => {
  assert.equal(normalizeSlug('Cards/Hapa Dev Proto Cards/Index.md'), 'Cards/Hapa Dev Proto Cards/Index');
});

test('buildWikiIndex reads markdown, frontmatter, wikilinks, backlinks, and card retrieval ids', () => {
  const root = makeVault();
  const index = buildWikiIndex(root);
  assert.equal(index.stats.markdownFiles, 3);
  assert.ok(index.pages['README']);
  assert.equal(index.pages['README'].title, 'Home');
  assert.deepEqual(index.pages['README'].links.map(l => l.target), ['Canon/World Bible', 'Cards/Card A']);
  assert.deepEqual(index.pages['README'].images, [{ alt: 'Portal visual', src: 'Assets/Visuals/portal.png' }]);
  assert.deepEqual(index.pages['README'].videos, [{ title: 'demo.mp4', src: 'Assets/Videos/demo.mp4' }]);
  assert.deepEqual(index.pages['Canon/World Bible'].backlinks.map(l => l.source), ['README']);
  assert.equal(index.cards[0].card_id, 'card-123');
  assert.equal(index.cards[0].retrieval_id, 'sqlite:cards/card-123');
  assert.equal(index.pages['README'].kind, 'index');
  assert.deepEqual(index.pages['README'].tags, ['home', 'start']);
  assert.equal(index.facets.sections.Root, 1);
  assert.equal(index.facets.sections.Cards, 1);
  assert.equal(index.facets.kinds.Card, 1);
  assert.equal(index.facets.statuses.seed, 1);
  assert.equal(index.stats.images, 1);
  assert.equal(index.stats.videos, 1);
  assert.equal(index.stats.musicSongs, 1);
  assert.equal(index.music.songs.length, 1);
  assert.equal(index.music.songs[0].title, 'Hapa Protocol Hymn');
  assert.equal(index.pages['Cards/Card A'].musicMatches[0].title, 'Hapa Protocol Hymn');
  assert.equal(index.pages['Cards/Card A'].musicMatches[0].audioUrl, 'file:///tmp/hapa-protocol-hymn.mp3');
  assert.equal(index.music.stats.songs, 1);
});

test('extractMarkdownImages finds image alt text and relative sources', () => {
  assert.deepEqual(
    extractMarkdownImages('![A flow](../Assets/Visuals/flow.svg)\n\n![Remote](https://example.com/a.png)'),
    [
      { alt: 'A flow', src: '../Assets/Visuals/flow.svg' },
      { alt: 'Remote', src: 'https://example.com/a.png' },
    ],
  );
});

test('extractMarkdownVideos finds markdown links and html video sources', () => {
  assert.deepEqual(
    extractMarkdownVideos('[Demo clip](../Assets/Videos/demo.mp4)\\n<video controls src=\"Assets/Videos/second.webm\"></video>'),
    [
      { title: 'Demo clip', src: '../Assets/Videos/demo.mp4' },
      { title: 'second.webm', src: 'Assets/Videos/second.webm' },
    ],
  );
});

test('resolveWikiLink handles aliases, omitted extensions, and basename fallback', () => {
  const root = makeVault();
  const index = buildWikiIndex(root);
  assert.equal(resolveWikiLink('Cards/Card A|first card', 'README', index), 'Cards/Card A');
  assert.equal(resolveWikiLink('World Bible', 'README', index), 'Canon/World Bible');
});
