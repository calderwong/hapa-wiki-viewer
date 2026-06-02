#!/usr/bin/env python3
"""Batch-create Hapa transcript review pages, Character Sheet ledger rows, and queue reports.

This is a deterministic scaffolding runner: it does not call an LLM or external API.
It selects transcript-backed YouTube videos without review pages, extracts high-signal
terms/sentences from transcripts, assigns Hapa skill buckets, writes review Markdown,
updates the source page, appends ledger rows, and emits a JSON/Markdown report.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import sqlite3
import subprocess
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

DEFAULT_WIKI = Path(os.environ.get('HAPA_WIKI_ROOT') or os.environ.get('HAPA_WIKI_PATH') or '~/Hapa_Worldbuilding_Wiki').expanduser()
DEFAULT_DB = Path(os.environ.get('HAPA_YOUTUBE_DB') or DEFAULT_WIKI / 'Raw/YouTube/youtube-watch-history-v2.sqlite').expanduser()
REVIEW_DIR = DEFAULT_WIKI / 'YouTube/Transcript Reviews'
CHAR_DIR = DEFAULT_WIKI / 'Character Sheets/Calder'
LEDGER = CHAR_DIR / 'Knowledge Gain Ledger.md'
CHAR_SHEET = CHAR_DIR / 'Calder Character Sheet Prototype.md'
QUEUE_MD = DEFAULT_WIKI / 'YouTube/Transcript Reviews/Review Queue Status.md'
REPORT_JSON = DEFAULT_WIKI / 'Raw/YouTube/reports/transcript-review-batch-latest.json'


def configure_paths(wiki: Path) -> None:
    global REVIEW_DIR, CHAR_DIR, LEDGER, CHAR_SHEET, QUEUE_MD, REPORT_JSON
    wiki = wiki.expanduser()
    REVIEW_DIR = wiki / 'YouTube/Transcript Reviews'
    CHAR_DIR = wiki / 'Character Sheets/Calder'
    LEDGER = CHAR_DIR / 'Knowledge Gain Ledger.md'
    CHAR_SHEET = CHAR_DIR / 'Calder Character Sheet Prototype.md'
    QUEUE_MD = wiki / 'YouTube/Transcript Reviews/Review Queue Status.md'
    REPORT_JSON = wiki / 'Raw/YouTube/reports/transcript-review-batch-latest.json'

STOPWORDS = set('''
the and for that with this from into about what when where which while will have has are was were you your our out how why not can its his her they them then than over under after before video image audio artifact metadata source notes note html json type just like really because there their would could should these those being been very more some much many most other also only each make made make making think thinking work working works use using used way ways thing things stuff sort sort of kind kind of actually basically right okay yeah um uh ah oh to in on at by as is it be or an a i we he she my me us do does did if so all no yes but
'''.split())

SKILLS = [
    {
        'name': 'Headless Brain Orchestration',
        'link': '[[Cards/Skill Cards/headless-brain-orchestration-b4d7c83d|Headless Brain Orchestration]]',
        'keywords': ['agent','agents','claude','codex','cursor','tool','tools','automation','orchestration','server','terminal','workflow','workflows','subagent','code'],
        'topics': ['agent-orchestration','ai-workflow'],
    },
    {
        'name': 'Knowledge Graph Synthesis',
        'link': '[[Cards/Skill Cards/knowledge-graph-synthesis-d20c5918|Knowledge Graph Synthesis]]',
        'keywords': ['knowledge','graph','graphs','memory','notes','obsidian','semantic','retrieval','rag','context','archive','archives','research','source','sources'],
        'topics': ['knowledge-graph','second-brain'],
    },
    {
        'name': 'Canonical Knowledge Indexing',
        'link': '[[Cards/Skill Cards/canonical-knowledge-indexing-534db62a|Canonical Knowledge Indexing]]',
        'keywords': ['index','indexing','canonical','canon','metadata','frontmatter','database','sqlite','sync','search','library','libraries'],
        'topics': ['indexing','metadata'],
    },
    {
        'name': 'Knowledge Architecture Blueprinting',
        'link': '[[Cards/Skill Cards/knowledge-architecture-blueprinting-6e90bc90|Knowledge Architecture Blueprinting]]',
        'keywords': ['architecture','system','systems','design','structure','protocol','blueprint','stack','infrastructure','platform'],
        'topics': ['architecture','systems'],
    },
    {
        'name': 'Modular Knowledge Structuring',
        'link': '[[Cards/Skill Cards/modular-knowledge-structuring-b28c74fe|Modular Knowledge Structuring]]',
        'keywords': ['module','modular','folder','folders','file','files','markdown','components','chunks','chunk','template','templates'],
        'topics': ['modularity','markdown'],
    },
    {
        'name': 'Portable Knowledge Capsule',
        'link': '[[Cards/Skill Cards/portable-knowledge-capsule-8a288c47|Portable Knowledge Capsule]]',
        'keywords': ['portable','phone','mobile','local','offline','device','devices','vault','git','sync','export','capsule'],
        'topics': ['portable-knowledge','local-first'],
    },
    {
        'name': 'Spatial Knowledge Graph Visualization',
        'link': '[[Cards/Skill Cards/spatial-knowledge-graph-visualization-7c39df9e|Spatial Knowledge Graph Visualization]]',
        'keywords': ['visual','visualization','spatial','map','maps','diagram','view','viewer','ui','interface','canvas'],
        'topics': ['visualization','ui'],
    },
    {
        'name': 'Canonical Knowledge Stewardship',
        'link': '[[Cards/Skill Cards/canonical-knowledge-stewardship-6a4448b1|Canonical Knowledge Stewardship]]',
        'keywords': ['truth','trust','evidence','provenance','review','quality','reliable','source','attribution','stewardship'],
        'topics': ['stewardship','provenance'],
    },
]

CATEGORY_PRIORITY = {
    'AI': 1,
    'Technology': 2,
    'Science & Math': 3,
    'Geopolitics': 4,
    'History': 5,
    'Religion & Philosophy': 6,
    'Other / Unclassified': 9,
}

TITLE_BOOST_TERMS = [
    'second brain', 'knowledge graph', 'obsidian', 'claude code', 'agent', 'agents',
    'rag', 'memory', 'notebooklm', 'llm', 'coding', 'workflow', 'ai', 'deepseek',
    'karpathy', 'openai', 'anthropic', 'cursor', 'gemini', 'research'
]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')


def slugify(value: str, fallback: str) -> str:
    value = (value or '').lower()
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')
    value = re.sub(r'-+', '-', value)
    return (value[:110].strip('-') or fallback)


def md_escape(value: object) -> str:
    return str(value or '').replace('\r','').strip()


def load_existing_review_ids() -> set[str]:
    ids = set()
    if REVIEW_DIR.exists():
        for p in REVIEW_DIR.glob('*.md'):
            text = p.read_text(errors='ignore')[:800]
            m = re.search(r'source_video_id:\s*"?([A-Za-z0-9_-]{6,})"?', text)
            if m:
                ids.add(m.group(1))
            m2 = re.search(r'hapa:youtube-transcript-review:([A-Za-z0-9_-]{6,})', text)
            if m2:
                ids.add(m2.group(1))
    return ids


def find_source_page(wiki: Path, video_id: str) -> Optional[Path]:
    matches = list((wiki / 'YouTube/Videos').glob(f'*{video_id}.md'))
    return matches[0] if matches else None


def wiki_slug(wiki: Path, path: Optional[Path]) -> str:
    if not path:
        return ''
    return str(path.relative_to(wiki)).replace('\\','/').removesuffix('.md')


def clean_transcript(text: str) -> str:
    text = re.sub(r'\[[^\]]{1,40}\]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def sentence_split(text: str) -> List[str]:
    text = clean_transcript(text)
    parts = re.split(r'(?<=[.!?])\s+', text)
    if len(parts) < 5:
        # TranscriptAPI text is often line-broken without punctuation. Build pseudo-sentences.
        words = text.split()
        return [' '.join(words[i:i+28]) for i in range(0, min(len(words), 700), 28)]
    return [p.strip() for p in parts if len(p.strip()) > 30]


def keywords(text: str, title: str, n: int = 18) -> List[str]:
    words = re.findall(r'[a-z][a-z0-9-]{3,}', (title + ' ' + text[:60000]).lower())
    counts = Counter(w for w in words if w not in STOPWORDS and len(w) > 3)
    return [w for w,_ in counts.most_common(n)]


def representative_sentences(text: str, terms: List[str], n: int = 7) -> List[str]:
    sents = sentence_split(text)
    if not sents:
        return []
    termset = set(terms[:14])
    scored = []
    for idx, sent in enumerate(sents[:260]):
        low = sent.lower()
        score = sum(1 for t in termset if t in low)
        score += 2 if any(k in low for k in ['workflow','system','agent','knowledge','research','important','because','build','useful','learn']) else 0
        score += max(0, 3 - idx // 30)  # intro often states premise
        if 50 <= len(sent) <= 420:
            scored.append((score, -idx, sent))
    scored.sort(reverse=True)
    out = []
    seen = set()
    for score, _neg_idx, sent in scored:
        norm = re.sub(r'\W+', ' ', sent.lower())[:90]
        if score <= 0 or norm in seen:
            continue
        seen.add(norm)
        out.append(sent.strip())
        if len(out) >= n:
            break
    if len(out) < n:
        for sent in sents[:n-len(out)]:
            out.append(sent.strip())
    return out[:n]


def assign_skills(title: str, transcript: str, category: str) -> Tuple[dict, List[dict], List[str]]:
    hay = (title + ' ' + transcript[:70000] + ' ' + category).lower()
    scored = []
    for skill in SKILLS:
        score = sum(hay.count(k.lower()) for k in skill['keywords'])
        if category == 'AI' and skill['name'] == 'Headless Brain Orchestration':
            score += 4
        if 'knowledge' in title.lower() and 'Knowledge' in skill['name']:
            score += 5
        if score > 0:
            scored.append((score, skill))
    scored.sort(key=lambda x: (-x[0], x[1]['name']))
    if not scored:
        scored = [(1, SKILLS[-1])]
    primary = scored[0][1]
    secondary = [s for _,s in scored[1:4]]
    topics = []
    for s in [primary] + secondary:
        topics.extend(s['topics'])
    topics.extend([slugify(category, 'uncategorized')])
    return primary, secondary, sorted(set(topics))[:10]


def knowledge_score(category: str, char_count: int, title: str, transcript: str, primary: dict) -> int:
    score = 5
    if category in ['AI','Technology','Science & Math']:
        score += 2
    elif category in ['Geopolitics','History','Religion & Philosophy']:
        score += 1
    if char_count > 60000:
        score += 1
    if any(t in title.lower() for t in TITLE_BOOST_TERMS):
        score += 1
    if primary['name'] in ['Headless Brain Orchestration','Knowledge Graph Synthesis','Knowledge Architecture Blueprinting']:
        score += 1
    if len(transcript) < 1000:
        score -= 2
    return max(1, min(10, score))


def one_screen_summary(title: str, channel: str, category: str, reps: List[str], terms: List[str]) -> str:
    premise = reps[0] if reps else title
    body = ' '.join(reps[1:4]) if len(reps) > 1 else ''
    key_terms = ', '.join(terms[:8])
    return (
        f"This source from {channel or 'an unknown creator'} is a {category or 'source-library'} transcript centered on `{title}`. "
        f"The strongest premise captured by the transcript is: {premise} "
        f"Across the high-signal excerpts, the source clusters around {key_terms}. {body} "
        "For the Hapa second brain, its value is less as a passive archive item and more as a source-to-skill evidence object: it can update the Character Sheet, supply a Skill Card assignment, and create concrete follow-up quests."
    )


def review_path_for(wiki: Path, title: str, video_id: str) -> Path:
    return wiki / 'YouTube/Transcript Reviews' / f"{slugify(title, video_id)}-{video_id}-review.md"


def source_page_update(source: Path, review_slug: str, primary: dict, secondary: List[dict], summary: str, category: str, topics: List[str]) -> None:
    raw = source.read_text(errors='ignore')
    source_rel = review_slug
    rel_lines = [
        f"- [[{source_rel}|Transcript review and Hapa knowledge-gain assessment]]",
        "- [[Character Sheets/Calder/Calder Character Sheet Prototype|Calder Character Sheet Prototype]]",
        "- [[Character Sheets/Calder/Knowledge Gain Ledger|Knowledge Gain Ledger]]",
        f"- {primary['link']}",
    ] + [f"- {s['link']}" for s in secondary[:2]]
    new_block = "## Summary\n" + summary.strip() + "\n\n"
    new_block += "## Category\n" + (category or 'Uncategorized') + "\n\n"
    new_block += "## Topics\n" + '\n'.join(f"- {t}" for t in topics[:9]) + "\n\n"
    new_block += "## Hapa Wiki Relations\n" + '\n'.join(dict.fromkeys(rel_lines))
    pattern = re.compile(r'## Summary\n.*?\n## Attribution Notes', re.S)
    if pattern.search(raw):
        raw = pattern.sub(new_block + "\n\n## Attribution Notes", raw)
    else:
        raw += "\n\n" + new_block + "\n"
    source.write_text(raw)


def ensure_base_pages(now: str) -> None:
    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    if not LEDGER.exists():
        LEDGER.write_text(f'''---\ntitle: "Calder Knowledge Gain Ledger"\ntype: hapa-character-sheet-ledger\nstatus: active\nowner: Calder Wong\ntags: [character-sheet, knowledge-gain, second-brain, transcript-review]\ntopics: [skills, xp, evidence, youtube]\nretrieval_id: "hapa:character-sheet:calder:knowledge-gain-ledger"\nupdated: "{now}"\n---\n\n# Calder Knowledge Gain Ledger\n\n| Date | Source | Skill | Knowledge Gain | XP | Evidence | Hapa Links | Next Action |\n|---|---|---|---:|---:|---|---|---|\n''')
    if not CHAR_SHEET.exists():
        CHAR_SHEET.write_text(f'''---\ntitle: "Calder Character Sheet Prototype"\ntype: hapa-character-sheet\nstatus: prototype\nowner: Calder Wong\ntags: [character-sheet, living-resume, second-brain, hapa, prototype]\ntopics: [skills, knowledge-graph, self-model, transcript-review, evidence-ledger]\nretrieval_id: "hapa:character-sheet:calder:prototype"\nupdated: "{now}"\n---\n\n# Calder Character Sheet Prototype\n\n## Identity Layer\n\n- Name: Calder Wong\n- Roles: Hapa worldbuilder, local-first AI app builder, knowledge-graph architect.\n\n## Stat Blocks\n\n| Stat | Level | XP | Evidence | Notes |\n|---|---:|---:|---|---|\n\n## Skill Tree\n\n| Skill | Rank | XP | Evidence | Next unlock |\n|---|---|---:|---|---|\n\n## Knowledge Domains\n\n| Domain | Coverage | Recent sources | Hapa applications |\n|---|---:|---|---|\n\n## Artifact Inventory\n\n| Artifact | Type | Relation | Evidence |\n|---|---|---|---|\n\n## Quest Log\n\n| Quest | Status | Source | Next action |\n|---|---|---|---|\n\n## Provenance Rules\n\nEvery stat/skill must link to an evidence page, transcript review, card, commit, app artifact, or wiki note.\n''')


def append_unique(path: Path, marker: str, line: str) -> None:
    text = path.read_text(errors='ignore') if path.exists() else ''
    if marker in text:
        return
    path.write_text(text.rstrip() + '\n' + line.rstrip() + '\n')


def append_character_sheet_batch(now: str, processed: List[dict]) -> None:
    if not processed:
        return
    text = CHAR_SHEET.read_text(errors='ignore')
    marker = f"<!-- transcript-review-batch-{now[:10]}-{hashlib.sha1(str([p['id'] for p in processed]).encode()).hexdigest()[:8]} -->"
    if marker in text:
        return
    rows = []
    for item in processed:
        rows.append(f"| Review {item['id']} | Completed | [[{item['review_slug']}|{item['title'][:60]}]] | Apply {item['primary_skill']} evidence to the next batch/skill view. |")
    block = f"\n\n{marker}\n\n## Transcript Review Batch - {now}\n\nProcessed {len(processed)} transcript-backed sources into Character Sheet evidence.\n\n| Quest | Status | Source | Next action |\n|---|---|---|---|\n" + '\n'.join(rows) + '\n'
    CHAR_SHEET.write_text(text.rstrip() + block)


def write_review(wiki: Path, row: dict, dry_run: bool = False) -> dict:
    now = now_iso()
    video_id = row['id']
    title = row['title'] or video_id
    channel = row['channel_name'] or 'Unknown'
    category = row['primary_category'] or row['category'] or 'Other / Unclassified'
    text_path = Path(row['text_path'])
    transcript = text_path.read_text(errors='ignore') if text_path.exists() else ''
    clean = clean_transcript(transcript)
    terms = keywords(clean, title)
    reps = representative_sentences(clean, terms)
    primary, secondary, topics = assign_skills(title, clean, category)
    score = knowledge_score(category, int(row['char_count'] or 0), title, clean, primary)
    xp = score * 10
    summary = one_screen_summary(title, channel, category, reps, terms)
    source = find_source_page(wiki, video_id)
    source_slug = wiki_slug(wiki, source) or f"YouTube/Videos/{video_id}"
    review_path = review_path_for(wiki, title, video_id)
    review_slug = wiki_slug(wiki, review_path)
    secondary_links = ', '.join(s['link'] for s in secondary) or 'None yet'
    term_lines = '\n'.join(f"- {t}" for t in terms[:12]) or '- None extracted.'
    excerpt_lines = '\n'.join(f"- {s}" for s in reps[:7]) or '- No representative excerpts extracted.'
    artifact_rows = [
        f"| [[Character Sheets/Calder/Calder Character Sheet Prototype]] | upgrades | Adds source-backed XP/evidence for {primary['name']}. | Use ledger row in next Character Sheet render. |",
        f"| [[Character Sheets/Calder/Knowledge Gain Ledger]] | supplies evidence for | Records score {score}/10 and +{xp} XP from this source. | Keep batching transcript-backed sources. |",
        f"| {primary['link']} | validates/informs | Transcript terms align with this skill bucket: {', '.join(terms[:5])}. | Accumulate 5+ evidence pages before promotion changes. |",
        "| [[YouTube/Index|YouTube Shared Library]] | upgrades | Moves this video from archive-only to reviewed source evidence. | Continue queue. |",
    ]
    for s in secondary[:2]:
        artifact_rows.append(f"| {s['link']} | secondary relation | Related terms suggest supporting skill evidence. | Reassess after more sources. |")
    safe_title = title.replace('"', '\\"')
    md = f'''---
title: "Transcript Review - {safe_title}"
type: youtube-transcript-review
status: reviewed
source_video_id: "{video_id}"
source_page: "{source_slug}"
transcript_path: "{text_path}"
reviewed_at: "{now}"
knowledge_gain_score: {score}
skill_assignment: "{primary['name']}"
retrieval_id: "hapa:youtube-transcript-review:{video_id}"
tags: [youtube, transcript-review, second-brain, character-sheet, hapa]
topics: [{', '.join(topics)}]
---

# Transcript Review - {title}

## Source

- Video: [[{source_slug}|{title}]]
- Transcript: `{text_path}`
- Creator/channel: {channel}
- Category: {category}
- Review status: deterministic batch scaffold; canon review still welcome

## One-Screen Summary

{summary}

## Knowledge Gain Assessment

- Score: {score}/10
- XP recommendation: +{xp}
- Novelty: {'High' if score >= 8 else 'Moderate' if score >= 6 else 'Low'} relative to the current Character Sheet scaffold.
- Actionability: {'High' if primary['name'] in ['Headless Brain Orchestration','Knowledge Graph Synthesis','Knowledge Architecture Blueprinting'] else 'Moderate'} because it maps to an existing Hapa skill bucket and can feed follow-up quests.
- Relevance to Calder: Strong when connected to Hapa source review, app scaffolding, Skill Cards, and Character Sheet progression.
- Reliability / caveats: This is a deterministic first-pass review generated from transcript terms and representative excerpts. Promote claims only after human/agent deep review.
- Already-known vs newly-useful: Treat as source-backed reinforcement unless the extraction notes surface a specific new method.

## Skill Assignment

- Primary skill/card: {primary['link']}
- Secondary skills/cards: {secondary_links}
- Evidence: The transcript terms and excerpts cluster around {', '.join(terms[:8])}.
- Suggested practice task: Convert this review into one Character Sheet quest or one Hapa app/wiki improvement.
- XP recommendation: +{xp} to {primary['name']}.

## Hapa Artifact Connections

| Hapa target | Relation | Why it matters | Next action |
|---|---|---|---|
{chr(10).join(artifact_rows)}

## Character Sheet Delta

- Skill XP: +{xp} to {primary['name']}.
- Knowledge domains touched: {', '.join(topics[:6])}.
- Evidence object: [[{review_slug}|this transcript review]].
- Quest seed: Apply the source's strongest useful idea to Hapa Wiki Viewer, the Character Sheet, or a related Skill Evidence page.

## Extraction Notes

### High-signal terms

{term_lines}

### Representative transcript excerpts

{excerpt_lines}

## Next Actions

1. Human/agent deep-review this scaffold if the source looks strategically important.
2. Promote repeated patterns into the relevant Skill Evidence page.
3. Use the ledger row to update Character Sheet stats once multiple sources converge.
'''
    result = {
        'id': video_id,
        'title': title,
        'review_path': str(review_path),
        'review_slug': review_slug,
        'source_path': str(source) if source else '',
        'source_slug': source_slug,
        'primary_skill': primary['name'],
        'score': score,
        'xp': xp,
        'category': category,
        'terms': terms[:12],
        'char_count': row['char_count'],
    }
    if dry_run:
        return result
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    review_path.write_text(md)
    if source:
        source_page_update(source, review_slug, primary, secondary, summary, category, topics)
    ledger_line = f"| {now[:10]} | [[{review_slug}|{title[:80]}]] | {primary['link']} | {score}/10 | +{xp} | transcript review `{video_id}` | [[{source_slug}|source]], [[Character Sheets/Calder/Calder Character Sheet Prototype]] | Convert the strongest source pattern into a Hapa app/wiki quest. |"
    append_unique(LEDGER, f"hapa:youtube-transcript-review:{video_id}", ledger_line)
    return result


def select_candidates(db_path: Path, wiki: Path, limit: int, include_other: bool = False) -> List[dict]:
    reviewed = load_existing_review_ids()
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    rows = con.execute('''
        SELECT v.id, v.title, v.channel_name, v.channel_url, v.url, v.category,
               t.text_path, t.char_count, t.source AS transcript_source,
               COALESCE(vct.primary_category, v.category, 'Other / Unclassified') AS primary_category,
               COALESCE(vct.priority_rank, 999) AS priority_rank,
               COALESCE(v.watch_count, 0) AS watch_count,
               v.last_watched_at
        FROM videos v
        JOIN transcripts t ON t.video_id = v.id
        LEFT JOIN video_content_targets vct ON vct.video_id = v.id
        WHERE COALESCE(t.char_count,0) > 0
        ORDER BY
          CASE COALESCE(vct.primary_category, v.category, 'Other / Unclassified')
            WHEN 'AI' THEN 1
            WHEN 'Technology' THEN 2
            WHEN 'Science & Math' THEN 3
            WHEN 'Geopolitics' THEN 4
            WHEN 'History' THEN 5
            WHEN 'Religion & Philosophy' THEN 6
            ELSE 9
          END,
          COALESCE(vct.priority_rank, 999),
          COALESCE(t.char_count,0) DESC
    ''').fetchall()
    con.close()
    candidates = []
    for row in rows:
        d = dict(row)
        if d['id'] in reviewed:
            continue
        if not include_other and d.get('primary_category') == 'Other / Unclassified':
            # Keep low-signal other/music rows for later unless explicitly included.
            continue
        title_low = (d.get('title') or '').lower()
        boost = sum(10 for term in TITLE_BOOST_TERMS if term in title_low)
        cat_score = 100 - CATEGORY_PRIORITY.get(d.get('primary_category'), 9) * 10
        d['_queue_score'] = cat_score + boost + min(int(d.get('char_count') or 0) // 50000, 8)
        candidates.append(d)
    candidates.sort(key=lambda d: (-d['_queue_score'], CATEGORY_PRIORITY.get(d.get('primary_category'), 9), -(d.get('char_count') or 0), d['title']))
    return candidates[:limit]


def write_queue_status(wiki: Path, report: dict) -> None:
    rows = '\n'.join(
        f"| [[{item['review_slug']}|{item['title'][:70]}]] | {item['category']} | {item['primary_skill']} | {item['score']}/10 | +{item['xp']} |"
        for item in report['processed']
    ) or '| None | | | | |'
    content = f'''---
title: "YouTube Transcript Review Queue Status"
type: youtube-transcript-review-queue
status: active
tags: [youtube, transcript-review, queue, second-brain, character-sheet]
topics: [review-queue, knowledge-gain, automation]
retrieval_id: "hapa:youtube-transcript-review:queue-status"
updated: "{report['finished_at']}"
---

# YouTube Transcript Review Queue Status

This page tracks deterministic batch scaffolding for transcript-backed YouTube source reviews.

## Latest Run

- Started: {report['started_at']}
- Finished: {report['finished_at']}
- Limit: {report['limit']}
- Dry run: {report['dry_run']}
- Processed: {len(report['processed'])}
- Remaining candidate estimate: {report['remaining_estimate']}
- Report JSON: `{REPORT_JSON}`

## Latest Processed Sources

| Review | Category | Skill | Knowledge Gain | XP |
|---|---|---|---:|---:|
{rows}

## Operating Notes

- Run from the `hapa-wiki-viewer` repository root.
- Preview: `npm run youtube:review-queue -- --dry-run --limit 10`.
- Batch: `npm run youtube:review-batch -- --limit 10 --index`.
- Keep batch sizes modest until quality is reviewed.
'''
    QUEUE_MD.parent.mkdir(parents=True, exist_ok=True)
    QUEUE_MD.write_text(content)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default='')
    ap.add_argument('--wiki', default=str(DEFAULT_WIKI))
    ap.add_argument('--limit', type=int, default=5)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--include-other', action='store_true')
    ap.add_argument('--index', action='store_true', help='Run npm run index after writing')
    args = ap.parse_args()
    wiki = Path(args.wiki).expanduser()
    configure_paths(wiki)
    db = Path(args.db).expanduser() if args.db else (wiki / 'Raw/YouTube/youtube-watch-history-v2.sqlite')
    start = now_iso()
    ensure_base_pages(start)
    candidates = select_candidates(db, wiki, args.limit, include_other=args.include_other)
    processed = [write_review(wiki, row, dry_run=args.dry_run) for row in candidates]
    if not args.dry_run:
        append_character_sheet_batch(start, processed)
    remaining = max(0, len(select_candidates(db, wiki, 100000, include_other=args.include_other)) - (0 if args.dry_run else len(processed)))
    report = {
        'started_at': start,
        'finished_at': now_iso(),
        'limit': args.limit,
        'dry_run': args.dry_run,
        'processed': processed,
        'remaining_estimate': remaining,
        'review_dir': str(REVIEW_DIR),
        'ledger': str(LEDGER),
        'character_sheet': str(CHAR_SHEET),
    }
    if not args.dry_run:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, indent=2))
        write_queue_status(wiki, report)
        if args.index:
            with open('/tmp/hapa-youtube-review-index.log', 'w', encoding='utf-8') as log:
                subprocess.run(['npm', 'run', 'index'], cwd=Path(__file__).resolve().parents[1], stdout=log, stderr=subprocess.STDOUT, check=False)
    print(json.dumps(report, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
