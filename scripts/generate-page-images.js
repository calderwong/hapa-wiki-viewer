#!/usr/bin/env node
/*
 * Resumable page-image generator for the Hapa Worldbuilding Wiki.
 *
 * Examples:
 *   npm run images:plan
 *   npm run images:generate -- --provider hapa-ltx --limit 10 --apply
 *   npm run images:generate -- --provider openai --section Canon --limit 3
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { buildWikiIndex } = require('../src/wikiIndexer');

const DEFAULT_WIKI_ROOT = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const VISUAL_ROOT_RELATIVE = 'Assets/Visuals/Page Heroes';
const MANIFEST_NAME = 'page-image-manifest.json';
const DEFAULT_LTX_MODEL = 'baidu/ERNIE-Image-Turbo';
const DEFAULT_OPENAI_IMAGE_MODEL = 'chatgpt-image-latest';

function parseArgs(argv) {
  const args = {
    wiki: process.env.HAPA_WIKI_PATH || DEFAULT_WIKI_ROOT,
    provider: 'dry-run',
    limit: 25,
    section: '',
    slug: '',
    apply: false,
    includeExisting: false,
    force: false,
    width: 1024,
    height: 1024,
    timeoutMs: 20 * 60_000,
    pollMs: 2000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === '--wiki') { args.wiki = next; i += 1; }
    else if (item === '--provider') { args.provider = next; i += 1; }
    else if (item === '--limit') { args.limit = Number.parseInt(next, 10); i += 1; }
    else if (item === '--section') { args.section = next; i += 1; }
    else if (item === '--slug') { args.slug = next; i += 1; }
    else if (item === '--width') { args.width = Number.parseInt(next, 10); i += 1; }
    else if (item === '--height') { args.height = Number.parseInt(next, 10); i += 1; }
    else if (item === '--timeout-ms') { args.timeoutMs = Number.parseInt(next, 10); i += 1; }
    else if (item === '--poll-ms') { args.pollMs = Number.parseInt(next, 10); i += 1; }
    else if (item === '--apply') args.apply = true;
    else if (item === '--include-existing') args.includeExisting = true;
    else if (item === '--force') args.force = true;
    else if (item === '--dry-run') args.provider = 'dry-run';
    else if (item === '--all') args.limit = 0;
    else if (item === '--help' || item === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!['dry-run', 'hapa-ltx', 'openai'].includes(args.provider)) {
    throw new Error(`Unsupported provider: ${args.provider}. Use dry-run, hapa-ltx, or openai.`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = 25;
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/generate-page-images.js [options]

Options:
  --provider dry-run|hapa-ltx|openai   Provider to use. Default: dry-run
  --limit N                            Max pages this run. Use --all for no cap. Default: 25
  --section NAME                       Restrict to a top-level wiki section
  --slug SLUG                          Generate one specific page slug
  --apply                              Insert generated image into the Markdown page
  --include-existing                   Include pages that already have Markdown images
  --force                              Regenerate even if manifest says succeeded
  --width N --height N                 Output size request. Default: 1024x1024
  --wiki PATH                          Wiki root. Default: ${DEFAULT_WIKI_ROOT}

Environment:
  HAPA_LTX_NODE_BASE_URL / HAPA_LTX_NODE_TOKEN / HAPA_LTX_NODE_TOKEN_FILE
  OPENAI_API_KEY / HAPA_OPENAI_API_KEY / saved Hapa openaiKey
  HAPA_WIKI_IMAGE_OPENAI_MODEL         Default: ${DEFAULT_OPENAI_IMAGE_MODEL}
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha(value, len = 10) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len);
}

function slugToFileStem(slug) {
  const base = String(slug || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'page';
  return `${base}-${sha(slug, 8)}`;
}

function stripMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)]]/g, '$2')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/[#>*_`~|[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(page) {
  const frontmatter = page.frontmatter || {};
  const tags = Array.isArray(page.tags) ? page.tags.slice(0, 10).join(', ') : '';
  const topics = Array.isArray(page.topics) ? page.topics.slice(0, 10).join(', ') : '';
  const context = stripMarkdown(page.body).slice(0, 1800);
  const status = page.status || frontmatter.status || 'unspecified';
  const type = page.type || frontmatter.type || page.kind || 'wiki page';

  return [
    'Create one square hero image for a Hapa Worldbuilding Wiki page.',
    'The image should be page-specific, symbolic, polished, and useful as a wiki visual.',
    'Do not include readable text, letters, UI screenshots, logos, watermarks, or captions inside the image.',
    'Use a refined dark-mode Hapa visual language: luminous local-first knowledge nodes, precise diagram geometry, warm gold, cool blue, green signal accents, subtle violet depth, premium editorial explainer art.',
    `Page title: ${page.title}.`,
    `Wiki slug: ${page.slug}.`,
    `Section: ${page.section}. Kind/type: ${page.kind} / ${type}. Status: ${status}.`,
    tags ? `Tags: ${tags}.` : '',
    topics ? `Topics: ${topics}.` : '',
    `Page context: ${context}`,
  ].filter(Boolean).join('\n');
}

function getOpenAIKey() {
  const direct = process.env.OPENAI_API_KEY || process.env.HAPA_OPENAI_API_KEY;
  if (direct && direct.trim()) return direct.trim();
  try {
    const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'hapa-ag', 'config.json');
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof data.openaiKey === 'string' && data.openaiKey.trim()) return data.openaiKey.trim();
  } catch {
    // ignore
  }
  throw new Error('OpenAI key not found. Set OPENAI_API_KEY/HAPA_OPENAI_API_KEY or save one in Hapa Settings.');
}

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
}

function getLtxConfig() {
  const baseUrl = (process.env.HAPA_LTX_NODE_BASE_URL || 'http://127.0.0.1:8753').replace(/\/+$/, '');
  let token = normalizeToken(process.env.HAPA_LTX_NODE_TOKEN);
  if (!token && process.env.HAPA_LTX_NODE_TOKEN_FILE) {
    token = normalizeToken(fs.readFileSync(process.env.HAPA_LTX_NODE_TOKEN_FILE, 'utf8'));
  }
  if (!token) {
    const candidates = [
      path.join(os.homedir(), 'Documents', 'Codex', '2026-05-19', 'thoroughly-review-the-hapa-worldbuilding-wiki', 'hapa-ltx-node', '.node_token'),
      path.join(os.homedir(), 'Desktop', 'hapa-ltx-node', '.node_token'),
      path.join(os.homedir(), 'hapa-ltx-node', '.node_token'),
    ];
    for (const candidate of candidates) {
      try {
        token = normalizeToken(fs.readFileSync(candidate, 'utf8'));
        if (token) break;
      } catch {
        // continue
      }
    }
  }
  if (!token) throw new Error('Hapa LTX node token not found.');
  return { baseUrl, token };
}

async function ltxRequest(method, pathname, body, timeoutMs = 60_000) {
  const { baseUrl, token } = getLtxConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`Hapa LTX ${res.status}: ${json.detail || json.error || text}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithHapaLtx(prompt, outputPath, page, args) {
  const created = await ltxRequest('POST', '/v1/jobs', {
    mode: 'text-to-image',
    prompt,
    negative_prompt: 'readable text, letters, logo, watermark, blurry, low quality, crowded layout',
    backend: 'ernie_image_diffusers',
    ernie_model: DEFAULT_LTX_MODEL,
    width: args.width,
    height: args.height,
    image_steps: 8,
    image_guidance: 1,
    low_ram: true,
    use_prompt_enhancer: true,
    project: 'hapa-wiki',
    tags: ['hapa-wiki', 'page-hero', page.section, page.kind].filter(Boolean),
    metadata: {
      wiki_slug: page.slug,
      wiki_title: page.title,
      workflow: 'hapa-wiki-page-hero',
    },
  });

  const start = Date.now();
  let job = created;
  while (Date.now() - start < args.timeoutMs) {
    job = await ltxRequest('GET', `/v1/jobs/${encodeURIComponent(created.id)}`, null, 30_000);
    const status = String(job.status || '').toLowerCase();
    if (status === 'succeeded') break;
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Hapa LTX job ${status}: ${typeof job.error === 'string' ? job.error : JSON.stringify(job.error || {})}`);
    }
    await new Promise(resolve => setTimeout(resolve, args.pollMs));
  }

  if (String(job.status || '').toLowerCase() !== 'succeeded') {
    throw new Error(`Hapa LTX job timed out: ${created.id}`);
  }

  const assets = Array.isArray(job.output_assets) ? job.output_assets : [];
  const asset = assets.find(a => a.media_type === 'image' && typeof a.path === 'string') || assets.find(a => typeof a.path === 'string');
  const sourcePath = asset?.path || job.artifact_path;
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`Hapa LTX job did not return a readable image path: ${created.id}`);
  fs.copyFileSync(sourcePath, outputPath);
  return { jobId: created.id, returnedModel: job.model || DEFAULT_LTX_MODEL, sourcePath };
}

async function generateWithOpenAI(prompt, outputPath) {
  const apiKey = getOpenAIKey();
  const model = process.env.HAPA_WIKI_IMAGE_OPENAI_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1024x1024' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI Images ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI Images response did not include b64_json`);
  fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
  return { returnedModel: model };
}

function imageMarkdown(relativeImagePath, page) {
  return `![${page.title} hero image](${relativeImagePath})`;
}

function applyImageToMarkdown(page, relativeImagePath) {
  const markdown = fs.readFileSync(page.path, 'utf8');
  if (markdown.includes(relativeImagePath)) return false;
  const image = imageMarkdown(relativeImagePath, page);
  const lines = markdown.split(/\r?\n/);
  const h1 = lines.findIndex(line => /^#\s+/.test(line));
  if (h1 >= 0) {
    lines.splice(h1 + 1, 0, '', image);
    fs.writeFileSync(page.path, lines.join('\n'));
    return true;
  }

  fs.writeFileSync(page.path, `${image}\n\n${markdown}`);
  return true;
}

function makeManifest(wikiRoot, existing = {}) {
  return {
    version: 1,
    wikiRoot,
    updatedAt: new Date().toISOString(),
    entries: existing.entries || {},
  };
}

function selectPages(index, manifest, args) {
  let pages = index.orderedSlugs.map(slug => index.pages[slug]).filter(Boolean);
  if (args.slug) pages = pages.filter(page => page.slug === args.slug);
  if (args.section) pages = pages.filter(page => page.section === args.section);
  if (!args.includeExisting) pages = pages.filter(page => !page.images?.length);
  if (!args.force) {
    pages = pages.filter(page => {
      const entry = manifest.entries[page.slug];
      return !(entry?.status === 'succeeded' && entry?.imagePath && fs.existsSync(entry.imagePath));
    });
  }
  return args.limit > 0 ? pages.slice(0, args.limit) : pages;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wikiRoot = path.resolve(args.wiki);
  const visualRoot = path.join(wikiRoot, VISUAL_ROOT_RELATIVE);
  ensureDir(visualRoot);
  const manifestPath = path.join(visualRoot, MANIFEST_NAME);
  const manifest = makeManifest(wikiRoot, readJson(manifestPath, {}));

  const index = buildWikiIndex(wikiRoot);
  const pages = selectPages(index, manifest, args);
  console.log(`Provider: ${args.provider}`);
  console.log(`Wiki pages: ${index.orderedSlugs.length}; pages selected this run: ${pages.length}`);
  console.log(`Manifest: ${manifestPath}`);

  let completed = 0;
  let failed = 0;

  for (const page of pages) {
    const stem = slugToFileStem(page.slug);
    const imagePath = path.join(visualRoot, `${stem}.png`);
    const promptPath = path.join(visualRoot, `${stem}.prompt.txt`);
    const relativeImagePath = path.relative(path.dirname(page.path), imagePath).replace(/\\/g, '/');
    const prompt = buildPrompt(page);
    fs.writeFileSync(promptPath, `${prompt}\n`);

    const entry = {
      slug: page.slug,
      title: page.title,
      section: page.section,
      kind: page.kind,
      provider: args.provider,
      promptPath,
      imagePath,
      relativeImagePath,
      sourceHash: sha(`${page.title}\n${page.body}`, 16),
      updatedAt: new Date().toISOString(),
    };

    try {
      if (args.provider === 'dry-run') {
        entry.status = 'planned';
      } else if (args.provider === 'hapa-ltx') {
        Object.assign(entry, await generateWithHapaLtx(prompt, imagePath, page, args));
        entry.status = 'succeeded';
      } else if (args.provider === 'openai') {
        Object.assign(entry, await generateWithOpenAI(prompt, imagePath));
        entry.status = 'succeeded';
      }

      if (entry.status === 'succeeded' && args.apply) {
        entry.markdownApplied = applyImageToMarkdown(page, relativeImagePath);
      }
      completed += 1;
      console.log(`[${completed}/${pages.length}] ${entry.status}: ${page.slug}`);
    } catch (error) {
      failed += 1;
      entry.status = 'failed';
      entry.error = error?.message || String(error);
      console.error(`[${completed + failed}/${pages.length}] failed: ${page.slug}: ${entry.error}`);
    }

    manifest.entries[page.slug] = entry;
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, manifest);
  }

  const successes = Object.values(manifest.entries).filter(entry => entry.status === 'succeeded').length;
  const planned = Object.values(manifest.entries).filter(entry => entry.status === 'planned').length;
  const failures = Object.values(manifest.entries).filter(entry => entry.status === 'failed').length;
  console.log(`Done. Completed this run: ${completed}; failed this run: ${failed}; manifest totals: ${successes} succeeded, ${planned} planned, ${failures} failed.`);
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
