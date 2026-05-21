const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createContext,
  classifyFile,
  sourceGroupFor,
  htmlToMarkdown,
  scanArtifacts,
  exportMediaIndex,
  exportWiki,
  getStatus,
} = require('../scripts/artifact-library');

function makeArtifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-artifacts-test-'));
  const notebook = path.join(root, 'Takeout 2', 'NotebookLM', 'The Hapa Protocol');
  const notes = path.join(notebook, 'Notes');
  const flow = path.join(root, 'Takeout 2', 'Flow');
  fs.mkdirSync(notes, { recursive: true });
  fs.mkdirSync(flow, { recursive: true });
  fs.writeFileSync(path.join(notebook, 'The Hapa Protocol metadata.json'), JSON.stringify({
    title: 'The Hapa Protocol',
    metadata: { createTime: '2026-05-20T00:00:00Z' },
  }));
  fs.writeFileSync(path.join(notes, 'AI Familiar Seed.html'), `
    <h1>AI Familiar Seed</h1>
    <p>The <strong>Hapa Protocol</strong> uses a Wormhole seed file for Thor.</p>
    <ul><li>Local ownership</li><li>Decentralized memory</li></ul>
  `);
  fs.writeFileSync(path.join(flow, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return root;
}

function makeWikiRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-artifact-wiki-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Hapa\nAI Familiar and Hapa Protocol memory.\n');
  fs.mkdirSync(path.join(root, 'Nodes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Nodes', 'Thor.md'), '# Thor\nWormhole seed file and AI Familiar notes.\n');
  return root;
}

test('classifyFile and sourceGroupFor identify mixed artifact sources', () => {
  const root = '/tmp/hapa-artifacts';
  assert.equal(classifyFile('/tmp/a.mp4'), 'video');
  assert.equal(classifyFile('/tmp/a.jpg'), 'image');
  assert.equal(classifyFile('/tmp/a.html'), 'note');
  assert.equal(sourceGroupFor(root, '/tmp/hapa-artifacts/Takeout 2/Flow/a.jpg'), 'Flow');
  assert.equal(sourceGroupFor(root, '/tmp/hapa-artifacts/Takeout 2/NotebookLM/Notebook/Notes/a.html'), 'NotebookLM');
});

test('htmlToMarkdown preserves NotebookLM headings, emphasis, and lists', () => {
  const markdown = htmlToMarkdown('<h1>Seed</h1><p><strong>Thor</strong> wakes up.</p><ul><li>Wormhole</li></ul>');
  assert.match(markdown, /^# Seed/);
  assert.match(markdown, /\*\*Thor\*\* wakes up/);
  assert.match(markdown, /- Wormhole/);
});

test('artifact scan, media index, and wiki export build local artifact pages', () => {
  const artifactRoot = makeArtifactFixture();
  const wikiRoot = makeWikiRoot();
  const ctx = createContext({
    artifactRoot,
    wikiRoot,
    dataRoot: path.join(wikiRoot, 'Raw', 'Artifacts'),
    assetRoot: path.join(wikiRoot, 'Assets', 'Artifacts'),
  });

  const scanned = scanArtifacts(ctx, { probe: false, thumbnails: false });
  assert.equal(scanned.files, 3);
  assert.equal(getStatus(ctx).notes, 1);
  assert.equal(getStatus(ctx).media, 1);

  const mediaIndex = exportMediaIndex(ctx);
  assert.equal(mediaIndex.assets, 1);
  assert.ok(fs.existsSync(path.join(wikiRoot, 'Raw', 'Artifacts', 'artifact-media-index.json')));

  const exported = exportWiki(ctx);
  assert.ok(exported.written.includes('Artifacts/Index.md'));
  const notePages = exported.written.filter(file => file.includes('Artifacts/NotebookLM Notes/'));
  assert.equal(notePages.length, 1);
  const noteBody = fs.readFileSync(path.join(wikiRoot, notePages[0]), 'utf8');
  assert.match(noteBody, /AI Familiar Seed/);
  assert.match(noteBody, /Wormhole seed file/);
});
