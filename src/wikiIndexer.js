const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
const MARKDOWN_VIDEO_LINK_RE = /\[([^\]\n]*)\]\(([^)\n]+\.(?:mp4|mov|webm)(?:#[^)\n]*)?)\)/gi;
const HTML_VIDEO_SRC_RE = /<(?:video|source)\b[^>]*\bsrc=["']([^"']+\.(?:mp4|mov|webm)(?:#[^"']*)?)["'][^>]*>/gi;

function normalizeSlug(relativePath) {
  return relativePath.replace(/\\/g, '/').replace(/\.md$/i, '');
}

function titleFromSlug(slug) {
  return slug.split('/').pop().replace(/[-_]/g, ' ');
}

function parseScalar(value) {
  value = String(value || '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(v => parseScalar(v)).filter(Boolean);
  }
  return value;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: raw };
  const yaml = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const data = {};
  let currentListKey = null;
  for (const line of yaml.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      if (!Array.isArray(data[currentListKey])) data[currentListKey] = [];
      data[currentListKey].push(parseScalar(listItem[1]));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) { currentListKey = null; continue; }
    currentListKey = null;
    const key = match[1];
    const rawValue = match[2].trim();
    if (rawValue === '') { data[key] = []; currentListKey = key; }
    else data[key] = parseScalar(rawValue);
  }
  return { data, body };
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map(v => v.trim()).filter(Boolean);
}

const ARTIFACT_STOP_WORDS = new Set('the,and,for,that,with,this,from,into,about,what,when,where,which,while,will,have,has,are,was,were,you,your,our,out,how,why,not,can,its,his,her,they,them,then,than,over,under,after,before,video,image,audio,artifact,metadata,source,notes,note,html,json,type'.split(','));

