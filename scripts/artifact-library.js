#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const { buildWikiIndex } = require('../src/wikiIndexer');

const DEFAULT_WIKI_ROOT = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const DEFAULT_ARTIFACT_ROOT = '/Users/calderwong/Desktop/hapa-artifacts';
const DEFAULT_DATA_ROOT = 'Raw/Artifacts';
const DEFAULT_ASSET_ROOT = 'Assets/Artifacts';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac']);
const NOTE_EXTS = new Set(['.html', '.htm']);
const DOC_EXTS = new Set(['.pdf', '.docx', '.pptx', '.rtf', '.txt', '.md']);
const DATA_EXTS = new Set(['.json', '.csv', '.tsv']);
const ARCHIVE_EXTS = new Set(['.zip', '.tgz', '.tar', '.gz']);

const STOP_WORDS = new Set('the,and,for,that,with,this,from,into,about,what,when,where,which,while,will,have,has,are,was,were,you,your,our,out,how,why,not,can,its,his,her,they,them,then,than,over,under,after,before,video,image,audio,artifact,metadata,source,notes,note,html,json,type'.split(','));

const KEYWORD_TAGS = [
  ['hapa-protocol', ['hapa protocol', 'hapa']],
  ['partnership-os', ['partnership os', 'partnership operating']],
  ['dominator-os', ['dominator os', 'dominator operating']],
  ['ai-familiar', ['ai familiar', 'familiar', 'phamiliar']],
  ['thor', ['thor', 'chaos-kitty', 'chaos kitty']],
  ['mimi', ['mimi phan', 'mimi']],
  ['calder', ['calder', 'cj wong']],
  ['blue', ['sovereign blue', 'blue architect']],
  ['wormhole-ingest', ['wormhole', 'seed file', 'seed-based', 'thor.mp4']],
  ['conviction', ['conviction', 'moral governance']],
  ['vibration', ['vibration', 'harmonic', 'breathline']],
  ['empathy', ['empathy', 'empathic', 'e-mpath']],
  ['healing', ['healing', 'therapeutic']],
  ['sovereignty', ['sovereign', 'sovereignty', 'decentralized']],
  ['local-ai', ['local ai', 'local-first', 'mlx', 'llm', 'model', 'diffusion']],
  ['video-generation', ['ltx', 'sora', 'video generation', 'looping video']],
  ['image-generation', ['z-image', 'ernie', 'image generation', 'diffusion']],
  ['creator-attribution', ['creator', 'attribution', 'royalty']],
  ['tarot', ['tarot']],
  ['alchemy', ['alchemy']],
  ['compliance', ['compliance']],
  ['notebooklm', ['notebooklm', 'notebook lm']],
  ['gemini', ['gemini']],
  ['youtube', ['youtube']],
  ['flow', ['flow']],
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

function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
    .slice(0, 90);
  return slug || fallback;
}

function markdownEscape(value) {
  return String(value || '').replace(/\r/g, '').trim();
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

function createContext(options = {}) {
  const wikiRoot = path.resolve(options.wikiRoot || process.env.HAPA_WIKI_ROOT || DEFAULT_WIKI_ROOT);
  const artifactRoot = path.resolve(options.artifactRoot || process.env.HAPA_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT);
  const dataRoot = path.resolve(options.dataRoot || process.env.HAPA_ARTIFACT_DATA_ROOT || path.join(wikiRoot, DEFAULT_DATA_ROOT));
  const assetRoot = path.resolve(options.assetRoot || process.env.HAPA_ARTIFACT_ASSET_ROOT || path.join(wikiRoot, DEFAULT_ASSET_ROOT));
  const dbPath = path.resolve(options.dbPath || process.env.HAPA_ARTIFACT_DB || path.join(dataRoot, 'artifact-library.sqlite'));
  const reportsDir = path.join(dataRoot, 'reports');
  const thumbnailsDir = path.join(assetRoot, 'thumbnails');
  ensureDir(dataRoot);
  ensureDir(assetRoot);
  ensureDir(reportsDir);
  ensureDir(thumbnailsDir);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return { wikiRoot, artifactRoot, dataRoot, assetRoot, dbPath, reportsDir, thumbnailsDir, db };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_group TEXT NOT NULL,
      source_path TEXT,
      metadata_json TEXT,
      tags_json TEXT,
      file_count INTEGER NOT NULL DEFAULT 0,
      media_count INTEGER NOT NULL DEFAULT 0,
      note_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_files (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL UNIQUE,
      rel_path TEXT NOT NULL,
      source_group TEXT NOT NULL,
      collection_id TEXT,
      kind TEXT NOT NULL,
      extension TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      codec TEXT,
      thumbnail_path TEXT,
      tags_json TEXT,
      metadata_json TEXT,
      converted_wiki_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL,
      target_slug TEXT NOT NULL,
      relation TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(artifact_id, target_slug, relation),
      FOREIGN KEY(artifact_id) REFERENCES artifact_files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_files_kind ON artifact_files(kind);
    CREATE INDEX IF NOT EXISTS idx_artifact_files_collection ON artifact_files(collection_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_files_group ON artifact_files(source_group);
    CREATE INDEX IF NOT EXISTS idx_wiki_relations_target ON wiki_relations(target_slug);
  `);
}

function commandExists(command) {
  const result = spawnSync('/bin/zsh', ['-lc', `command -v ${JSON.stringify(command)}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function resolveBinary(name) {
  if (process.env[`HAPA_${name.toUpperCase()}_PATH`]) return process.env[`HAPA_${name.toUpperCase()}_PATH`];
  return commandExists(name) || `/opt/homebrew/bin/${name}`;
}

function walkFiles(rootDir, options = {}) {
  const out = [];
  const max = Number(options.limit || 0);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('._')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        if (max && out.length >= max) return;
      } else if (entry.isFile()) {
        out.push(full);
        if (max && out.length >= max) return;
      }
    }
  }
  walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function classifyFile(file) {
  const lower = file.toLowerCase();
  const ext = path.extname(lower);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext) || /\.mp4\(\d+\)$/i.test(lower)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (NOTE_EXTS.has(ext)) return 'note';
  if (DATA_EXTS.has(ext)) return 'data';
  if (DOC_EXTS.has(ext)) return 'document';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  return 'other';
}

function sourceGroupFor(root, file) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (rel.startsWith('Takeout 2/Flow/')) return 'Flow';
  if (rel.startsWith('Takeout 2/NotebookLM/')) return 'NotebookLM';
  if (rel.startsWith('Takeout 2/Gemini/')) return 'Gemini';
  if (rel.startsWith('Takeout/YouTube and YouTube Music/')) return 'YouTube';
  if (/takeout/i.test(rel)) return 'Takeout';
  return rel.split('/')[0] || 'Artifacts';
}

