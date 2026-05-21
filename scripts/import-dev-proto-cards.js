#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_WIKI_ROOT = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const DEFAULT_DB_PATH = '/Users/calderwong/Library/Application Support/hapa-ag/persistence.db';
const CARD_ROOT_REL = 'Cards/Hapa Dev Proto Cards';
const CARD_PAGES_REL = `${CARD_ROOT_REL}/Cards`;
const MEDIA_PAGES_REL = `${CARD_ROOT_REL}/Media`;
const ASSET_ROOT_REL = 'Assets/Cards/HapaDevProto';
const RAW_ROOT_REL = 'Raw/hapa-dev-proto-card-snapshot';

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

function slugify(value, fallback = 'card') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
    .slice(0, 100);
  return slug || fallback;
}

function hash(value, length = 12) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function jsonParse(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function yamlQuote(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function markdownEscape(value) {
  return String(value == null ? '' : value).replace(/\r/g, '').trim();
}

function truncateMarkdown(value, limit = 900) {
  const text = markdownEscape(value).replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function htmlEntityDecode(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeLocalPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file:////')) return decodeURIComponent(raw.replace(/^file:\/\/\/\//, '/'));
  if (raw.startsWith('file://')) {
    try {
      return fileURLToPath(raw);
    } catch {
      return decodeURIComponent(raw.replace(/^file:\/+/, '/'));
    }
  }
  return raw;
}

function inferMediaKind(value) {
  const clean = String(value || '').toLowerCase().split('?')[0].split('#')[0];
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(clean)) return 'image';
  if (/\.(mp4|mov|m4v|webm|mkv|avi)$/.test(clean)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(clean)) return 'audio';
  return '';
}

function readPngTextChunks(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 16 || buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return [];
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    const start = offset + 8;
    const end = start + length;
    if (end > buf.length) break;
    const data = buf.slice(start, end);
    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      chunks.push({
        type,
        keyword: nul === -1 ? '' : data.slice(0, nul).toString('latin1'),
        text: data.slice(nul + 1).toString('utf8'),
      });
    } else if (type === 'iTXt') {
      const first = data.indexOf(0);
      if (first !== -1 && data.length > first + 4) {
        const keyword = data.slice(0, first).toString('latin1');
        const compressionFlag = data[first + 1];
        const compressionMethod = data[first + 2];
        let cursor = first + 3;
        const langEnd = data.indexOf(0, cursor);
        cursor = langEnd === -1 ? cursor : langEnd + 1;
        const translatedEnd = data.indexOf(0, cursor);
        cursor = translatedEnd === -1 ? cursor : translatedEnd + 1;
        let textBytes = data.slice(cursor);
        if (compressionFlag === 1 && compressionMethod === 0) {
          try {
            textBytes = zlib.inflateSync(textBytes);
          } catch {
            textBytes = Buffer.alloc(0);
          }
        }
        chunks.push({ type, keyword, text: textBytes.toString('utf8') });
      }
    } else if (type === 'zTXt') {
      const nul = data.indexOf(0);
      if (nul !== -1 && data[nul + 1] === 0) {
        try {
          chunks.push({
            type,
            keyword: data.slice(0, nul).toString('latin1'),
            text: zlib.inflateSync(data.slice(nul + 2)).toString('utf8'),
          });
        } catch {
          // Ignore malformed compressed text chunks.
        }
      }
    } else if (type === 'eXIf') {
      chunks.push({ type, keyword: 'eXIf', text: data.toString('utf8') });
    }
    offset = end + 4;
  }
  return chunks;
}

function extractBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function parseEmbeddedJson(text) {
  const anchors = ['{"mflux_version"', '{"model"', '{"prompt"'];
  for (const anchor of anchors) {
    let idx = text.indexOf(anchor);
    while (idx !== -1) {
      const raw = extractBalancedJson(text, idx);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.prompt || parsed.model || parsed.mflux_version) return parsed;
        } catch {
          // Keep scanning.
        }
      }
      idx = text.indexOf(anchor, idx + anchor.length);
    }
  }
  return null;
}

function firstXmlValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = String(xml || '').match(re);
  return match ? htmlEntityDecode(match[1].replace(/<[^>]+>/g, '').trim()) : '';
}

