#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const { buildWikiIndex, parseFrontmatter } = require('../src/wikiIndexer');

const DEFAULT_WIKI_ROOT = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const DEFAULT_DATA_ROOT = 'Raw/WikiOps';
const DEFAULT_AUTHOR = process.env.HAPA_WIKI_AUTHOR || process.env.USER || 'local-user';
const DEFAULT_ACTOR_TYPE = process.env.HAPA_WIKI_ACTOR_TYPE || 'human';

const DEFAULT_CATEGORIES = [
  ['open-question', 'Open Question', 'Needs a human or agent response before the page should be treated as settled.', 'open', '#f4c35c'],
  ['helpful-append', 'Helpful Append', 'Additional context, reference material, or proposed text that may be appended later.', 'open', '#8ef0c4'],
  ['canon-risk', 'Canon Risk', 'Possible lore/canon contradiction, unstable claim, or source-of-truth issue.', 'open', '#ff7878'],
  ['source-needed', 'Source Needed', 'Claim needs citation, primary source, artifact link, or attribution.', 'open', '#ffaa54'],
  ['continuity', 'Continuity', 'Cross-page continuity note or relation that future agents should reconcile.', 'open', '#78a6ff'],
  ['agent-task', 'Agent Task', 'Actionable task for a future local agent run.', 'open', '#c06fff'],
  ['implementation', 'Implementation', 'Engineering or product implementation note tied to the wiki page.', 'open', '#78a6ff'],
  ['style', 'Style', 'Editorial, naming, formatting, or tone note.', 'open', '#9aa7bd'],
  ['attribution', 'Attribution', 'Creator/source influence or credit tracking note.', 'open', '#8ef0c4'],
];

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function fromJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stableHash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createId(prefix, value = '') {
  return `${prefix}_${stableHash(`${value}:${now()}:${crypto.randomBytes(8).toString('hex')}`, 14)}`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readBodyArg(args, names = ['body', 'content']) {
  for (const name of names) {
    if (typeof args[name] === 'string') return args[name];
  }
  if (args.file) return fs.readFileSync(path.resolve(args.file), 'utf8');
  if (args.stdin) return readStdin();
  return '';
}

function normalizeSlug(slug) {
  const clean = String(slug || '').replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+/, '').trim();
  if (!clean || clean.includes('..') || path.isAbsolute(clean)) throw new Error(`Unsafe wiki slug: ${slug}`);
  return clean;
}

