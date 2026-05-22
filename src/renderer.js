let wiki = null;
let currentSlug = null;
let currentPage = null;
let isEditing = false;
let history = [];
let future = [];
let currentView = 'portal';
let timelineEvents = [];
let activePortalSection = null;
let selectedCardSlug = null;
let cardDensity = localStorage.getItem('hapa-card-density') || 'compact';
let cardQualityCache = new Map();
let musicAudioCtx = null;
let musicAnalyser = null;
let musicAnimationFrame = null;

const el = id => document.getElementById(id);
const routeParams = new URLSearchParams(window.location.search);
const isDetachedCardWindow = routeParams.get('mode') === 'card';
const initialDetachedSlug = routeParams.get('slug') || '';

const CARD_TIER_CONFIG = {
  common: { label: 'Common', badge: 'C', minScore: 0 },
  uncommon: { label: 'Uncommon', badge: 'U', minScore: 2 },
  rare: { label: 'Rare', badge: 'R', minScore: 4 },
  epic: { label: 'Epic', badge: 'E', minScore: 6 },
  legendary: { label: 'Legendary', badge: 'L', minScore: 9 },
  mythic: { label: 'Mythic', badge: 'M', minScore: 12 },
};
const CARD_TIER_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

function setWikiIndex(nextWiki) {
  wiki = nextWiki;
  cardQualityCache = new Map();
}

const PORTAL_SECTIONS = [
  {
    id: 'canon',
    title: 'Canon & Cosmology',
    badge: 'Narrative Root',
    desc: 'The primordial history and mythic timeline of the Partnership OS soft fork resisting the hierarchical Dominator OS.',
    slugs: ['Canon/World Bible', 'Canon/Timeline', 'Canon/Era Map'],
    links: [
      { label: 'World Bible', slug: 'Canon/World Bible' },
      { label: 'Chronicle Timeline', slug: 'Canon/Timeline' },
      { label: 'Era Map', slug: 'Canon/Era Map' }
    ]
  },
  {
    id: 'names',
    title: 'Sovereign Identities',
    badge: 'Consul & AIs',
    desc: 'Deep files on key human operators, composite quines, and the modular AI Familiars guarding local node life.',
    slugs: ['Names/Calder CJ Wong', 'Names/Mimi Phan Falka', 'Names/Blue', 'Names/Thor'],
    links: [
      { label: 'Calder Wong', slug: 'Names/Calder CJ Wong' },
      { label: 'Mimi Phan Falka', slug: 'Names/Mimi Phan Falka' },
      { label: 'Sovereign Blue', slug: 'Names/Blue' },
      { label: 'Thor (Chaos-Kitty)', slug: 'Names/Thor' }
    ]
  },
  {
    id: 'nodes',
    title: 'System Architecture',
    badge: 'Hardware Nodes',
    desc: 'The technical blueprint of high-performance desktop shells, zero-copy Metal audio graphics, and pre-commit warden consensus.',
    slugs: ['Nodes/Existing/hapa-dev-proto', 'Nodes/Node Capability Matrix', 'Nodes/Node Graph v2'],
    links: [
      { label: 'hapa-dev-proto', slug: 'Nodes/Existing/hapa-dev-proto' },
      { label: 'Capability Matrix', slug: 'Nodes/Node Capability Matrix' },
      { label: 'Visual Node Graph', slug: 'Nodes/Node Graph v2' }
    ]
  },
  {
    id: 'cards',
    title: 'Card Vector Library',
    badge: 'Wormhole Ingest',
    desc: 'Content-addressed atomic card indexes minted from raw audio, drag-and-drop text chunks, and voice transcriptions.',
    slugs: ['Cards/Index of Cards', 'Cards/Hapa Dev Proto Cards/Index'],
    links: [
      { label: 'Global Card Index', slug: 'Cards/Index of Cards' },
      { label: 'Wormhole Card Vector', slug: 'Cards/Hapa Dev Proto Cards/Index' }
    ]
  },
  {
    id: 'systems',
    title: 'Systems & Protocols',
    badge: 'Operational Specs',
    desc: 'Consolidated front-end design systems, BLE Proof-of-Presence Campfire Nonces, and decentralized local mesh specifications.',
    slugs: ['Systems/Astro & Gravity Design System', 'Systems/Mechanics Glossary', 'Systems/Phamiliars Field Guide'],
    links: [
      { label: 'Astro & Gravity Design Spec', slug: 'Systems/Astro & Gravity Design System' },
      { label: 'Mechanics Glossary', slug: 'Systems/Mechanics Glossary' },
      { label: 'Familiars Field Guide', slug: 'Systems/Phamiliars Field Guide' }
    ]
  },
  {
    id: 'development',
    title: 'Development Roadmap',
    badge: 'Sovereign Priority',
    desc: 'Strategic execution rankings, node development gaps, and actionable workstreams to scale the peer-to-peer garden.',
    slugs: ['Development/Worldbuilding Roadmap', 'Development/Priority Ranking 1-10'],
    links: [
      { label: 'Worldbuilding Roadmap', slug: 'Development/Worldbuilding Roadmap' },
      { label: 'Priority Ranking 1-10', slug: 'Development/Priority Ranking 1-10' }
    ]
  }
];

function switchView(viewName) {
  currentView = viewName;
  
  // Hide all view sections
  el('portalView').style.display = 'none';
  el('cardsView').style.display = 'none';
  el('timelineView').style.display = 'none';
  el('page').style.display = 'none';
  
  // Deactivate all tab buttons
  el('togglePortal').classList.remove('active');
  el('toggleCards').classList.remove('active');
  el('toggleTimeline').classList.remove('active');
  el('toggleDoc').classList.remove('active');
  
  if (viewName === 'portal') {
    el('portalView').style.display = 'block';
    el('togglePortal').classList.add('active');
  } else if (viewName === 'cards') {
    el('cardsView').style.display = 'block';
    el('toggleCards').classList.add('active');
    renderCardBrowser();
  } else if (viewName === 'timeline') {
    el('timelineView').style.display = 'block';
    el('toggleTimeline').classList.add('active');
    renderTimeline();
  } else if (viewName === 'doc') {
    el('page').style.display = 'block';
    el('toggleDoc').classList.add('active');
  }
}

function initPortal() {
  renderPortal();
}

const SECTION_EXPLANATIONS = {
  canon: {
    title: 'Canon & Cosmology',
    subtitle: 'The foundational narrative and mythic timeline of Hapa',
    explanation: 'The Canon section maps the poetic, historical, and mythic prehistory of the Hapa universe. Here, you will find chronicles detailing the Nicene Fork root bug, the destruction of the high-dimensional Rainbow Gates of Sodom & Thebes, and the battle of the divergent Magdalene OS against the hierarchical, debt-based Dominator OS. This narrative framework is not merely background lore; it represents the moral imperative and sovereign intent that guides the design and alignment of all local Hapa nodes and software layers.',
    icon: 'CN',
    accentColor: '#ff7878',
    sectionKey: 'Canon'
  },
  names: {
    title: 'Sovereign Identities',
    subtitle: 'Roster of core operators and autonomous AI organs',
    explanation: 'Sovereign Identities houses deep files on the key human operators and cognitive entities that govern and protect local node operations. Discover details on Calder CJ Wong (the memories-defender and triadic avatar), Mimi Phan Falka (the schema-mancer and AI architect), Blue (the self-governing composite quine singularity), and Thor (the feline fuzz-tester), as well as the autonomous AI Familiars (Naomi, Gaby, Taro Tarot) that manage state and preserve local sovereignty.',
    icon: 'ID',
    accentColor: '#78a6ff',
    sectionKey: 'Names'
  },
  nodes: {
    title: 'System Architecture',
    subtitle: 'Local-first hardware specs and client runtimes',
    explanation: 'System Architecture contains the hard technical blueprints of physical Hapa node deployments. From local high-performance desktop shells and zero-copy Swift/Metal spatial graphics pipelines to append-only Hypercore block-web storage, these guides define how local nodes sync and orchestrate services (using Warden pre-commit structures and microservices) without relying on centralized, rent-seeking cloud infrastructure.',
    icon: 'ND',
    accentColor: '#8ef0c4',
    sectionKey: 'Nodes'
  },
  cards: {
    title: 'Card Vector Library',
    subtitle: 'Content-addressed atomic vectors for local intelligence',
    explanation: 'The Card Vector Library catalogs the atomic, content-addressed blocks of the Hapa local knowledge graph. Derived from raw audio recordings, text chunks, and transcripts, these cards are indexed and categorized by topics and sorted into strict quality tiers (Tier 0 to Tier 5). AI Familiars ingest these vector structures to execute instant semantic retrieval and local intelligence training loops.',
    icon: 'CV',
    accentColor: '#f4c35c',
    sectionKey: 'Cards'
  },
  systems: {
    title: 'Systems & Protocols',
    subtitle: 'Standardized specifications, UI parameters, and mesh rules',
    explanation: 'Systems & Protocols governs the operational rules of the node cluster. It houses the Astro & Gravity Design System specifications, explaining the Mode Gravity Zustand store matrix (governing blurring, lock states, and input densities), the hearthHash Proof-of-Presence BLE nonces, and the Fastify/FastAPI loopback microservices topology.',
    icon: 'SY',
    accentColor: '#c06fff',
    sectionKey: 'Systems'
  },
  development: {
    title: 'Development Roadmap',
    subtitle: 'Actionable workstreams and strategic growth tracks',
    explanation: 'The Development Roadmap outlines the strategic path forward for the Hapa ecosystem. It documents node gap analyses, active developer workstreams, and priority rankings (1 through 10) that serve as a checklist to scale the local-first garden from initial developer isolation to a robust, decentralized local mesh of 100+ physical nodes.',
    icon: 'RD',
    accentColor: '#ffaa54',
    sectionKey: 'Development'
  }
};