function extractMediaMetadata(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext !== '.png') return {};
  try {
    const chunks = readPngTextChunks(sourcePath);
    const combined = chunks.map(chunk => chunk.text).join('\n');
    const json = parseEmbeddedJson(combined) || {};
    const xmp = chunks.find(chunk => /xmpmeta|rdf:RDF|mflux:/i.test(chunk.text))?.text || '';
    const prompt = json.prompt || firstXmlValue(xmp, 'rdf:li') || '';
    const negativePrompt = json.negative_prompt || json.negativePrompt || '';
    const seed = json.seed ?? firstXmlValue(xmp, 'mflux:seed');
    const steps = json.steps ?? firstXmlValue(xmp, 'mflux:steps');
    const guidance = json.guidance ?? firstXmlValue(xmp, 'mflux:guidance');
    return {
      prompt,
      negativePrompt,
      model: json.model || json.base_model || '',
      baseModel: json.base_model || '',
      seed: seed == null ? '' : seed,
      steps: steps == null ? '' : steps,
      guidance: guidance == null ? '' : guidance,
      width: json.width || '',
      height: json.height || '',
      precision: json.precision || '',
      quantize: json.quantize ?? '',
      generationTimeSeconds: json.generation_time_seconds || '',
      createdAt: json.created_at || '',
      loraPaths: json.lora_paths || null,
      loraScales: json.lora_scales || null,
      source: json.mflux_version ? 'MFLUX embedded PNG metadata' : xmp ? 'PNG XMP metadata' : '',
      raw: Object.keys(json).length ? json : undefined,
    };
  } catch {
    return {};
  }
}

