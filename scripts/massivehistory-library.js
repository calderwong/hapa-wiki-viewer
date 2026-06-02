#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { parseFrontmatter } = require('../src/wikiIndexer');

const DEFAULT_WIKI_ROOT = path.join(os.homedir(), 'Desktop', 'Hapa_Worldbuilding_Wiki');
const DEFAULT_SOURCE_ROOT = path.join(os.homedir(), 'Desktop', 'massivehistory_chunks');

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

function stableHash(value, length = 16) {
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
  const sourceRoot = path.resolve(options.sourceRoot || process.env.HAPA_MASSIVEHISTORY_SOURCE_ROOT || DEFAULT_SOURCE_ROOT);
  const manifestPath = path.resolve(options.manifest || path.join(sourceRoot, 'manifest.json'));
  const rawRoot = path.join(wikiRoot, 'Raw', 'massivehistory');
  const chunkRoot = path.join(wikiRoot, 'MassiveHistory', 'Chunks');
  ensureDir(rawRoot);
  ensureDir(chunkRoot);
  return { wikiRoot, sourceRoot, manifestPath, rawRoot, chunkRoot };
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadManifest(ctx) {
  if (!fs.existsSync(ctx.manifestPath)) throw new Error(`MassiveHistory manifest not found: ${ctx.manifestPath}`);
  return JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
}

function loadReviewMap(ctx) {
  const file = path.join(ctx.rawRoot, 'massivehistory_programmatic_review.json');
  const payload = readJson(file, { reviews: [] });
  const reviews = new Map();
  for (const review of payload.reviews || []) reviews.set(Number(review.chunk), review);
  return reviews;
}

function loadSummary(ctx) {
  return readJson(path.join(ctx.rawRoot, 'massivehistory_summary.json'), {});
}

function padChunk(n) {
  return String(Number(n)).padStart(4, '0');
}

function pageSpan(chunk) {
  const start = Number(chunk.start_page || String(chunk.pages || '').split('-')[0] || 0);
  const end = Number(chunk.end_page || String(chunk.pages || '').split('-')[1] || start);
  return { start, end, label: `${start}-${end}` };
}

function chunkRef(chunk) {
  return `mh:${padChunk(chunk.chunk)}`;
}

function chunkSlug(chunk) {
  const span = pageSpan(chunk);
  return `MassiveHistory/Chunks/mh-${padChunk(chunk.chunk)}-p${String(span.start).padStart(4, '0')}-${String(span.end).padStart(4, '0')}`;
}

function reviewSlug(chunk) {
  return `MassiveHistory/Chunk Reviews/massivehistory_chunk_${padChunk(chunk.chunk)}_review`;
}

function markdownList(items, labeler, limit = 20) {
  if (!items || !items.length) return '- None recorded.';
  return items.slice(0, limit).map(item => `- ${labeler(item)}`).join('\n');
}

function reviewTags(review = {}) {
  const tags = new Set(['massivehistory', 'source-chunk']);
  for (const raw of String(review.dominant_categories || '').split(',')) {
    const tag = raw.trim().replace(/_/g, '-');
    if (tag) tags.add(tag);
  }
  return [...tags].sort();
}

function firstHeading(body, fallback) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function yamlString(value) {
  return JSON.stringify(String(value || ''));
}

function wikiLink(slug, label) {
  return `[[${slug}|${label || slug.split('/').pop()}]]`;
}

function writeChunkPage(ctx, manifest, chunk, review) {
  const span = pageSpan(chunk);
  const ref = chunkRef(chunk);
  const slug = chunkSlug(chunk);
  const file = path.join(ctx.wikiRoot, `${slug}.md`);
  ensureDir(path.dirname(file));
  const raw = fs.readFileSync(chunk.file, 'utf8');
  const parsed = parseFrontmatter(raw);
  const body = parsed.body.trim();
  const title = `MassiveHistory ${ref} Pages ${span.label}`;
  const previous = chunk.chunk > 1 ? manifest.chunks[chunk.chunk - 2] : null;
  const next = chunk.chunk < manifest.chunks.length ? manifest.chunks[chunk.chunk] : null;
  const tags = reviewTags(review);
  const reviewPath = path.join(ctx.wikiRoot, `${reviewSlug(chunk)}.md`);
  const reviewLine = fs.existsSync(reviewPath) ? `- Programmatic review: ${wikiLink(reviewSlug(chunk), `Chunk ${padChunk(chunk.chunk)} review`)}` : '- Programmatic review: not generated yet.';
  const categoryLines = review?.categories
    ? Object.entries(review.categories).sort((a, b) => b[1] - a[1]).map(([category, count]) => `- ${category.replace(/_/g, '-')}: ${count}`).join('\n')
    : '- No category counts recorded.';
  const namesLine = review?.names
    ? markdownList(Object.entries(review.names).sort((a, b) => b[1] - a[1]), ([name, count]) => `${name}: ${count}`, 12)
    : '- No names extracted.';
  const systemsLine = review?.systems
    ? markdownList(Object.entries(review.systems).sort((a, b) => b[1] - a[1]), ([name, count]) => `${name}: ${count}`, 12)
    : '- No systems extracted.';
  const sourceTitle = firstHeading(body, title);
  const content = `---\ntitle: ${yamlString(title)}\ntype: massivehistory-chunk\nstatus: imported\nmassivehistory_ref: ${yamlString(ref)}\nsource_chunk: ${Number(chunk.chunk)}\nsource_pages: ${yamlString(span.label)}\nsource_file: ${yamlString(chunk.file)}\nsource_sha256_16: ${yamlString(chunk.sha256_16 || stableHash(raw))}\ntags: ${toJson(tags)}\n---\n# ${title}\n\n## Reference\n- Stable ref: \`${ref}\`\n- Wiki slug: \`${slug}\`\n- Source pages: ${span.label}\n- Source heading: ${sourceTitle}\n- Source file: \`${chunk.file}\`\n- Source SHA-16: \`${chunk.sha256_16 || stableHash(raw)}\`\n${reviewLine}\n- Previous: ${previous ? wikiLink(chunkSlug(previous), chunkRef(previous)) : 'None'}\n- Next: ${next ? wikiLink(chunkSlug(next), chunkRef(next)) : 'None'}\n\n## Review Signals\nDominant categories: ${review?.dominant_categories || 'not reviewed'}\n\n${categoryLines}\n\n## Names\n${namesLine}\n\n## Systems\n${systemsLine}\n\n## Original Chunk Text\n\n${body}\n`;
  fs.writeFileSync(file, content);
  return {
    ref,
    chunk: Number(chunk.chunk),
    slug,
    title,
    sourceTitle,
    pages: span.label,
    startPage: span.start,
    endPage: span.end,
    chars: Number(chunk.chars || raw.length),
    sha256_16: chunk.sha256_16 || stableHash(raw),
    sourceFile: chunk.file,
    reviewSlug: fs.existsSync(reviewPath) ? reviewSlug(chunk) : '',
    tags,
    dominantCategories: review?.dominant_categories || '',
  };
}

function writeIndexPage(ctx, manifest, chunkIndex, summary) {
  const file = path.join(ctx.wikiRoot, 'MassiveHistory', 'Index.md');
  ensureDir(path.dirname(file));
  const topNames = markdownList(summary.top_names || [], ([name, count]) => `${name}: ${count}`, 20);
  const topSystems = markdownList(summary.top_systems || [], ([name, count]) => `${name}: ${count}`, 20);
  const categoryCounts = summary.category_counts
    ? Object.entries(summary.category_counts).sort((a, b) => b[1] - a[1]).map(([category, count]) => `- ${category.replace(/_/g, '-')}: ${count}`).join('\n')
    : '- No category counts recorded.';
  const chunkLines = chunkIndex.map(chunk => `- \`${chunk.ref}\` ${wikiLink(chunk.slug, `pages ${chunk.pages}`)} - ${chunk.dominantCategories || 'unreviewed'}; ${chunk.chars.toLocaleString()} chars`).join('\n');
  const content = `---\ntitle: MassiveHistory Source Library\ntype: massivehistory-index\nstatus: active\ntags: [massivehistory, source-library, canon, lore, history]\n---\n# MassiveHistory Source Library\n\nMassiveHistory is now addressable from the wiki as stable chunk pages. Use refs like \`mh:0001\` in comments, cards, and future agent tasks, or link directly to a chunk page.\n\n## Source\n- Source PDF: \`${manifest.source}\`\n- Pages: ${manifest.pages}\n- Chunks: ${manifest.chunk_count}\n- Chunk source folder: \`${ctx.sourceRoot}\`\n- Machine index: \`Raw/massivehistory/massivehistory-chunk-index.json\`\n\n## Top Names\n${topNames}\n\n## Top Systems\n${topSystems}\n\n## Category Counts\n${categoryCounts}\n\n## Chunk Map\n${chunkLines}\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writeReferencePage(ctx, manifest, chunkIndex) {
  const file = path.join(ctx.wikiRoot, 'MassiveHistory', 'Reference Map.md');
  ensureDir(path.dirname(file));
  const rows = chunkIndex.map(chunk => `| \`${chunk.ref}\` | ${wikiLink(chunk.slug, chunk.pages)} | ${chunk.dominantCategories || ''} | ${chunk.sourceTitle.replace(/\|/g, '/')} |`).join('\n');
  const content = `---\ntitle: MassiveHistory Reference Map\ntype: massivehistory-reference-map\nstatus: active\ntags: [massivehistory, references, source-map]\n---\n# MassiveHistory Reference Map\n\n| Ref | Pages | Categories | Source Heading |\n| --- | --- | --- | --- |\n${rows}\n\n## API\nThe Wiki Ops API exposes this same data at \`GET /api/massivehistory/chunks\` once \`npm run wikiops:serve\` is running.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function writeProtocolNote(ctx) {
  const file = path.join(ctx.wikiRoot, 'Development', 'MassiveHistory Integration Protocol.md');
  ensureDir(path.dirname(file));
  const content = `---\ntitle: MassiveHistory Integration Protocol\ntype: protocol\nstatus: active\ntags: [massivehistory, wiki, comments, protocol]\n---\n# MassiveHistory Integration Protocol\n\nMassiveHistory chunks are imported as normal wiki pages so humans and agents can read, link, comment, append, and flag work against them through Wiki Ops.\n\n## Stable Addressing\n- Reference id: \`mh:####\`\n- Wiki slug pattern: \`MassiveHistory/Chunks/mh-####-pSTART-END\`\n- Machine index: \`Raw/massivehistory/massivehistory-chunk-index.json\`\n\n## Commenting Guidance\nUse \`open-question\` for unresolved lore/canon questions, \`source-needed\` for attribution/citation gaps, \`canon-risk\` for contradictions, and \`helpful-append\` for extracted text that should be promoted into a curated wiki article.\n`;
  fs.writeFileSync(file, content);
  return file;
}