function renderSubHomePage(sectionId) {
  const expl = SECTION_EXPLANATIONS[sectionId];
  if (!expl) { activePortalSection = null; renderPortal(); return; }
  
  const container = el('portalView');
  container.innerHTML = '';
  
  const subWrap = document.createElement('div');
  subWrap.className = 'sub-home-container';
  
  // Breadcrumb / Back Navigation header
  const topNav = document.createElement('div');
  topNav.className = 'sub-home-nav';
  topNav.innerHTML = `
    <button class="portal-back-btn">← Back to Portal</button>
  `;
  subWrap.appendChild(topNav);
  
  // High fidelity Hero block
  const hero = document.createElement('div');
  hero.className = 'sub-home-hero';
  hero.style.borderLeftColor = expl.accentColor;
  hero.innerHTML = `
    <div class="sub-home-hero-badge" style="border-color: ${expl.accentColor}; color: ${expl.accentColor}">
      ${expl.icon} ${expl.title}
    </div>
    <h1>${expl.title}</h1>
    <p class="sub-home-hero-subtitle">${expl.subtitle}</p>
    <div class="sub-home-hero-explanation">${expl.explanation}</div>
  `;
  subWrap.appendChild(hero);
  
  // Associated Pages and Groupings
  const pagesInSection = wiki.orderedSlugs
    .map(slug => wiki.pages[slug])
    .filter(p => p && p.section === expl.sectionKey);
    
  if (pagesInSection.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-section-msg';
    emptyMsg.textContent = 'No pages found in this category.';
    subWrap.appendChild(emptyMsg);
  } else {
    // Group pages by kind
    const groups = {};
    for (const p of pagesInSection) {
      const g = p.kind || 'General';
      (groups[g] ||= []).push(p);
    }
    
    const groupsContainer = document.createElement('div');
    groupsContainer.className = 'sub-home-groups';
    
    // Sort group names
    const sortedGroups = Object.keys(groups).sort();
    for (const groupName of sortedGroups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'sub-home-group';
      
      const groupTitle = document.createElement('h2');
      groupTitle.className = 'sub-home-group-title';
      groupTitle.textContent = `${groupName} (${groups[groupName].length})`;
      groupEl.appendChild(groupTitle);
      
      const cardGrid = document.createElement('div');
      cardGrid.className = 'sub-home-card-grid';
      
      for (const p of groups[groupName]) {
        const pageCard = document.createElement('div');
        pageCard.className = 'sub-home-page-card';
        pageCard.style.borderLeftColor = expl.accentColor;
        
        let statusBadgeHtml = '';
        if (p.status) {
          statusBadgeHtml = `<span class="page-status-badge ${p.status.toLowerCase()}">${p.status}</span>`;
        }
        
        let tagsHtml = '';
        const tags = p.frontmatter?.tags || [];
        if (tags.length > 0) {
          tagsHtml = `
            <div class="page-card-tags">
              ${(Array.isArray(tags) ? tags : [tags]).slice(0, 3).map(t => `<span class="tag-chip">#${t}</span>`).join('')}
            </div>
          `;
        }
        
        const summaryText = p.summary || 'No summary available.';
        
        pageCard.innerHTML = `
          <div class="page-card-header">
            <h3 class="page-card-title">${escapeHtml(p.title)}</h3>
            ${statusBadgeHtml}
          </div>
          <p class="page-card-summary">${escapeHtml(summaryText)}</p>
          ${tagsHtml}
          <div class="page-card-footer">
            <span class="links-count">${p.links?.length || 0} Outgoing</span>
            <span class="divider">·</span>
            <span class="backlinks-count">${p.backlinks?.length || 0} Incoming</span>
            ${(p.images?.length || 0) ? `<span class="divider">·</span><span class="visuals-count">${p.images.length} Visuals</span>` : ''}
            ${(p.artifactMatches?.length || 0) ? `<span class="divider">·</span><span class="visuals-count">${p.artifactMatches.length} Artifacts</span>` : ''}
          </div>
        `;
        
        pageCard.onclick = () => {
          openPage(p.slug);
        };
        
        cardGrid.appendChild(pageCard);
      }
      
      groupEl.appendChild(cardGrid);
      groupsContainer.appendChild(groupEl);
    }
    
    subWrap.appendChild(groupsContainer);
  }
  
  container.appendChild(subWrap);
  
  // Hook up back button click
  subWrap.querySelector('.portal-back-btn').onclick = () => {
    activePortalSection = null;
    el('crumb').textContent = 'Portal';
    renderPortal();
  };
  
  // Update breadcrumb
  el('crumb').textContent = `Portal > ${expl.title}`;
}

function renderPortal() {
  if (activePortalSection) {
    renderSubHomePage(activePortalSection);
    return;
  }

  const container = el('portalView');
  container.innerHTML = '';
  
  const portalWrap = document.createElement('div');
  portalWrap.className = 'portal-container';
  
  const header = document.createElement('div');
  header.className = 'portal-header';
  header.innerHTML = `
    <h1>Hapa Protocol Portal</h1>
    <p>High-level tactical dashboard for local-first systems, narrative memory, and cognitive orchestration</p>
  `;
  portalWrap.appendChild(header);
  
  const grid = document.createElement('div');
  grid.className = 'portal-grid';
  
  for (const s of PORTAL_SECTIONS) {
    const card = document.createElement('div');
    card.className = `portal-card ${s.id}`;
    
    // Get live counts from index
    let count = 0;
    if (s.id === 'canon') count = wiki.facets?.sections?.['Canon'] || 0;
    else if (s.id === 'names') count = wiki.facets?.sections?.['Names'] || 0;
    else if (s.id === 'nodes') count = wiki.facets?.sections?.['Nodes'] || 0;
    else if (s.id === 'cards') count = wiki.facets?.sections?.['Cards'] || 0;
    else if (s.id === 'systems') count = wiki.facets?.sections?.['Systems'] || 0;
    else if (s.id === 'development') count = wiki.facets?.sections?.['Development'] || 0;
    
    let linksHtml = '';
    for (const l of s.links) {
      linksHtml += `<button class="portal-link" data-slug="${l.slug}">${l.label}</button>`;
    }
    
    card.innerHTML = `
      <div class="portal-card-header">
        <div class="portal-card-title">${s.title}</div>
        <div class="portal-card-badge">${count} pages</div>
      </div>
      <div class="portal-card-desc">${s.desc}</div>
      <div class="portal-card-links">
        ${linksHtml}
      </div>
    `;
    
    card.onclick = (ev) => {
      if (ev.target.tagName === 'BUTTON' || ev.target.closest('button')) return;
      activePortalSection = s.id;
      renderPortal();
    };
    
    grid.appendChild(card);
  }
  
  portalWrap.appendChild(grid);
  container.appendChild(portalWrap);
  
  // Hook up button clicks
  container.querySelectorAll('.portal-link').forEach(btn => {
    btn.onclick = () => {
      const slug = btn.dataset.slug;
      if (slug) openPage(slug);
    };
  });
}

function getCardVisualType(card) {
  const type = String(card.type || card.kind || '').toLowerCase();
  const mediaKind = String(card.media_kind || '').toLowerCase();
  if (type.includes('set')) return 'set';
  if (card.videoUrl || mediaKind.includes('video')) return 'video';
  if (card.coverUrl || mediaKind.includes('image')) return 'image';
  if (mediaKind.includes('audio')) return 'audio';
  if (type.includes('media')) return 'media';
  return 'text';
}

function calculateCardQuality(card) {
  const page = wiki?.pages?.[card.slug] || {};
  const cacheKey = [
    card.slug,
    card.coverUrl || '',
    card.videoUrl || '',
    card.summary?.length || 0,
    page.summary?.length || 0,
    card.parent_card_id || '',
    card.imageCount || page.images?.length || 0,
    card.videoCount || page.videos?.length || 0,
  ].join('|');
  const cached = cardQualityCache.get(cacheKey);
  if (cached) return cached;

  let score = 0;
  const affixes = [];
  const summary = card.summary || page.summary || '';
  const topics = [...(card.topics || []), ...(card.tags || []), ...(page.frontmatter?.topics || [])].filter(Boolean);
  const imageCount = Number(card.imageCount || page.images?.length || 0);
  const videoCount = Number(card.videoCount || page.videos?.length || 0);
  const hasMedia = Boolean(card.coverUrl || card.videoUrl || imageCount || videoCount);

  if (hasMedia) { score += 1; affixes.push('media'); }
  if (card.videoUrl || videoCount || /loop|gif|first-frame|last-frame/i.test(`${card.type || ''} ${card.media_kind || ''}`)) {
    score += 1;
    affixes.push('loop');
  }
  if (card.title && card.title.trim() && card.title !== 'Untitled Card') { score += 1; affixes.push('named'); }
  if (card.parent_card_id || page.frontmatter?.parent_card_id) { score += 1; affixes.push('linked'); }
  if (summary && summary.trim().length > 20) { score += 2; affixes.push('summarized'); }
  if (summary.length > 260) score += 1;
  if (topics.length) { score += 2; affixes.push('tagged'); }
  if ((page.links || []).length || (page.backlinks || []).length) { score += 2; affixes.push('wiki'); }
  if (/transcript/i.test(`${card.type || ''} ${card.slug || ''} ${summary}`)) { score += 2; affixes.push('transcribed'); }
  if (card.card_id || card.retrieval_id) score += 1;

  let tier = 'common';
  for (const key of CARD_TIER_ORDER) {
    if (score >= CARD_TIER_CONFIG[key].minScore) {
      tier = key;
      break;
    }
  }

  const result = {
    score,
    tier,
    affixes: [...new Set(affixes)],
    tierLabel: CARD_TIER_CONFIG[tier].label,
    badge: CARD_TIER_CONFIG[tier].badge,
  };
  cardQualityCache.set(cacheKey, result);
  return result;
}

function buildCardStats(card, quality) {
  const page = wiki?.pages?.[card.slug] || {};
  const linkCount = (page.links || []).length + (page.backlinks || []).length + (card.parent_card_id ? 1 : 0);
  const mediaCount = Number(card.imageCount || page.images?.length || 0) + Number(card.videoCount || page.videos?.length || 0) + (card.coverUrl || card.videoUrl ? 1 : 0);
  const loreBase = Math.min(100, 24 + String(card.summary || page.summary || '').length / 9);
  return [
    ['Signal', Math.min(100, 18 + quality.score * 7)],
    ['Media', Math.min(100, 18 + mediaCount * 24)],
    ['Lore', loreBase],
    ['Links', Math.min(100, 16 + linkCount * 13)],
  ];
}

function buildCardPacket(card) {
  const page = wiki?.pages?.[card.slug] || {};
  const quality = calculateCardQuality(card);
  return {
    packet_type: 'hapa-wiki-card',
    title: card.title,
    slug: card.slug,
    relative_path: page.relativePath || '',
    card_id: card.card_id || '',
    retrieval_id: card.retrieval_id || '',
    parent_card_id: card.parent_card_id || '',
    type: card.type || page.kind || '',
    status: card.status || '',
    media: {
      kind: cardMediaState(card),
      cover_url: card.coverUrl || '',
      video_url: card.videoUrl || '',
      images: Number(card.imageCount || page.images?.length || 0),
      videos: Number(card.videoCount || page.videos?.length || 0),
    },
    quality,
    topics: (card.topics || page.frontmatter?.topics || []).slice(0, 12),
    tags: (card.tags || []).slice(0, 12),
    summary: page.summary || card.summary || '',
  };
}

function findCardBySlug(slug) {
  return (wiki?.cards || []).find(card => card.slug === slug) || null;
}

function cardFromPage(page) {
  if (!page) return null;
  const indexedPage = wiki?.pages?.[page.slug] || page;
  const existing = findCardBySlug(page.slug);
  if (existing) return existing;
  if (indexedPage.kind !== 'Card' && indexedPage.section !== 'Cards' && !page.frontmatter?.card_id && !page.frontmatter?.retrieval_id) return null;
  return {
    slug: page.slug,
    title: page.title || indexedPage.title,
    summary: cleanSummaryText(page.summary || indexedPage.summary || ''),
    card_id: page.frontmatter?.card_id || '',
    retrieval_id: page.frontmatter?.retrieval_id || '',
    type: page.frontmatter?.type || indexedPage.kind || 'Card',
    status: indexedPage.status || page.frontmatter?.status || '',
    parent_card_id: page.frontmatter?.parent_card_id || '',
    topics: page.frontmatter?.topics || [],
    tags: page.frontmatter?.tags || [],
    coverUrl: indexedPage.coverUrl || '',
    videoUrl: indexedPage.videoUrl || '',
    imageCount: page.images?.length || 0,
    videoCount: page.videos?.length || 0,
  };
}

function cleanSummaryText(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderCardPageDossier(page, bodyHtml, frontmatterHtml) {
  const card = cardFromPage(page);
  if (!card) return `<article class="article">${frontmatterHtml}${bodyHtml}</article>`;
  const quality = calculateCardQuality(card);
  const packet = buildCardPacket(card);
  const stats = buildCardStats(card, quality);
  const topics = (packet.topics || []).slice(0, 10);
  const summary = cleanSummaryText(page.summary || card.summary || '');
  const cleanBody = bodyHtml.replace(new RegExp(`^\\s*<h1[^>]*>${escapeRegExp(page.title)}<\\/h1>`, 'i'), '');
  const media = card.videoUrl
    ? `<video class="card-page-media" src="${escapeHtml(card.videoUrl)}" controls preload="metadata"></video>`
    : card.coverUrl
      ? `<img class="card-page-media" src="${escapeHtml(card.coverUrl)}" alt="${escapeHtml(card.title)}" />`
      : `<div class="card-page-media placeholder">${escapeHtml(getCardVisualType(card))}</div>`;
  const metaRows = [
    ['Slug', page.slug],
    ['Card ID', card.card_id || page.frontmatter?.card_id || ''],
    ['Retrieval', card.retrieval_id || page.frontmatter?.retrieval_id || ''],
    ['Parent', card.parent_card_id || page.frontmatter?.parent_card_id || ''],
    ['Type', card.type || page.kind || ''],
    ['Status', card.status || page.status || ''],
  ].filter(([, value]) => value);

  return `
    <article class="article card-page-dossier tier-${quality.tier}">
      <section class="card-page-hero">
        <span class="holo-corner top-left"></span>
        <span class="holo-corner top-right"></span>
        <span class="holo-corner bottom-left"></span>
        <span class="holo-corner bottom-right"></span>
        <div class="card-page-media-frame">
          ${media}
          <div class="media-vignette"></div>
          <div class="media-scanlines"></div>
        </div>
        <div class="card-page-head">
          <div class="card-page-tier">
            <span class="tier-badge">${quality.badge}</span>
            <div>
              <strong>${quality.tierLabel}</strong>
              <small>${quality.affixes.join(' / ') || 'base card'}</small>
            </div>
            <b>${quality.score}</b>
          </div>
          <div class="kicker">Card Dossier</div>
          <h1>${escapeHtml(card.title)}</h1>
          <p>${escapeHtml(summary)}</p>
          <div class="card-page-actions">
            <button id="detachCardPage">Open Window</button>
            <button id="copyCardPageLink">Copy Link</button>
            <button id="copyCardPagePacket">Copy Packet</button>
            <button id="showCardPageFile">Show File</button>
          </div>
          <div class="inspector-stat-grid">
            ${stats.map(([label, value]) => `
              <div class="inspector-stat">
                <div><span>${escapeHtml(label)}</span><strong>${Math.round(value)}</strong></div>
                <i style="--value:${Math.max(4, Math.min(100, value))}%"></i>
              </div>
            `).join('')}
          </div>
          <div class="inspector-topic-row">${topics.map(topic => `<span>${escapeHtml(topic)}</span>`).join('')}</div>
        </div>
      </section>
      <section class="card-page-layout">
        <div class="card-page-main">
          ${cleanBody}
        </div>
        <aside class="card-page-side">
          <div class="agent-packet">
            <div class="agent-packet-title">Agent packet</div>
            <pre>${escapeHtml(JSON.stringify(packet, null, 2))}</pre>
          </div>
          <div class="inspector-table">
            ${metaRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
          </div>
          ${frontmatterHtml}
        </aside>
      </section>
    </article>
  `;
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bindCardPageActions(card) {
  if (!card) return;
  const packet = buildCardPacket(card);
  const detach = el('detachCardPage');
  const copyLink = el('copyCardPageLink');
  const copyPacket = el('copyCardPagePacket');
  const showFile = el('showCardPageFile');
  if (detach) detach.onclick = () => window.hapaWiki.openCardWindow(card.slug);
  if (copyLink) copyLink.onclick = () => copyText(`[[${card.slug}|${card.title}]]`, 'Wiki link copied');
  if (copyPacket) copyPacket.onclick = () => copyText(JSON.stringify(packet, null, 2), 'Agent packet copied');
  if (showFile) showFile.onclick = () => window.hapaWiki.showInFinder(card.slug);
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  window.hapaSfx?.playCardSnapSound?.();
  showToast(label);
}

function showToast(message) {
  let toast = document.getElementById('copyToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copyToast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 1500);
}

function cardMediaState(card) {
  if (card.videoUrl) return 'video';
  if (card.coverUrl) return 'image';
  return 'none';
}

function cardSearchText(card) {
  const page = wiki.pages[card.slug] || {};
  return [
    card.title,
    card.slug,
    card.card_id,
    card.retrieval_id,
    card.type,
    card.media_kind,
    card.parent_card_id,
    card.status,
    (card.topics || []).join(' '),
    (card.tags || []).join(' '),
    page.searchText,
  ].join(' ').toLowerCase();
}

function getFilteredCards() {
  const q = (el('cardSearch')?.value || '').trim().toLowerCase();
  const type = el('cardTypeFilter')?.value || '';
  const media = el('cardMediaFilter')?.value || '';
  const status = el('cardStatusFilter')?.value || '';
  const tier = el('cardTierFilter')?.value || '';
  return (wiki.cards || []).filter(card => {
    if (type && (card.type || card.kind || '') !== type) return false;
    if (status && card.status !== status) return false;
    if (media && cardMediaState(card) !== media) return false;
    if (tier && calculateCardQuality(card).tier !== tier) return false;
    if (q && !cardSearchText(card).includes(q)) return false;
    return true;
  });
}

function sortCards(cards) {
  const sort = el('cardSort')?.value || 'quality';
  return cards.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'type') {
      const typeDelta = String(a.type || a.kind || '').localeCompare(String(b.type || b.kind || ''));
      return typeDelta || a.title.localeCompare(b.title);
    }
    if (sort === 'media') {
      const mediaDelta = Number(!!b.coverUrl || !!b.videoUrl) - Number(!!a.coverUrl || !!a.videoUrl);
      return mediaDelta || a.title.localeCompare(b.title);
    }
    const aq = calculateCardQuality(a);
    const bq = calculateCardQuality(b);
    const tierDelta = CARD_TIER_ORDER.indexOf(aq.tier) - CARD_TIER_ORDER.indexOf(bq.tier);
    if (tierDelta) return tierDelta;
    return bq.score - aq.score || Number(!!b.coverUrl || !!b.videoUrl) - Number(!!a.coverUrl || !!a.videoUrl) || a.title.localeCompare(b.title);
  });
}

function fillCardSelect(id, values, label) {
  const select = el(id);
  const current = select.value || '';
  select.innerHTML = `<option value="">${label}</option>`;
  values.filter(Boolean).sort((a, b) => a.localeCompare(b)).forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
  if (values.includes(current)) select.value = current;
}

function setupCardFilters() {
  const cards = wiki.cards || [];
  fillCardSelect('cardTypeFilter', [...new Set(cards.map(card => card.type || card.kind).filter(Boolean))], 'All card types');
  fillCardSelect('cardStatusFilter', [...new Set(cards.map(card => card.status).filter(Boolean))], 'All statuses');
}

function renderCardBrowser() {
  if (!wiki || !el('cardGrid')) return;
  setupCardFilters();
  const cards = sortCards(getFilteredCards());
  const visible = cards.slice(0, 360);
  if (!selectedCardSlug || !cards.some(card => card.slug === selectedCardSlug)) {
    selectedCardSlug = visible[0]?.slug || null;
  }

  const withCover = (wiki.cards || []).filter(card => card.coverUrl || card.videoUrl).length;
  const mediaCards = (wiki.cards || []).filter(card => card.type === 'hapa_dev_proto_media_card').length;
  const highTierCards = (wiki.cards || []).filter(card => ['mythic', 'legendary'].includes(calculateCardQuality(card).tier)).length;
  el('cardStats').innerHTML = `
    <div><strong>${(wiki.cards || []).length.toLocaleString()}</strong><span>cards indexed</span></div>
    <div><strong>${withCover.toLocaleString()}</strong><span>with media</span></div>
    <div><strong>${mediaCards.toLocaleString()}</strong><span>media cards</span></div>
    <div><strong>${highTierCards.toLocaleString()}</strong><span>high tier</span></div>
  `;
  el('cardResultMeta').textContent = `${cards.length.toLocaleString()} matches · showing ${visible.length.toLocaleString()} · ${wiki.stats.images || 0} wiki images · drag cards as retrieval packets`;

  const grid = el('cardGrid');
  const densityToggle = el('cardDensityToggle');
  if (densityToggle) densityToggle.textContent = cardDensity === 'compact' ? 'Detail' : 'Compact';
  grid.classList.toggle('compact', cardDensity === 'compact');
  grid.innerHTML = '';
  if (!visible.length) {
    grid.innerHTML = '<p class="empty">No cards match the active filters.</p>';
    renderCardInspector(null);
    return;
  }

  for (const card of visible) {
    const tile = document.createElement('button');
    const quality = calculateCardQuality(card);
    const mediaState = cardMediaState(card);
    const visualType = getCardVisualType(card);
    tile.className = `library-card tier-${quality.tier} card-kind-${visualType} ${card.slug === selectedCardSlug ? 'active' : ''}`;
    tile.dataset.slug = card.slug;
    tile.draggable = true;
    const media = card.videoUrl
      ? `<video class="library-card-media" src="${escapeHtml(card.videoUrl)}" muted preload="metadata"></video>`
      : card.coverUrl
        ? `<img class="library-card-media" src="${escapeHtml(card.coverUrl)}" alt="${escapeHtml(card.title)}" loading="lazy" />`
        : `<div class="library-card-placeholder">${escapeHtml((card.type || card.kind || 'Card').slice(0, 18))}</div>`;
    const chips = [visualType, mediaState, card.status].filter(Boolean).slice(0, 3);
    const shortId = String(card.card_id || card.retrieval_id || card.slug).split('/').pop().slice(0, 18);
    tile.innerHTML = `
      <div class="card-quality-bar">
        <span>${quality.badge} ${quality.tierLabel}</span>
        <strong>${quality.score}</strong>
      </div>
      <span class="holo-corner top-left"></span>
      <span class="holo-corner top-right"></span>
      <span class="holo-corner bottom-left"></span>
      <span class="holo-corner bottom-right"></span>
      <div class="library-card-frame">
        ${media}
        <div class="media-vignette"></div>
        <div class="media-scanlines"></div>
        <div class="library-media-badge">${escapeHtml(mediaState)}</div>
      </div>
      <div class="library-card-body">
        <div class="library-card-title-row">
          <div class="library-card-title">${escapeHtml(card.title)}</div>
          <span class="tier-badge">${quality.badge}</span>
        </div>
        <div class="library-card-summary">${escapeHtml(card.summary || 'No summary available.')}</div>
        <div class="card-affix-row">${quality.affixes.slice(0, 5).map(affix => `<span>${escapeHtml(affix)}</span>`).join('')}</div>
        <div class="library-card-chips">${chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
        <div class="library-card-id">${escapeHtml(shortId)}</div>
      </div>
    `;
    tile.onclick = () => {
      window.hapaSfx?.playCardClickSound?.();
      selectedCardSlug = card.slug;
      renderCardBrowser();
    };
    tile.ondblclick = () => {
      window.hapaSfx?.playCardPortalSound?.('blue');
      openPage(card.slug);
    };
    tile.ondragstart = ev => {
      window.hapaSfx?.playPickUpSound?.();
      const packet = buildCardPacket(card);
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('application/json', JSON.stringify(packet, null, 2));
      ev.dataTransfer.setData('text/plain', `[[${card.slug}|${card.title}]]\n${packet.summary || ''}`);
    };
    tile.ondragend = () => window.hapaSfx?.playDropSound?.();
    grid.appendChild(tile);
  }
  renderCardInspector(cards.find(card => card.slug === selectedCardSlug) || visible[0]);
}

function renderCardInspector(card) {
  const box = el('cardInspector');
  if (!box) return;
  if (!card) {
    box.className = 'card-inspector';
    box.innerHTML = '<p class="empty">Select a card to inspect its media, lineage, and retrieval metadata.</p>';
    return;
  }
  const page = wiki.pages[card.slug] || {};
  const quality = calculateCardQuality(card);
  const packet = buildCardPacket(card);
  const stats = buildCardStats(card, quality);
  box.className = `card-inspector tier-${quality.tier}`;
  const media = card.videoUrl
    ? `<video class="inspector-media" src="${escapeHtml(card.videoUrl)}" controls preload="metadata"></video>`
    : card.coverUrl
      ? `<img class="inspector-media" src="${escapeHtml(card.coverUrl)}" alt="${escapeHtml(card.title)}" />`
      : `<div class="inspector-media placeholder">No cover media</div>`;
  const topics = (card.topics || page.frontmatter?.topics || []).slice(0, 8);
  const metaRows = [
    ['Slug', card.slug],
    ['Card ID', card.card_id || page.frontmatter?.card_id || ''],
    ['Parent', card.parent_card_id || page.frontmatter?.parent_card_id || ''],
    ['Type', card.type || page.kind || ''],
    ['Status', card.status || ''],
    ['Images', String(card.imageCount || page.images?.length || 0)],
    ['Videos', String(card.videoCount || page.videos?.length || 0)],
  ].filter(([, value]) => value);
  box.innerHTML = `
    <span class="holo-corner top-left"></span>
    <span class="holo-corner top-right"></span>
    <span class="holo-corner bottom-left"></span>
    <span class="holo-corner bottom-right"></span>
    <div class="inspector-quality">
      <span class="tier-badge">${quality.badge}</span>
      <div>
        <strong>${quality.tierLabel}</strong>
        <small>${quality.affixes.join(' / ') || 'base card'}</small>
      </div>
      <b>${quality.score}</b>
    </div>
    <div class="inspector-head">
      <div class="kicker">Artifact Analysis</div>
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(page.summary || card.summary || '')}</p>
    </div>
    <div class="inspector-media-wrap">
      ${media}
      <div class="media-vignette"></div>
      <div class="media-scanlines"></div>
    </div>
    <div class="inspector-actions">
      <button id="openSelectedCard">Open Page</button>
      <button id="detachSelectedCard">Open Window</button>
      <button id="showSelectedCard">Show File</button>
      <button id="copySelectedWikiLink">Copy Link</button>
      <button id="copySelectedPacket">Copy Packet</button>
    </div>
    <div class="inspector-stat-grid">
      ${stats.map(([label, value]) => `
        <div class="inspector-stat">
          <div><span>${escapeHtml(label)}</span><strong>${Math.round(value)}</strong></div>
          <i style="--value:${Math.max(4, Math.min(100, value))}%"></i>
        </div>
      `).join('')}
    </div>
    <div class="inspector-topic-row">${topics.map(topic => `<span>${escapeHtml(topic)}</span>`).join('')}</div>
    <div class="agent-packet">
      <div class="agent-packet-title">Agent packet</div>
      <pre>${escapeHtml(JSON.stringify(packet, null, 2))}</pre>
    </div>
    <div class="inspector-table">
      ${metaRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
    </div>
  `;
  el('openSelectedCard').onclick = () => {
    window.hapaSfx?.playCardPortalSound?.('blue');
    openPage(card.slug);
  };
  el('detachSelectedCard').onclick = () => window.hapaWiki.openCardWindow(card.slug);
  el('showSelectedCard').onclick = () => window.hapaWiki.showInFinder(card.slug);
  el('copySelectedWikiLink').onclick = () => copyText(`[[${card.slug}|${card.title}]]`, 'Wiki link copied');
  el('copySelectedPacket').onclick = () => copyText(JSON.stringify(packet, null, 2), 'Agent packet copied');
}

function parseYear(timeStr) {
  const clean = timeStr.replace(/[,~.c]/g, '').trim().toLowerCase();
  if (clean.includes('bce') || clean.includes('bc')) {
    const match = clean.match(/\d+/);
    return match ? -parseInt(match[0], 10) : 0;
  }
  if (clean.includes('middle ages')) {
    return 1100;
  }
  const matchRange = clean.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (matchRange) {
    return parseInt(matchRange[1], 10);
  }
  const matchNum = clean.match(/\d+/);
  return matchNum ? parseInt(matchNum[0], 10) : 0;
}

function parseTimelineEvents(md) {
  const lines = md.split(/\r?\n/);
  let currentEra = 'General';
  let parentTime = '';
  timelineEvents = [];
  
  for (let line of lines) {
    line = line.trimEnd();
    if (line.startsWith('## ')) {
      const eraTitle = line.substring(3).trim();
      if (eraTitle.toLowerCase().includes('cards & vector')) continue;
      currentEra = eraTitle;
      continue;
    }
    
    // Top-level bullet
    if (line.trim().startsWith('*')) {
      const matchWithTitle = line.match(/^\*\s+\*\*([^*]+)\s+[-–—]\s+([^*:]+)(?::\*\*(?:\s*:)?|\*\*:\s*)\s*(.*)$/);
      if (matchWithTitle) {
        const time = matchWithTitle[1].trim();
        const title = matchWithTitle[2].trim();
        const desc = matchWithTitle[3].trim();
        parentTime = time;
        timelineEvents.push({
          era: currentEra,
          time,
          title,
          desc,
          year: parseYear(time)
        });
        continue;
      }
      
      const matchSimple = line.match(/^\*\s+\*\*([^*:]+)(?::\*\*|\*\*:\s*)\s*(.*)$/);
      if (matchSimple) {
        const time = matchSimple[1].trim();
        const desc = matchSimple[2].trim();
        parentTime = time;
        timelineEvents.push({
          era: currentEra,
          time,
          title: time,
          desc,
          year: parseYear(time)
        });
        continue;
      }
    }
    
    // Nested bullet
    if (line.startsWith(' ') || line.startsWith('\t')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('*')) {
        const matchNested = trimmed.match(/^\*\s+\*\*([^*:]+)(?::\*\*|\*\*:\s*)\s*(.*)$/);
        if (matchNested) {
          const title = matchNested[1].trim();
          const desc = matchNested[2].trim();
          timelineEvents.push({
            era: currentEra,
            time: parentTime,
            title,
            desc,
            year: parseYear(parentTime)
          });
          continue;
        }
      }
    }
  }
}

async function initTimeline() {
  try {
    const page = await window.hapaWiki.getPage('Canon/Timeline');
    if (page && page.body) {
      parseTimelineEvents(page.body);
      populateTimelineEraFilter();
    }
  } catch (err) {
    console.error('Error loading timeline page:', err);
  }
}

function populateTimelineEraFilter() {
  const select = el('timelineEraFilter');
  if (!select) return;
  const eras = [...new Set(timelineEvents.map(e => e.era))].filter(Boolean);
  select.innerHTML = '<option value="">All Eras</option>';
  for (const era of eras) {
    const opt = document.createElement('option');
    opt.value = era;
    opt.textContent = era;
    select.appendChild(opt);
  }
}

function formatDescription(desc) {
  let html = escapeHtml(desc);
  html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, alias) => {
    return `<a href="#" data-wikilink="${escapeHtml(target.trim())}">${escapeHtml(alias.trim())}</a>`;
  });
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const label = target.trim().split('/').pop();
    return `<a href="#" data-wikilink="${escapeHtml(target.trim())}">${escapeHtml(label)}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  return html;
}

function renderTimeline() {
  const listEl = el('timelineEventsList');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  const query = el('timelineSearch').value.trim().toLowerCase();
  const eraFilter = el('timelineEraFilter').value;
  const sliderVal = parseInt(el('timelineZoomSlider').value, 10);
  
  if (sliderVal > 0) {
    el('timelineZoomVal').textContent = `Log Zoom: x${sliderVal}`;
  } else {
    el('timelineZoomVal').textContent = 'Compact';
  }
  
  let filtered = timelineEvents.filter(e => {
    if (eraFilter && e.era !== eraFilter) return false;
    if (query) {
      const matchText = `${e.time} ${e.era} ${e.title} ${e.desc}`.toLowerCase();
      if (!matchText.includes(query)) return false;
    }
    return true;
  });
  
  filtered.sort((a, b) => a.year - b.year);
  
  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty" style="padding: 20px;">No matching timeline events found.</p>';
    return;
  }
  
  filtered.forEach((e, idx) => {
    const item = document.createElement('div');
    item.className = 'timeline-event-item';
    
    if (sliderVal > 0 && idx > 0) {
      const prev = filtered[idx - 1];
      const yearDiff = Math.abs(e.year - prev.year);
      const margin = Math.min(250, 24 + Math.log1p(yearDiff) * sliderVal);
      item.style.marginTop = `${margin}px`;
    }
    
    const card = document.createElement('div');
    card.className = 'timeline-event-card';
    card.dataset.shortDesc = e.desc ? e.desc.slice(0, 100) + (e.desc.length > 100 ? '...' : '') : '';
    
    card.innerHTML = `
      <div class="timeline-event-meta">
        <span class="timeline-event-time">${escapeHtml(e.time)}</span>
        <span class="timeline-event-era">${escapeHtml(e.era)}</span>
      </div>
      <h3 class="timeline-event-title">${escapeHtml(e.title)}</h3>
      <p class="timeline-event-desc">${escapeHtml(card.dataset.shortDesc)}</p>
    `;
    
    card.onclick = (ev) => {
      if (ev.target.tagName === 'A' || ev.target.closest('a')) return;
      
      const isExpanded = card.classList.contains('expanded');
      
      listEl.querySelectorAll('.timeline-event-card.expanded').forEach(c => {
        if (c === card) return;
        c.classList.remove('expanded');
        const details = c.querySelector('.timeline-event-details');
        if (details) details.remove();
        const descEl = c.querySelector('.timeline-event-desc');
        if (descEl) descEl.textContent = c.dataset.shortDesc;
      });
      
      if (isExpanded) {
        card.classList.remove('expanded');
        const details = card.querySelector('.timeline-event-details');
        if (details) details.remove();
        const descEl = card.querySelector('.timeline-event-desc');
        if (descEl) descEl.textContent = card.dataset.shortDesc;
      } else {
        card.classList.add('expanded');
        const descEl = card.querySelector('.timeline-event-desc');
        if (descEl) {
          descEl.innerHTML = formatDescription(e.desc);
        }
        
        const details = document.createElement('div');
        details.className = 'timeline-event-details';
        
        const links = [];
        const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
        let m;
        while ((m = linkRegex.exec(e.desc)) !== null) {
          const target = m[1].trim();
          const alias = m[2] ? m[2].trim() : target.split('/').pop();
          links.push({ target, alias });
        }
        
        let linksHtml = '';
        if (links.length > 0) {
          linksHtml = `
            <div style="margin-top: 8px; font-size: 11px; color: var(--muted);">
              <strong>Related Pages:</strong> 
              ${links.map(l => `<a href="#" data-wikilink="${escapeHtml(l.target)}">${escapeHtml(l.alias)}</a>`).join(', ')}
            </div>
          `;
        }
        
        details.innerHTML = `
          <div style="color: var(--muted); font-size: 11px; line-height: 1.4;">
            Era Context: ${escapeHtml(e.era)}
          </div>
          ${linksHtml}
        `;
        card.appendChild(details);
      }
    };
    
    card.onmouseenter = () => item.classList.add('hovered');
    card.onmouseleave = () => item.classList.remove('hovered');
    
    item.appendChild(card);
    
    const marker = document.createElement('div');
    marker.className = 'timeline-event-marker';
    item.appendChild(marker);
    
    listEl.appendChild(item);
  });
}

function setupTimelineControls() {
  const tSearch = el('timelineSearch');
  const tEra = el('timelineEraFilter');
  const tSlider = el('timelineZoomSlider');
  
  if (tSearch) {
    tSearch.addEventListener('input', () => renderTimeline());
  }
  if (tEra) {
    tEra.addEventListener('change', () => renderTimeline());
  }
  if (tSlider) {
    tSlider.addEventListener('input', () => renderTimeline());
  }
  
  const listEl = el('timelineEventsList');
  if (listEl) {
    listEl.addEventListener('click', ev => {
      const a = ev.target.closest('[data-wikilink]');
      if (a) {
        ev.preventDefault();
        const target = resolveTarget(a.dataset.wikilink);
        if (target) {
          openPage(target);
        }
      }
    });
  }
}

function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function slugTitle(slug) { return wiki?.pages?.[slug]?.title || slug; }

function markdownToHtml(md, fromSlug=currentSlug) {
  return window.hapaWiki.renderMarkdown(md, fromSlug);
}

function resolveTarget(target, fromSlug=currentSlug) {
  target = target.replace(/\.md$/i, '').split('|')[0].trim();
  if (wiki.pages[target]) return target;
  const fromDir = fromSlug?.includes('/') ? fromSlug.split('/').slice(0,-1).join('/') : '';
  if (fromDir && wiki.pages[`${fromDir}/${target}`]) return `${fromDir}/${target}`;
  const lower = target.toLowerCase();
  const direct = wiki.orderedSlugs.find(s => s.toLowerCase() === lower);
  if (direct) return direct;
  const baseMatches = wiki.orderedSlugs.filter(s => s.split('/').pop().toLowerCase() === lower);
  return baseMatches.length ? baseMatches[0] : null;
}

function pageMatches(page, q) {
  const section = el('sectionFilter').value;
  const kind = el('kindFilter').value;
  const status = el('statusFilter').value;
  if (section && page.section !== section) return false;
  if (kind && page.kind !== kind) return false;
  if (status && page.status !== status) return false;
  if (q && !page.searchText.includes(q)) return false;
  return true;
}

function renderTree(filter='') {
  const tree = el('tree'); tree.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const groups = {};
  let total = 0;
  for (const slug of wiki.orderedSlugs) {
    const p = wiki.pages[slug];
    if (!pageMatches(p, q)) continue;
    total += 1;
    const group = p.section || (slug.includes('/') ? slug.split('/')[0] : 'Root');
    (groups[group] ||= []).push(slug);
  }
  const imageCount = wiki.stats.images || 0;
  const videoCount = wiki.stats.videos || 0;
  const artifactCount = wiki.stats.artifactAssets || 0;
  const musicCount = wiki.stats.musicSongs || 0;
  el('stats').textContent = `${total} shown · ${wiki.stats.markdownFiles} pages · ${wiki.stats.cards} card pages · ${wiki.stats.links} links · ${imageCount} images · ${videoCount} videos · ${artifactCount} artifact assets · ${musicCount} songs`;
  for (const group of Object.keys(groups).sort()) {
    const wrap = document.createElement('div'); wrap.className = 'tree-group';
    wrap.innerHTML = `<div class="tree-title">${escapeHtml(group)} (${groups[group].length})</div>`;
    for (const slug of groups[group].slice(0, q ? 400 : 150)) {
      const p = wiki.pages[slug];
      const a = document.createElement('a'); a.className = 'nav-item' + (slug===currentSlug?' active':'');
      a.textContent = p.kind && p.kind !== group ? `${p.title} · ${p.kind}` : p.title; a.title = slug; a.onclick = () => openPage(slug);
      wrap.appendChild(a);
    }
    tree.appendChild(wrap);
  }
}

async function openPage(slug, push=true) {
  if (!wiki.pages[slug]) slug = 'README';
  if (push && currentSlug && currentSlug !== slug) { history.push(currentSlug); future = []; }
  currentSlug = slug;
  switchView('doc');
  const page = await window.hapaWiki.getPage(slug);
  currentPage = page;
  isEditing = false;
  setEditMode(false);
  const fm = Object.keys(page.frontmatter || {}).length ? `<div class="frontmatter">${escapeHtml(JSON.stringify(page.frontmatter, null, 2))}</div>` : '';
  const html = await markdownToHtml(page.body, slug);
  const card = cardFromPage({ ...page, ...(wiki.pages[page.slug] || {}) });
  el('page').innerHTML = card
    ? renderCardPageDossier(page, html, fm)
    : `<article class="article">${fm}${html}</article>`;
  el('crumb').textContent = slug;
  document.title = isDetachedCardWindow ? `Hapa Card - ${page.title}` : 'Hapa Wiki Viewer';
  const detachButton = el('detachPage');
  if (detachButton) detachButton.style.display = card ? '' : 'none';
  bindCardPageActions(card);
  renderLinks(page);
  await renderWikiOps(page);
  renderTree(el('search').value);
  drawGraph(page);
  document.querySelectorAll('[data-wikilink], a[href^="hapa-wiki:"]').forEach(a => a.onclick = ev => {
    ev.preventDefault();
    const href = a.getAttribute('href') || '';
    const rawTarget = a.dataset.wikilink || decodeURIComponent(href.replace(/^hapa-wiki:/, ''));
    const target = resolveTarget(rawTarget);
    if (target) openPage(target);
  });
}

function musicTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function drawMusicVisualizer(canvas, analyser) {
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const render = () => {
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, '#78a6ff');
    gradient.addColorStop(0.5, '#f4c35c');
    gradient.addColorStop(1, '#ff78c8');
    ctx.fillStyle = 'rgba(8, 11, 20, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = gradient;
    const bars = 48;
    const step = Math.floor(data.length / bars) || 1;
    const gap = 2;
    const w = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const value = data[i * step] || 0;
      const h = Math.max(3, (value / 255) * canvas.height);
      ctx.fillRect(i * w, canvas.height - h, Math.max(1, w - gap), h);
    }
    musicAnimationFrame = requestAnimationFrame(render);
  };
  if (musicAnimationFrame) cancelAnimationFrame(musicAnimationFrame);
  render();
}

function wireMusicAudio(audio, canvas) {
  if (!audio || !canvas) return;
  audio.addEventListener('play', () => {
    try {
      if (!musicAudioCtx) musicAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (musicAudioCtx.state === 'suspended') musicAudioCtx.resume();
      if (!audio.dataset.analyserWired) {
        const src = musicAudioCtx.createMediaElementSource(audio);
        musicAnalyser = musicAudioCtx.createAnalyser();
        musicAnalyser.fftSize = 128;
        src.connect(musicAnalyser);
        musicAnalyser.connect(musicAudioCtx.destination);
        audio.dataset.analyserWired = '1';
      }
      drawMusicVisualizer(canvas, musicAnalyser);
    } catch (err) {
      console.warn('Music visualizer unavailable:', err);
    }
  });
  audio.addEventListener('pause', () => {
    if (musicAnimationFrame) cancelAnimationFrame(musicAnimationFrame);
  });
}

function renderMusicPlayer(page) {
  const box = el('musicPlayerPanel');
  if (!box) return;
  box.innerHTML = '';
  const songs = page.musicMatches || [];
  if (!songs.length) {
    box.innerHTML = '<p class="empty">No mapped Hapa songs yet. Run the music indexer to connect songs to this page.</p>';
    return;
  }
  const lead = songs[0];
  const wrap = document.createElement('div');
  wrap.className = 'music-player-card';
  const songCards = songs.slice(0, 5).map((song, idx) => `
    <button class="music-song-chip ${idx === 0 ? 'active' : ''}" data-music-index="${idx}">
      <span>${escapeHtml(song.title || 'Untitled song')}</span>
      <small>${escapeHtml(song.connection || song.explanation || 'Connected by shared Hapa development/canon language').slice(0, 160)}</small>
    </button>
  `).join('');
  wrap.innerHTML = `
    <div class="music-now">
      <div class="music-kicker">Hapa development soundtrack</div>
      <div class="music-title">${escapeHtml(lead.title || 'Untitled song')}</div>
      <div class="music-meta">${escapeHtml([lead.model, lead.majorModelVersion, musicTime(lead.duration)].filter(Boolean).join(' · '))}</div>
      <audio class="music-audio" controls preload="metadata" src="${escapeHtml(lead.audioUrl || '')}"></audio>
      <canvas class="music-visualizer" width="280" height="74"></canvas>
      <p class="music-explanation">${escapeHtml(lead.connection || lead.explanation || 'This song shares language with the current wiki artifact and is part of the Hapa development/canon music archive.')}</p>
      <details class="music-lyrics"><summary>Lyric excerpt / source data</summary><pre>${escapeHtml(lead.lyricExcerpt || lead.tags || '')}</pre></details>
    </div>
    <div class="music-song-list">${songCards}</div>
  `;
  box.appendChild(wrap);
  const audio = wrap.querySelector('.music-audio');
  const canvas = wrap.querySelector('.music-visualizer');
  wireMusicAudio(audio, canvas);
  wrap.querySelectorAll('[data-music-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = songs[Number(btn.dataset.musicIndex || 0)] || lead;
      wrap.querySelectorAll('.music-song-chip').forEach(chip => chip.classList.remove('active'));
      btn.classList.add('active');
      wrap.querySelector('.music-title').textContent = next.title || 'Untitled song';
      wrap.querySelector('.music-meta').textContent = [next.model, next.majorModelVersion, musicTime(next.duration)].filter(Boolean).join(' · ');
      wrap.querySelector('.music-explanation').textContent = next.connection || next.explanation || 'Connected by shared Hapa development/canon language.';
      wrap.querySelector('.music-lyrics pre').textContent = next.lyricExcerpt || next.tags || '';
      audio.src = next.audioUrl || '';
      audio.load();
    });
  });
}