function collectionFor(root, file) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const group = sourceGroupFor(root, file);
  if (group === 'NotebookLM') {
    const parts = rel.split('/');
    const notebook = parts[2] && !['Artifacts', 'Notes', 'Chat History'].includes(parts[2]) ? parts[2] : 'NotebookLM Root';
    return {
      title: notebook,
      sourceGroup: group,
      sourcePath: path.join(root, 'Takeout 2', 'NotebookLM', notebook),
    };
  }
  if (group === 'Flow') return { title: 'Flow Media Export', sourceGroup: group, sourcePath: path.join(root, 'Takeout 2', 'Flow') };
  if (group === 'Gemini') return { title: 'Gemini Export', sourceGroup: group, sourcePath: path.join(root, 'Takeout 2', 'Gemini') };
  if (group === 'YouTube') return { title: 'YouTube Takeout', sourceGroup: group, sourcePath: path.join(root, 'Takeout', 'YouTube and YouTube Music') };
  return { title: group, sourceGroup: group, sourcePath: path.join(root, group) };
}

function collectionId(info) {
  return `${slugify(`${info.sourceGroup} ${info.title}`, 'collection')}-${stableHash(`${info.sourceGroup}:${info.sourcePath || info.title}`, 8)}`;
}

function readTextPreview(file, limit = 512 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(fs.statSync(file).size, limit));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function tryParseJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value) {
  return htmlDecode(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function inlineHtmlToMarkdown(value) {
  return htmlDecode(String(value || '')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${stripTags(text)}](${href})`)
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToMarkdown(raw) {
  let html = String(raw || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\r/g, '');

  html = html.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, text) => `\n# ${inlineHtmlToMarkdown(text)}\n\n`);
  html = html.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, text) => `\n## ${inlineHtmlToMarkdown(text)}\n\n`);
  html = html.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, text) => `\n### ${inlineHtmlToMarkdown(text)}\n\n`);
  html = html.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_m, text) => `\n#### ${inlineHtmlToMarkdown(text)}\n\n`);
  html = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, text) => `\n- ${inlineHtmlToMarkdown(text).replace(/\n+/g, ' ')}\n`);
  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, text) => `\n${inlineHtmlToMarkdown(text)}\n\n`);
  html = html.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_m, text) => `\n${inlineHtmlToMarkdown(text)}\n\n`);
  html = inlineHtmlToMarkdown(html);
  return html
    .split(/\n/)
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromHtml(raw, fallback) {
  const h1 = String(raw || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const title = String(raw || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripTags(title[1]);
  return fallback;
}

function sidecarMetadata(file) {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const candidates = [
    path.join(dir, `${base} metadata.json`),
    path.join(dir, `${base}.metadata.json`),
    path.join(dir, `${base}.json`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || candidate === file) continue;
    const parsed = tryParseJson(readTextPreview(candidate, 2 * 1024 * 1024));
    if (parsed) return parsed;
  }
  return null;
}

function extractMetadata(file, kind) {
  const ext = path.extname(file).toLowerCase();
  if (kind === 'data' && ext === '.json') {
    const parsed = tryParseJson(readTextPreview(file, 4 * 1024 * 1024));
    return parsed || {};
  }
  return sidecarMetadata(file) || {};
}

function cleanBasenameTitle(file) {
  return path.basename(file).replace(/\.[^.]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleAndSummary(file, kind, metadata) {
  const fallbackTitle = cleanBasenameTitle(file);
  if (metadata?.title) {
    return {
      title: String(metadata.title).trim(),
      summary: metadata.description || metadata.summary || metadata.type || '',
    };
  }
  if (kind === 'note') {
    const raw = readTextPreview(file);
    return {
      title: titleFromHtml(raw, fallbackTitle),
      summary: stripTags(raw).slice(0, 700),
    };
  }
  if (kind === 'data') {
    const raw = readTextPreview(file);
    const parsed = tryParseJson(raw);
    if (parsed?.title) return { title: String(parsed.title), summary: parsed.type || '' };
    return { title: fallbackTitle, summary: stripTags(raw).slice(0, 500) };
  }
  if (kind === 'document' && ['.txt', '.md', '.rtf'].includes(path.extname(file).toLowerCase())) {
    return { title: fallbackTitle, summary: stripTags(readTextPreview(file)).slice(0, 700) };
  }
  return { title: fallbackTitle, summary: metadata?.type || '' };
}

function probeMedia(file) {
  const ffprobe = resolveBinary('ffprobe');
  if (!fs.existsSync(ffprobe)) return {};
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=width,height,codec_type,codec_name',
    '-of', 'json',
    file,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) return {};
  const parsed = tryParseJson(result.stdout) || {};
  const stream = (parsed.streams || []).find(s => Number(s.width) || Number(s.height)) || (parsed.streams || [])[0] || {};
  const codecs = [...new Set((parsed.streams || []).map(s => s.codec_name).filter(Boolean))];
  return {
    width: stream.width ? Number(stream.width) : null,
    height: stream.height ? Number(stream.height) : null,
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    codec: codecs.join(', '),
  };
}

function createThumbnail(ctx, file, id, kind, options = {}) {
  if (options.thumbnails === false || !['image', 'video'].includes(kind)) return '';
  const ffmpeg = resolveBinary('ffmpeg');
  if (!fs.existsSync(ffmpeg)) return '';
  const thumb = path.join(ctx.thumbnailsDir, `${id}.jpg`);
  if (fs.existsSync(thumb) && !options.forceThumbnails) return path.relative(ctx.wikiRoot, thumb).replace(/\\/g, '/');
  ensureDir(path.dirname(thumb));
  const args = ['-y', '-v', 'error'];
  if (kind === 'video') args.push('-ss', '00:00:01');
  args.push('-i', file, '-frames:v', '1', '-vf', 'scale=w=min(480\\,iw):h=-2', thumb);
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: Number(options.thumbnailTimeoutMs || 45000) });
  if (result.status !== 0 || !fs.existsSync(thumb)) return '';
  return path.relative(ctx.wikiRoot, thumb).replace(/\\/g, '/');
}

function tokenize(value) {
  const counts = new Map();
  for (const raw of String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (STOP_WORDS.has(raw)) continue;
    if (isNoiseTerm(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return counts;
}

function isNoiseTerm(term) {
  const value = String(term || '').toLowerCase();
  if (value.length < 4) return true;
  if (/^[0-9a-f]{4,}$/i.test(value)) return true;
  if (/^[0-9a-f]{4,}-[0-9a-f-]{8,}$/i.test(value)) return true;
  const digitCount = (value.match(/\d/g) || []).length;
  if (digitCount >= 2 && !/[aeiou]/.test(value)) return true;
  return false;
}

function inferTags(record) {
  const tags = new Set([record.sourceGroup.toLowerCase(), record.kind]);
  const hay = `${record.title} ${record.summary} ${record.relPath}`.toLowerCase();
  for (const [tag, needles] of KEYWORD_TAGS) {
    if (needles.some(needle => hay.includes(needle))) tags.add(tag);
  }
  if (record.width && record.height) {
    if (Math.abs(record.width - record.height) < Math.max(record.width, record.height) * 0.05) tags.add('square');
    else if (record.width > record.height) tags.add('landscape');
    else tags.add('portrait');
  }
  if (record.durationSeconds) {
    if (record.durationSeconds <= 10) tags.add('short-clip');
    else if (record.durationSeconds >= 300) tags.add('long-form');
  }
  if (record.sizeBytes >= 100 * 1024 * 1024) tags.add('large-file');
  for (const term of [...tokenize(`${record.title} ${record.summary}`).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([term]) => term)) {
    if (!isNoiseTerm(term)) tags.add(term);
  }
  return [...tags].sort();
}

function upsertCollection(db, info, metadata = {}) {
  const id = collectionId(info);
  const stamp = now();
  const tags = inferTags({
    sourceGroup: info.sourceGroup,
    kind: 'collection',
    title: info.title,
    summary: JSON.stringify(metadata || {}),
    relPath: info.sourcePath || '',
    width: null,
    height: null,
    durationSeconds: null,
    sizeBytes: 0,
  });
  db.prepare(`
    INSERT INTO collections (id, title, source_group, source_path, metadata_json, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      source_group = excluded.source_group,
      source_path = excluded.source_path,
      metadata_json = excluded.metadata_json,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `).run(id, info.title, info.sourceGroup, info.sourcePath || '', toJson(metadata || {}), toJson(tags), stamp, stamp);
  return id;
}

function collectionMetadata(root, info) {
  if (!info.sourcePath || !fs.existsSync(info.sourcePath) || !fs.statSync(info.sourcePath).isDirectory()) return {};
  const candidates = fs.readdirSync(info.sourcePath)
    .filter(name => /\.json$/i.test(name) && /metadata|\.json$/i.test(name))
    .map(name => path.join(info.sourcePath, name));
  for (const candidate of candidates) {
    const parsed = tryParseJson(readTextPreview(candidate, 2 * 1024 * 1024));
    if (parsed?.title || parsed?.metadata) return parsed;
  }
  return {};
}

function scanArtifacts(ctx, options = {}) {
  if (!fs.existsSync(ctx.artifactRoot)) throw new Error(`Artifact folder not found: ${ctx.artifactRoot}`);
  const files = walkFiles(ctx.artifactRoot, options);
  const tx = ctx.db.prepare('BEGIN');
  const commit = ctx.db.prepare('COMMIT');
  const rollback = ctx.db.prepare('ROLLBACK');
  const collectionCache = new Map();
  let media = 0;
  let notes = 0;
  let thumbnails = 0;
  let failed = 0;
  tx.run();
  try {
    for (const file of files) {
      const stat = fs.statSync(file);
      const relPath = path.relative(ctx.artifactRoot, file).replace(/\\/g, '/');
      const kind = classifyFile(file);
      const sourceGroup = sourceGroupFor(ctx.artifactRoot, file);
      const collInfo = collectionFor(ctx.artifactRoot, file);
      const collKey = `${collInfo.sourceGroup}:${collInfo.sourcePath}:${collInfo.title}`;
      let collId = collectionCache.get(collKey);
      if (!collId) {
        collId = upsertCollection(ctx.db, collInfo, collectionMetadata(ctx.artifactRoot, collInfo));
        collectionCache.set(collKey, collId);
      }
      let metadata = {};
      try { metadata = extractMetadata(file, kind) || {}; } catch { metadata = {}; }
      const info = titleAndSummary(file, kind, metadata);
      const mediaMeta = ['image', 'video', 'audio'].includes(kind) && options.probe !== false ? probeMedia(file) : {};
      const id = stableHash(file, 16);
      const record = {
        sourceGroup,
        kind,
        relPath,
        title: info.title,
        summary: info.summary || '',
        width: mediaMeta.width || null,
        height: mediaMeta.height || null,
        durationSeconds: Number.isFinite(mediaMeta.durationSeconds) ? mediaMeta.durationSeconds : null,
        sizeBytes: stat.size,
      };
      const thumbnailPath = createThumbnail(ctx, file, id, kind, options);
      if (thumbnailPath) thumbnails += 1;
      const tags = inferTags(record);
      const stamp = now();
      ctx.db.prepare(`
        INSERT INTO artifact_files (
          id, source_path, rel_path, source_group, collection_id, kind, extension, title, summary,
          size_bytes, mtime_ms, width, height, duration_seconds, codec, thumbnail_path, tags_json,
          metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_path) DO UPDATE SET
          rel_path = excluded.rel_path,
          source_group = excluded.source_group,
          collection_id = excluded.collection_id,
          kind = excluded.kind,
          extension = excluded.extension,
          title = excluded.title,
          summary = excluded.summary,
          size_bytes = excluded.size_bytes,
          mtime_ms = excluded.mtime_ms,
          width = COALESCE(excluded.width, artifact_files.width),
          height = COALESCE(excluded.height, artifact_files.height),
          duration_seconds = COALESCE(excluded.duration_seconds, artifact_files.duration_seconds),
          codec = COALESCE(NULLIF(excluded.codec, ''), artifact_files.codec),
          thumbnail_path = COALESCE(NULLIF(excluded.thumbnail_path, ''), artifact_files.thumbnail_path),
          tags_json = excluded.tags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        id,
        file,
        relPath,
        sourceGroup,
        collId,
        kind,
        path.extname(file).toLowerCase(),
        info.title || cleanBasenameTitle(file),
        info.summary || '',
        stat.size,
        stat.mtimeMs,
        mediaMeta.width || null,
        mediaMeta.height || null,
        Number.isFinite(mediaMeta.durationSeconds) ? mediaMeta.durationSeconds : null,
        mediaMeta.codec || '',
        thumbnailPath,
        toJson(tags),
        toJson(metadata || {}),
        stamp,
        stamp,
      );
      if (['image', 'video', 'audio'].includes(kind)) media += 1;
      if (kind === 'note') notes += 1;
    }
    recomputeCollectionCounts(ctx.db);
    commit.run();
  } catch (error) {
    failed += 1;
    rollback.run();
    throw error;
  }
  const index = exportMediaIndex(ctx);
  return { files: files.length, media, notes, thumbnails, failed, dbPath: ctx.dbPath, mediaIndex: index.file };
}

function recomputeCollectionCounts(db) {
  db.exec(`
    UPDATE collections SET
      file_count = (SELECT COUNT(*) FROM artifact_files WHERE artifact_files.collection_id = collections.id),
      media_count = (SELECT COUNT(*) FROM artifact_files WHERE artifact_files.collection_id = collections.id AND artifact_files.kind IN ('image', 'video', 'audio')),
      note_count = (SELECT COUNT(*) FROM artifact_files WHERE artifact_files.collection_id = collections.id AND artifact_files.kind = 'note'),
      updated_at = '${now()}';
  `);
}

function rowToAsset(row, ctx) {
  const tags = fromJson(row.tags_json, []);
  const thumbAbs = row.thumbnail_path ? path.join(ctx.wikiRoot, row.thumbnail_path) : '';
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourceGroup: row.source_group,
    collectionId: row.collection_id || '',
    collectionTitle: row.collection_title || '',
    sourcePath: row.source_path,
    relPath: row.rel_path,
    sizeBytes: row.size_bytes || 0,
    width: row.width || null,
    height: row.height || null,
    durationSeconds: row.duration_seconds || null,
    codec: row.codec || '',
    thumbnailPath: row.thumbnail_path || '',
    thumbnailUrl: thumbAbs && fs.existsSync(thumbAbs) ? pathToFileURL(thumbAbs).href : '',
    sourceUrl: pathToFileURL(row.source_path).href,
    tags,
    summary: row.summary || '',
  };
}

function exportMediaIndex(ctx) {
  const rows = ctx.db.prepare(`
    SELECT artifact_files.*, collections.title AS collection_title
    FROM artifact_files
    LEFT JOIN collections ON collections.id = artifact_files.collection_id
    WHERE artifact_files.kind IN ('image', 'video', 'audio')
    ORDER BY artifact_files.source_group, artifact_files.title
  `).all();
  const assets = rows.map(row => rowToAsset(row, ctx));
  const byKind = {};
  const bySource = {};
  const byTag = {};
  for (const asset of assets) {
    byKind[asset.kind] = (byKind[asset.kind] || 0) + 1;
    bySource[asset.sourceGroup] = (bySource[asset.sourceGroup] || 0) + 1;
    for (const tag of asset.tags) byTag[tag] = (byTag[tag] || 0) + 1;
  }
  const payload = {
    generatedAt: now(),
    artifactRoot: ctx.artifactRoot,
    dbPath: ctx.dbPath,
    stats: { assets: assets.length, byKind, bySource, byTag },
    assets,
  };
  const file = path.join(ctx.dataRoot, 'artifact-media-index.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return { file, assets: assets.length };
}

function fileRelativeToWiki(ctx, file) {
  return path.relative(ctx.wikiRoot, file).replace(/\\/g, '/');
}

function wikiLink(slug, label) {
  return `[[${slug}|${label || slug.split('/').pop()}]]`;
}

function writeArtifactIndexPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'Index.md');
  ensureDir(path.dirname(file));
  const status = getStatus(ctx);
  const topTags = Object.entries(status.mediaTags || {}).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const collections = ctx.db.prepare('SELECT id, title, source_group, file_count, media_count, note_count FROM collections ORDER BY file_count DESC LIMIT 25').all();
  const content = `---\ntitle: Hapa Artifact Library\ntype: artifact-library-index\nstatus: active\ntags: [artifacts, shared-library, media, source-library]\n---\n# Hapa Artifact Library\n\nThis page is generated from \`${ctx.dbPath}\`, which indexes the mixed export folder at \`${ctx.artifactRoot}\` without duplicating the full 14 GB source vault into the wiki.\n\n## Current Inventory\n- Files indexed: ${status.files}\n- Media assets indexed: ${status.media}\n- NotebookLM/Gemini/HTML notes indexed: ${status.notes}\n- Collections: ${status.collections}\n- Generated thumbnails: ${status.thumbnails}\n- Media index for viewer card augmentation: \`Raw/Artifacts/artifact-media-index.json\`\n\n## Source Areas\n${Object.entries(status.bySource).sort((a, b) => b[1] - a[1]).map(([source, count]) => `- ${source}: ${count} files`).join('\n') || '- No sources indexed yet.'}\n\n## Top Media Tags\n${topTags.length ? topTags.map(([tag, count]) => `- ${tag}: ${count}`).join('\n') : '- No media tags yet.'}\n\n## Collections\n${collections.length ? collections.map(row => `- ${wikiLink(collectionPageSlug(row), row.title)} - ${row.source_group}; ${row.file_count} files, ${row.media_count} media, ${row.note_count} notes`).join('\n') : '- No collections yet.'}\n\n## Library Pages\n- ${wikiLink('Artifacts/Media Library', 'Media Library')}\n- ${wikiLink('Artifacts/NotebookLM Export Library', 'NotebookLM Export Library')}\n- ${wikiLink('Artifacts/Gemini Export', 'Gemini Export')}\n- ${wikiLink('Artifacts/YouTube Takeout Source', 'YouTube Takeout Source')}\n- ${wikiLink('Development/Hapa Artifact Library Pipeline', 'Artifact Library Pipeline')}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function collectionPageSlug(row) {
  if (row.source_group === 'NotebookLM') return `Artifacts/NotebookLM/${slugify(row.title, 'notebook')}`;
  if (row.source_group === 'Flow') return 'Artifacts/Flow Media Library';
  if (row.source_group === 'Gemini') return 'Artifacts/Gemini Export';
  if (row.source_group === 'YouTube') return 'Artifacts/YouTube Takeout Source';
  return `Artifacts/Collections/${slugify(row.title, 'collection')}`;
}

function imageMarkdown(asset, ctx) {
  if (!asset.thumbnailPath) return '';
  return `![${asset.title}](${path.relative(path.join(ctx.wikiRoot, 'Artifacts'), path.join(ctx.wikiRoot, asset.thumbnailPath)).replace(/\\/g, '/')})`;
}

function writeMediaLibraryPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'Media Library.md');
  ensureDir(path.dirname(file));
  const rows = ctx.db.prepare(`
    SELECT artifact_files.*, collections.title AS collection_title
    FROM artifact_files
    LEFT JOIN collections ON collections.id = artifact_files.collection_id
    WHERE artifact_files.kind IN ('image', 'video')
    ORDER BY artifact_files.source_group, artifact_files.mtime_ms DESC
    LIMIT 160
  `).all();
  const assets = rows.map(row => rowToAsset(row, ctx));
  const cards = assets.map(asset => {
    const dims = asset.width && asset.height ? `${asset.width}x${asset.height}` : 'unknown size';
    const duration = asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s` : '';
    const preview = imageMarkdown(asset, ctx);
    return `### ${asset.title}\n${preview}\n\n- Kind: ${asset.kind}\n- Source: ${asset.sourceGroup} / ${asset.collectionTitle || 'Unsorted'}\n- Dimensions: ${dims}${duration ? `; duration ${duration}` : ''}\n- Tags: ${asset.tags.slice(0, 10).join(', ')}\n- Source path: \`${asset.sourcePath}\`\n`;
  }).join('\n');
  const content = `---\ntitle: Artifact Media Library\ntype: artifact-media-library\nstatus: active\ntags: [artifacts, media, images, videos]\n---\n# Artifact Media Library\n\nThe viewer uses \`Raw/Artifacts/artifact-media-index.json\` to suggest these images and videos as augment cards on related wiki pages. This page shows a sampled visual catalog; the full persistence layer is the SQLite database.\n\n${cards || 'No media assets indexed yet.'}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writeFlowPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'Flow Media Library.md');
  ensureDir(path.dirname(file));
  const rows = ctx.db.prepare(`
    SELECT artifact_files.*, collections.title AS collection_title
    FROM artifact_files
    LEFT JOIN collections ON collections.id = artifact_files.collection_id
    WHERE artifact_files.source_group = 'Flow' AND artifact_files.kind IN ('image', 'video')
    ORDER BY artifact_files.mtime_ms DESC
    LIMIT 160
  `).all();
  const assets = rows.map(row => rowToAsset(row, ctx));
  const lines = assets.map(asset => {
    const preview = imageMarkdown(asset, ctx);
    const duration = asset.durationSeconds ? `, ${asset.durationSeconds.toFixed(1)}s` : '';
    return `### ${asset.title}\n${preview}\n\n- ${asset.kind}${asset.width && asset.height ? `, ${asset.width}x${asset.height}` : ''}${duration}\n- Tags: ${asset.tags.slice(0, 8).join(', ')}\n- Source path: \`${asset.sourcePath}\`\n`;
  }).join('\n');
  const content = `---\ntitle: Flow Media Library\ntype: artifact-media-source\nstatus: active\ntags: [artifacts, flow, images, videos]\n---\n# Flow Media Library\n\nImported from the Flow export inside \`hapa-artifacts\`. The files are retained in place and represented in the wiki through metadata, thumbnails, and viewer augment cards.\n\n${lines || 'No Flow media indexed yet.'}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writeNotebookLibraryPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'NotebookLM Export Library.md');
  ensureDir(path.dirname(file));
  const notebooks = ctx.db.prepare(`
    SELECT id, title, source_group, source_path, metadata_json, file_count, media_count, note_count, tags_json
    FROM collections
    WHERE source_group = 'NotebookLM'
    ORDER BY note_count DESC, title
  `).all();
  const lines = notebooks.map(row => {
    const tags = fromJson(row.tags_json, []);
    const metadata = fromJson(row.metadata_json, {});
    const viewed = metadata?.metadata?.lastViewed || '';
    return `- ${wikiLink(collectionPageSlug(row), row.title)} - ${row.note_count} notes, ${row.media_count} media${viewed ? `, last viewed ${viewed}` : ''}${tags.length ? `; tags: ${tags.slice(0, 6).join(', ')}` : ''}`;
  }).join('\n');
  const content = `---\ntitle: NotebookLM Export Library\ntype: artifact-notebook-library\nstatus: active\ntags: [artifacts, notebooklm, notes, source-library]\n---\n# NotebookLM Export Library\n\nNotebookLM exports are converted into wiki pages so their lore, research, and generated artifacts can participate in search, backlinks, and media augmentation.\n\n## Notebooks\n${lines || '- No NotebookLM exports indexed yet.'}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function notebookNotePagePath(ctx, collection, noteRow) {
  const collectionSlug = slugify(collection.title, 'notebook');
  const noteSlug = `${slugify(noteRow.title, 'note')}-${noteRow.id.slice(0, 8)}`;
  return path.join(ctx.wikiRoot, 'Artifacts', 'NotebookLM Notes', collectionSlug, `${noteSlug}.md`);
}

function writeNotebookCollectionPages(ctx, options = {}) {
  const written = [];
  const collections = ctx.db.prepare(`
    SELECT * FROM collections
    WHERE source_group = 'NotebookLM'
    ORDER BY note_count DESC, title
  `).all();
  const noteLimit = Number(options['note-limit'] || options.noteLimit || 0);
  for (const collection of collections) {
    const pageFile = path.join(ctx.wikiRoot, `${collectionPageSlug(collection)}.md`);
    ensureDir(path.dirname(pageFile));
    const notesSql = `
      SELECT * FROM artifact_files
      WHERE collection_id = ? AND kind = 'note'
      ORDER BY title
      ${noteLimit ? 'LIMIT ?' : ''}
    `;
    const notes = noteLimit ? ctx.db.prepare(notesSql).all(collection.id, noteLimit) : ctx.db.prepare(notesSql).all(collection.id);
    const media = ctx.db.prepare(`
      SELECT artifact_files.*, collections.title AS collection_title
      FROM artifact_files
      LEFT JOIN collections ON collections.id = artifact_files.collection_id
      WHERE collection_id = ? AND artifact_files.kind IN ('image', 'video', 'audio')
      ORDER BY artifact_files.title
      LIMIT 40
    `).all(collection.id).map(row => rowToAsset(row, ctx));
    const metadata = fromJson(collection.metadata_json, {});
    const noteLines = [];
    for (const note of notes) {
      const noteFile = notebookNotePagePath(ctx, collection, note);
      ensureDir(path.dirname(noteFile));
      const raw = readTextPreview(note.source_path, 4 * 1024 * 1024);
      const body = htmlToMarkdown(raw) || stripTags(raw);
      const tags = fromJson(note.tags_json, []);
      const rel = fileRelativeToWiki(ctx, noteFile);
      const content = `---\ntitle: ${JSON.stringify(note.title)}\ntype: notebooklm-note\nstatus: imported\nsource_artifact_id: ${JSON.stringify(note.id)}\nsource_collection: ${JSON.stringify(collection.title)}\ntags: ${JSON.stringify(['artifacts', 'notebooklm', ...tags.slice(0, 8)])}\n---\n# ${note.title}\n\n> Imported from NotebookLM export: \`${note.source_path}\`\n\n${body}\n`;
      fs.writeFileSync(noteFile, content);
      ctx.db.prepare('UPDATE artifact_files SET converted_wiki_path = ?, updated_at = ? WHERE id = ?').run(rel, now(), note.id);
      noteLines.push(`- ${wikiLink(rel.replace(/\.md$/i, ''), note.title)}`);
      written.push(noteFile);
    }
    const mediaLines = media.length ? media.map(asset => {
      const preview = imageMarkdown(asset, ctx);
      return `### ${asset.title}\n${preview}\n\n- Kind: ${asset.kind}\n- Tags: ${asset.tags.slice(0, 8).join(', ')}\n- Source path: \`${asset.sourcePath}\`\n`;
    }).join('\n') : 'No media artifacts indexed for this notebook.';
    const content = `---\ntitle: ${JSON.stringify(collection.title)}\ntype: notebooklm-export\nstatus: imported\ntags: ${JSON.stringify(['artifacts', 'notebooklm', ...fromJson(collection.tags_json, []).slice(0, 8)])}\n---\n# ${collection.title}\n\n## Metadata\n- Source path: \`${collection.source_path || ''}\`\n- Files indexed: ${collection.file_count}\n- Notes converted: ${notes.length}${noteLimit ? ` of ${collection.note_count}` : ''}\n- Media indexed: ${collection.media_count}\n- Created: ${metadata?.metadata?.createTime || ''}\n- Last viewed: ${metadata?.metadata?.lastViewed || ''}\n\n## Converted Notes\n${noteLines.length ? noteLines.join('\n') : '- No notes converted yet.'}\n\n## Media Artifacts\n${mediaLines}\n`;
    fs.writeFileSync(pageFile, content);
    written.push(pageFile);
  }
  return written;
}

function writeGeminiPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'Gemini Export.md');
  ensureDir(path.dirname(file));
  const rows = ctx.db.prepare(`
    SELECT * FROM artifact_files
    WHERE source_group = 'Gemini'
    ORDER BY title
  `).all();
  const lines = rows.map(row => `- ${row.title} - ${row.kind}, ${row.size_bytes} bytes, \`${row.source_path}\``).join('\n');
  const content = `---\ntitle: Gemini Export\ntype: artifact-source-export\nstatus: imported\ntags: [artifacts, gemini, takeout]\n---\n# Gemini Export\n\nThe Gemini portion of the Takeout currently indexes as source metadata for future conversion. Empty or placeholder export files are retained in the datastore so the audit trail stays complete.\n\n${lines || '- No Gemini files indexed yet.'}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writeYouTubeSourcePage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Artifacts', 'YouTube Takeout Source.md');
  ensureDir(path.dirname(file));
  const rows = ctx.db.prepare(`
    SELECT kind, extension, COUNT(*) AS n
    FROM artifact_files
    WHERE source_group = 'YouTube'
    GROUP BY kind, extension
    ORDER BY n DESC
  `).all();
  const content = `---\ntitle: YouTube Takeout Source\ntype: artifact-source-export\nstatus: imported\ntags: [artifacts, youtube, takeout, attribution]\n---\n# YouTube Takeout Source\n\nThe YouTube files inside \`hapa-artifacts\` are indexed here as the raw source export. The richer watch-history datastore remains the dedicated YouTube library at [[YouTube/Index|YouTube Shared Library]].\n\n## Indexed Files\n${rows.length ? rows.map(row => `- ${row.kind} ${row.extension || ''}: ${row.n}`).join('\n') : '- No YouTube source files indexed yet.'}\n\n## Next Queue\nUse the existing YouTube library scripts when you want transcripts, creator pages, and attribution enrichment from this Takeout source.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writePipelinePage(ctx) {
  const file = path.join(ctx.wikiRoot, 'Development', 'Hapa Artifact Library Pipeline.md');
  ensureDir(path.dirname(file));
  const content = `---\ntitle: Hapa Artifact Library Pipeline\ntype: development-pipeline\nstatus: active\ntags: [artifacts, pipeline, wiki-viewer, persistence]\n---\n# Hapa Artifact Library Pipeline\n\nThe artifact library turns \`/Users/calderwong/Desktop/hapa-artifacts\` into wiki-native memory without copying the full source vault.\n\n## Persistence\n- SQLite datastore: \`Raw/Artifacts/artifact-library.sqlite\`\n- Viewer media index: \`Raw/Artifacts/artifact-media-index.json\`\n- Generated thumbnails: \`Assets/Artifacts/thumbnails/\`\n- Converted NotebookLM notes: \`Artifacts/NotebookLM Notes/\`\n\n## Commands\n\`\`\`bash\nnpm run artifacts:init\nnpm run artifacts:scan\nnpm run artifacts:wiki\nnpm run artifacts:status\nnpm run index\n\`\`\`\n\n## Card Augmentation\nThe wiki indexer reads \`Raw/Artifacts/artifact-media-index.json\`, scores media against page titles, tags, topics, summaries, and slugs, and exposes the best matches as artifact augment cards in the viewer sidebar.\n\n## Operating Notes\n- Source media remains in \`hapa-artifacts\`; the wiki stores paths, metadata, and thumbnails.\n- NotebookLM HTML notes are converted to markdown pages so they can be searched and linked.\n- Flow media is cataloged as image/video assets with dimensions, duration, tags, and previews.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function exportWiki(ctx, options = {}) {
  const written = [];
  written.push(writeArtifactIndexPage(ctx));
  written.push(writeMediaLibraryPage(ctx));
  written.push(writeFlowPage(ctx));
  written.push(writeNotebookLibraryPage(ctx));
  written.push(...writeNotebookCollectionPages(ctx, options));
  written.push(writeGeminiPage(ctx));
  written.push(writeYouTubeSourcePage(ctx));
  written.push(writePipelinePage(ctx));
  exportMediaIndex(ctx);
  refreshWikiRelations(ctx);
  return { written: written.map(file => fileRelativeToWiki(ctx, file)), count: written.length };
}

function scoreTerms(sourceCounts, targetCounts) {
  let score = 0;
  for (const [term, count] of sourceCounts) {
    if (!targetCounts.has(term)) continue;
    score += Math.min(count, 4) * (1 + Math.min(targetCounts.get(term), 3));
  }
  return score;
}

function refreshWikiRelations(ctx, options = {}) {
  let index;
  try { index = buildWikiIndex(ctx.wikiRoot); } catch { return { relations: 0 }; }
  const media = ctx.db.prepare(`
    SELECT artifact_files.*, collections.title AS collection_title
    FROM artifact_files
    LEFT JOIN collections ON collections.id = artifact_files.collection_id
    WHERE artifact_files.kind IN ('image', 'video')
  `).all();
  ctx.db.exec("DELETE FROM wiki_relations WHERE relation = 'artifact-augment'");
  let relations = 0;
  const limitPerPage = Number(options.limitPerPage || 8);
  const insert = ctx.db.prepare(`
    INSERT INTO wiki_relations (artifact_id, target_slug, relation, score, note, created_at)
    VALUES (?, ?, 'artifact-augment', ?, ?, ?)
    ON CONFLICT(artifact_id, target_slug, relation) DO UPDATE SET score = excluded.score, note = excluded.note
  `);
  for (const slug of index.orderedSlugs) {
    const page = index.pages[slug];
    const pageTerms = tokenize(`${page.title} ${page.slug} ${page.tags.join(' ')} ${page.topics.join(' ')} ${page.summary}`);
    const scored = [];
    for (const asset of media) {
      const tags = fromJson(asset.tags_json, []);
      const assetTerms = tokenize(`${asset.title} ${asset.collection_title || ''} ${asset.source_group} ${tags.join(' ')} ${asset.summary || ''}`);
      const score = scoreTerms(pageTerms, assetTerms);
      if (score > 0) scored.push({ asset, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const match of scored.slice(0, limitPerPage)) {
      insert.run(match.asset.id, slug, match.score, match.asset.title, now());
      relations += 1;
    }
  }
  return { relations };
}

function getStatus(ctx) {
  const scalar = sql => ctx.db.prepare(sql).get().n;
  const bySourceRows = ctx.db.prepare('SELECT source_group, COUNT(*) AS n FROM artifact_files GROUP BY source_group ORDER BY n DESC').all();
  const byKindRows = ctx.db.prepare('SELECT kind, COUNT(*) AS n FROM artifact_files GROUP BY kind ORDER BY n DESC').all();
  const mediaRows = ctx.db.prepare("SELECT tags_json, thumbnail_path FROM artifact_files WHERE kind IN ('image', 'video', 'audio')").all();
  const mediaTags = {};
  let thumbnails = 0;
  for (const row of mediaRows) {
    if (row.thumbnail_path) thumbnails += 1;
    for (const tag of fromJson(row.tags_json, [])) mediaTags[tag] = (mediaTags[tag] || 0) + 1;
  }
  return {
    dbPath: ctx.dbPath,
    dataRoot: ctx.dataRoot,
    artifactRoot: ctx.artifactRoot,
    files: scalar('SELECT COUNT(*) AS n FROM artifact_files'),
    media: scalar("SELECT COUNT(*) AS n FROM artifact_files WHERE kind IN ('image', 'video', 'audio')"),
    notes: scalar("SELECT COUNT(*) AS n FROM artifact_files WHERE kind = 'note'"),
    collections: scalar('SELECT COUNT(*) AS n FROM collections'),
    relations: scalar('SELECT COUNT(*) AS n FROM wiki_relations'),
    thumbnails,
    bySource: Object.fromEntries(bySourceRows.map(row => [row.source_group, row.n])),
    byKind: Object.fromEntries(byKindRows.map(row => [row.kind, row.n])),
    mediaTags,
  };
}

function writeReadme(ctx) {
  const file = path.join(ctx.dataRoot, 'README.md');
  const content = `# Hapa Artifact Library Datastore\n\nThis folder stores the local artifact index for the Hapa wiki viewer.\n\n- \`artifact-library.sqlite\` stores source paths, tags, media metadata, NotebookLM conversion state, and wiki relations.\n- \`artifact-media-index.json\` is the browser-safe media index consumed by the wiki viewer.\n- \`reports/\` is reserved for audit reports.\n- Thumbnails live in \`Assets/Artifacts/thumbnails/\`.\n\nPrimary commands from \`/Users/calderwong/Desktop/hapa-wiki-viewer\`:\n\n\`\`\`bash\nnpm run artifacts:init\nnpm run artifacts:scan\nnpm run artifacts:wiki\nnpm run artifacts:status\nnpm run index\n\`\`\`\n`;
  fs.writeFileSync(file, content);
  return file;
}

function initLibrary(ctx) {
  const readme = writeReadme(ctx);
  const index = exportMediaIndex(ctx);
  return { dbPath: ctx.dbPath, dataRoot: ctx.dataRoot, readme, mediaIndex: index.file };
}

async function main() {
  const args = parseArgs();
  const command = args._[0] || 'status';
  const ctx = createContext({
    wikiRoot: args['wiki-root'],
    artifactRoot: args.path || args['artifact-root'],
    dataRoot: args['data-root'],
    assetRoot: args['asset-root'],
    dbPath: args.db,
  });
  let result;
  if (command === 'init') result = initLibrary(ctx);
  else if (command === 'scan') result = scanArtifacts(ctx, {
    ...args,
    thumbnails: args.thumbnails !== 'false' && args['no-thumbnails'] !== true,
    probe: args.probe !== 'false' && args['no-probe'] !== true,
    forceThumbnails: Boolean(args['force-thumbnails']),
  });
  else if (command === 'export-media-index') result = exportMediaIndex(ctx);
  else if (command === 'export-wiki') result = exportWiki(ctx, args);
  else if (command === 'relations') result = refreshWikiRelations(ctx, args);
  else if (command === 'status') result = getStatus(ctx);
  else throw new Error(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  createContext,
  parseArgs,
  classifyFile,
  sourceGroupFor,
  collectionFor,
  htmlToMarkdown,
  inferTags,
  scanArtifacts,
  exportMediaIndex,
  exportWiki,
  getStatus,
  initLibrary,
  refreshWikiRelations,
};