function tokenize(value) {
  const counts = new Map();
  for (const raw of String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (ARTIFACT_STOP_WORDS.has(raw)) continue;
    if (isNoiseArtifactTerm(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return counts;
}

function isNoiseArtifactTerm(term) {
  const value = String(term || '').toLowerCase();
  if (value.length < 4) return true;
  if (/^[0-9a-f]{4,}$/i.test(value)) return true;
  if (/^[0-9a-f]{4,}-[0-9a-f-]{8,}$/i.test(value)) return true;
  const digitCount = (value.match(/\d/g) || []).length;
  if (digitCount >= 2 && !/[aeiou]/.test(value)) return true;
  return false;
}

function scoreTokenMaps(sourceCounts, targetCounts) {
  let score = 0;
  for (const [term, count] of sourceCounts) {
    if (!targetCounts.has(term)) continue;
    score += Math.min(count, 4) * (1 + Math.min(targetCounts.get(term), 3));
  }
  return score;
}

function loadArtifactMediaIndex(root) {
  const mediaIndexPath = path.join(root, 'Raw', 'Artifacts', 'artifact-media-index.json');
  if (!fs.existsSync(mediaIndexPath)) return { mediaIndexPath, generatedAt: '', stats: { assets: 0 }, assets: [] };
  try {
    const payload = JSON.parse(fs.readFileSync(mediaIndexPath, 'utf8'));
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    return {
      mediaIndexPath,
      generatedAt: payload.generatedAt || '',
      stats: payload.stats || { assets: assets.length },
      assets: assets.map(asset => {
        const thumbAbs = asset.thumbnailPath ? path.join(root, asset.thumbnailPath) : '';
        return {
          ...asset,
          thumbnailUrl: asset.thumbnailUrl || (thumbAbs && fs.existsSync(thumbAbs) ? pathToFileURL(thumbAbs).href : ''),
          sourceUrl: asset.sourceUrl || (asset.sourcePath ? pathToFileURL(asset.sourcePath).href : ''),
        };
      }),
    };
  } catch {
    return { mediaIndexPath, generatedAt: '', stats: { assets: 0 }, assets: [] };
  }
}

function attachArtifactAugmentations(index) {
  const artifactIndex = loadArtifactMediaIndex(index.root);
  const mediaAssets = artifactIndex.assets.filter(asset => ['image', 'video'].includes(asset.kind));
  const scoredAssets = mediaAssets.map(asset => ({
    asset,
    terms: tokenize(`${asset.title || ''} ${asset.sourceGroup || ''} ${asset.collectionTitle || ''} ${(asset.tags || []).join(' ')} ${asset.summary || ''} ${asset.relPath || ''}`),
  }));
  let augmentedPages = 0;
  for (const slug of index.orderedSlugs) {
    const page = index.pages[slug];
    const pageTerms = tokenize(`${page.title} ${page.slug} ${page.section} ${page.kind} ${page.tags.join(' ')} ${page.topics.join(' ')} ${page.summary}`);
    const matches = [];
    for (const item of scoredAssets) {
      const score = scoreTokenMaps(pageTerms, item.terms);
      if (score <= 0) continue;
      matches.push({ ...item.asset, score });
    }
    matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    page.artifactMatches = matches.slice(0, 6);
    if (page.artifactMatches.length) augmentedPages += 1;
  }
  index.artifacts = {
    mediaIndexPath: artifactIndex.mediaIndexPath,
    generatedAt: artifactIndex.generatedAt,
    stats: artifactIndex.stats,
  };
  index.stats.artifactAssets = artifactIndex.stats.assets || mediaAssets.length;
  index.stats.artifactAugmentedPages = augmentedPages;
}

function loadHapaMusicIndex(root) {
  const candidates = [
    path.join(root, 'Raw', 'Music', 'hapa-music-page-index.json'),
    path.join(root, 'Raw', 'Music', 'hapa-music-index.json'),
  ];
  for (const musicIndexPath of candidates) {
    if (!fs.existsSync(musicIndexPath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(musicIndexPath, 'utf8'));
      const songs = Array.isArray(payload.songs) ? payload.songs : [];
      return {
        musicIndexPath,
        generatedAt: payload.generatedAt || '',
        stats: payload.stats || { songs: songs.length },
        songs: songs.map(song => ({
          ...song,
          audioUrl: song.audioUrl || (song.localPath && fs.existsSync(song.localPath) ? pathToFileURL(song.localPath).href : ''),
          imageUrl: song.imageUrl || '',
        })),
      };
    } catch {
      return { musicIndexPath, generatedAt: '', stats: { songs: 0 }, songs: [] };
    }
  }
  return { musicIndexPath: candidates[0], generatedAt: '', stats: { songs: 0 }, songs: [] };
}

function attachHapaMusicAugmentations(index) {
  const musicIndex = loadHapaMusicIndex(index.root);
  const songs = musicIndex.songs.filter(song => song.localPath || song.audioUrl);
  const scoredSongs = songs.map(song => ({
    song,
    terms: tokenize(`${song.title || ''} ${song.lyricMasterTitle || ''} ${song.tags || ''} ${(song.topics || []).join(' ')} ${(song.pageSlugs || []).join(' ')} ${song.lyricExcerpt || ''} ${song.explanation || ''}`),
  }));
  let musicAugmentedPages = 0;
  for (const slug of index.orderedSlugs) {
    const page = index.pages[slug];
    const direct = songs.filter(song => (song.pageSlugs || []).includes(slug));
    const pageTerms = tokenize(`${page.title} ${page.slug} ${page.section} ${page.kind} ${page.tags.join(' ')} ${page.topics.join(' ')} ${page.summary}`);
    const matches = [];
    for (const item of scoredSongs) {
      const directBonus = (item.song.pageSlugs || []).includes(slug) ? 100 : 0;
      const score = directBonus + scoreTokenMaps(pageTerms, item.terms);
      if (score < 60 && !directBonus) continue;
      matches.push({ ...item.song, score });
    }
    for (const song of direct) {
      if (!matches.some(match => match.id === song.id)) matches.push({ ...song, score: 100 });
    }
    matches.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)));
    page.musicMatches = matches.slice(0, 5);
    if (page.musicMatches.length) musicAugmentedPages += 1;
  }
  index.music = {
    musicIndexPath: musicIndex.musicIndexPath,
    generatedAt: musicIndex.generatedAt,
    stats: musicIndex.stats,
  };
  index.stats.musicSongs = musicIndex.stats.songs || songs.length;
  index.stats.musicAugmentedPages = musicAugmentedPages;
}