function renderLinks(page) {
  const backlinkBox = el('backlinks'); backlinkBox.innerHTML = '';
  if (!page.backlinks.length) backlinkBox.innerHTML = '<p class="empty">No backlinks yet.</p>';
  for (const b of page.backlinks) backlinkBox.appendChild(linkEl(b.source, b.title));
  const out = el('outlinks'); out.innerHTML = '';
  if (!page.links.length) out.innerHTML = '<p class="empty">No outgoing wikilinks.</p>';
  for (const l of page.links) out.appendChild(linkEl(l.resolved || resolveTarget(l.target), l.alias || l.target, !l.resolved));
  const visualBox = el('visuals'); visualBox.innerHTML = '';
  const images = page.images || [];
  const videos = page.videos || [];
  if (!images.length && !videos.length) visualBox.innerHTML = '<p class="empty">No page visuals yet.</p>';
  for (const img of images) {
    const item = document.createElement('div');
    item.className = 'visual-item';
    item.innerHTML = `
      <div class="visual-item-alt">${escapeHtml(img.alt || 'Untitled visual')}</div>
      <div class="visual-item-src">${escapeHtml(img.src)}</div>
    `;
    visualBox.appendChild(item);
  }
  for (const video of videos) {
    const item = document.createElement('div');
    item.className = 'visual-item';
    item.innerHTML = `
      <div class="visual-item-alt">Video: ${escapeHtml(video.title || 'Node demo')}</div>
      <div class="visual-item-src">${escapeHtml(video.src)}</div>
    `;
    visualBox.appendChild(item);
  }
  renderMusicPlayer(page);
  const artifactBox = el('artifactAugments');
  artifactBox.innerHTML = '';
  const artifacts = page.artifactMatches || [];
  if (!artifacts.length) artifactBox.innerHTML = '<p class="empty">No artifact matches yet.</p>';
  for (const asset of artifacts) {
    const item = document.createElement('div');
    item.className = 'artifact-augment-card';
    const preview = asset.thumbnailUrl
      ? `<img class="artifact-augment-thumb" src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(asset.title || 'Artifact preview')}" loading="lazy" />`
      : `<div class="artifact-augment-thumb placeholder">${escapeHtml(asset.kind || 'asset')}</div>`;
    const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : '';
    const duration = asset.durationSeconds ? `${Number(asset.durationSeconds).toFixed(1)}s` : '';
    const meta = [asset.kind, asset.sourceGroup, dims, duration].filter(Boolean).join(' · ');
    item.innerHTML = `
      ${preview}
      <div class="artifact-augment-body">
        <div class="artifact-augment-title">${escapeHtml(asset.title || asset.id)}</div>
        <div class="artifact-augment-meta">${escapeHtml(meta)}</div>
        <div class="artifact-augment-tags">${(asset.tags || []).slice(0, 5).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="artifact-augment-src">${escapeHtml(asset.relPath || asset.sourcePath || '')}</div>
      </div>
    `;
    artifactBox.appendChild(item);
  }
  const retrieval = { slug: page.slug, relativePath: page.relativePath, ...page.frontmatter };
  el('retrieval').textContent = JSON.stringify(retrieval, null, 2);
}

