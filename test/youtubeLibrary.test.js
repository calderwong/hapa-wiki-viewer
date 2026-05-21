const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createContext,
  extractVideoId,
  importTakeout,
  parseTakeoutHtml,
  parseTakeoutJson,
  queueAll,
  exportWiki,
  getStatus,
  vttToText,
} = require('../scripts/youtube-library');

function makeWikiRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-youtube-wiki-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Hapa\nLocal model workflow and visual archive.\n');
  fs.mkdirSync(path.join(root, 'Systems'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Systems', 'Local Models.md'), '# Local Models\nMLX, diffusion, video, workflow, model, and archive notes.\n');
  return root;
}

test('extractVideoId handles common YouTube URL shapes', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=abc123&t=9s'), 'abc123');
  assert.equal(extractVideoId('https://youtu.be/xyz789'), 'xyz789');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/short42'), 'short42');
  assert.equal(extractVideoId('https://example.com/watch?v=nope'), null);
});

test('parseTakeoutJson normalizes Google Takeout watch events', () => {
  const events = parseTakeoutJson(JSON.stringify([
    {
      title: 'Watched Local AI Video Workflow',
      titleUrl: 'https://www.youtube.com/watch?v=ai001',
      subtitles: [{ name: 'Creator One', url: 'https://www.youtube.com/@creatorone' }],
      time: '2026-05-20T19:00:00Z',
    },
  ]));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Local AI Video Workflow');
  assert.equal(events[0].channelName, 'Creator One');
});

test('parseTakeoutHtml reads legacy Takeout history exports', () => {
  const events = parseTakeoutHtml(`
    <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
      Watched <a href="https://www.youtube.com/watch?v=html001">A Hapa Archive Explainer</a><br>
      <a href="https://www.youtube.com/channel/UC123">Archive Channel</a><br>
      May 20, 2026, 7:00:00 PM PDT
    </div>
  `);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'A Hapa Archive Explainer');
  assert.equal(events[0].channelName, 'Archive Channel');
});

test('import, queue, status, and wiki export build a local source library', () => {
  const wikiRoot = makeWikiRoot();
  const ctx = createContext({ wikiRoot, dataRoot: path.join(wikiRoot, 'Raw', 'YouTube') });
  const takeout = path.join(os.tmpdir(), `hapa-watch-history-${Date.now()}.json`);
  fs.writeFileSync(takeout, JSON.stringify([
    {
      title: 'Watched Local AI Video Workflow',
      titleUrl: 'https://www.youtube.com/watch?v=ai001',
      subtitles: [{ name: 'Creator One', url: 'https://www.youtube.com/@creatorone' }],
      time: '2026-05-20T19:00:00Z',
    },
    {
      title: 'Watched Local AI Video Workflow',
      titleUrl: 'https://www.youtube.com/watch?v=ai001',
      subtitles: [{ name: 'Creator One', url: 'https://www.youtube.com/@creatorone' }],
      time: '2026-05-20T20:00:00Z',
    },
  ]));

  const imported = importTakeout(ctx, takeout);
  assert.equal(imported.parsedEvents, 2);
  assert.equal(imported.totalUniqueVideos, 1);
  assert.equal(getStatus(ctx).watchEvents, 2);

  const queued = queueAll(ctx);
  assert.equal(queued.queuedVideos, 1);
  assert.equal(queued.queuedChannels, 1);

  const exported = exportWiki(ctx, { limit: 5 });
  assert.ok(exported.written.includes('YouTube/Index.md'));
  assert.ok(fs.existsSync(path.join(wikiRoot, 'YouTube', 'Index.md')));
  assert.match(fs.readFileSync(path.join(wikiRoot, 'YouTube', 'Index.md'), 'utf8'), /YouTube Shared Library/);
});

test('vttToText removes timestamps and duplicate caption lines', () => {
  const text = vttToText(`WEBVTT

00:00:00.000 --> 00:00:02.000
Hello <c>world</c>

00:00:02.000 --> 00:00:03.000
Hello world

00:00:03.000 --> 00:00:04.000
Archive workflow
`);
  assert.equal(text, 'Hello world\nArchive workflow');
});
