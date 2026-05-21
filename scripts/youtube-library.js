#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const { buildWikiIndex } = require('../src/wikiIndexer');

const DEFAULT_WIKI_ROOT = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const DEFAULT_DATA_ROOT = 'Raw/YouTube';
const DEFAULT_OPENAI_MODEL = process.env.HAPA_YOUTUBE_OPENAI_MODEL || 'gpt-4o-mini';

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

function stableHash(value, length = 12) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
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
  const dataRoot = path.resolve(options.dataRoot || process.env.HAPA_YOUTUBE_DATA_ROOT || path.join(wikiRoot, DEFAULT_DATA_ROOT));
  const dbPath = path.resolve(options.dbPath || process.env.HAPA_YOUTUBE_DB || path.join(dataRoot, 'youtube-library.sqlite'));
  const transcriptsDir = path.join(dataRoot, 'transcripts');
  const rawDir = path.join(dataRoot, 'raw');
  const reportsDir = path.join(dataRoot, 'reports');
  ensureDir(dataRoot);
  ensureDir(transcriptsDir);
  ensureDir(rawDir);
  ensureDir(reportsDir);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return { wikiRoot, dataRoot, dbPath, transcriptsDir, rawDir, reportsDir, db };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      channel_id TEXT,
      channel_name TEXT,
      channel_url TEXT,
      first_watched_at TEXT,
      last_watched_at TEXT,
      watch_count INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      raw_json TEXT,
      metadata_json TEXT,
      summary TEXT,
      category TEXT,
      topics_json TEXT,
      wiki_matches_json TEXT,
      attribution_note TEXT,
      transcript_status TEXT NOT NULL DEFAULT 'pending',
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      wiki_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watch_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      watched_at TEXT,
      title TEXT,
      url TEXT,
      channel_name TEXT,
      channel_url TEXT,
      source TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(video_id, watched_at, title),
      FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      metadata_json TEXT,
      other_videos_json TEXT,
      wiki_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      video_id TEXT PRIMARY KEY,
      source TEXT,
      language TEXT,
      text_path TEXT,
      raw_path TEXT,
      char_count INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT,
      error TEXT,
      FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 100,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(kind, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS wiki_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_slug TEXT NOT NULL,
      relation TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_type, source_id, target_slug, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_kind ON jobs(status, kind, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_watch_events_video ON watch_events(video_id);
    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
  `);
}

function extractVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (host.endsWith('youtube.com')) {
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'live', 'embed'].includes(parts[0])) return parts[1] || null;
    }
  } catch {}
  return null;
}

function extractChannelId(url, name) {
  if (!url) return `name:${stableHash(name || 'unknown-channel', 16)}`;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && parts[1]) return parts[1];
    if (parts[0] === 'c' && parts[1]) return `c:${parts[1]}`;
    if (parts[0] === '@' || parsed.pathname.startsWith('/@')) return `handle:${parts[0].replace(/^@/, '') || parts[1] || stableHash(url, 8)}`;
    if (parts[0]) return `${parts[0]}:${parts[1] || stableHash(url, 8)}`;
  } catch {}
  return `url:${stableHash(url, 16)}`;
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/^Watched\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return htmlDecode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseTakeoutJson(raw, sourceName = 'watch-history.json') {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${sourceName} was not a JSON array`);
  return parsed.map((entry) => {
    const subtitle = Array.isArray(entry.subtitles) ? entry.subtitles[0] : null;
    return {
      title: cleanTitle(entry.title),
      url: entry.titleUrl || '',
      watchedAt: entry.time || '',
      channelName: subtitle?.name || '',
      channelUrl: subtitle?.url || '',
      source: sourceName,
      raw: entry,
    };
  }).filter(item => extractVideoId(item.url));
}

function parseTakeoutHtml(raw, sourceName = 'watch-history.html') {
  const chunks = raw.split(/<div class="content-cell[^"]*">/i).slice(1);
  const events = [];
  for (const chunk of chunks) {
    const end = chunk.split(/<\/div>\s*<\/div>/i)[0] || chunk;
    const links = [...end.matchAll(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gis)];
    if (!links.length) continue;
    const videoUrl = htmlDecode(links[0][1]);
    const videoId = extractVideoId(videoUrl);
    if (!videoId) continue;
    const channelUrl = links[1] ? htmlDecode(links[1][1]) : '';
    const channelName = links[1] ? stripTags(links[1][2]) : '';
    const text = stripTags(end);
    const watchedAt = text
      .replace(/^Watched\s+/i, '')
      .replace(stripTags(links[0][2]), '')
      .replace(channelName, '')
      .trim();
    events.push({
      title: cleanTitle(stripTags(links[0][2])),
      url: videoUrl,
      watchedAt,
      channelName,
      channelUrl,
      source: sourceName,
      raw: { html: end.slice(0, 2000) },
    });
  }
  return events;
}