async function renderWikiOps(page) {
  await populateCommentCategories();
  const [comments, versions] = await Promise.all([
    window.hapaWiki.listComments({ slug: page.slug, limit: 100 }),
    window.hapaWiki.listVersions(page.slug),
  ]);
  renderComments(comments || []);
  renderVersions(versions || []);
}

async function populateCommentCategories() {
  const list = await window.hapaWiki.getCategories();
  const datalist = el('commentCategoryOptions');
  datalist.innerHTML = '';
  for (const category of list || []) {
    const option = document.createElement('option');
    option.value = category.id;
    option.label = category.label || category.id;
    datalist.appendChild(option);
  }
  if (!el('commentCategory').value) el('commentCategory').value = 'open-question';
}

function renderComments(comments) {
  const box = el('commentsList');
  box.innerHTML = '';
  if (!comments.length) {
    box.innerHTML = '<p class="empty">No comments or flags for this page.</p>';
    return;
  }
  for (const comment of comments) {
    const item = document.createElement('div');
    item.className = `comment-card status-${escapeHtml(comment.status || 'open')}`;
    const tags = (comment.tags || []).slice(0, 6).map(tag => `<span>${escapeHtml(tag)}</span>`).join('');
    const quote = comment.quote ? `<blockquote>${escapeHtml(comment.quote)}</blockquote>` : '';
    const nextStatus = comment.status === 'resolved' ? 'open' : 'resolved';
    item.innerHTML = `
      <div class="comment-card-head">
        <span class="comment-category">${escapeHtml(comment.category)}</span>
        <span class="comment-status">${escapeHtml(comment.status)}</span>
      </div>
      ${quote}
      <div class="comment-body">${escapeHtml(comment.body)}</div>
      <div class="comment-meta">${escapeHtml(comment.author)} · ${escapeHtml(comment.actorType)} · p${Number(comment.priority || 0)} · ${escapeHtml(comment.createdAt || '')}</div>
      <div class="comment-tags">${tags}</div>
      <div class="ops-row"><button data-comment-id="${escapeHtml(comment.id)}" data-comment-status="${nextStatus}">${nextStatus === 'resolved' ? 'Resolve' : 'Reopen'}</button></div>
    `;
    box.appendChild(item);
  }
  box.querySelectorAll('[data-comment-id]').forEach(btn => {
    btn.onclick = async () => {
      await window.hapaWiki.updateComment(btn.dataset.commentId, {
        status: btn.dataset.commentStatus,
        author: 'wiki-viewer',
        actorType: 'human',
      });
      if (currentPage) await renderWikiOps(currentPage);
    };
  });
}

