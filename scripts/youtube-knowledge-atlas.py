#!/usr/bin/env python3
"""Build a Hapa-oriented YouTube Knowledge Atlas from transcript-review pages.

The atlas is intentionally wiki-native: category landing pages, topic pages, skill
consolidation pages, matrices, and orientation maps that connect Calder, Hapa, and
source-backed knowledge evidence.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import os
import re
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

DEFAULT_WIKI = Path(os.environ.get('HAPA_WIKI_ROOT') or os.environ.get('HAPA_WIKI_PATH') or '~/Hapa_Worldbuilding_Wiki').expanduser()
ATLAS_ROOT_REL = 'YouTube/Knowledge Atlas'
REPORT_REL = 'Raw/YouTube/reports/youtube-knowledge-atlas-latest.json'

CATEGORY_ORDER = ['AI', 'Technology', 'Science & Math', 'Geopolitics', 'History', 'Religion & Philosophy', 'Other / Unclassified']

CATEGORY_NARRATIVES = {
    'AI': {
        'what': 'AI is the body of knowledge about agents, models, coding assistants, generative media, evaluation, automation, and the fast-changing tool ecosystem.',
        'hapa': 'For Hapa, this category is the operating engine: it supplies patterns for agent orchestration, local-first media generation, wiki growth, source review, card drafting, and app development.',
        'subcats': ['Agentic coding and CLI agents', 'Generative media and multimodal tools', 'Model ecosystem and capability tracking', 'RAG, memory, and second-brain workflows', 'AI product strategy and governance'],
        'questions': ['Which workflows should become repeatable Hapa protocols?', 'Which tools deserve local app integration?', 'Which demos map to Skill Cards rather than one-off inspiration?'],
    },
    'Technology': {
        'what': 'Technology collects software, platforms, devices, UX, infrastructure, programming practice, security, and product-building knowledge.',
        'hapa': 'For Hapa, this category turns imagination into implementation: viewers, registries, apps, local databases, media pipelines, and operating dashboards.',
        'subcats': ['Local-first apps and databases', 'Developer tooling and architecture', 'Interfaces and visualization', 'Security, privacy, and operations', 'Product systems and shipping loops'],
        'questions': ['Which tools reduce friction for Calder?', 'Which platform ideas should harden into Hapa nodes?', 'Which implementation patterns support durable personal infrastructure?'],
    },
    'Science & Math': {
        'what': 'Science & Math gathers explanatory models, quantitative reasoning, complexity, physics, biology, computation, and evidence-based inquiry.',
        'hapa': 'For Hapa, it provides the epistemic skeleton: model-building habits, simulation literacy, causal thinking, and system metaphors that can make lore and apps coherent.',
        'subcats': ['Causal models and systems thinking', 'Simulation and complexity', 'Physics/cosmology as metaphor', 'Biology and intelligence', 'Mathematical reasoning and visualization'],
        'questions': ['Which scientific frames can become Hapa world rules?', 'Which mental models improve Calder’s app design?', 'Which explanations deserve visual cards or diagrams?'],
    },
    'Geopolitics': {
        'what': 'Geopolitics covers power, states, war, institutions, economics, ideology, information conflict, and civilization-scale incentives.',
        'hapa': 'For Hapa, this is strategic literacy: it explains why systems fail, why narratives compete, and why sovereign memory / resilient tooling matter.',
        'subcats': ['State power and institutions', 'War, security, and deterrence', 'Economics and industrial capacity', 'Media, propaganda, and narrative conflict', 'Civilization and governance models'],
        'questions': ['What does this teach about resilient systems?', 'Which patterns explain institutional failure or coordination?', 'How should Hapa encode power, trust, and narrative into canon?'],
    },
    'History': {
        'what': 'History contains long-horizon memory: biographies, civilizations, wars, inventions, cultural change, and repeated human patterns.',
        'hapa': 'For Hapa, history is the precedent layer. It gives lore depth, failure modes, archetypes, and evidence that today’s problems are rarely new.',
        'subcats': ['Civilizational rise/fall', 'Biographical models', 'War and institution memory', 'Technology transitions', 'Cultural and religious continuities'],
        'questions': ['Which historical pattern repeats in Hapa lore?', 'Which biography informs Calder’s character sheet?', 'Which precedent should become a card or system rule?'],
    },
    'Religion & Philosophy': {
        'what': 'Religion & Philosophy collects meaning, ethics, metaphysics, practice, identity, attention, consciousness, and ultimate-value questions.',
        'hapa': 'For Hapa, this anchors the Names/identity layer: why tools matter, what a self is, what memory is for, and what kind of life Calder is building toward.',
        'subcats': ['Identity, names, and selfhood', 'Ethics and virtue', 'Attention and practice', 'Consciousness and metaphysics', 'Meaning-making and ritual'],
        'questions': ['What value should guide the build?', 'Which practices strengthen Calder’s agency?', 'Which ideas map to Hapa Names, Phamiliars, or canon?'],
    },
    'Other / Unclassified': {
        'what': 'Other / Unclassified is the compost layer: music, culture, entertainment, miscellaneous channels, and sources not yet cleanly bucketed.',
        'hapa': 'For Hapa, this is not junk. It is affect, taste, aesthetics, personal context, and latent pattern material waiting for better classification.',
        'subcats': ['Aesthetic/taste signals', 'Music and performance', 'Personal-interest fragments', 'Unsorted creator clusters', 'Potential reclassification queue'],
        'questions': ['What should be reclassified?', 'Which sources reveal Calder’s taste?', 'Which fragments should become Hapa media, lore, or mood boards?'],
    },
}

SKILL_LINKS = {
    'Headless Brain Orchestration': '[[Cards/Skill Cards/headless-brain-orchestration-b4d7c83d|Headless Brain Orchestration]]',
    'Knowledge Graph Synthesis': '[[Cards/Skill Cards/knowledge-graph-synthesis-d20c5918|Knowledge Graph Synthesis]]',
    'Knowledge Architecture Blueprinting': '[[Cards/Skill Cards/knowledge-architecture-blueprinting-6e90bc90|Knowledge Architecture Blueprinting]]',
    'Canonical Knowledge Indexing': '[[Cards/Skill Cards/canonical-knowledge-indexing-534db62a|Canonical Knowledge Indexing]]',
    'Modular Knowledge Structuring': '[[Cards/Skill Cards/modular-knowledge-structuring-b28c74fe|Modular Knowledge Structuring]]',
    'Portable Knowledge Capsule': '[[Cards/Skill Cards/portable-knowledge-capsule-8a288c47|Portable Knowledge Capsule]]',
    'Spatial Knowledge Graph Visualization': '[[Cards/Skill Cards/spatial-knowledge-graph-visualization-7c39df9e|Spatial Knowledge Graph Visualization]]',
    'Canonical Knowledge Stewardship': '[[Cards/Skill Cards/canonical-knowledge-stewardship-6a4448b1|Canonical Knowledge Stewardship]]',
}

SKILL_NARRATIVES = {
    'Headless Brain Orchestration': 'Running agents, tools, queues, and local/remote workers as a coordinated second brain rather than isolated chat sessions.',
    'Knowledge Graph Synthesis': 'Turning sources into connected evidence, concepts, backlinks, and useful retrieval structures.',
    'Knowledge Architecture Blueprinting': 'Designing the structure of a system before filling it: schemas, layers, routes, interfaces, protocols, and information flow.',
    'Canonical Knowledge Indexing': 'Making source material findable, traceable, deduplicated, indexed, and synchronized across apps.',
    'Modular Knowledge Structuring': 'Breaking knowledge into small durable modules: cards, pages, sections, chunks, patterns, and reusable templates.',
    'Portable Knowledge Capsule': 'Keeping useful knowledge movable, local-first, compressed, and accessible across contexts/devices.',
    'Spatial Knowledge Graph Visualization': 'Making knowledge navigable through maps, dashboards, graph surfaces, dossiers, and visual orientation pages.',
    'Canonical Knowledge Stewardship': 'Protecting truth, provenance, uncertainty, and review state so Hapa does not confuse generated scaffolds with canon.',
}

HAPA_TARGETS = [
    ('[[Character Sheets/Calder/Calder Character Sheet Prototype]]', 'Personal skill/XP layer and living résumé evidence sink.'),
    ('[[Character Sheets/Calder/Knowledge Gain Ledger]]', 'Source-to-skill ledger for what Calder has learned from YouTube evidence.'),
    ('[[YouTube/Transcript Reviews/Review Queue Status]]', 'Operational queue page for transcript reviews.'),
    ('[[Operations/Hapa Autonomous Ops Dashboard]]', 'Autonomous progress and system health dashboard.'),
    ('[[Cards/Skill Cards/Index]]', 'Skill-card index that should absorb repeated capability evidence.'),
    ('[[Nodes]]', 'App/node responsibility layer for turning source knowledge into tools.'),
    ('[[Development]]', 'Implementation plans, runbooks, and build logs.'),
]

STOP = set('''about after again against already also always another around because before being between called could different does doing during even every first from getting going great here into just know like look made make many maybe more most much need never only other people really right same should something still system take than that their there these thing things think this those through using video want ways what where which while with without work world would your time well good back mean said years down little gonna guys open states country life feel next able pretty saying play might didn real come example click year better point course probably everything give looks news put actually let's okay yeah stuff sort kind bit lot lots part parts trying talking talk talks says tell told thing anything somebody everyone'''.split())


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')


def slugify(s: str) -> str:
    s = s.lower().replace('&', 'and')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return re.sub(r'-+', '-', s) or 'untitled'


def rel(wiki: Path, p: Path) -> str:
    return str(p.relative_to(wiki)).replace('\\','/').removesuffix('.md')


def read_frontmatter(text: str) -> Tuple[dict, str]:
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            raw = text[3:end].strip().splitlines()
            body = text[end+4:]
            fm = {}
            for line in raw:
                if ':' not in line: continue
                k,v=line.split(':',1)
                v=v.strip()
                if v.startswith('[') and v.endswith(']'):
                    fm[k.strip()] = [x.strip().strip('"\'') for x in v[1:-1].split(',') if x.strip()]
                else:
                    fm[k.strip()] = v.strip('"')
            return fm, body
    return {}, text


def extract_section(text: str, heading: str, max_chars=1400) -> str:
    m = re.search(rf'## {re.escape(heading)}\n(.*?)(?=\n## |\Z)', text, re.S)
    return (m.group(1).strip()[:max_chars] if m else '')


def parse_reviews(wiki: Path) -> List[dict]:
    out=[]
    for p in sorted((wiki/'YouTube/Transcript Reviews').glob('*-review.md')):
        if p.name == 'Review Queue Status.md':
            continue
        text=p.read_text(errors='ignore')
        fm, body = read_frontmatter(text)
        vid=fm.get('source_video_id','')
        title=fm.get('title','').replace('Transcript Review - ','') or p.stem
        skill=fm.get('skill_assignment','Unassigned')
        score=int(fm.get('knowledge_gain_score') or 0)
        topics=fm.get('topics') if isinstance(fm.get('topics'), list) else []
        source=fm.get('source_page','')
        m=re.search(r'- Category: (.+)', body)
        category=m.group(1).strip() if m else 'Other / Unclassified'
        m=re.search(r'- Creator/channel: (.+)', body)
        channel=m.group(1).strip() if m else 'Unknown'
        terms=[]
        sec=extract_section(body, 'Extraction Notes', 2600)
        term_part=re.search(r'### High-signal terms\n(.*?)(?=\n### |\Z)', sec, re.S)
        if term_part:
            terms=[x.strip('- ').strip() for x in term_part.group(1).splitlines() if x.strip().startswith('-')]
        summary=extract_section(body, 'One-Screen Summary', 900)
        out.append({
            'path': p,
            'slug': rel(wiki,p),
            'video_id': vid,
            'title': title,
            'skill': skill,
            'score': score,
            'topics': topics,
            'source': source,
            'category': category,
            'channel': channel,
            'terms': terms[:16],
            'summary': summary,
        })
    return out


def top_terms(items: List[dict], n=30) -> List[Tuple[str,int]]:
    c=collections.Counter()
    for it in items:
        for t in it.get('terms') or []:
            t=t.lower().strip()
            if len(t)>2 and t not in STOP:
                c[t]+=1
    return c.most_common(n)


def top_channels(items: List[dict], n=12):
    return collections.Counter(i['channel'] for i in items).most_common(n)


def best_examples(items: List[dict], n=12):
    return sorted(items, key=lambda x: (-x['score'], x['title']))[:n]


def front(title, typ, rid, tags, topics, updated):
    tags_s=', '.join(tags)
    topics_s=', '.join(topics)
    safe_title = title.replace('"', '\\"')
    return f'''---\ntitle: "{safe_title}"\ntype: {typ}\nstatus: active\ntags: [{tags_s}]\ntopics: [{topics_s}]\nretrieval_id: "{rid}"\nupdated: "{updated}"\n---\n\n'''


def write(path: Path, content: str, dry=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not dry:
        path.write_text(content)


def table(rows):
    return '\n'.join(rows) + ('\n' if rows else '')


def examples_table(items: List[dict], maxn=12):
    rows=['| Source | Category | Skill | Score | Why it matters |','|---|---|---|---:|---|']
    for it in best_examples(items, maxn):
        why=(it['summary'].replace('\n',' ')[:160] + '…') if it.get('summary') else 'Evidence-backed source for this grouping.'
        rows.append(f"| [[{it['slug']}|{it['title'][:80]}]] | [[{ATLAS_ROOT_REL}/Categories/{slugify(it['category'])}|{it['category']}]] | {SKILL_LINKS.get(it['skill'], it['skill'])} | {it['score']} | {why} |")
    return table(rows)


def topic_from_term(term: str) -> str:
    return slugify(term)


def category_page(wiki, category, items, all_items, updated):
    info=CATEGORY_NARRATIVES.get(category, CATEGORY_NARRATIVES['Other / Unclassified'])
    skill_counts=collections.Counter(i['skill'] for i in items)
    topic_counts=collections.Counter(t for i in items for t in i['topics'])
    terms=top_terms(items, 24)
    avg=sum(i['score'] for i in items)/len(items) if items else 0
    subcat_rows=[]
    for sub in info['subcats']:
        # soft assign examples using title/terms overlap with subcategory words
        words=[w for w in re.findall(r'[a-z]{4,}', sub.lower()) if w not in STOP]
        sub_items=[i for i in items if any(w in (i['title']+' '+' '.join(i['terms'])).lower() for w in words)]
        subcat_rows.append(f"| {sub} | {len(sub_items)}+ candidate sources | {examples_table(sub_items, 3).splitlines()[2] if sub_items else 'Use as curation lens.'} |")
    content=front(f'YouTube Knowledge Category - {category}', 'youtube-knowledge-category', f'hapa:youtube:knowledge-category:{slugify(category)}', ['youtube','knowledge-atlas','category','hapa'], [slugify(category),'second-brain','hapa'], updated)
    content+=f'''# YouTube Knowledge Category - {category}\n\n## Orientation\n\n{info['what']}\n\n{info['hapa']}\n\nThis page is a landing surface over {len(items):,} transcript review pages with an average knowledge-gain score of {avg:.1f}/10. It should help Calder move from a pile of watched videos to an applied body of knowledge: what this category means, what it teaches, how it links to Hapa, and which Skill Cards it keeps feeding.\n\n## Key Questions\n\n''' + ''.join(f'- {q}\n' for q in info['questions'])
    content+='''\n## Hapa Application\n\n| Hapa target | How this category applies |\n|---|---|\n'''
    for target, desc in HAPA_TARGETS:
        content+=f"| {target} | {desc} The `{category}` category supplies source-backed patterns and examples for this target. |\n"
    content+='''\n## Skill Consolidation\n\n| Skill | Sources | Role in this category |\n|---|---:|---|\n'''
    for skill,count in skill_counts.most_common():
        content+=f"| {SKILL_LINKS.get(skill, skill)} | {count:,} | {SKILL_NARRATIVES.get(skill,'Evidence bucket for this category.')} |\n"
    content+='''\n## Sub-Category Lenses\n\n| Lens | Candidate density | Example seed |\n|---|---:|---|\n''' + '\n'.join(subcat_rows) + '\n'
    content+='''\n## High-Signal Topics and Terms\n\n| Topic/term | Sources | Link |\n|---|---:|---|\n'''
    for t,c in topic_counts.most_common(12):
        content+=f"| {t} | {c:,} | [[{ATLAS_ROOT_REL}/Topics/{slugify(t)}|{t}]] |\n"
    for t,c in terms[:12]:
        content+=f"| {t} | {c:,} | [[{ATLAS_ROOT_REL}/Topics/{topic_from_term(t)}|{t}]] |\n"
    content+='''\n## Source Examples\n\n''' + examples_table(items, 16)
    content+='''\n## Related Category Pages\n\n'''
    for other in CATEGORY_ORDER:
        if other != category:
            content+=f"- [[{ATLAS_ROOT_REL}/Categories/{slugify(other)}|{other}]]\n"
    return content


def skill_page(skill, items, updated):
    cat_counts=collections.Counter(i['category'] for i in items)
    term_counts=top_terms(items, 20)
    content=front(f'YouTube Skill Consolidation - {skill}', 'youtube-skill-consolidation', f'hapa:youtube:skill-consolidation:{slugify(skill)}', ['youtube','knowledge-atlas','skill-consolidation','hapa'], [slugify(skill),'skill-tree','character-sheet'], updated)
    content+=f'''# YouTube Skill Consolidation - {skill}\n\n## Orientation\n\n{SKILL_NARRATIVES.get(skill, 'A recurring capability evidenced by transcript reviews.')}\n\nThis page consolidates {len(items):,} transcript reviews assigned to {SKILL_LINKS.get(skill, skill)}. Treat it as a bridge between YouTube evidence, Calder's Character Sheet, and Hapa implementation choices.\n\n## Applies to Calder\n\n- Builds a repeatable skill, not just passive knowledge.\n- Provides source examples for practice quests and proof artifacts.\n- Helps decide what Calder should learn next, delegate to agents, or encode into Hapa apps.\n\n## Applies to Hapa\n\n| Hapa target | Application |\n|---|---|\n| [[Character Sheets/Calder/Calder Character Sheet Prototype]] | Convert source count and scores into evidence-backed skill progression. |\n| [[Cards/Skill Cards/Index]] | Merge repeated patterns into Skill Cards, practices, and failure modes. |\n| [[Development]] | Turn high-scoring examples into implementation quests. |\n| [[Operations/Hapa Autonomous Ops Dashboard]] | Track recurring automation/knowledge work as autonomous operations. |\n\n## Category Distribution\n\n| Category | Sources | Landing page |\n|---|---:|---|\n'''
    for cat,count in cat_counts.most_common():
        content+=f"| {cat} | {count:,} | [[{ATLAS_ROOT_REL}/Categories/{slugify(cat)}|{cat}]] |\n"
    content+='''\n## Sub-Skills / Repeating Patterns\n\n| Pattern | Evidence count | Practice prompt |\n|---|---:|---|\n'''
    for term,count in term_counts[:12]:
        content+=f"| {term} | {count:,} | Find 3 high-scoring examples and convert them into a Hapa protocol, card note, or app task. |\n"
    content+='''\n## Strong Evidence Examples\n\n''' + examples_table(items, 18)
    content+='''\n## Related Skills\n\n'''
    for other in sorted(SKILL_LINKS):
        if other != skill:
            content+=f"- [[{ATLAS_ROOT_REL}/Skills/{slugify(other)}|{other}]]\n"
    return content


def topic_page(topic, items, updated):
    cat_counts=collections.Counter(i['category'] for i in items)
    skill_counts=collections.Counter(i['skill'] for i in items)
    topic_title=topic.replace('-', ' ').title()
    content=front(f'YouTube Topic - {topic_title}', 'youtube-knowledge-topic', f'hapa:youtube:topic:{slugify(topic)}', ['youtube','knowledge-atlas','topic','hapa'], [slugify(topic),'source-evidence'], updated)
    content+=f'''# YouTube Topic - {topic_title}\n\n## Orientation\n\nThis topic page gathers {len(items):,} transcript reviews where `{topic}` appears as a topic tag or repeated extraction term. Use it as a mid-level navigation surface between broad categories and individual source reviews.\n\nFor Calder, this is a way to see which concepts keep recurring in the watched corpus. For Hapa, it is a candidate node: if the topic keeps connecting categories, skills, and artifacts, it may deserve a stronger wiki page, card, or implementation protocol.\n\n## Category Spread\n\n| Category | Sources | Link |\n|---|---:|---|\n'''
    for cat,count in cat_counts.most_common():
        content+=f"| {cat} | {count:,} | [[{ATLAS_ROOT_REL}/Categories/{slugify(cat)}|{cat}]] |\n"
    content+='''\n## Skill Spread\n\n| Skill | Sources | Link |\n|---|---:|---|\n'''
    for skill,count in skill_counts.most_common():
        content+=f"| {SKILL_LINKS.get(skill, skill)} | {count:,} | [[{ATLAS_ROOT_REL}/Skills/{slugify(skill)}|consolidation]] |\n"
    content+='''\n## Hapa Relevance\n\n- Person: helps Calder recognize a recurring interest, capability, or open question.\n- Project: helps Hapa decide whether this topic should become a node, Skill Card, character-sheet stat, or app feature.\n- Knowledge requirement: gathers source examples so future synthesis can cite evidence rather than vibes.\n\n## Source Examples\n\n''' + examples_table(items, 20)
    return content


def index_page(items, updated):
    by_cat=collections.defaultdict(list); by_skill=collections.defaultdict(list); by_topic=collections.defaultdict(list)
    for it in items:
        by_cat[it['category']].append(it); by_skill[it['skill']].append(it)
        for t in set(it['topics'] + [x for x,_ in top_terms([it], 6)]): by_topic[t].append(it)
    total=len(items); avg=sum(i['score'] for i in items)/total if total else 0
    content=front('YouTube Knowledge Atlas', 'youtube-knowledge-atlas-index', 'hapa:youtube:knowledge-atlas:index', ['youtube','knowledge-atlas','second-brain','hapa'], ['youtube','knowledge-graph','character-sheet','hapa'], updated)
    content+=f'''# YouTube Knowledge Atlas\n\n## What This Is\n\nThis is the orientation layer over Calder's transcript-backed YouTube corpus. It turns {total:,} review pages into category landing pages, topic pages, skill consolidation pages, and Hapa application maps. The goal is not to replace individual transcript reviews; it is to make the body of knowledge relatable and navigable: person -> project -> facts -> artifacts.\n\nAverage knowledge-gain score across reviewed sources: {avg:.1f}/10.\n\n## Start Here\n\n- [[{ATLAS_ROOT_REL}/Calder Orientation|Calder Orientation]]\n- [[{ATLAS_ROOT_REL}/Hapa Application Map|Hapa Application Map]]\n- [[{ATLAS_ROOT_REL}/Category-Skill Matrix|Category-Skill Matrix]]\n- [[{ATLAS_ROOT_REL}/Topic Index|Topic Index]]\n\n## Category Landing Pages\n\n| Category | Sources | What it contributes to Hapa |\n|---|---:|---|\n'''
    for cat in CATEGORY_ORDER:
        info=CATEGORY_NARRATIVES[cat]
        content+=f"| [[{ATLAS_ROOT_REL}/Categories/{slugify(cat)}|{cat}]] | {len(by_cat.get(cat,[])):,} | {info['hapa']} |\n"
    content+='''\n## Skill Consolidation Pages\n\n| Skill | Sources | Role |\n|---|---:|---|\n'''
    for skill, arr in sorted(by_skill.items(), key=lambda kv: -len(kv[1])):
        content+=f"| [[{ATLAS_ROOT_REL}/Skills/{slugify(skill)}|{skill}]] | {len(arr):,} | {SKILL_NARRATIVES.get(skill,'Evidence bucket.')} |\n"
    content+='''\n## High-Volume Topic Pages\n\n'''
    for topic, arr in sorted(by_topic.items(), key=lambda kv: -len(kv[1]))[:40]:
        content+=f"- [[{ATLAS_ROOT_REL}/Topics/{slugify(topic)}|{topic}]] ({len(arr):,})\n"
    content+='''\n## How to Use This Atlas\n\n1. Pick a category landing page for broad orientation.\n2. Use skill consolidation pages to see what Calder is actually learning.\n3. Use topic pages to find recurring patterns across categories.\n4. Promote high-signal repeated ideas into Hapa Skill Cards, Nodes, Development plans, or Character Sheet quests.\n5. Keep provenance attached: every claim should link back to transcript reviews or source pages.\n'''
    return content


def matrix_page(items, updated):
    cats=CATEGORY_ORDER
    skills=[s for s,_ in collections.Counter(i['skill'] for i in items).most_common()]
    counts=collections.Counter((i['category'],i['skill']) for i in items)
    content=front('YouTube Category-Skill Matrix', 'youtube-knowledge-matrix', 'hapa:youtube:knowledge-atlas:category-skill-matrix', ['youtube','knowledge-atlas','matrix','hapa'], ['skills','categories','knowledge-graph'], updated)
    content+='# YouTube Category-Skill Matrix\n\nThis matrix shows where the watched corpus is training Calder: category content on one axis, Hapa Skill Cards on the other. Dense cells are the places to create sub-categories, deeper synthesis, or app quests.\n\n'
    content+='| Category | ' + ' | '.join(skills) + ' |\n'
    content+='|---|' + '|'.join(['---:']*len(skills)) + '|\n'
    for cat in cats:
        content+=f"| [[{ATLAS_ROOT_REL}/Categories/{slugify(cat)}|{cat}]] | " + ' | '.join(str(counts.get((cat,s),0)) for s in skills) + ' |\n'
    content+='\n## Dense Cells To Mine Next\n\n'
    for (cat,skill),count in counts.most_common(20):
        content+=f"- {count:,} sources: [[{ATLAS_ROOT_REL}/Categories/{slugify(cat)}|{cat}]] x [[{ATLAS_ROOT_REL}/Skills/{slugify(skill)}|{skill}]]\n"
    return content


def orientation_page(items, updated):
    content=front('Calder Orientation to YouTube Knowledge', 'youtube-calder-orientation', 'hapa:youtube:knowledge-atlas:calder-orientation', ['youtube','calder','orientation','character-sheet','hapa'], ['person','project','knowledge'], updated)
    content+='''# Calder Orientation to YouTube Knowledge\n\n## Person: What This Corpus Says About Calder\n\nThis YouTube body of knowledge is a map of recurring attention. It shows Calder repeatedly collecting inputs about agents, systems, power, tools, philosophy, history, aesthetics, and implementation. The point is not merely that the videos were watched; the point is that they now become source-backed evidence for a living skill tree and project operating system.\n\n## Project: How It Feeds Hapa\n\nHapa needs more than lore. It needs infrastructure, canon stewardship, media generation, app surfaces, second-brain protocols, skill cards, and a way to connect personal development to worldbuilding. The YouTube atlas provides a bridge from external knowledge into those Hapa surfaces.\n\n## Knowledge Required To Get There\n\n| Requirement | YouTube evidence surface | Hapa application |\n|---|---|---|\n| Build with agents | [[YouTube/Knowledge Atlas/Skills/headless-brain-orchestration]] | automate wiki growth, coding, media, review queues |\n| Preserve provenance | [[YouTube/Knowledge Atlas/Skills/canonical-knowledge-stewardship]] | prevent scaffold/canon confusion |\n| Navigate complexity visually | [[YouTube/Knowledge Atlas/Skills/spatial-knowledge-graph-visualization]] | dashboards, graph maps, dossiers |\n| Turn sources into memory | [[YouTube/Knowledge Atlas/Skills/knowledge-graph-synthesis]] | wiki backlinks, Character Sheet evidence |\n| Design systems | [[YouTube/Knowledge Atlas/Skills/knowledge-architecture-blueprinting]] | local apps and Hapa nodes |\n\n## Recommended Reading Path\n\n1. [[YouTube/Knowledge Atlas/Categories/ai]] for the build engine.\n2. [[YouTube/Knowledge Atlas/Categories/technology]] for implementation surfaces.\n3. [[YouTube/Knowledge Atlas/Categories/geopolitics]] for power, narrative, resilience, and institutions.\n4. [[YouTube/Knowledge Atlas/Categories/history]] for precedent and lore depth.\n5. [[YouTube/Knowledge Atlas/Categories/religion-and-philosophy]] for identity, Names, ethics, and meaning.\n6. [[YouTube/Knowledge Atlas/Category-Skill Matrix]] to choose dense synthesis targets.\n'''
    return content


def hapa_map_page(items, updated):
    content=front('Hapa Application Map for YouTube Knowledge', 'youtube-hapa-application-map', 'hapa:youtube:knowledge-atlas:hapa-application-map', ['youtube','hapa','application-map','second-brain'], ['hapa','apps','skills','canon'], updated)
    content+='''# Hapa Application Map for YouTube Knowledge\n\n## Purpose\n\nThis page answers: where should the YouTube corpus go inside Hapa? The answer is not one place. It should feed skills, canon, apps, operations, media, and Calder's Character Sheet, while preserving source provenance.\n\n## Application Surfaces\n\n| Surface | What YouTube contributes | Example links |\n|---|---|---|\n| Character Sheet | Skill evidence, XP, learning trails, quests | [[Character Sheets/Calder/Calder Character Sheet Prototype]], [[Character Sheets/Calder/Knowledge Gain Ledger]] |\n| Skill Cards | Repeated capabilities, practices, failure modes | [[Cards/Skill Cards/Index]], [[YouTube/Knowledge Atlas/Skills/headless-brain-orchestration]] |\n| Hapa Wiki Viewer | Search, graph navigation, category landing pages, dossiers | [[YouTube/Knowledge Atlas]], [[YouTube/Knowledge Atlas/Topic Index]] |\n| Development | App ideas, protocols, implementation targets | [[Development]], [[Operations/Hapa Autonomous Ops Dashboard]] |\n| Canon / Lore | Precedent, philosophy, power, identity, archetypes | [[YouTube/Knowledge Atlas/Categories/history]], [[YouTube/Knowledge Atlas/Categories/religion-and-philosophy]] |\n| Media / Cards | Visual metaphors, source echoes, card prompts | [[Cards/Skill Cards/Index]], [[Assets]] |\n\n## Conversion Loop\n\n1. Source review captures evidence.\n2. Category/topic page makes it discoverable.\n3. Skill consolidation page turns it into a capability.\n4. Character Sheet ledger turns it into personal progression.\n5. Development/Node/Card page turns it into a Hapa artifact.\n6. Provenance links keep it grounded.\n\n## Current Strongest Conversion Targets\n\n'''
    for skill,count in collections.Counter(i['skill'] for i in items).most_common(8):
        content+=f"- {count:,} sources -> [[{ATLAS_ROOT_REL}/Skills/{slugify(skill)}|{skill}]] -> {SKILL_NARRATIVES.get(skill,'Hapa capability.')}\n"
    return content


def topic_index_page(topic_map, updated):
    content=front('YouTube Topic Index', 'youtube-topic-index', 'hapa:youtube:knowledge-atlas:topic-index', ['youtube','topic-index','knowledge-atlas','hapa'], ['topics','navigation','knowledge-graph'], updated)
    content+='# YouTube Topic Index\n\nTopic pages gather both explicit review topics and repeated high-signal extraction terms. High counts indicate concepts that may deserve stronger wiki nodes or Hapa Skill Card evidence pages.\n\n| Topic | Sources | Page |\n|---|---:|---|\n'
    for topic, arr in sorted(topic_map.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:250]:
        content+=f"| {topic} | {len(arr):,} | [[{ATLAS_ROOT_REL}/Topics/{slugify(topic)}|{topic}]] |\n"
    return content


def build(wiki: Path, dry=False):
    updated=now_iso()
    items=parse_reviews(wiki)
    by_cat=collections.defaultdict(list); by_skill=collections.defaultdict(list); by_topic=collections.defaultdict(list)
    for it in items:
        by_cat[it['category']].append(it)
        by_skill[it['skill']].append(it)
        topic_set=set(it['topics'])
        for term,_ in top_terms([it], 8): topic_set.add(term)
        for t in topic_set:
            by_topic[t].append(it)
    root=wiki/ATLAS_ROOT_REL
    written=[]
    pages={
        root/'Index.md': index_page(items, updated),
        root/'Category-Skill Matrix.md': matrix_page(items, updated),
        root/'Calder Orientation.md': orientation_page(items, updated),
        root/'Hapa Application Map.md': hapa_map_page(items, updated),
        root/'Topic Index.md': topic_index_page(by_topic, updated),
    }
    for cat in CATEGORY_ORDER:
        pages[root/'Categories'/f'{slugify(cat)}.md']=category_page(wiki, cat, by_cat.get(cat,[]), items, updated)
    for skill, arr in by_skill.items():
        pages[root/'Skills'/f'{slugify(skill)}.md']=skill_page(skill, arr, updated)
    for topic, arr in sorted(by_topic.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:120]:
        pages[root/'Topics'/f'{slugify(topic)}.md']=topic_page(topic, arr, updated)
    for p,c in pages.items():
        write(p,c,dry); written.append(str(p))
    report={
        'updated': updated,
        'review_count': len(items),
        'written_count': len(written),
        'atlas_root': str(root),
        'written': written,
        'category_counts': {k:len(v) for k,v in sorted(by_cat.items())},
        'skill_counts': {k:len(v) for k,v in sorted(by_skill.items(), key=lambda kv:-len(kv[1]))},
        'topic_pages_written': min(120,len(by_topic)),
    }
    if not dry:
        rp=wiki/REPORT_REL; rp.parent.mkdir(parents=True, exist_ok=True); rp.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--wiki', default=str(DEFAULT_WIKI))
    ap.add_argument('--dry-run', action='store_true')
    args=ap.parse_args()
    build(Path(args.wiki), args.dry_run)

if __name__=='__main__':
    main()