function readTakeoutSource(sourcePath) {
  const absolute = path.resolve(sourcePath);
  if (!fs.existsSync(absolute)) throw new Error(`Takeout path not found: ${absolute}`);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    const candidates = [
      path.join(absolute, 'Takeout', 'YouTube and YouTube Music', 'history', 'watch-history.json'),
      path.join(absolute, 'Takeout', 'YouTube and YouTube Music', 'history', 'watch-history.html'),
      path.join(absolute, 'YouTube and YouTube Music', 'history', 'watch-history.json'),
      path.join(absolute, 'YouTube and YouTube Music', 'history', 'watch-history.html'),
    ];
    const found = candidates.find(file => fs.existsSync(file));
    if (!found) throw new Error(`Could not find YouTube watch-history.json/html inside ${absolute}`);
    return { name: path.basename(found), raw: fs.readFileSync(found, 'utf8') };
  }
  if (/\.zip$/i.test(absolute)) {
    const listing = spawnSync('unzip', ['-Z1', absolute], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (listing.status !== 0) throw new Error(`Could not list zip: ${listing.stderr || listing.stdout}`);
    const file = listing.stdout.split(/\r?\n/)
      .find(name => /YouTube and YouTube Music\/history\/watch-history\.(json|html)$/i.test(name));
    if (!file) throw new Error('Could not find YouTube watch-history.json/html in Takeout zip');
    const extracted = spawnSync('unzip', ['-p', absolute, file], { encoding: 'utf8', maxBuffer: 300 * 1024 * 1024 });
    if (extracted.status !== 0) throw new Error(`Could not extract ${file}: ${extracted.stderr || extracted.stdout}`);
    return { name: file, raw: extracted.stdout };
  }
  return { name: path.basename(absolute), raw: fs.readFileSync(absolute, 'utf8') };
}

function parseTakeoutSource(sourcePath) {
  const source = readTakeoutSource(sourcePath);
  if (/\.json$/i.test(source.name)) return parseTakeoutJson(source.raw, source.name);
  if (/\.html?$/i.test(source.name)) return parseTakeoutHtml(source.raw, source.name);
  const trimmed = source.raw.trim();
  if (trimmed.startsWith('[')) return parseTakeoutJson(source.raw, source.name);
  return parseTakeoutHtml(source.raw, source.name);
}

function upsertChannel(db, event) {
  if (!event.channelName && !event.channelUrl) return null;
  const id = extractChannelId(event.channelUrl, event.channelName);
  const stamp = now();
  db.prepare(`
    INSERT INTO channels (id, name, url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(NULLIF(excluded.name, ''), channels.name),
      url = COALESCE(NULLIF(excluded.url, ''), channels.url),
      updated_at = excluded.updated_at
  `).run(id, event.channelName || 'Unknown Creator', event.channelUrl || '', stamp, stamp);
  return id;
}