function renderVersions(versions) {
  const box = el('versionsList');
  box.innerHTML = '';
  if (!versions.length) {
    box.innerHTML = '<p class="empty">No saved versions yet.</p>';
    return;
  }
  for (const version of versions.slice(0, 8)) {
    const item = document.createElement('div');
    item.className = 'version-card';
    item.innerHTML = `
      <div class="version-hash">${escapeHtml((version.contentHash || '').slice(0, 12))}</div>
      <div class="version-message">${escapeHtml(version.message || 'Version snapshot')}</div>
      <div class="comment-meta">${escapeHtml(version.author)} · ${escapeHtml(version.actorType)} · ${escapeHtml(version.createdAt || '')}</div>
    `;
    box.appendChild(item);
  }
}

function setEditMode(active) {
  isEditing = active;
  el('editPage').style.display = active ? 'none' : '';
  el('savePage').style.display = active ? '' : 'none';
  el('cancelEdit').style.display = active ? '' : 'none';
}

function beginSourceEdit() {
  if (!currentPage) return;
  setEditMode(true);
  switchView('doc');
  el('page').innerHTML = `
    <div class="source-editor-wrap">
      <div class="source-editor-meta">Editing ${escapeHtml(currentPage.slug)}. Saves are versioned through Wiki Ops.</div>
      <textarea id="sourceEditor" class="source-editor"></textarea>
    </div>
  `;
  el('sourceEditor').value = currentPage.raw || '';
}