function importChunks(ctx) {
  const manifest = loadManifest(ctx);
  const reviews = loadReviewMap(ctx);
  const summary = loadSummary(ctx);
  const chunkIndex = [];
  for (const chunk of manifest.chunks || []) {
    chunkIndex.push(writeChunkPage(ctx, manifest, chunk, reviews.get(Number(chunk.chunk))));
  }
  const indexPage = writeIndexPage(ctx, manifest, chunkIndex, summary);
  const referencePage = writeReferencePage(ctx, manifest, chunkIndex);
  const protocolPage = writeProtocolNote(ctx);
  const payload = {
    generatedAt: now(),
    source: manifest.source,
    sourceRoot: ctx.sourceRoot,
    pages: manifest.pages,
    chunkCount: manifest.chunk_count,
    chunks: chunkIndex,
  };
  const out = path.join(ctx.rawRoot, 'massivehistory-chunk-index.json');
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  return {
    chunks: chunkIndex.length,
    indexPage,
    referencePage,
    protocolPage,
    machineIndex: out,
  };
}

function getStatus(ctx) {
  const machineIndex = path.join(ctx.rawRoot, 'massivehistory-chunk-index.json');
  const payload = readJson(machineIndex, { chunks: [] });
  return {
    wikiRoot: ctx.wikiRoot,
    sourceRoot: ctx.sourceRoot,
    manifestPath: ctx.manifestPath,
    machineIndex,
    importedChunks: payload.chunks?.length || 0,
    sourceChunks: fs.existsSync(ctx.manifestPath) ? loadManifest(ctx).chunks.length : 0,
  };
}

async function main() {
  const args = parseArgs();
  const command = args._[0] || 'status';
  const ctx = createContext({ wikiRoot: args['wiki-root'], sourceRoot: args.path || args['source-root'], manifest: args.manifest });
  let result;
  if (command === 'import') result = importChunks(ctx);
  else if (command === 'status') result = getStatus(ctx);
  else throw new Error(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  createContext,
  parseArgs,
  loadManifest,
  chunkRef,
  chunkSlug,
  importChunks,
  getStatus,
};
