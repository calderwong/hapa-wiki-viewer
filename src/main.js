const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { marked } = require('marked');
const { buildWikiIndex } = require('./wikiIndexer');
const wikiOps = require('../scripts/wiki-ops');

const DEFAULT_WIKI_PATH = '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
let currentWikiPath = process.env.HAPA_WIKI_PATH || DEFAULT_WIKI_PATH;
let currentIndex = null;
let mainWindow = null;
const cardWindows = new Map();

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    title: 'Hapa Wiki Viewer',
    backgroundColor: '#090b12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer gone]', details);
  });
  win.webContents.on('unresponsive', () => {
    console.error('[window unresponsive] renderer stopped responding');
  });
  win.webContents.on('responsive', () => {
    console.log('[window responsive] renderer recovered');
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadFile(path.join(__dirname, 'renderer.html'));
}

function createCardWindow(slug) {
  if (!slug) return false;
  const existing = cardWindows.get(slug);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return true;
  }

  const title = currentIndex?.pages?.[slug]?.title || slug;
  const win = new BrowserWindow({
    width: 980,
    height: 1120,
    minWidth: 720,
    minHeight: 640,
    title: `Hapa Card - ${title}`,
    backgroundColor: '#090b12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  cardWindows.set(slug, win);
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[card-window:${level}] ${message} (${sourceId}:${line})`);
  });
  win.on('closed', () => {
    if (cardWindows.get(slug) === win) cardWindows.delete(slug);
  });
  win.loadFile(path.join(__dirname, 'renderer.html'), {
    query: { mode: 'card', slug }
  });
  return true;
}

function safeBuildIndex(wikiPath = currentWikiPath) {
  if (!fs.existsSync(wikiPath)) throw new Error(`Wiki folder not found: ${wikiPath}`);
  currentWikiPath = wikiPath;
  currentIndex = buildWikiIndex(wikiPath);
  return sanitizeIndex(currentIndex);
}

function wikiOpsContext() {
  return wikiOps.createContext({ wikiRoot: currentWikiPath });
}

function sanitizePageRecord(p) {
  const firstImage = p.cover || p.images?.[0]?.src || '';
  const firstVideo = p.videos?.[0]?.src || '';
  const artifactCover = p.artifactMatches?.find(asset => asset.thumbnailUrl)?.thumbnailUrl || '';
  return {
    slug: p.slug, relativePath: p.relativePath, title: p.title, frontmatter: p.frontmatter,
    links: p.links, images: p.images, videos: p.videos || [], backlinks: p.backlinks, summary: p.summary,
    section: p.section, kind: p.kind, status: p.status, searchText: p.searchText,
    cover: p.cover || '',
    coverUrl: firstImage ? resolveMarkdownAssetSrc(firstImage, p.slug) : artifactCover,
    videoUrl: firstVideo ? resolveMarkdownAssetSrc(firstVideo, p.slug) : '',
    artifactMatches: p.artifactMatches || [],
    musicMatches: p.musicMatches || []
  };
}

function sanitizeCardRecord(card) {
  const page = currentIndex.pages[card.slug];
  const firstImage = card.cover || page?.cover || page?.images?.[0]?.src || '';
  const firstVideo = page?.videos?.[0]?.src || '';
  const artifactCover = page?.artifactMatches?.find(asset => asset.thumbnailUrl)?.thumbnailUrl || '';
  return {
    ...card,
    coverUrl: firstImage ? resolveMarkdownAssetSrc(firstImage, card.slug) : artifactCover,
    videoUrl: firstVideo ? resolveMarkdownAssetSrc(firstVideo, card.slug) : '',
    artifactCount: page?.artifactMatches?.length || 0,
  };
}

function syntheticCardFromPage(page) {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary || '',
    card_id: page.frontmatter?.card_id || '',
    retrieval_id: page.frontmatter?.retrieval_id || '',
    type: page.frontmatter?.type || page.kind || 'Card',
    status: page.status || page.frontmatter?.status || '',
    parent_card_id: page.frontmatter?.parent_card_id || '',
    topics: page.frontmatter?.topics || [],
    tags: page.frontmatter?.tags || [],
    cover: page.cover || '',
    imageCount: page.images?.length || 0,
    videoCount: page.videos?.length || 0,
  };
}

function sanitizeIndex(index) {
  return {
    root: index.root,
    generatedAt: index.generatedAt,
    orderedSlugs: index.orderedSlugs,
    pages: Object.fromEntries(Object.entries(index.pages).map(([slug, p]) => [slug, sanitizePageRecord(p)])),
    cards: index.cards.map(sanitizeCardRecord),
    graph: index.graph,
    stats: index.stats,
    facets: index.facets,
    artifacts: index.artifacts || null,
    music: index.music || null
  };
}

function safeCardWindowIndex(slug) {
  if (!currentIndex) safeBuildIndex();
  const page = currentIndex.pages[slug];
  if (!page) throw new Error(`Card page not found: ${slug}`);
  const relatedSlugs = new Set([slug]);
  for (const link of page.links || []) if (link.resolved && currentIndex.pages[link.resolved]) relatedSlugs.add(link.resolved);
  for (const backlink of page.backlinks || []) if (backlink.source && currentIndex.pages[backlink.source]) relatedSlugs.add(backlink.source);

  const pages = {};
  for (const relatedSlug of relatedSlugs) {
    pages[relatedSlug] = sanitizePageRecord(currentIndex.pages[relatedSlug]);
  }
  const rawCard = currentIndex.cards.find(card => card.slug === slug) || syntheticCardFromPage(page);
  return {
    root: currentIndex.root,
    generatedAt: currentIndex.generatedAt,
    orderedSlugs: [...relatedSlugs],
    pages,
    cards: [sanitizeCardRecord(rawCard)],
    graph: { nodes: [], edges: [] },
    stats: currentIndex.stats,
    facets: { sections: {}, kinds: {}, types: {}, statuses: {}, tags: {}, cardTopics: {} },
    artifacts: null,
    music: currentIndex.music || null
  };
}

function wikiLinkToMarkdown(_match, rawTarget, alias) {
  const target = rawTarget.trim().replace(/\.md$/i, '');
  const aliasText = typeof alias === 'string' ? alias : '';
  const label = (aliasText || target.split('/').pop() || target).trim();
  return `[${label}](hapa-wiki:${encodeURIComponent(target)})`;
}

function resolveMarkdownAssetSrc(src, fromSlug = '') {
  const raw = String(src || '').trim();
  if (!raw || /^(?:https?:|data:|file:|hapa-wiki:)/i.test(raw)) return raw;
  if (!currentIndex) safeBuildIndex();

  const withoutHash = raw.split('#')[0];
  const hash = raw.includes('#') ? `#${raw.split('#').slice(1).join('#')}` : '';
  const decoded = decodeURIComponent(withoutHash);
  const page = currentIndex.pages[fromSlug];
  const pageDir = page?.relativePath ? path.dirname(page.relativePath) : '';
  const baseDir = path.resolve(currentIndex.root, pageDir === '.' ? '' : pageDir);
  const resolved = path.resolve(baseDir, decoded);
  const root = path.resolve(currentIndex.root);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) return raw;
  return `${pathToFileURL(resolved).href}${hash}`;
}

function escapeHtmlAttr(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function resolveRenderedAssetSources(html, fromSlug = '') {
  return String(html || '').replace(/<(img|video|source)([^>]*?)src="([^"]+)"([^>]*)>/g, (_match, tag, before, src, after) => {
    const resolved = resolveMarkdownAssetSrc(src, fromSlug);
    return `<${tag}${before}src="${escapeHtmlAttr(resolved)}"${after}>`;
  });
}