async function saveSourceEdit() {
  if (!currentPage || !isEditing) return;
  const editor = el('sourceEditor');
  await window.hapaWiki.updatePage({
    slug: currentPage.slug,
    content: editor.value,
    author: 'wiki-viewer',
    actorType: 'human',
    message: 'UI source edit',
  });
  setWikiIndex(await window.hapaWiki.reindex());
  setupFilters();
  await openPage(currentPage.slug, false);
}

async function cancelSourceEdit() {
  if (!currentPage) return;
  setEditMode(false);
  await openPage(currentPage.slug, false);
}

async function appendCurrentPage() {
  if (!currentPage) return;
  const body = el('appendBody').value.trim();
  if (!body) return;
  await window.hapaWiki.appendPage({
    slug: currentPage.slug,
    heading: el('appendHeading').value.trim(),
    body,
    author: 'wiki-viewer',
    actorType: 'human',
    message: 'UI append',
  });
  el('appendBody').value = '';
  el('appendHeading').value = '';
  setWikiIndex(await window.hapaWiki.reindex());
  setupFilters();
  await openPage(currentPage.slug, false);
}

function useCurrentSelection() {
  const selected = String(window.getSelection()?.toString() || '').trim();
  if (selected) el('commentQuote').value = selected.slice(0, 2000);
}