function upsertVideoEvent(db, event) {
  const videoId = extractVideoId(event.url);
  if (!videoId) return { imported: false, reason: 'missing-video-id' };
  const channelId = upsertChannel(db, event);
  const stamp = now();
  const title = event.title || `YouTube Video ${videoId}`;
  db.prepare(`
    INSERT INTO videos (
      id, url, title, channel_id, channel_name, channel_url, first_watched_at,
      last_watched_at, watch_count, source, raw_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = COALESCE(NULLIF(excluded.title, ''), videos.title),
      channel_id = COALESCE(NULLIF(excluded.channel_id, ''), videos.channel_id),
      channel_name = COALESCE(NULLIF(excluded.channel_name, ''), videos.channel_name),
      channel_url = COALESCE(NULLIF(excluded.channel_url, ''), videos.channel_url),
      first_watched_at = CASE
        WHEN videos.first_watched_at IS NULL OR videos.first_watched_at = '' THEN excluded.first_watched_at
        WHEN excluded.first_watched_at IS NULL OR excluded.first_watched_at = '' THEN videos.first_watched_at
        WHEN excluded.first_watched_at < videos.first_watched_at THEN excluded.first_watched_at
        ELSE videos.first_watched_at
      END,
      last_watched_at = CASE
        WHEN videos.last_watched_at IS NULL OR videos.last_watched_at = '' THEN excluded.last_watched_at
        WHEN excluded.last_watched_at IS NULL OR excluded.last_watched_at = '' THEN videos.last_watched_at
        WHEN excluded.last_watched_at > videos.last_watched_at THEN excluded.last_watched_at
        ELSE videos.last_watched_at
      END,
      watch_count = videos.watch_count + 1,
      source = excluded.source,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(
    videoId,
    event.url,
    title,
    channelId || '',
    event.channelName || '',
    event.channelUrl || '',
    event.watchedAt || '',
    event.watchedAt || '',
    event.source || '',
    toJson(event.raw || event),
    stamp,
    stamp,
  );
  const eventInsert = db.prepare(`
    INSERT OR IGNORE INTO watch_events (
      video_id, watched_at, title, url, channel_name, channel_url, source, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    videoId,
    event.watchedAt || '',
    title,
    event.url,
    event.channelName || '',
    event.channelUrl || '',
    event.source || '',
    toJson(event.raw || event),
    stamp,
  );
  return { imported: true, videoId, eventInserted: eventInsert.changes > 0 };
}

function importTakeout(ctx, sourcePath) {
  const events = parseTakeoutSource(sourcePath);
  let videos = 0;
  let eventsInserted = 0;
  const tx = ctx.db.prepare('BEGIN');
  const commit = ctx.db.prepare('COMMIT');
  const rollback = ctx.db.prepare('ROLLBACK');
  tx.run();
  try {
    for (const event of events) {
      const result = upsertVideoEvent(ctx.db, event);
      if (result.imported) videos += 1;
      if (result.eventInserted) eventsInserted += 1;
    }
    commit.run();
  } catch (error) {
    rollback.run();
    throw error;
  }
  const uniqueVideos = ctx.db.prepare('SELECT COUNT(*) AS n FROM videos').get().n;
  return { parsedEvents: events.length, importedVideoRows: videos, insertedWatchEvents: eventsInserted, totalUniqueVideos: uniqueVideos };
}

function queueJob(db, kind, targetType, targetId, payload = {}, priority = 100) {
  const stamp = now();
  db.prepare(`
    INSERT INTO jobs (kind, target_type, target_id, status, priority, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    ON CONFLICT(kind, target_type, target_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      priority = MIN(jobs.priority, excluded.priority),
      status = CASE WHEN jobs.status IN ('failed', 'blocked') THEN 'pending' ELSE jobs.status END,
      updated_at = excluded.updated_at
  `).run(kind, targetType, targetId, priority, toJson(payload), stamp, stamp);
}

function queueAll(ctx, options = {}) {
  const limit = Number(options.limit || 0);
  const videos = ctx.db.prepare(`SELECT id, url, title, channel_id FROM videos ORDER BY last_watched_at DESC LIMIT ?`).all(limit || 1000000000);
  const channels = ctx.db.prepare(`SELECT id, name, url FROM channels ORDER BY name LIMIT ?`).all(limit || 1000000000);
  for (const video of videos) {
    queueJob(ctx.db, 'transcript', 'video', video.id, { url: video.url, title: video.title }, 50);
    queueJob(ctx.db, 'enrichment', 'video', video.id, { title: video.title }, 80);
    queueJob(ctx.db, 'wiki_video', 'video', video.id, { title: video.title }, 120);
  }
  for (const channel of channels) {
    queueJob(ctx.db, 'creator_metadata', 'channel', channel.id, { url: channel.url, name: channel.name }, 70);
    queueJob(ctx.db, 'wiki_creator', 'channel', channel.id, { name: channel.name }, 130);
  }
  return { queuedVideos: videos.length, queuedChannels: channels.length };
}

function getNextJobs(db, kind, limit) {
  return db.prepare(`
    SELECT * FROM jobs
    WHERE kind = ? AND status = 'pending'
    ORDER BY priority ASC, created_at ASC
    LIMIT ?
  `).all(kind, limit);
}

function markJob(db, id, status, fields = {}) {
  const stamp = now();
  const current = db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(id);
  const attempts = status === 'running' ? Number(current?.attempts || 0) + 1 : Number(current?.attempts || 0);
  db.prepare(`
    UPDATE jobs SET
      status = ?,
      attempts = ?,
      last_error = ?,
      updated_at = ?,
      started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? IN ('succeeded', 'failed', 'blocked', 'skipped') THEN ? ELSE completed_at END
    WHERE id = ?
  `).run(status, attempts, fields.lastError || null, stamp, status, stamp, status, stamp, id);
}

function commandExists(command) {
  const found = spawnSync('/bin/zsh', ['-lc', `command -v ${JSON.stringify(command)}`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : '';
}

function resolveYtDlp() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) return process.env.YTDLP_PATH;
  const found = commandExists('yt-dlp');
  if (found) return found;
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Library', 'Python', '3.13', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.12', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.11', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.10', 'bin', 'yt-dlp'),
    path.join(home, 'Library', 'Python', '3.9', 'bin', 'yt-dlp'),
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
  ];
  return candidates.find(file => fs.existsSync(file)) || '';
}