function createContext(options = {}) {
  const wikiRoot = path.resolve(options.wikiRoot || process.env.HAPA_WIKI_ROOT || DEFAULT_WIKI_ROOT);
  const dataRoot = path.resolve(options.dataRoot || process.env.HAPA_WIKI_OPS_DATA_ROOT || path.join(wikiRoot, DEFAULT_DATA_ROOT));
  const dbPath = path.resolve(options.dbPath || process.env.HAPA_WIKI_OPS_DB || path.join(dataRoot, 'wiki-ops.sqlite'));
  const reportsDir = path.join(dataRoot, 'reports');
  ensureDir(dataRoot);
  ensureDir(reportsDir);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return { wikiRoot, dataRoot, dbPath, reportsDir, db };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      slug TEXT,
      relative_path TEXT,
      author TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      message TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_versions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      parent_version_id TEXT,
      operation_id TEXT,
      author TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      message TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(slug, content_hash),
      FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS comment_categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      default_status TEXT NOT NULL DEFAULT 'open',
      color TEXT,
      rules_json TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      relative_path TEXT,
      category TEXT NOT NULL DEFAULT 'open-question',
      status TEXT NOT NULL DEFAULT 'open',
      priority INTEGER NOT NULL DEFAULT 2,
      author TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      body TEXT NOT NULL,
      quote TEXT,
      anchor_text TEXT,
      line_start INTEGER,
      line_end INTEGER,
      tags_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comment_events (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      author TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      body TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_page_versions_slug ON page_versions(slug, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_slug_status ON comments(slug, status, priority);
    CREATE INDEX IF NOT EXISTS idx_comments_category ON comments(category);
    CREATE INDEX IF NOT EXISTS idx_operations_slug ON operations(slug, created_at);
  `);

  const stamp = now();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO comment_categories (id, label, description, default_status, color, rules_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'system', ?, ?)
  `);
  for (const category of DEFAULT_CATEGORIES) {
    insert.run(category[0], category[1], category[2], category[3], category[4], toJson({ builtIn: true }), stamp, stamp);
  }
}

function pagePathFromSlug(ctx, slug) {
  const normalized = normalizeSlug(slug);
  const target = path.resolve(ctx.wikiRoot, `${normalized}.md`);
  const root = path.resolve(ctx.wikiRoot);
  if (!target.startsWith(root + path.sep) && target !== root) throw new Error(`Page path escaped wiki root: ${slug}`);
  return target;
}

function resolvePage(ctx, slug, options = {}) {
  const normalized = normalizeSlug(slug);
  const direct = pagePathFromSlug(ctx, normalized);
  if (fs.existsSync(direct) || options.create) {
    return { slug: normalized, file: direct, relativePath: path.relative(ctx.wikiRoot, direct).replace(/\\/g, '/') };
  }
  const index = buildWikiIndex(ctx.wikiRoot);
  const page = index.pages[normalized] || index.pages[index.slugByLower[normalized.toLowerCase()]];
  if (!page) throw new Error(`Wiki page not found: ${slug}`);
  return { slug: page.slug, file: page.path, relativePath: page.relativePath };
}

function pageTitleFromRaw(slug, raw) {
  const { data, body } = parseFrontmatter(String(raw || ''));
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return data.title || heading || slug.split('/').pop();
}

function readPage(ctx, slug) {
  const page = resolvePage(ctx, slug);
  const raw = fs.readFileSync(page.file, 'utf8');
  const parsed = parseFrontmatter(raw);
  return {
    slug: page.slug,
    relativePath: page.relativePath,
    file: page.file,
    title: pageTitleFromRaw(page.slug, raw),
    raw,
    body: parsed.body,
    frontmatter: parsed.data,
    contentHash: contentHash(raw),
  };
}

function insertOperation(ctx, fields) {
  const op = {
    id: fields.id || createId('op', `${fields.kind}:${fields.slug || ''}`),
    kind: fields.kind,
    slug: fields.slug || '',
    relativePath: fields.relativePath || '',
    author: fields.author || DEFAULT_AUTHOR,
    actorType: fields.actorType || fields.actor_type || DEFAULT_ACTOR_TYPE,
    message: fields.message || '',
    metadata: fields.metadata || {},
    createdAt: fields.createdAt || now(),
  };
  ctx.db.prepare(`
    INSERT INTO operations (id, kind, slug, relative_path, author, actor_type, message, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(op.id, op.kind, op.slug, op.relativePath, op.author, op.actorType, op.message, toJson(op.metadata), op.createdAt);
  return op;
}

function latestVersion(ctx, slug) {
  return ctx.db.prepare('SELECT * FROM page_versions WHERE slug = ? ORDER BY created_at DESC LIMIT 1').get(slug) || null;
}

function insertVersion(ctx, fields) {
  const hash = contentHash(fields.content);
  const existing = ctx.db.prepare('SELECT * FROM page_versions WHERE slug = ? AND content_hash = ?').get(fields.slug, hash);
  if (existing) return existing;
  const stamp = fields.createdAt || now();
  const version = {
    id: fields.id || createId('ver', `${fields.slug}:${hash}`),
    slug: fields.slug,
    relativePath: fields.relativePath,
    contentHash: hash,
    parentVersionId: fields.parentVersionId || null,
    operationId: fields.operationId || null,
    author: fields.author || DEFAULT_AUTHOR,
    actorType: fields.actorType || DEFAULT_ACTOR_TYPE,
    message: fields.message || '',
    content: fields.content,
    createdAt: stamp,
  };
  ctx.db.prepare(`
    INSERT INTO page_versions (
      id, slug, relative_path, content_hash, parent_version_id, operation_id, author, actor_type, message, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    version.id,
    version.slug,
    version.relativePath,
    version.contentHash,
    version.parentVersionId,
    version.operationId,
    version.author,
    version.actorType,
    version.message,
    version.content,
    version.createdAt,
  );
  return version;
}

function ensureBaselineVersion(ctx, page, author = 'system', actorType = 'system') {
  const hash = contentHash(page.raw);
  const existing = ctx.db.prepare('SELECT * FROM page_versions WHERE slug = ? AND content_hash = ?').get(page.slug, hash);
  if (existing) return existing;
  const op = insertOperation(ctx, {
    kind: 'snapshot',
    slug: page.slug,
    relativePath: page.relativePath,
    author,
    actorType,
    message: 'Baseline snapshot before first protocol write',
  });
  return insertVersion(ctx, {
    slug: page.slug,
    relativePath: page.relativePath,
    content: page.raw,
    operationId: op.id,
    author,
    actorType,
    message: op.message,
  });
}

function writePageContent(ctx, slug, content, options = {}) {
  const resolved = resolvePage(ctx, slug, { create: Boolean(options.create) });
  const author = options.author || DEFAULT_AUTHOR;
  const actorType = options.actorType || options.actor_type || DEFAULT_ACTOR_TYPE;
  const message = options.message || 'Update page through Hapa Wiki Ops';
  const stamp = now();
  ensureDir(path.dirname(resolved.file));
  const oldRaw = fs.existsSync(resolved.file) ? fs.readFileSync(resolved.file, 'utf8') : '';
  const oldPage = { slug: resolved.slug, relativePath: resolved.relativePath, raw: oldRaw };
  const tx = ctx.db.prepare('BEGIN');
  const commit = ctx.db.prepare('COMMIT');
  const rollback = ctx.db.prepare('ROLLBACK');
  tx.run();
  try {
    const parent = oldRaw ? ensureBaselineVersion(ctx, oldPage, author, actorType) : latestVersion(ctx, resolved.slug);
    const op = insertOperation(ctx, {
      kind: options.kind || 'update',
      slug: resolved.slug,
      relativePath: resolved.relativePath,
      author,
      actorType,
      message,
      metadata: options.metadata || {},
      createdAt: stamp,
    });
    fs.writeFileSync(resolved.file, content);
    const version = insertVersion(ctx, {
      slug: resolved.slug,
      relativePath: resolved.relativePath,
      content,
      parentVersionId: parent?.id || null,
      operationId: op.id,
      author,
      actorType,
      message,
      createdAt: stamp,
    });
    commit.run();
    return { operation: op, version, slug: resolved.slug, relativePath: resolved.relativePath, file: resolved.file, contentHash: version.contentHash };
  } catch (error) {
    rollback.run();
    throw error;
  }
}

function appendToPage(ctx, slug, body, options = {}) {
  const page = readPage(ctx, slug);
  const heading = options.heading ? `\n\n## ${options.heading}\n` : '\n\n';
  const content = `${page.raw.replace(/\s*$/g, '')}${heading}${String(body || '').trim()}\n`;
  return writePageContent(ctx, page.slug, content, {
    ...options,
    kind: 'append',
    message: options.message || `Append to ${page.slug}`,
  });
}

function listVersions(ctx, slug, options = {}) {
  const normalized = normalizeSlug(slug);
  const rows = ctx.db.prepare(`
    SELECT id, slug, relative_path, content_hash, parent_version_id, operation_id, author, actor_type, message, created_at,
      length(content) AS content_length
    FROM page_versions
    WHERE slug = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(normalized, Number(options.limit || 50));
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    parentVersionId: row.parent_version_id,
    operationId: row.operation_id,
    author: row.author,
    actorType: row.actor_type,
    message: row.message,
    createdAt: row.created_at,
    contentLength: row.content_length,
  }));
}

function getVersion(ctx, id) {
  const row = ctx.db.prepare('SELECT * FROM page_versions WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    parentVersionId: row.parent_version_id,
    operationId: row.operation_id,
    author: row.author,
    actorType: row.actor_type,
    message: row.message,
    content: row.content,
    createdAt: row.created_at,
  };
}

function restoreVersion(ctx, id, options = {}) {
  const version = getVersion(ctx, id);
  if (!version) throw new Error(`Version not found: ${id}`);
  return writePageContent(ctx, version.slug, version.content, {
    ...options,
    kind: 'restore',
    message: options.message || `Restore version ${id}`,
    metadata: { restoredVersionId: id },
  });
}

function listCategories(ctx) {
  return ctx.db.prepare('SELECT * FROM comment_categories ORDER BY id').all().map(row => ({
    id: row.id,
    label: row.label,
    description: row.description || '',
    defaultStatus: row.default_status,
    color: row.color || '',
    rules: fromJson(row.rules_json, {}),
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function upsertCategory(ctx, fields = {}) {
  const id = normalizeCategoryId(fields.id || fields.category || fields.label);
  const stamp = now();
  ctx.db.prepare(`
    INSERT INTO comment_categories (id, label, description, default_status, color, rules_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      default_status = excluded.default_status,
      color = excluded.color,
      rules_json = excluded.rules_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    fields.label || id,
    fields.description || '',
    fields.defaultStatus || fields.default_status || 'open',
    fields.color || '',
    toJson(fields.rules || {}),
    fields.author || DEFAULT_AUTHOR,
    stamp,
    stamp,
  );
  return listCategories(ctx).find(category => category.id === id);
}

function normalizeCategoryId(value) {
  const id = String(value || 'open-question').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'open-question';
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function addComment(ctx, fields = {}) {
  const page = resolvePage(ctx, fields.slug);
  const category = normalizeCategoryId(fields.category || 'open-question');
  const cat = ctx.db.prepare('SELECT * FROM comment_categories WHERE id = ?').get(category);
  if (!cat) upsertCategory(ctx, { id: category, label: category, author: fields.author || DEFAULT_AUTHOR });
  const stamp = now();
  const comment = {
    id: fields.id || createId('cmt', `${page.slug}:${category}`),
    slug: page.slug,
    relativePath: page.relativePath,
    category,
    status: fields.status || cat?.default_status || 'open',
    priority: Number(fields.priority || 2),
    author: fields.author || DEFAULT_AUTHOR,
    actorType: fields.actorType || fields.actor_type || DEFAULT_ACTOR_TYPE,
    body: String(fields.body || '').trim(),
    quote: fields.quote || '',
    anchorText: fields.anchorText || fields.anchor_text || fields.quote || '',
    lineStart: fields.lineStart || fields.line_start || null,
    lineEnd: fields.lineEnd || fields.line_end || null,
    tags: normalizeTags(fields.tags),
    metadata: fields.metadata || {},
    createdAt: stamp,
    updatedAt: stamp,
  };
  if (!comment.body) throw new Error('Comment body is required');
  ctx.db.prepare(`
    INSERT INTO comments (
      id, slug, relative_path, category, status, priority, author, actor_type, body, quote, anchor_text,
      line_start, line_end, tags_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    comment.id,
    comment.slug,
    comment.relativePath,
    comment.category,
    comment.status,
    comment.priority,
    comment.author,
    comment.actorType,
    comment.body,
    comment.quote,
    comment.anchorText,
    comment.lineStart,
    comment.lineEnd,
    toJson(comment.tags),
    toJson(comment.metadata),
    comment.createdAt,
    comment.updatedAt,
  );
  addCommentEvent(ctx, comment.id, {
    eventType: 'created',
    author: comment.author,
    actorType: comment.actorType,
    body: comment.body,
    metadata: { category: comment.category, status: comment.status, tags: comment.tags },
  });
  return getComment(ctx, comment.id);
}

function addCommentEvent(ctx, commentId, fields = {}) {
  const stamp = now();
  const id = createId('cme', `${commentId}:${fields.eventType || 'event'}`);
  ctx.db.prepare(`
    INSERT INTO comment_events (id, comment_id, event_type, author, actor_type, body, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    commentId,
    fields.eventType || fields.event_type || 'event',
    fields.author || DEFAULT_AUTHOR,
    fields.actorType || fields.actor_type || DEFAULT_ACTOR_TYPE,
    fields.body || '',
    toJson(fields.metadata || {}),
    stamp,
  );
  return id;
}

function rowToComment(row) {
  return {
    id: row.id,
    slug: row.slug,
    relativePath: row.relative_path,
    category: row.category,
    status: row.status,
    priority: row.priority,
    author: row.author,
    actorType: row.actor_type,
    body: row.body,
    quote: row.quote || '',
    anchorText: row.anchor_text || '',
    lineStart: row.line_start,
    lineEnd: row.line_end,
    tags: fromJson(row.tags_json, []),
    metadata: fromJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || '',
  };
}

function getComment(ctx, id) {
  const row = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  return row ? rowToComment(row) : null;
}

function listComments(ctx, options = {}) {
  const limit = Number(options.limit || 100);
  const clauses = [];
  const params = [];
  if (options.slug) {
    clauses.push('slug = ?');
    params.push(normalizeSlug(options.slug));
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.category) {
    clauses.push('category = ?');
    params.push(normalizeCategoryId(options.category));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = ctx.db.prepare(`
    SELECT * FROM comments
    ${where}
    ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in-progress' THEN 1 WHEN 'answered' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
      priority DESC, updated_at DESC
    LIMIT ?
  `).all(...params, limit);
  return rows.map(rowToComment);
}

function updateComment(ctx, id, fields = {}) {
  const current = getComment(ctx, id);
  if (!current) throw new Error(`Comment not found: ${id}`);
  const next = {
    category: fields.category ? normalizeCategoryId(fields.category) : current.category,
    status: fields.status || current.status,
    priority: fields.priority == null ? current.priority : Number(fields.priority),
    body: fields.body == null ? current.body : String(fields.body),
    tags: fields.tags == null ? current.tags : normalizeTags(fields.tags),
    metadata: fields.metadata || current.metadata || {},
    updatedAt: now(),
    resolvedAt: fields.status === 'resolved' ? now() : (fields.status && fields.status !== 'resolved' ? '' : current.resolvedAt),
  };
  ctx.db.prepare(`
    UPDATE comments SET
      category = ?,
      status = ?,
      priority = ?,
      body = ?,
      tags_json = ?,
      metadata_json = ?,
      updated_at = ?,
      resolved_at = ?
    WHERE id = ?
  `).run(
    next.category,
    next.status,
    next.priority,
    next.body,
    toJson(next.tags),
    toJson(next.metadata),
    next.updatedAt,
    next.resolvedAt || null,
    id,
  );
  addCommentEvent(ctx, id, {
    eventType: 'updated',
    author: fields.author || DEFAULT_AUTHOR,
    actorType: fields.actorType || fields.actor_type || DEFAULT_ACTOR_TYPE,
    body: fields.eventBody || '',
    metadata: next,
  });
  return getComment(ctx, id);
}

function listCommentEvents(ctx, id) {
  return ctx.db.prepare('SELECT * FROM comment_events WHERE comment_id = ? ORDER BY created_at').all(id).map(row => ({
    id: row.id,
    commentId: row.comment_id,
    eventType: row.event_type,
    author: row.author,
    actorType: row.actor_type,
    body: row.body || '',
    metadata: fromJson(row.metadata_json, {}),
    createdAt: row.created_at,
  }));
}

function getStatus(ctx) {
  const scalar = sql => ctx.db.prepare(sql).get().n;
  const statusRows = ctx.db.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status ORDER BY n DESC').all();
  const categoryRows = ctx.db.prepare('SELECT category, COUNT(*) AS n FROM comments GROUP BY category ORDER BY n DESC').all();
  return {
    wikiRoot: ctx.wikiRoot,
    dataRoot: ctx.dataRoot,
    dbPath: ctx.dbPath,
    comments: scalar('SELECT COUNT(*) AS n FROM comments'),
    openComments: scalar("SELECT COUNT(*) AS n FROM comments WHERE status = 'open'"),
    versions: scalar('SELECT COUNT(*) AS n FROM page_versions'),
    operations: scalar('SELECT COUNT(*) AS n FROM operations'),
    categories: scalar('SELECT COUNT(*) AS n FROM comment_categories'),
    commentsByStatus: Object.fromEntries(statusRows.map(row => [row.status, row.n])),
    commentsByCategory: Object.fromEntries(categoryRows.map(row => [row.category, row.n])),
  };
}

function writeProtocolPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Development', 'Hapa Wiki Ops Protocol.md');
  ensureDir(path.dirname(file));
  const content = `---\ntitle: Hapa Wiki Ops Protocol\ntype: protocol\nstatus: active\ntags: [wiki, versioning, comments, agents, protocol]\n---\n# Hapa Wiki Ops Protocol\n\nThe Hapa Wiki uses markdown files as the canonical source of truth, with \`Raw/WikiOps/wiki-ops.sqlite\` as the protocol log for comments, page versions, categories, and edit operations.\n\n## Comment Types\n- \`open-question\`: needs a human or agent response.\n- \`helpful-append\`: useful material that may become page text.\n- \`canon-risk\`: possible lore or continuity conflict.\n- \`source-needed\`: needs a citation, artifact link, or attribution.\n- \`continuity\`: cross-page relation or reconciliation note.\n- \`agent-task\`: actionable future agent work.\n\nHumans and agents may add new categories with rules metadata through the UI, CLI, or API.\n\n## Versioning Rule\nEvery append, update, or restore writes through Wiki Ops. The system snapshots the prior markdown content and stores the new version with actor, author, message, hash, and operation id.\n\n## CLI\n\`\`\`bash\nnpm run wikiops:init\nnpm run wikiops:comment -- --slug README --category open-question --body \"What should be clarified?\"\nnpm run wikiops:append -- --slug README --heading \"Agent note\" --body \"New material.\"\nnpm run wikiops:serve\n\`\`\`\n\n## HTTP API\nStart with \`npm run wikiops:serve\`. Default URL: \`http://127.0.0.1:8767\`.\n\n- \`GET /api/status\`\n- \`GET /api/page?slug=README\`\n- \`PUT /api/page\` with \`{ \"slug\", \"content\", \"message\" }\`\n- \`POST /api/page/append\` with \`{ \"slug\", \"body\", \"heading\" }\`\n- \`GET /api/comments?slug=README\`\n- \`POST /api/comments\`\n- \`PATCH /api/comments/:id\`\n- \`GET /api/versions?slug=README\`\n- \`POST /api/versions/:id/restore\`\n\n## MassiveHistory References\nMassiveHistory chunks use stable references like \`mh:0001\` and wiki slugs like \`MassiveHistory/Chunks/mh-0001-p0001-0044\`. Comment directly on chunk pages when a lore, canon, or source issue needs future attention.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function initLibrary(ctx) {
  const protocolPage = writeProtocolPage(ctx);
  return { ...getStatus(ctx), protocolPage };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://127.0.0.1',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readMassiveHistoryIndex(ctx, query = {}) {
  const file = path.join(ctx.wikiRoot, 'Raw', 'massivehistory', 'massivehistory-chunk-index.json');
  if (!fs.existsSync(file)) return { generatedAt: '', chunks: [] };
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const q = String(query.q || '').toLowerCase().trim();
  const limit = Number(query.limit || 50);
  const chunks = (payload.chunks || []).filter(chunk => {
    if (!q) return true;
    return `${chunk.ref} ${chunk.slug} ${chunk.title} ${(chunk.tags || []).join(' ')} ${chunk.pages}`.toLowerCase().includes(q);
  }).slice(0, limit);
  return { generatedAt: payload.generatedAt, source: payload.source, chunks };
}

async function routeApi(ctx, req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, getStatus(ctx));
    if (req.method === 'GET' && url.pathname === '/api/categories') return sendJson(res, 200, { categories: listCategories(ctx) });
    if (req.method === 'POST' && url.pathname === '/api/categories') return sendJson(res, 201, { category: upsertCategory(ctx, await readJsonBody(req)) });
    if (req.method === 'GET' && url.pathname === '/api/page') return sendJson(res, 200, { page: readPage(ctx, url.searchParams.get('slug')) });
    if (req.method === 'PUT' && url.pathname === '/api/page') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, writePageContent(ctx, body.slug, body.content || '', body));
    }
    if (req.method === 'POST' && url.pathname === '/api/page/append') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, appendToPage(ctx, body.slug, body.body || '', body));
    }
    if (req.method === 'GET' && url.pathname === '/api/comments') {
      return sendJson(res, 200, { comments: listComments(ctx, Object.fromEntries(url.searchParams.entries())) });
    }
    if (req.method === 'POST' && url.pathname === '/api/comments') return sendJson(res, 201, { comment: addComment(ctx, await readJsonBody(req)) });
    const commentMatch = url.pathname.match(/^\/api\/comments\/([^/]+)$/);
    if (commentMatch && req.method === 'GET') {
      const comment = getComment(ctx, commentMatch[1]);
      if (!comment) return sendJson(res, 404, { error: 'Comment not found' });
      return sendJson(res, 200, { comment, events: listCommentEvents(ctx, comment.id) });
    }
    if (commentMatch && req.method === 'PATCH') return sendJson(res, 200, { comment: updateComment(ctx, commentMatch[1], await readJsonBody(req)) });
    if (req.method === 'GET' && url.pathname === '/api/versions') return sendJson(res, 200, { versions: listVersions(ctx, url.searchParams.get('slug'), Object.fromEntries(url.searchParams.entries())) });
    const restoreMatch = url.pathname.match(/^\/api\/versions\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === 'POST') return sendJson(res, 200, restoreVersion(ctx, restoreMatch[1], await readJsonBody(req)));
    if (req.method === 'GET' && url.pathname === '/api/massivehistory/chunks') return sendJson(res, 200, readMassiveHistoryIndex(ctx, Object.fromEntries(url.searchParams.entries())));
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message, stack: process.env.NODE_ENV === 'development' ? error.stack : undefined });
  }
}

function serve(ctx, options = {}) {
  const host = options.host || process.env.HAPA_WIKI_OPS_HOST || '127.0.0.1';
  const port = Number(options.port || process.env.HAPA_WIKI_OPS_PORT || 8767);
  const server = http.createServer((req, res) => routeApi(ctx, req, res));
  const explicitPort = Boolean(options.port || process.env.HAPA_WIKI_OPS_PORT);
  let candidate = port;
  let announced = false;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !explicitPort && candidate < port + 20) {
      candidate += 1;
      server.listen(candidate, host);
      return;
    }
    throw error;
  });
  server.on('listening', () => {
    if (announced) return;
    announced = true;
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : candidate;
    console.log(JSON.stringify({ status: 'listening', url: `http://${host}:${activePort}`, dbPath: ctx.dbPath }, null, 2));
  });
  server.listen(candidate, host);
  return server;
}

async function runCommand(args = parseArgs()) {
  const command = args._[0] || 'status';
  const ctx = createContext({ wikiRoot: args['wiki-root'], dataRoot: args['data-root'], dbPath: args.db });
  if (command === 'init') return initLibrary(ctx);
  if (command === 'status') return getStatus(ctx);
  if (command === 'read') return { page: readPage(ctx, args.slug) };
  if (command === 'versions') return { versions: listVersions(ctx, args.slug, args) };
  if (command === 'restore') return restoreVersion(ctx, args.id, args);
  if (command === 'comments') return { comments: listComments(ctx, args) };
  if (command === 'comment') return { comment: addComment(ctx, { ...args, body: readBodyArg(args, ['body', 'comment']) }) };
  if (command === 'comment-status') return { comment: updateComment(ctx, args.id, args) };
  if (command === 'append') return appendToPage(ctx, args.slug, readBodyArg(args), args);
  if (command === 'update') return writePageContent(ctx, args.slug, readBodyArg(args), args);
  if (command === 'categories') return { categories: listCategories(ctx) };
  if (command === 'category-add') return { category: upsertCategory(ctx, args) };
  if (command === 'massivehistory') return readMassiveHistoryIndex(ctx, args);
  if (command === 'serve') {
    serve(ctx, args);
    return null;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  runCommand().then(result => {
    if (result) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  createContext,
  parseArgs,
  readPage,
  writePageContent,
  appendToPage,
  listVersions,
  getVersion,
  restoreVersion,
  addComment,
  updateComment,
  listComments,
  getComment,
  listCommentEvents,
  listCategories,
  upsertCategory,
  getStatus,
  initLibrary,
  serve,
  routeApi,
  readMassiveHistoryIndex,
  normalizeSlug,
};