async function addCurrentComment() {
  if (!currentPage) return;
  const body = el('commentBody').value.trim();
  if (!body) return;
  const category = el('commentCategory').value.trim() || 'open-question';
  await window.hapaWiki.addComment({
    slug: currentPage.slug,
    category,
    status: el('commentStatus').value || 'open',
    priority: Number(el('commentPriority').value || 2),
    quote: el('commentQuote').value.trim(),
    body,
    tags: el('commentTags').value.split(',').map(tag => tag.trim()).filter(Boolean),
    author: 'wiki-viewer',
    actorType: 'human',
  });
  el('commentBody').value = '';
  el('commentQuote').value = '';
  el('commentTags').value = '';
  await renderWikiOps(currentPage);
}

function linkEl(slug, label, missing=false) { const a = document.createElement('a'); a.className='link-item'; a.textContent = missing ? `Missing: ${label}` : label; a.title=slug||''; if(slug) a.onclick=()=>openPage(slug); return a; }

function drawGraph(page) {
  const c = el('graph'), ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  const related = [...new Set([page.slug, ...page.links.map(l => l.resolved).filter(Boolean), ...page.backlinks.map(b => b.source)])].slice(0,18);
  const cx=c.width/2, cy=c.height/2; ctx.strokeStyle='#273047'; ctx.fillStyle='#78a6ff'; ctx.font='10px sans-serif';
  related.forEach((slug,i)=>{ const angle=(i/Math.max(1,related.length))*Math.PI*2; const r=i===0?0:82; const x=cx+Math.cos(angle)*r, y=cy+Math.sin(angle)*r; if(i>0){ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();} ctx.fillStyle=i===0?'#f4c35c':'#78a6ff'; ctx.beginPath();ctx.arc(x,y,i===0?7:4,0,Math.PI*2);ctx.fill(); ctx.fillStyle='#e9edf8'; ctx.fillText(slugTitle(slug).slice(0,18), x+6, y+3); });
}