function walkMarkdown(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
    }
  }
  walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function buildCardPageMap(wikiRoot) {
  const map = new Map();
  const titleBySlug = new Map();
  const root = path.join(wikiRoot, CARD_ROOT_REL);
  for (const file of walkMarkdown(root)) {
    const raw = fs.readFileSync(file, 'utf8');
    const id = raw.match(/^card_id:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim();
    const title = raw.match(/^title:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim() || path.basename(file, '.md');
    const slug = path.relative(wikiRoot, file).replace(/\\/g, '/').replace(/\.md$/i, '');
    titleBySlug.set(slug, title);
    if (id && !map.has(id)) map.set(id, { file, slug, title });
  }
  return { map, titleBySlug };
}

function readRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT id, type, media_kind, core_name, name, tier, hellweek_run_id, parent_id,
             thumbnail, media_local_path, lore, content_text, created_at, updated_at, metadata_json
      FROM cards
      WHERE is_deleted = 0
      ORDER BY created_at ASC, id ASC
    `).all();
  } finally {
    db.close();
  }
}

function mediaSourceForRow(row, meta) {
  const candidates = [
    row.media_local_path,
    meta.mediaLocalPath,
    meta.representativeMediaLocalPath,
    meta.generatedVideoLocal,
    meta.generatedImageLocal,
    meta.thumbnail,
    row.thumbnail,
  ];
  for (const candidate of candidates) {
    const local = normalizeLocalPath(candidate);
    if (!local) continue;
    if (fs.existsSync(local) && fs.statSync(local).isFile()) return local;
  }
  return '';
}

function rowTitle(row, meta) {
  return String(row.name || meta.name || row.id || 'Untitled card').trim();
}

function assetRelForSource(sourcePath, kind) {
  const ext = path.extname(sourcePath) || (kind === 'video' ? '.mp4' : '.png');
  const base = slugify(path.basename(sourcePath, ext), kind || 'media');
  const dir = kind === 'video' ? 'videos' : kind === 'audio' ? 'audio' : 'images';
  return `${ASSET_ROOT_REL}/${dir}/${base}-${hash(sourcePath, 10)}${ext.toLowerCase()}`;
}

function relativeMarkdownPath(fromFile, targetAbs) {
  return encodeURI(path.relative(path.dirname(fromFile), targetAbs).replace(/\\/g, '/'));
}

function upsertGeneratedSection(raw, marker, section) {
  const start = `<!-- ${marker}:START -->`;
  const end = `<!-- ${marker}:END -->`;
  const next = `${start}\n${section.trim()}\n${end}`;
  const re = new RegExp(`\\n?<!-- ${marker}:START -->[\\s\\S]*?<!-- ${marker}:END -->`);
  if (re.test(raw)) return raw.replace(re, `\n\n${next}`);
  const lineage = raw.indexOf('\n## Lineage metadata');
  if (lineage !== -1) return `${raw.slice(0, lineage).trimEnd()}\n\n${next}\n${raw.slice(lineage)}`;
  return `${raw.trimEnd()}\n\n${next}\n`;
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
  return true;
}

function copyMedia(sourcePath, assetAbs) {
  ensureDir(path.dirname(assetAbs));
  if (fs.existsSync(assetAbs)) {
    const srcStat = fs.statSync(sourcePath);
    const dstStat = fs.statSync(assetAbs);
    if (srcStat.size === dstStat.size) return false;
  }
  fs.copyFileSync(sourcePath, assetAbs);
  return true;
}

function mediaPageContent(entry, parentPage, mediaPageFile, wikiRoot) {
  const assetAbs = path.join(wikiRoot, entry.assetRelPath);
  const mediaRel = relativeMarkdownPath(mediaPageFile, assetAbs);
  const title = entry.title || entry.cardId;
  const parentLink = parentPage ? `[[${parentPage.slug}|${parentPage.title}]]` : `\`${entry.parentCardId || 'none'}\``;
  const mediaMarkup = entry.mediaKind === 'video'
    ? `<video src="${mediaRel}" controls></video>`
    : `![${title}](${mediaRel})`;
  return `---\n` +
    `title: ${yamlQuote(title)}\n` +
    `type: hapa_dev_proto_media_card\n` +
    `card_id: ${yamlQuote(entry.cardId)}\n` +
    `parent_card_id: ${yamlQuote(entry.parentCardId || '')}\n` +
    `media_kind: ${yamlQuote(entry.mediaKind)}\n` +
    `source: hapa-dev-proto sqlite media projection\n` +
    `created_at: ${yamlQuote(entry.createdAt || '')}\n` +
    `updated_at: ${yamlQuote(entry.updatedAt || '')}\n` +
    `asset: ${yamlQuote(entry.assetRelPath)}\n` +
    `---\n\n` +
    `# ${title}\n\n` +
    `${mediaMarkup}\n\n` +
    `## Parent card\n\n` +
    `${parentLink}\n\n` +
    `## Retrieval\n\n` +
    `- SQLite row: \`${entry.cardId}\`\n` +
    `- Parent card id: \`${entry.parentCardId || ''}\`\n` +
    `- Media kind: \`${entry.mediaKind}\`\n` +
    `- Copied wiki asset: \`${entry.assetRelPath}\`\n` +
    `- Source app media path: \`${entry.sourcePath}\`\n`;
}

function parentMediaSection(parentId, entries, pageFile, wikiRoot) {
  const lines = [
    '## Hapa Dev Proto Media',
    '',
    `Imported from the live \`hapa-ag\` card media projection. Parent card id: \`${parentId}\`.`,
    '',
  ];
  for (const entry of entries.slice(0, 8)) {
    const assetAbs = path.join(wikiRoot, entry.assetRelPath);
    const mediaRel = relativeMarkdownPath(pageFile, assetAbs);
    const label = markdownEscape(entry.title || entry.cardId);
    if (entry.mediaKind === 'video') lines.push(`<video src="${mediaRel}" controls></video>`);
    else lines.push(`![${label}](${mediaRel})`);
    lines.push('');
    lines.push(`- Media card id: \`${entry.cardId}\``);
    lines.push(`- Wiki asset: \`${entry.assetRelPath}\``);
    lines.push(`- Source app media path: \`${entry.sourcePath}\``);
    if (entry.createdAt) lines.push(`- Created: \`${entry.createdAt}\``);
    lines.push('');
  }
  if (entries.length > 8) lines.push(`Additional media records omitted from this page section: ${entries.length - 8}. See the import manifest.`);
  return lines.join('\n').trim();
}

function updateIndexPage(wikiRoot, stats, generatedAt) {
  const file = path.join(wikiRoot, CARD_ROOT_REL, 'Index.md');
  if (!fs.existsSync(file)) return false;
  const raw = fs.readFileSync(file, 'utf8');
  const section = [
    '## Imported Media Augments',
    '',
    `Last media import: \`${generatedAt}\`.`,
    '',
    `- Live SQLite cards scanned: ${stats.rowsScanned}.`,
    `- Media records with local files: ${stats.mediaRecords}.`,
    `- Media assets copied into the wiki: ${stats.assetsCopied}.`,
    `- Existing parent card pages augmented: ${stats.parentPagesUpdated}.`,
    `- Media-card pages written: ${stats.mediaPagesWritten}.`,
    `- Manifest: \`${RAW_ROOT_REL}/hapa_dev_proto_media_import.json\`.`,
    '',
    'The viewer card browser uses these copied assets as cover media, while the retrieval metadata keeps the live `hapa-ag` SQLite row ids and source paths visible for agents.',
  ].join('\n');
  return writeIfChanged(file, upsertGeneratedSection(raw, 'HAPA_DEV_PROTO_MEDIA_IMPORT', section));
}

function importDevProtoCards(options = {}) {
  const wikiRoot = path.resolve(options.wikiRoot || process.env.HAPA_WIKI_ROOT || DEFAULT_WIKI_ROOT);
  const dbPath = path.resolve(options.dbPath || process.env.HAPA_DEV_PROTO_DB || DEFAULT_DB_PATH);
  const generatedAt = now();
  const rawRoot = path.join(wikiRoot, RAW_ROOT_REL);
  const mediaPagesRoot = path.join(wikiRoot, MEDIA_PAGES_REL);
  ensureDir(rawRoot);
  ensureDir(mediaPagesRoot);

  if (!fs.existsSync(dbPath)) throw new Error(`hapa-dev-proto SQLite DB not found: ${dbPath}`);
  const rows = readRows(dbPath);
  const { map: pageByCardId } = buildCardPageMap(wikiRoot);
  const sourceToAsset = new Map();
  const mediaEntries = [];
  let assetsCopied = 0;

  for (const row of rows) {
    const meta = jsonParse(row.metadata_json, {});
    const sourcePath = mediaSourceForRow(row, meta);
    if (!sourcePath) continue;
    const kind = row.media_kind || meta.mediaKind || inferMediaKind(sourcePath);
    if (!['image', 'video'].includes(kind)) continue;
    const assetRelPath = sourceToAsset.get(sourcePath) || assetRelForSource(sourcePath, kind);
    sourceToAsset.set(sourcePath, assetRelPath);
    const assetAbs = path.join(wikiRoot, assetRelPath);
    if (copyMedia(sourcePath, assetAbs)) assetsCopied += 1;
    mediaEntries.push({
      cardId: String(row.id),
      parentCardId: String(row.parent_id || meta.parentCardId || ''),
      title: rowTitle(row, meta),
      mediaKind: kind,
      sourcePath,
      assetRelPath,
      type: row.type || '',
      coreName: row.core_name || meta.coreName || '',
      createdAt: row.created_at || meta.createdAt || '',
      updatedAt: row.updated_at || meta.updatedAt || '',
    });
  }

  const mediaByParent = new Map();
  for (const entry of mediaEntries) {
    if (!entry.parentCardId) continue;
    if (!mediaByParent.has(entry.parentCardId)) mediaByParent.set(entry.parentCardId, []);
    mediaByParent.get(entry.parentCardId).push(entry);
  }

  let parentPagesUpdated = 0;
  for (const [parentId, entries] of mediaByParent) {
    const page = pageByCardId.get(parentId);
    if (!page) continue;
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const raw = fs.readFileSync(page.file, 'utf8');
    const next = upsertGeneratedSection(raw, 'HAPA_DEV_PROTO_MEDIA', parentMediaSection(parentId, entries, page.file, wikiRoot));
    if (writeIfChanged(page.file, next)) parentPagesUpdated += 1;
  }

  let mediaPagesWritten = 0;
  for (const entry of mediaEntries) {
    if (entry.cardId.startsWith('card-') && pageByCardId.has(entry.cardId)) continue;
    const parentPage = entry.parentCardId ? pageByCardId.get(entry.parentCardId) : null;
    const fileName = `${slugify(entry.title, entry.mediaKind)}-${slugify(entry.cardId, 'media')}.md`;
    const mediaPageFile = path.join(mediaPagesRoot, fileName);
    const content = mediaPageContent(entry, parentPage, mediaPageFile, wikiRoot);
    if (writeIfChanged(mediaPageFile, content)) mediaPagesWritten += 1;
  }

  const stats = {
    generatedAt,
    wikiRoot,
    dbPath,
    rowsScanned: rows.length,
    mediaRecords: mediaEntries.length,
    assetsCopied,
    parentPagesWithMedia: mediaByParent.size,
    parentPagesUpdated,
    mediaPagesWritten,
  };
  const manifest = {
    ...stats,
    assetRoot: ASSET_ROOT_REL,
    mediaPageRoot: MEDIA_PAGES_REL,
    media: mediaEntries,
  };
  writeIfChanged(path.join(rawRoot, 'hapa_dev_proto_media_import.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  updateIndexPage(wikiRoot, stats, generatedAt);
  return stats;
}

function main() {
  const args = parseArgs();
  const stats = importDevProtoCards({
    wikiRoot: args['wiki-root'],
    dbPath: args.db,
  });
  console.log(JSON.stringify(stats, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { importDevProtoCards, normalizeLocalPath, assetRelForSource, upsertGeneratedSection };
