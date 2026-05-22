#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildWikiIndex } = require('../src/wikiIndexer');

const WIKI_ROOT = process.env.HAPA_WIKI_PATH || '/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki';
const REGISTRY_PATH = process.env.HAPA_SONG_REGISTRY_JSON || '/Users/calderwong/Desktop/hapa-song-registry/data/registry.json';
const RAW_DIR = path.join(WIKI_ROOT, 'Raw', 'Music');
const MUSIC_DIR = path.join(WIKI_ROOT, 'Music');

const STOP = new Set('the,and,for,that,with,this,from,into,about,what,when,where,which,while,will,have,has,are,was,were,you,your,our,out,how,why,not,can,its,his,her,they,them,then,than,over,under,after,before,song,lyrics,music,prompt,verse,chorus,bridge,intro,outro'.split(','));

function tokenize(value) {
  const counts = new Map();
  for (const raw of String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (STOP.has(raw)) continue;
    if (/^[0-9a-f-]{8,}$/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return counts;
}
function score(a, b) {
  let total = 0;
  for (const [term, n] of a) if (b.has(term)) total += Math.min(n, 5) * (1 + Math.min(b.get(term), 4));
  return total;
}
function slugify(value) {
  return String(value || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'song';
}
function firstWords(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function yamlScalar(value) { return JSON.stringify(String(value || '')); }
function wikiLink(slug, label) { return `[[${slug}|${label || slug.split('/').pop()}]]`; }
function asArray(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function songText(song, masterById) {
  const master = masterById.get(song.lyricMasterId) || {};
  return [song.title, song.tags, song.prompt, song.lyrics, master.sourceTitle, master.lyrics].filter(Boolean).join('\n');
}
function connectionExplanation(song, matchedPages) {
  const links = matchedPages.slice(0, 4).map(p => wikiLink(p.slug, p.title)).join(', ');
  const bits = [];
  if (/hapa/i.test(`${song.title} ${song.tags} ${song.prompt} ${song.lyrics}`)) bits.push('explicit Hapa language');
  if (/protocol|node|agent|card|memory|canon|truth|signal|flow|mirror|blue|thor|calder|mimi|domina/i.test(`${song.title} ${song.tags} ${song.prompt} ${song.lyrics}`)) bits.push('shared canon/development vocabulary');
  if (song.lyricMasterId) bits.push(`lyric master ${song.lyricMasterId}`);
  return `Connected to ${links || 'the Hapa wiki'} through ${bits.join(', ') || 'title/lyrics/tag overlap with page language'}. Treat this as a curator suggestion, not canonical placement until reviewed.`;
}

function main() {
  if (!fs.existsSync(REGISTRY_PATH)) throw new Error(`Song registry missing: ${REGISTRY_PATH}`);
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const wiki = buildWikiIndex(WIKI_ROOT);
  const masterById = new Map((registry.lyricMasters || []).map(m => [m.id, m]));
  const candidatePages = wiki.orderedSlugs
    .map(slug => wiki.pages[slug])
    .filter(p => !/^Raw\//.test(p.slug) && !/^Music\//.test(p.slug))
    .map(p => ({
      slug: p.slug,
      title: p.title,
      section: p.section,
      terms: tokenize(`${p.title} ${p.slug} ${p.kind} ${p.section} ${asArray(p.tags).join(' ')} ${asArray(p.topics).join(' ')} ${p.summary}`),
    }));

  const rawSongMatches = (registry.songs || [])
    .filter(s => s.localPath && fs.existsSync(s.localPath))
    .map(song => {
      const text = songText(song, masterById);
      const terms = tokenize(text);
      const pageScores = candidatePages
        .map(page => ({ ...page, score: score(terms, page.terms) }))
        .filter(p => p.score >= 12)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, 8);
      return { song, terms, pageScores, topScore: pageScores[0]?.score || 0 };
    })
    .filter(item => item.topScore > 1 || /hapa|calder|domina|protocol|node|agent|card|memory|truth|signal|flow|mirror|blue|thor|mimi/i.test(songText(item.song, masterById)))
    .sort((a, b) => b.topScore - a.topScore || String(a.song.title).localeCompare(String(b.song.title)));

  const seenSongFamilies = new Set();
  const songs = [];
  for (const item of rawSongMatches) {
    const key = `${item.song.lyricMasterId || item.song.id}:${String(item.song.title || '').toLowerCase()}`;
    if (seenSongFamilies.has(key)) continue;
    seenSongFamilies.add(key);
    songs.push(item);
    if (songs.length >= Number(process.env.HAPA_MUSIC_INDEX_LIMIT || 240)) break;
  }

  const exportedSongs = songs.map(({ song, pageScores }) => {
    const master = masterById.get(song.lyricMasterId) || {};
    return {
      id: song.id,
      title: song.title,
      authors: song.authors || registry.defaultAuthors || [],
      duration: song.duration || 0,
      model: song.model || '',
      majorModelVersion: song.majorModelVersion || '',
      createdAt: song.createdAt || '',
      tags: firstWords(song.tags, 900),
      lyricMasterId: song.lyricMasterId || '',
      lyricMasterTitle: master.sourceTitle || '',
      lyricExcerpt: firstWords(song.lyrics || master.lyrics || song.prompt || '', 1100),
      localPath: song.localPath,
      audioUrl: pathToFileURL(song.localPath).href,
      imageUrl: song.imageUrl || '',
      pageSlugs: pageScores.slice(0, 5).map(p => p.slug),
      pageMatches: pageScores.slice(0, 5).map(p => ({ slug: p.slug, title: p.title, section: p.section, score: p.score })),
      explanation: connectionExplanation(song, pageScores),
      connection: connectionExplanation(song, pageScores),
      source: {
        registry: REGISTRY_PATH,
        sunoLocalPath: song.localPath,
        audioUrl: song.audioUrl || '',
      },
    };
  });

  ensureDir(RAW_DIR); ensureDir(MUSIC_DIR);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceRegistry: REGISTRY_PATH,
    sourceCounts: registry.counts || {},
    stats: {
      songs: exportedSongs.length,
      registrySongs: (registry.songs || []).length,
      lyricMasters: (registry.lyricMasters || []).length,
      promptGroups: (registry.promptGroups || []).length,
      stems: (registry.stems || []).length,
    },
    songs: exportedSongs,
  };
  fs.writeFileSync(path.join(RAW_DIR, 'hapa-music-page-index.json'), JSON.stringify(payload, null, 2) + '\n');

  const top = exportedSongs.slice(0, 40);
  const indexMd = `---\ntitle: "Hapa Music Canon Index"\ntype: music_index\nstatus: draft\ngenerated_by: hapa-wiki-viewer-music-indexer\ngenerated_at: ${yamlScalar(payload.generatedAt)}\nsource_registry: ${yamlScalar(REGISTRY_PATH)}\n---\n# Hapa Music Canon Index\n\nThis index connects locally generated Hapa songs and lyrics to wiki pages, Cards, topics, lore, and development artifacts. These links are generated from title/lyrics/style prompt/tag overlap plus known Hapa development vocabulary. They are curator suggestions, not final canon, until reviewed.\n\nSource registry: \`${REGISTRY_PATH}\`\n\nCounts: ${payload.stats.registrySongs} songs, ${payload.stats.lyricMasters} lyric masters, ${payload.stats.promptGroups} prompt groups, ${payload.stats.stems} stems.\n\n## Player behavior\n\nThe local Hapa Wiki Viewer reads \`Raw/Music/hapa-music-page-index.json\` and preloads relevant songs into the right-side **Music / Lore Player** on wiki pages with matches. The player uses local audio files from the Suno library and displays an analyser visualizer while playing.\n\n## Top connected songs\n\n${top.map(song => `### ${song.title}\n\n- Song id: \`${song.id}\`\n- Lyric master: \`${song.lyricMasterId}\`\n- Local audio: \`${song.localPath}\`\n- Connected pages: ${song.pageMatches.map(p => wikiLink(p.slug, p.title)).join(', ')}\n- Explanation: ${song.explanation}\n\n> ${song.lyricExcerpt.slice(0, 420).replace(/\n/g, ' ')}\n`).join('\n')}\n`;
  fs.writeFileSync(path.join(MUSIC_DIR, 'Hapa Music Canon Index.md'), indexMd);

  const byPage = new Map();
  for (const song of exportedSongs) for (const match of song.pageMatches || []) {
    if (!byPage.has(match.slug)) byPage.set(match.slug, []);
    byPage.get(match.slug).push({ song, match });
  }
  const pageRows = [...byPage.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 120);
  const connectionsMd = `---\ntitle: "Hapa Song-to-Wiki Connections"\ntype: music_connection_index\nstatus: draft\ngenerated_by: hapa-wiki-viewer-music-indexer\ngenerated_at: ${yamlScalar(payload.generatedAt)}\n---\n# Hapa Song-to-Wiki Connections\n\nThis page records where the music player will surface songs across the wiki. The mapping is evidence-backed by local registry metadata and lexical overlap, but it should be reviewed as canon matures.\n\n${pageRows.map(([slug, rows]) => `## ${wikiLink(slug, wiki.pages[slug]?.title || slug)}\n\n${rows.slice(0, 8).map(({ song, match }) => `- **${song.title}** (score ${match.score}) — ${song.explanation}`).join('\n')}\n`).join('\n')}\n`;
  fs.writeFileSync(path.join(MUSIC_DIR, 'Song-to-Wiki Connections.md'), connectionsMd);

  console.log(`Wrote ${exportedSongs.length} songs to ${path.join(RAW_DIR, 'hapa-music-page-index.json')}`);
  console.log(`Wrote ${path.join(MUSIC_DIR, 'Hapa Music Canon Index.md')}`);
  console.log(`Wrote ${path.join(MUSIC_DIR, 'Song-to-Wiki Connections.md')}`);
}

if (require.main === module) main();
