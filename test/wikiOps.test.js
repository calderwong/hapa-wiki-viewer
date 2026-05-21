const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  createContext,
  initLibrary,
  readPage,
  appendToPage,
  addComment,
  updateComment,
  listComments,
  listVersions,
  upsertCategory,
  listCategories,
  routeApi,
} = require('../scripts/wiki-ops');

function makeWikiRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapa-wikiops-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Hapa\nSeed page.\n');
  fs.mkdirSync(path.join(root, 'Canon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Canon', 'World Bible.md'), '# World Bible\nCanon notes.\n');
  return root;
}

function requestJson(server, method, urlPath, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Wiki Ops comments, categories, append, and versions share one datastore', () => {
  const wikiRoot = makeWikiRoot();
  const ctx = createContext({ wikiRoot, dataRoot: path.join(wikiRoot, 'Raw', 'WikiOps') });
  const init = initLibrary(ctx);
  assert.ok(fs.existsSync(init.protocolPage));

  const category = upsertCategory(ctx, {
    id: 'continuity-check',
    label: 'Continuity Check',
    description: 'A test category',
    rules: { test: true },
  });
  assert.equal(category.id, 'continuity-check');
  assert.ok(listCategories(ctx).some(row => row.id === 'continuity-check'));

  const comment = addComment(ctx, {
    slug: 'README',
    category: 'open-question',
    body: 'Should this page link to MassiveHistory?',
    quote: 'Seed page.',
    tags: ['massivehistory', 'question'],
    author: 'test-agent',
    actorType: 'agent',
  });
  assert.equal(comment.status, 'open');
  assert.equal(listComments(ctx, { slug: 'README' }).length, 1);
  const answered = updateComment(ctx, comment.id, { status: 'answered', author: 'test-human' });
  assert.equal(answered.status, 'answered');

  const appended = appendToPage(ctx, 'README', 'A protocol append.', { heading: 'Protocol Notes', author: 'test-agent', actorType: 'agent' });
  assert.equal(appended.slug, 'README');
  assert.match(readPage(ctx, 'README').raw, /A protocol append/);
  assert.ok(listVersions(ctx, 'README').length >= 2);
});

test('Wiki Ops HTTP API exposes page, comments, and append operations', async () => {
  const wikiRoot = makeWikiRoot();
  const ctx = createContext({ wikiRoot, dataRoot: path.join(wikiRoot, 'Raw', 'WikiOps') });
  const server = http.createServer((req, res) => routeApi(ctx, req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await requestJson(server, 'GET', '/api/page?slug=README');
    assert.equal(page.status, 200);
    assert.equal(page.body.page.slug, 'README');

    const created = await requestJson(server, 'POST', '/api/comments', {
      slug: 'README',
      category: 'helpful-append',
      body: 'API-added note.',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.comment.category, 'helpful-append');

    const appended = await requestJson(server, 'POST', '/api/page/append', {
      slug: 'README',
      heading: 'API Append',
      body: 'Added through API.',
    });
    assert.equal(appended.status, 200);
    assert.match(fs.readFileSync(path.join(wikiRoot, 'README.md'), 'utf8'), /Added through API/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