function vttToText(raw) {
  const seen = new Set();
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const clean = line
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;
    if (/^(WEBVTT|Kind:|Language:)/i.test(clean)) continue;
    if (/^\d+$/.test(clean)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/i.test(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.join('\n');
}

function runTranscriptJob(ctx, job) {
  const video = ctx.db.prepare('SELECT * FROM videos WHERE id = ?').get(job.target_id);
  if (!video) {
    markJob(ctx.db, job.id, 'skipped', { lastError: 'Video not found' });
    return { status: 'skipped', id: job.target_id };
  }
  const ytDlp = resolveYtDlp();
  if (!ytDlp) {
    ctx.db.prepare('UPDATE videos SET transcript_status = ?, updated_at = ? WHERE id = ?').run('blocked', now(), video.id);
    markJob(ctx.db, job.id, 'blocked', { lastError: 'yt-dlp is not installed. Install it or set YTDLP_PATH, then rerun youtube:transcripts.' });
    return { status: 'blocked', id: video.id };
  }
  markJob(ctx.db, job.id, 'running');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hapa-yt-${video.id}-`));
  const outBase = path.join(tmp, video.id);
  const args = [
    '--skip-download',
    '--write-auto-subs',
    '--write-subs',
    '--sub-langs', process.env.HAPA_YOUTUBE_SUB_LANGS || 'en.*',
    '--sub-format', 'vtt',
    '--output', `${outBase}.%(ext)s`,
    video.url,
  ];
  const result = spawnSync(ytDlp, args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, timeout: Number(process.env.HAPA_YOUTUBE_YTDLP_TIMEOUT_MS || 180000) });
  const files = fs.readdirSync(tmp).filter(file => file.endsWith('.vtt'));
  if (result.status !== 0 || !files.length) {
    const error = (result.stderr || result.stdout || 'No transcript subtitles were available').slice(0, 2000);
    ctx.db.prepare(`
      INSERT INTO transcripts (video_id, source, error, fetched_at)
      VALUES (?, 'yt-dlp', ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET error = excluded.error, fetched_at = excluded.fetched_at
    `).run(video.id, error, now());
    ctx.db.prepare('UPDATE videos SET transcript_status = ?, updated_at = ? WHERE id = ?').run('failed', now(), video.id);
    markJob(ctx.db, job.id, 'failed', { lastError: error });
    return { status: 'failed', id: video.id, error };
  }
  const rawFile = path.join(tmp, files[0]);
  const raw = fs.readFileSync(rawFile, 'utf8');
  const text = vttToText(raw);
  const safe = `${video.id}-${stableHash(video.title, 8)}`;
  const rawPath = path.join(ctx.transcriptsDir, `${safe}.vtt`);
  const textPath = path.join(ctx.transcriptsDir, `${safe}.txt`);
  fs.copyFileSync(rawFile, rawPath);
  fs.writeFileSync(textPath, text);
  ctx.db.prepare(`
    INSERT INTO transcripts (video_id, source, language, text_path, raw_path, char_count, fetched_at, error)
    VALUES (?, 'yt-dlp', 'en', ?, ?, ?, ?, NULL)
    ON CONFLICT(video_id) DO UPDATE SET
      source = excluded.source,
      language = excluded.language,
      text_path = excluded.text_path,
      raw_path = excluded.raw_path,
      char_count = excluded.char_count,
      fetched_at = excluded.fetched_at,
      error = NULL
  `).run(video.id, textPath, rawPath, text.length, now());
  ctx.db.prepare('UPDATE videos SET transcript_status = ?, updated_at = ? WHERE id = ?').run('succeeded', now(), video.id);
  markJob(ctx.db, job.id, 'succeeded');
  return { status: 'succeeded', id: video.id, chars: text.length };
}

function textTerms(value) {
  const stop = new Set('the,and,for,that,with,this,from,into,about,what,when,where,which,while,will,have,has,are,was,were,you,your,our,out,how,why,not,can,its,his,her,they,them,then,than,over,under,after,before,video,youtube,watched'.split(','));
  const counts = new Map();
  for (const raw of String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (stop.has(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return counts;
}

function loadTranscript(ctx, videoId) {
  const row = ctx.db.prepare('SELECT * FROM transcripts WHERE video_id = ?').get(videoId);
  if (!row?.text_path || !fs.existsSync(row.text_path)) return '';
  return fs.readFileSync(row.text_path, 'utf8');
}

function wikiMatches(ctx, text, limit = 8) {
  let index;
  try {
    index = buildWikiIndex(ctx.wikiRoot);
  } catch {
    return [];
  }
  const terms = textTerms(text);
  if (!terms.size) return [];
  const matches = [];
  for (const slug of index.orderedSlugs) {
    if (slug.startsWith('YouTube/')) continue;
    const page = index.pages[slug];
    const pageTerms = textTerms(`${page.title} ${page.tags.join(' ')} ${page.topics.join(' ')} ${page.summary}`);
    let score = 0;
    for (const [term, count] of terms) {
      if (pageTerms.has(term)) score += Math.min(count, 4) * (1 + Math.min(pageTerms.get(term), 3));
    }
    if (score > 0) matches.push({ slug, title: page.title, score });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

function deterministicSummary(video, transcript) {
  const firstTranscript = String(transcript || '').split(/\n+/).filter(Boolean).slice(0, 5).join(' ');
  const seed = firstTranscript || `${video.title}${video.channel_name ? ` by ${video.channel_name}` : ''}.`;
  return seed.replace(/\s+/g, ' ').trim().slice(0, 700);
}

function deterministicCategory(text) {
  const hay = String(text || '').toLowerCase();
  const categories = [
    ['AI and local models', ['ai', 'model', 'llm', 'diffusion', 'mlx', 'openai', 'agent']],
    ['Video and generative media', ['video', 'film', 'camera', 'render', 'animation', 'generative']],
    ['Worldbuilding and lore', ['worldbuilding', 'lore', 'story', 'myth', 'fiction', 'canon']],
    ['Software and systems', ['code', 'software', 'database', 'server', 'api', 'app', 'workflow']],
    ['Music and audio', ['music', 'song', 'audio', 'sound', 'stem', 'mix']],
    ['Design and interface', ['design', 'ui', 'ux', 'interface', 'visual', 'brand']],
  ];
  for (const [label, words] of categories) {
    if (words.some(word => hay.includes(word))) return label;
  }
  return 'Research and references';
}

function topTopics(text, count = 10) {
  return [...textTerms(text).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([term]) => term);
}

async function openAiEnrichment(video, transcript, matches) {
  const apiKey = process.env.HAPA_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY or HAPA_OPENAI_API_KEY is required for --provider openai');
  const input = [
    {
      role: 'system',
      content: 'You enrich a personal YouTube learning history into a wiki knowledge library. Return compact JSON only.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        video: {
          title: video.title,
          url: video.url,
          channel: video.channel_name,
          watched_at: video.last_watched_at,
        },
        transcript_excerpt: String(transcript || '').slice(0, 18000),
        possible_hapa_wiki_matches: matches,
        desired_json_schema: {
          summary: '5 to 8 sentence useful summary, not a transcript dump',
          category: 'short category',
          topics: ['lowercase topic labels'],
          attribution_note: 'how this source may have influenced Hapa ideas, phrased carefully',
          wiki_match_notes: [{ slug: 'wiki slug', relation: 'why it may connect' }],
        },
      }),
    },
  ];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      messages: input,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return JSON.parse(json.choices[0].message.content);
}

async function enrichVideo(ctx, job, options = {}) {
  const video = ctx.db.prepare('SELECT * FROM videos WHERE id = ?').get(job.target_id);
  if (!video) {
    markJob(ctx.db, job.id, 'skipped', { lastError: 'Video not found' });
    return { status: 'skipped', id: job.target_id };
  }
  const transcript = loadTranscript(ctx, video.id);
  if (!transcript && !options.includeWithoutTranscript) {
    return { status: 'waiting', id: video.id, reason: 'transcript not ready' };
  }
  markJob(ctx.db, job.id, 'running');
  const baseText = `${video.title}\n${video.channel_name}\n${transcript}`;
  const matches = wikiMatches(ctx, baseText, Number(options.matches || 8));
  let enrichment;
  if (options.provider === 'openai') enrichment = await openAiEnrichment(video, transcript, matches);
  else {
    enrichment = {
      summary: deterministicSummary(video, transcript),
      category: deterministicCategory(baseText),
      topics: topTopics(baseText),
      attribution_note: 'Imported as a watched learning source. Review before claiming direct influence.',
      wiki_match_notes: matches.map(match => ({ slug: match.slug, relation: 'lexical overlap with title/transcript terms' })),
    };
  }
  ctx.db.prepare(`
    UPDATE videos SET
      summary = ?,
      category = ?,
      topics_json = ?,
      wiki_matches_json = ?,
      attribution_note = ?,
      enrichment_status = 'succeeded',
      updated_at = ?
    WHERE id = ?
  `).run(
    enrichment.summary || '',
    enrichment.category || '',
    toJson(enrichment.topics || []),
    toJson(enrichment.wiki_match_notes || matches),
    enrichment.attribution_note || '',
    now(),
    video.id,
  );
  for (const match of matches) {
    ctx.db.prepare(`
      INSERT INTO wiki_relations (source_type, source_id, target_slug, relation, score, note, created_at)
      VALUES ('video', ?, ?, 'learning-reference', ?, ?, ?)
      ON CONFLICT(source_type, source_id, target_slug, relation) DO UPDATE SET
        score = excluded.score,
        note = excluded.note
    `).run(video.id, match.slug, match.score, match.title, now());
  }
  markJob(ctx.db, job.id, 'succeeded');
  return { status: 'succeeded', id: video.id };
}

function runCreatorJob(ctx, job, options = {}) {
  const channel = ctx.db.prepare('SELECT * FROM channels WHERE id = ?').get(job.target_id);
  if (!channel) {
    markJob(ctx.db, job.id, 'skipped', { lastError: 'Channel not found' });
    return { status: 'skipped', id: job.target_id };
  }
  const ytDlp = resolveYtDlp();
  if (!ytDlp || !channel.url) {
    const error = !ytDlp ? 'yt-dlp is not installed. Creator metadata can still be exported from Takeout basics.' : 'Channel URL missing';
    ctx.db.prepare('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?').run('blocked', now(), channel.id);
    markJob(ctx.db, job.id, 'blocked', { lastError: error });
    return { status: 'blocked', id: channel.id, error };
  }
  markJob(ctx.db, job.id, 'running');
  const max = Number(options.sampleVideos || 12);
  const result = spawnSync(ytDlp, ['-J', '--flat-playlist', '--playlist-end', String(max), channel.url], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: Number(process.env.HAPA_YOUTUBE_YTDLP_TIMEOUT_MS || 180000),
  });
  if (result.status !== 0) {
    const error = (result.stderr || result.stdout || 'yt-dlp creator metadata failed').slice(0, 2000);
    ctx.db.prepare('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?').run('failed', now(), channel.id);
    markJob(ctx.db, job.id, 'failed', { lastError: error });
    return { status: 'failed', id: channel.id, error };
  }
  const meta = JSON.parse(result.stdout);
  const otherVideos = Array.isArray(meta.entries)
    ? meta.entries.slice(0, max).map(entry => ({ id: entry.id, title: entry.title, url: entry.url || `https://www.youtube.com/watch?v=${entry.id}` }))
    : [];
  ctx.db.prepare(`
    UPDATE channels SET
      metadata_json = ?,
      other_videos_json = ?,
      status = 'succeeded',
      updated_at = ?
    WHERE id = ?
  `).run(toJson({ title: meta.title, description: meta.description, channel_id: meta.channel_id, uploader_id: meta.uploader_id }), toJson(otherVideos), now(), channel.id);
  markJob(ctx.db, job.id, 'succeeded');
  return { status: 'succeeded', id: channel.id, videos: otherVideos.length };
}

function markdownEscape(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function wikiLink(slug, label) {
  return `[[${slug}|${label || slug.split('/').pop()}]]`;
}

function videoPagePath(ctx, video) {
  const slug = `${slugify(video.title, video.id)}-${video.id}`;
  return path.join(ctx.wikiRoot, 'YouTube', 'Videos', `${slug}.md`);
}

function creatorPagePath(ctx, channel) {
  const slug = `${slugify(channel.name, channel.id)}-${stableHash(channel.id, 6)}`;
  return path.join(ctx.wikiRoot, 'YouTube', 'Creators', `${slug}.md`);
}

function relativeWikiPath(ctx, file) {
  return path.relative(ctx.wikiRoot, file).replace(/\\/g, '/');
}

function writeVideoPage(ctx, video) {
  const transcript = ctx.db.prepare('SELECT * FROM transcripts WHERE video_id = ?').get(video.id);
  const topics = fromJson(video.topics_json, []);
  const matches = fromJson(video.wiki_matches_json, []);
  const watched = ctx.db.prepare('SELECT watched_at FROM watch_events WHERE video_id = ? ORDER BY watched_at DESC LIMIT 8').all(video.id);
  const file = videoPagePath(ctx, video);
  ensureDir(path.dirname(file));
  const matchLines = matches.length
    ? matches.slice(0, 10).map(match => `- ${wikiLink(match.slug, match.slug.split('/').pop())}${match.relation ? ` - ${match.relation}` : ''}`).join('\n')
    : '- No wiki matches yet.';
  const content = `---\ntitle: ${JSON.stringify(video.title)}\ntype: youtube-video-source\nstatus: imported\nsource_video_id: ${JSON.stringify(video.id)}\nchannel: ${JSON.stringify(video.channel_name || '')}\ntags: [youtube, shared-library, attribution]\n---\n# ${video.title}\n\n## Source\n- URL: ${video.url}\n- Creator: ${video.channel_name || 'Unknown'}\n- Channel: ${video.channel_url || ''}\n- First watched: ${video.first_watched_at || ''}\n- Last watched: ${video.last_watched_at || ''}\n- Watch count: ${video.watch_count || 0}\n- Transcript: ${transcript?.text_path ? transcript.text_path : 'not available yet'}\n\n## Summary\n${markdownEscape(video.summary || 'Queued for enrichment.')}\n\n## Category\n${markdownEscape(video.category || 'Uncategorized')}\n\n## Topics\n${topics.length ? topics.map(topic => `- ${topic}`).join('\n') : '- None yet.'}\n\n## Hapa Wiki Relations\n${matchLines}\n\n## Attribution Notes\n${markdownEscape(video.attribution_note || 'Imported as a watched source. Review before treating as a direct influence.')}\n\n## Recent Watch Events\n${watched.length ? watched.map(row => `- ${row.watched_at || 'unknown time'}`).join('\n') : '- No watch events recorded.'}\n`;
  fs.writeFileSync(file, content);
  ctx.db.prepare('UPDATE videos SET wiki_status = ?, updated_at = ? WHERE id = ?').run('succeeded', now(), video.id);
  return file;
}

function writeCreatorPage(ctx, channel) {
  const file = creatorPagePath(ctx, channel);
  ensureDir(path.dirname(file));
  const videos = ctx.db.prepare('SELECT id, title, url, last_watched_at, summary FROM videos WHERE channel_id = ? ORDER BY last_watched_at DESC LIMIT 50').all(channel.id);
  const otherVideos = fromJson(channel.other_videos_json, []);
  const content = `---\ntitle: ${JSON.stringify(channel.name)}\ntype: youtube-creator-source\nstatus: imported\nsource_channel_id: ${JSON.stringify(channel.id)}\ntags: [youtube, creator, shared-library, attribution]\n---\n# ${channel.name}\n\n## Source\n- Channel URL: ${channel.url || ''}\n- Videos watched in history: ${videos.length}\n- Metadata status: ${channel.status || 'pending'}\n\n## Watched Videos\n${videos.length ? videos.map(video => `- [${video.title}](${video.url}) - ${video.last_watched_at || ''}`).join('\n') : '- None recorded yet.'}\n\n## Other Videos Sample\n${otherVideos.length ? otherVideos.map(video => `- [${video.title}](${video.url})`).join('\n') : '- No channel sample gathered yet.'}\n\n## Attribution Notes\nThis creator appeared in the imported YouTube watch history. Use this page to track references, influences, and credits as Hapa ideas are mapped back to source material.\n`;
  fs.writeFileSync(file, content);
  ctx.db.prepare('UPDATE channels SET wiki_path = ?, updated_at = ? WHERE id = ?').run(relativeWikiPath(ctx, file), now(), channel.id);
  return file;
}

function writeIndexPage(ctx) {
  const file = path.join(ctx.wikiRoot, 'YouTube', 'Index.md');
  ensureDir(path.dirname(file));
  const status = getStatus(ctx);
  const topChannels = ctx.db.prepare(`
    SELECT channel_name, channel_url, COUNT(*) AS n
    FROM videos
    WHERE channel_name IS NOT NULL AND channel_name != ''
    GROUP BY channel_name, channel_url
    ORDER BY n DESC
    LIMIT 25
  `).all();
  const recent = ctx.db.prepare(`
    SELECT title, url, channel_name, last_watched_at, category
    FROM videos
    ORDER BY last_watched_at DESC
    LIMIT 25
  `).all();
  const content = `---\ntitle: YouTube Shared Library\ntype: source-library-index\nstatus: active\ntags: [youtube, shared-library, attribution]\n---\n# YouTube Shared Library\n\nThis index is generated from the local YouTube history datastore at \`${ctx.dbPath}\`.\n\nSee [[Development/YouTube Shared Library Pipeline|YouTube Shared Library Pipeline]] for the operating notes.\n\n## Status\n- Videos: ${status.videos}\n- Watch events: ${status.watchEvents}\n- Creators: ${status.channels}\n- Transcript jobs pending: ${status.jobs.transcript?.pending || 0}\n- Enrichment jobs pending: ${status.jobs.enrichment?.pending || 0}\n- Wiki video jobs pending: ${status.jobs.wiki_video?.pending || 0}\n\n## Top Creators In Watch History\n${topChannels.length ? topChannels.map(row => `- [${row.channel_name}](${row.channel_url || '#'}) - ${row.n} watched videos`).join('\n') : '- No creators imported yet.'}\n\n## Recent Imported Videos\n${recent.length ? recent.map(row => `- [${row.title}](${row.url}) - ${row.channel_name || 'Unknown'} - ${row.category || 'Uncategorized'} - ${row.last_watched_at || ''}`).join('\n') : '- No videos imported yet.'}\n\n## Workflow\n1. Export YouTube watch history through Google Takeout.\n2. Run \`npm run youtube:import -- --path /path/to/takeout.zip\`.\n3. Run \`npm run youtube:queue\`.\n4. Run transcript, enrichment, creator, and wiki jobs in batches.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function exportWiki(ctx, options = {}) {
  const limit = Number(options.limit || 50);
  const videoJobs = getNextJobs(ctx.db, 'wiki_video', limit);
  const creatorJobs = getNextJobs(ctx.db, 'wiki_creator', limit);
  const written = [];
  for (const job of videoJobs) {
    const video = ctx.db.prepare('SELECT * FROM videos WHERE id = ?').get(job.target_id);
    if (!video) {
      markJob(ctx.db, job.id, 'skipped', { lastError: 'Video not found' });
      continue;
    }
    markJob(ctx.db, job.id, 'running');
    written.push(writeVideoPage(ctx, video));
    markJob(ctx.db, job.id, 'succeeded');
  }
  for (const job of creatorJobs) {
    const channel = ctx.db.prepare('SELECT * FROM channels WHERE id = ?').get(job.target_id);
    if (!channel) {
      markJob(ctx.db, job.id, 'skipped', { lastError: 'Channel not found' });
      continue;
    }
    markJob(ctx.db, job.id, 'running');
    written.push(writeCreatorPage(ctx, channel));
    markJob(ctx.db, job.id, 'succeeded');
  }
  written.push(writeIndexPage(ctx));
  return { written: written.map(file => relativeWikiPath(ctx, file)) };
}

async function runJobs(ctx, kind, runner, options = {}) {
  const limit = Number(options.limit || 10);
  const jobs = getNextJobs(ctx.db, kind, limit);
  const results = [];
  for (const job of jobs) {
    try {
      const result = await runner(ctx, job, options);
      results.push(result);
    } catch (error) {
      markJob(ctx.db, job.id, 'failed', { lastError: error.message });
      results.push({ status: 'failed', id: job.target_id, error: error.message });
    }
  }
  return { kind, processed: results.length, results };
}

function getStatus(ctx) {
  const scalar = sql => ctx.db.prepare(sql).get().n;
  const jobRows = ctx.db.prepare('SELECT kind, status, COUNT(*) AS n FROM jobs GROUP BY kind, status').all();
  const jobs = {};
  for (const row of jobRows) {
    if (!jobs[row.kind]) jobs[row.kind] = {};
    jobs[row.kind][row.status] = row.n;
  }
  return {
    dbPath: ctx.dbPath,
    dataRoot: ctx.dataRoot,
    ytDlp: resolveYtDlp() || null,
    videos: scalar('SELECT COUNT(*) AS n FROM videos'),
    watchEvents: scalar('SELECT COUNT(*) AS n FROM watch_events'),
    channels: scalar('SELECT COUNT(*) AS n FROM channels'),
    transcripts: scalar('SELECT COUNT(*) AS n FROM transcripts WHERE char_count > 0'),
    enriched: scalar("SELECT COUNT(*) AS n FROM videos WHERE enrichment_status = 'succeeded'"),
    wikiVideoPages: scalar("SELECT COUNT(*) AS n FROM videos WHERE wiki_status = 'succeeded'"),
    jobs,
  };
}

function writeReadme(ctx) {
  const file = path.join(ctx.dataRoot, 'README.md');
  const content = `# YouTube Shared Library Datastore\n\nThis folder stores the local Hapa YouTube learning library.\n\n- \`youtube-library.sqlite\` stores watch history metadata, creators, queues, relations, and enrichment state.\n- \`transcripts/\` stores local transcript text and raw caption files when transcript jobs succeed.\n- \`raw/\` is reserved for local source snapshots.\n- \`reports/\` is reserved for job reports and audits.\n\nPrimary commands from \`/Users/calderwong/Desktop/hapa-wiki-viewer\`:\n\n\`\`\`bash\nnpm run youtube:init\nnpm run youtube:import -- --path /path/to/takeout.zip\nnpm run youtube:queue\nnpm run youtube:transcripts -- --limit 25\nnpm run youtube:enrich -- --limit 25 --include-without-transcript\nnpm run youtube:creators -- --limit 25\nnpm run youtube:wiki -- --limit 50\nnpm run youtube:status\n\`\`\`\n\nFor full YouTube watch history, use Google Takeout and include YouTube and YouTube Music history. Browser history alone is not a complete YouTube watch history source.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function initLibrary(ctx) {
  const readme = writeReadme(ctx);
  const index = writeIndexPage(ctx);
  return { dbPath: ctx.dbPath, dataRoot: ctx.dataRoot, readme, index };
}

async function main() {
  const args = parseArgs();
  const command = args._[0] || 'status';
  const ctx = createContext({ wikiRoot: args['wiki-root'], dataRoot: args['data-root'], dbPath: args.db });
  let result;
  if (command === 'init') result = initLibrary(ctx);
  else if (command === 'import-takeout') {
    if (!args.path) throw new Error('Usage: youtube-library.js import-takeout --path /path/to/takeout.zip');
    result = importTakeout(ctx, args.path);
  } else if (command === 'queue-all') result = queueAll(ctx, args);
  else if (command === 'run-transcripts') result = await runJobs(ctx, 'transcript', runTranscriptJob, args);
  else if (command === 'run-enrichment') result = await runJobs(ctx, 'enrichment', enrichVideo, {
    ...args,
    provider: args.provider || 'deterministic',
    includeWithoutTranscript: Boolean(args['include-without-transcript']),
  });
  else if (command === 'run-creators') result = await runJobs(ctx, 'creator_metadata', runCreatorJob, args);
  else if (command === 'export-wiki') result = exportWiki(ctx, args);
  else if (command === 'status') result = getStatus(ctx);
  else {
    throw new Error(`Unknown command: ${command}`);
  }
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
  extractVideoId,
  parseTakeoutJson,
  parseTakeoutHtml,
  parseTakeoutSource,
  importTakeout,
  queueAll,
  getStatus,
  exportWiki,
  initLibrary,
  deterministicCategory,
  resolveYtDlp,
  vttToText,
};