async function load() {
  if (isDetachedCardWindow) document.body.classList.add('card-window-mode');
  el('rootPath').textContent = 'Indexing wiki...';
  setWikiIndex(isDetachedCardWindow
    ? await window.hapaWiki.loadCardWindow(initialDetachedSlug)
    : await window.hapaWiki.load());
  el('rootPath').textContent = wiki.root;
  setupFilters();
  renderTree();
  initPortal();
  await initTimeline();
  if (isDetachedCardWindow) {
    const target = resolveTarget(initialDetachedSlug) || (wiki.pages.README ? 'README' : wiki.orderedSlugs[0]);
    await openPage(target, false);
    return;
  }
  await openPage(wiki.pages.README ? 'README' : wiki.orderedSlugs[0], false);
  switchView('portal');
}

function fillSelect(id, values, label) {
  const s = el(id);
  s.innerHTML = `<option value="">${label}</option>`;
  Object.entries(values || {}).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).forEach(([value,count]) => {
    const opt = document.createElement('option'); opt.value = value; opt.textContent = `${value} (${count})`; s.appendChild(opt);
  });
}

function setupFilters() {
  fillSelect('sectionFilter', wiki.facets?.sections, 'All sections');
  fillSelect('kindFilter', wiki.facets?.kinds, 'All kinds');
  fillSelect('statusFilter', wiki.facets?.statuses, 'All statuses');
  const quick = el('quickbar'); quick.innerHTML = '';
  ['Names','Nodes','Cards','Canon','Systems','Development'].forEach(section => {
    if (!wiki.facets?.sections?.[section]) return;
    const chip = document.createElement('button'); chip.className='chip'; chip.textContent = `${section} ${wiki.facets.sections[section]}`;
    chip.onclick = () => { el('sectionFilter').value = section; renderTree(el('search').value); };
    quick.appendChild(chip);
  });
}

function setSection(section) { el('sectionFilter').value = section; renderTree(el('search').value); }
function randomOpen() {
  const q = el('search').value.trim().toLowerCase();
  const matches = wiki.orderedSlugs.filter(slug => pageMatches(wiki.pages[slug], q));
  if (matches.length) openPage(matches[Math.floor(Math.random() * matches.length)]);
}

function toggleCardDensity() {
  cardDensity = cardDensity === 'compact' ? 'detail' : 'compact';
  localStorage.setItem('hapa-card-density', cardDensity);
  renderCardBrowser();
}

function initSoundToggle() {
  window.hapaSfx?.bindGlobalUiSounds?.(document);
  const btn = el('toggleSound');
  if (!btn) return;
  const sync = () => {
    const muted = window.hapaSfx?.getMuteState?.() || false;
    btn.textContent = muted ? 'SFX Off' : 'SFX On';
    btn.classList.toggle('muted', muted);
    btn.setAttribute('aria-pressed', String(!muted));
  };
  sync();
  btn.onclick = ev => {
    ev.stopPropagation();
    const muted = window.hapaSfx?.toggleMute?.();
    sync();
    if (!muted) window.hapaSfx?.playCardSnapSound?.();
  };
}

function selectAdjacentCard(direction) {
  const cards = sortCards(getFilteredCards());
  if (!cards.length) return;
  const idx = Math.max(0, cards.findIndex(card => card.slug === selectedCardSlug));
  const next = cards[Math.max(0, Math.min(cards.length - 1, idx + direction))];
  selectedCardSlug = next.slug;
  renderCardBrowser();
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', ev => {
    const tag = ev.target?.tagName?.toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target?.isContentEditable;
    if (!editable && ev.key === '/') {
      ev.preventDefault();
      if (currentView === 'cards') el('cardSearch')?.focus();
      else el('search')?.focus();
      return;
    }
    if (currentView !== 'cards' || editable) return;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      selectAdjacentCard(1);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      selectAdjacentCard(-1);
    } else if (ev.key === 'Enter' && selectedCardSlug) {
      ev.preventDefault();
      openPage(selectedCardSlug);
    }
  });
}

el('search').addEventListener('input', e => renderTree(e.target.value));
['sectionFilter','kindFilter','statusFilter'].forEach(id => el(id).addEventListener('change', () => renderTree(el('search').value)));
['cardSearch','cardTypeFilter','cardMediaFilter','cardStatusFilter','cardTierFilter','cardSort'].forEach(id => el(id).addEventListener('input', renderCardBrowser));
['cardTypeFilter','cardMediaFilter','cardStatusFilter','cardTierFilter','cardSort'].forEach(id => el(id).addEventListener('change', renderCardBrowser));
el('cardDensityToggle').onclick = toggleCardDensity;
el('randomPage').onclick = randomOpen;
el('discoverNodes').onclick = () => setSection('Nodes');
el('discoverNames').onclick = () => setSection('Names');
el('discoverCards').onclick = () => setSection('Cards');
el('home').onclick = () => openPage('README');
el('back').onclick = () => { const s=history.pop(); if(s){ future.push(currentSlug); openPage(s,false);} };
el('forward').onclick = () => { const s=future.pop(); if(s){ history.push(currentSlug); openPage(s,false);} };
el('showFinder').onclick = () => window.hapaWiki.showInFinder(currentSlug);
el('detachPage').onclick = () => {
  if (currentSlug && cardFromPage({ ...(currentPage || {}), ...(wiki.pages[currentSlug] || {}), slug: currentSlug })) {
    window.hapaWiki.openCardWindow(currentSlug);
  }
};
el('reindex').onclick = async () => { setWikiIndex(await window.hapaWiki.reindex()); setupFilters(); renderTree(el('search').value); openPage(currentSlug,false); };
el('openFolder').onclick = async () => { const next = await window.hapaWiki.openFolder(); if(next){ setWikiIndex(next); el('rootPath').textContent=wiki.root; setupFilters(); renderTree(); openPage(wiki.pages.README?'README':wiki.orderedSlugs[0],false); } };
el('editPage').onclick = beginSourceEdit;
el('savePage').onclick = saveSourceEdit;
el('cancelEdit').onclick = cancelSourceEdit;
el('appendPage').onclick = appendCurrentPage;
el('useSelection').onclick = useCurrentSelection;
el('addComment').onclick = addCurrentComment;

// Tab Navigation Controls
el('togglePortal').onclick = () => { activePortalSection = null; el('crumb').textContent = 'Portal'; switchView('portal'); };
el('toggleCards').onclick = () => { el('crumb').textContent = 'Cards'; switchView('cards'); };
el('toggleTimeline').onclick = () => switchView('timeline');
el('toggleDoc').onclick = () => switchView('doc');

initSoundToggle();
setupTimelineControls();
setupKeyboardShortcuts();

load().catch(err => {
  console.error(err);
  el('rootPath').textContent = 'Load failed';
  switchView('doc');
  el('page').innerHTML = `<article class="article"><h1>Hapa Wiki Viewer failed to load</h1><pre>${escapeHtml(err.stack || err.message)}</pre></article>`;
});