function pageKind(relative, data) {
  const section = relative.includes('/') ? relative.split('/')[0] : 'Root';
  if (data.card_id || data.retrieval_id || /\/Cards\//.test('/' + relative)) return 'Card';
  if (section === 'Nodes') return 'Node';
  if (section === 'Names') return 'Name';
  if (section === 'Canon') return 'Canon';
  if (section === 'Systems') return 'System';
  if (section === 'Development') return 'Development';
  if (section === 'MassiveHistory') return 'MassiveHistory';
  if (section === 'Notebook Reviews') return 'Notebook Review';
  return data.type || section;
}

function walkMarkdown(rootDir) {
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

function extractWikiLinks(body) {
  const links = [];
  let match;
  while ((match = WIKILINK_RE.exec(body))) {
    const raw = match[1].trim();
    const [targetPart, aliasPart] = raw.split('|');
    const target = targetPart.trim().replace(/\.md$/i, '');
    links.push({ raw, target, alias: aliasPart ? aliasPart.trim() : '' });
  }
  return links;
}

function extractMarkdownImages(body) {
  const images = [];
  let match;
  while ((match = MARKDOWN_IMAGE_RE.exec(body))) {
    const alt = match[1].trim();
    const rawSrc = match[2].trim();
    const src = rawSrc.split(/\s+(?=(?:"[^"]*"|'[^']*')$)/)[0].trim();
    if (!src) continue;
    images.push({ alt, src });
  }
  return images;
}

function extractMarkdownVideos(body) {
  const videos = [];
  const seen = new Set();
  let match;
  while ((match = MARKDOWN_VIDEO_LINK_RE.exec(body))) {
    const title = match[1].trim();
    const rawSrc = match[2].trim();
    const src = rawSrc.split(/\s+(?=(?:"[^"]*"|'[^']*')$)/)[0].trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    videos.push({ title, src });
  }
  while ((match = HTML_VIDEO_SRC_RE.exec(body))) {
    const src = match[1].trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    videos.push({ title: src.split('/').pop() || 'Video', src });
  }
  return videos;
}

function resolveWikiLink(rawTarget, fromSlug, index) {
  const target = rawTarget.split('|')[0].trim().replace(/\.md$/i, '');
  if (!target) return null;
  if (index.pages[target]) return target;

  const fromDir = fromSlug.includes('/') ? fromSlug.split('/').slice(0, -1).join('/') : '';
  const relative = fromDir ? `${fromDir}/${target}` : target;
  if (index.pages[relative]) return relative;

  const lower = target.toLowerCase();
  if (index.slugByLower[lower]) return index.slugByLower[lower];

  const base = target.split('/').pop().toLowerCase();
  if (index.slugByBasename[base] && index.slugByBasename[base].length === 1) return index.slugByBasename[base][0];
  return null;
}

function buildWikiIndex(rootDir) {
  const root = path.resolve(rootDir);
  const files = walkMarkdown(root);
  const index = {
    root,
    generatedAt: new Date().toISOString(),
    pages: {},
    orderedSlugs: [],
    slugByLower: {},
    slugByBasename: {},
    cards: [],
    graph: { nodes: [], edges: [] },
    facets: { sections: {}, kinds: {}, types: {}, statuses: {}, tags: {}, cardTopics: {} },
    stats: { markdownFiles: files.length, links: 0, backlinks: 0, cards: 0, images: 0, videos: 0 }
  };

  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const slug = normalizeSlug(relative);
    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = data.title || heading || titleFromSlug(slug);
    const text = body.replace(WIKILINK_RE, '$1').replace(/[#>*_`\-\[\]()]/g, ' ');
    const kind = pageKind(relative, data);
    const section = slug.includes('/') ? slug.split('/')[0] : 'Root';
    const tags = asArray(data.tags);
    const topics = asArray(data.topics);
    const images = extractMarkdownImages(body);
    const videos = extractMarkdownVideos(body);
    const cover = data.cover_image || data.cover || data.image || data.thumbnail || images[0]?.src || '';
    const page = {
      slug,
      path: file,
      relativePath: relative,
      section,
      kind,
      title,
      frontmatter: data,
      tags,
      topics,
      status: data.status || '',
      type: data.type || '',
      body,
      raw,
      links: extractWikiLinks(body),
      images,
      videos,
      cover,
      backlinks: [],
      summary: body.replace(/\s+/g, ' ').trim().slice(0, 280),
      searchText: `${title} ${slug} ${kind} ${section} ${tags.join(' ')} ${topics.join(' ')} ${JSON.stringify(data)} ${text}`.toLowerCase()
    };
    index.pages[slug] = page;
    index.orderedSlugs.push(slug);
    index.slugByLower[slug.toLowerCase()] = slug;
    const base = slug.split('/').pop().toLowerCase();
    if (!index.slugByBasename[base]) index.slugByBasename[base] = [];
    index.slugByBasename[base].push(slug);
    const bump = (bucket, key) => { if (key) bucket[key] = (bucket[key] || 0) + 1; };
    bump(index.facets.sections, section);
    bump(index.facets.kinds, kind);
    bump(index.facets.types, data.type || '');
    bump(index.facets.statuses, data.status || '');
    for (const tag of tags) bump(index.facets.tags, tag);
    for (const topic of topics) bump(index.facets.cardTopics, topic);
    if (data.card_id || data.retrieval_id || /\/Cards\//.test('/' + relative)) {
      index.cards.push({
        slug,
        title,
        card_id: data.card_id || '',
        retrieval_id: data.retrieval_id || '',
        type: data.type || data.card_type || '',
        media_kind: data.media_kind || '',
        parent_card_id: data.parent_card_id || '',
        topics,
        tags,
        status: data.status || '',
        section,
        kind,
        summary: page.summary,
        cover,
        imageCount: images.length,
        videoCount: videos.length,
      });
    }
  }

  for (const slug of index.orderedSlugs) {
    const page = index.pages[slug];
    for (const link of page.links) {
      const resolved = resolveWikiLink(link.raw, slug, index);
      link.resolved = resolved;
      if (resolved && index.pages[resolved]) {
        index.pages[resolved].backlinks.push({ source: slug, title: page.title, alias: link.alias || '' });
        index.graph.edges.push({ source: slug, target: resolved, label: link.alias || 'wikilink' });
      }
    }
  }

  index.graph.nodes = index.orderedSlugs.map(slug => ({ id: slug, label: index.pages[slug].title, group: slug.split('/')[0] || 'Root' }));
  index.stats.links = index.orderedSlugs.reduce((n, slug) => n + index.pages[slug].links.length, 0);
  index.stats.backlinks = index.orderedSlugs.reduce((n, slug) => n + index.pages[slug].backlinks.length, 0);
  index.stats.images = index.orderedSlugs.reduce((n, slug) => n + index.pages[slug].images.length, 0);
  index.stats.videos = index.orderedSlugs.reduce((n, slug) => n + (index.pages[slug].videos || []).length, 0);
  index.stats.cards = index.cards.length;
  attachArtifactAugmentations(index);
  attachHapaMusicAugmentations(index);
  return index;
}

module.exports = { buildWikiIndex, resolveWikiLink, normalizeSlug, parseFrontmatter, extractWikiLinks, extractMarkdownImages, extractMarkdownVideos, pageKind, asArray, loadArtifactMediaIndex, attachArtifactAugmentations, loadHapaMusicIndex, attachHapaMusicAugmentations };