function renderMarkdown(markdown, fromSlug = '') {
  const source = String(markdown || '')
    .replace(/\[\[([^\]\|\n]+)\|([^\]\n]+)\]\]/g, wikiLinkToMarkdown)
    .replace(/\[\[([^\]\n]+)\]\]/g, wikiLinkToMarkdown);

  const html = marked.parse(source, {
    async: false,
    gfm: true,
    breaks: false,
    mangle: false,
    headerIds: false
  });
  return resolveRenderedAssetSources(html, fromSlug);
}

ipcMain.handle('wiki:load', () => safeBuildIndex());
ipcMain.handle('wiki:loadCardWindow', (_event, slug) => safeCardWindowIndex(slug));
ipcMain.handle('wiki:renderMarkdown', (_event, markdown, fromSlug) => renderMarkdown(markdown, fromSlug));
ipcMain.handle('wiki:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: currentWikiPath });
  if (result.canceled || !result.filePaths[0]) return null;
  return safeBuildIndex(result.filePaths[0]);
});
ipcMain.handle('wiki:getPage', async (_event, slug) => {
  if (!currentIndex) safeBuildIndex();
  const page = currentIndex.pages[slug];
  if (!page) return null;
  return { slug: page.slug, title: page.title, body: page.body, raw: page.raw, frontmatter: page.frontmatter, links: page.links, images: page.images, videos: page.videos || [], artifactMatches: page.artifactMatches || [], musicMatches: page.musicMatches || [], backlinks: page.backlinks, relativePath: page.relativePath };
});
ipcMain.handle('wiki:reindex', () => safeBuildIndex(currentWikiPath));
ipcMain.handle('wiki:showInFinder', async (_event, slug) => {
  if (!currentIndex) safeBuildIndex();
  const page = currentIndex.pages[slug];
  if (page) shell.showItemInFolder(page.path);
  return !!page;
});
ipcMain.handle('wiki:openCardWindow', async (_event, slug) => {
  if (!currentIndex) safeBuildIndex();
  if (!currentIndex.pages[slug]) return false;
  return createCardWindow(slug);
});
ipcMain.handle('wikiops:listComments', (_event, options = {}) => wikiOps.listComments(wikiOpsContext(), options || {}));
ipcMain.handle('wikiops:addComment', (_event, payload = {}) => wikiOps.addComment(wikiOpsContext(), payload || {}));
ipcMain.handle('wikiops:updateComment', (_event, id, payload = {}) => wikiOps.updateComment(wikiOpsContext(), id, payload || {}));
ipcMain.handle('wikiops:listVersions', (_event, slug) => wikiOps.listVersions(wikiOpsContext(), slug, { limit: 12 }));
ipcMain.handle('wikiops:getCategories', () => wikiOps.listCategories(wikiOpsContext()));
ipcMain.handle('wikiops:addCategory', (_event, payload = {}) => wikiOps.upsertCategory(wikiOpsContext(), payload || {}));
ipcMain.handle('wikiops:appendPage', (_event, payload = {}) => {
  const result = wikiOps.appendToPage(wikiOpsContext(), payload.slug, payload.body || '', {
    ...payload,
    author: payload.author || 'wiki-viewer',
    actorType: payload.actorType || 'human',
  });
  safeBuildIndex(currentWikiPath);
  return result;
});
ipcMain.handle('wikiops:updatePage', (_event, payload = {}) => {
  const result = wikiOps.writePageContent(wikiOpsContext(), payload.slug, payload.content || '', {
    ...payload,
    author: payload.author || 'wiki-viewer',
    actorType: payload.actorType || 'human',
    message: payload.message || 'UI source edit',
  });
  safeBuildIndex(currentWikiPath);
  return result;
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (gotSingleInstanceLock) createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
