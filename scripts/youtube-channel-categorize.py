#!/usr/bin/env python3
"""Channel-first content bucket categorization for the Hapa YouTube history DB.

This is deliberately local/offline: it categorizes creators/channels from channel names,
watched video titles, and existing DB metadata. It records both channel-level labels and
video-level priority targets back into SQLite, then writes a wiki report.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

WIKI = Path(os.environ.get('HAPA_WIKI_ROOT') or os.environ.get('HAPA_WIKI_PATH') or '~/Hapa_Worldbuilding_Wiki').expanduser()
DB = Path(os.environ.get('HAPA_YOUTUBE_DB') or WIKI / 'Raw/YouTube/youtube-watch-history-v2.sqlite').expanduser()
REPORT = WIKI / 'Raw' / 'YouTube' / 'reports' / 'YouTube Channel Content Buckets.md'
SUMMARY_JSON = WIKI / 'Raw' / 'YouTube' / 'reports' / 'youtube-channel-content-buckets-summary.json'

BUCKETS = [
    ('AI', 1),
    ('Geopolitics', 2),
    ('History', 3),
    ('Technology', 4),
    ('Science & Math', 5),
    ('Religion & Philosophy', 6),
]
PRIORITY = {name: rank for name, rank in BUCKETS}
OTHER = 'Other / Unclassified'

# Channels where the creator identity is enough to classify strongly. This improves
# high-impact channels and avoids relying only on individual video titles.
MANUAL: dict[str, list[str]] = {
    # AI
    'wes roth': ['AI'],
    'matthew berman': ['AI'],
    'theaigrid': ['AI'],
    'worldofai': ['AI'],
    'ai search': ['AI'],
    'ai jason': ['AI'],
    'david ondrej': ['AI'],
    'julian goldie seo': ['AI', 'Technology'],
    'data wizardry': ['AI', 'Technology'],
    'github awesome': ['AI', 'Technology'],
    'matt wolfe': ['AI'],
    'all about ai': ['AI'],
    'two minute papers': ['AI', 'Science & Math'],
    'yannic kilcher': ['AI', 'Science & Math'],
    'bycloud': ['AI', 'Technology'],

    # Geopolitics / military current affairs
    'zeihan on geopolitics': ['Geopolitics'],
    'task & purpose': ['Geopolitics', 'Technology'],
    'warfronts': ['Geopolitics', 'History'],
    'combat veteran news': ['Geopolitics'],
    'reallifelore': ['Geopolitics', 'History'],
    'johnny harris': ['Geopolitics', 'History'],
    'caspianreport': ['Geopolitics', 'History'],
    'visualpolitik en': ['Geopolitics'],
    'binkov\'s battlegrounds': ['Geopolitics', 'Technology'],
    'insights from ukraine and russia': ['Geopolitics'],
    'denys davydov': ['Geopolitics'],
    'the enforcer': ['Geopolitics'],
    'artur rehi': ['Geopolitics'],
    'china observer': ['Geopolitics'],
    'good times bad times': ['Geopolitics'],
    'dw news': ['Geopolitics'],
    'bbc news': ['Geopolitics'],
    'sky news': ['Geopolitics'],
    'cnn': ['Geopolitics'],
    'cnbc': ['Geopolitics', 'Technology'],
    'cnbc television': ['Geopolitics'],
    'the wall street journal': ['Geopolitics', 'Technology'],
    'the trump report': ['Geopolitics'],
    'andrew bustamante': ['Geopolitics'],

    # History
    'kings and generals': ['History', 'Geopolitics'],
    'invicta': ['History'],
    'simple history': ['History'],
    'the fat electrician': ['History', 'Geopolitics', 'Technology'],
    'the fat files': ['History', 'Geopolitics'],
    'the infographics show': ['History', 'Geopolitics', 'Science & Math'],
    'a day in history': ['History'],
    'timeline - world history documentaries': ['History'],
    'epic history': ['History'],
    'the military show': ['History', 'Geopolitics', 'Technology'],
    'the armchair historian': ['History'],
    'sandrhoman history': ['History'],
    'historymarche': ['History'],
    'oversimplified': ['History'],
    'history matters': ['History'],

    # Technology
    'linus tech tips': ['Technology'],
    'fireship': ['Technology'],
    'the primetime': ['Technology'],
    'iJustine'.lower(): ['Technology'],
    'thrillseeker': ['Technology'],
    'the virtual reality show': ['Technology'],
    'force gaming': ['Technology'],
    'gameranx': ['Technology'],
    'ign': ['Technology'],
    'asongold tv': ['Technology'],
    'asmongold tv': ['Technology'],
    'logically answered': ['Technology', 'Science & Math'],
    'megaprojects': ['Technology', 'History'],
    'sideprojects': ['Technology', 'History'],
    'business basics': ['Technology', 'Geopolitics'],
    'how money works': ['Technology', 'Geopolitics'],
    'heresy financial': ['Geopolitics', 'Technology'],

    # Science & Math
    'veritasium': ['Science & Math', 'Technology'],
    'welch labs': ['Science & Math', 'AI'],
    'joe scott': ['Science & Math', 'Technology'],
    'scishow': ['Science & Math'],
    'kurzgesagt – in a nutshell': ['Science & Math', 'Religion & Philosophy'],
    'kurzgesagt - in a nutshell': ['Science & Math', 'Religion & Philosophy'],
    'numberphile': ['Science & Math'],
    '3blue1brown': ['Science & Math'],
    'minutephysics': ['Science & Math'],
    'sabine hossenfelder': ['Science & Math', 'Religion & Philosophy'],
    'big think': ['Religion & Philosophy', 'Science & Math'],
    'tedx talks': ['Religion & Philosophy', 'Science & Math', 'Technology'],
    'ted': ['Religion & Philosophy', 'Science & Math', 'Technology'],

    # Religion & Philosophy
    'lex fridman': ['AI', 'Technology', 'Science & Math', 'Religion & Philosophy'],
    'lex clips': ['AI', 'Technology', 'Science & Math', 'Religion & Philosophy'],
    'chris williamson': ['Religion & Philosophy'],
    'tom bilyeu': ['Religion & Philosophy', 'Technology'],
    'the diary of a ceo': ['Religion & Philosophy', 'Technology'],
    'soft white underbelly': ['Religion & Philosophy'],
    'thoughty2': ['Science & Math', 'History', 'Religion & Philosophy'],
    'video advice': ['Religion & Philosophy'],
}

KEYWORDS: dict[str, list[str]] = {
    'AI': [
        r'\bai\b', r'artificial intelligence', r'agi\b', r'openai', r'chatgpt', r'claude', r'gemini', r'llm\b',
        r'large language model', r'neural', r'deep learning', r'machine learning', r'agentic', r'ai agent',
        r'prompt', r'cursor', r'copilot', r'midjourney', r'stable diffusion', r'runway', r'comfyui', r'voice model',
        r'text.?to.?video', r'autonomous agent', r'qwen', r'notebooklm', r'perplexity', r'gpt', r'robotics',
    ],
    'Geopolitics': [
        r'geopolitic', r'ukraine', r'russia', r'china', r'taiwan', r'nato', r'israel', r'gaza', r'iran', r'war\b',
        r'military', r'army', r'navy', r'air force', r'defense', r'weapon', r'missile', r'tank', r'drone',
        r'frontline', r'battlefield', r'election', r'president', r'congress', r'politic', r'policy', r'economy',
        r'global', r'oil', r'trade', r'sanction', r'intelligence', r'cia', r'border', r'empire',
    ],
    'History': [
        r'history', r'historical', r'ancient', r'rome', r'roman', r'greek', r'medieval', r'wwi', r'wwii',
        r'world war', r'cold war', r'civil war', r'empire', r'kingdom', r'battle of', r'battle\b', r'war of',
        r'documentary', r'century', r'archaeology', r'egypt', r'napoleon', r'viking', r'crusade', r'timeline',
    ],
    'Technology': [
        r'tech', r'technology', r'computer', r'programming', r'coding', r'developer', r'javascript', r'python',
        r'github', r'software', r'hardware', r'gpu', r'nvidia', r'apple', r'iphone', r'macbook', r'linux',
        r'windows', r'vr\b', r'ar\b', r'virtual reality', r'robot', r'startup', r'saas', r'app\b', r'cloud',
        r'security', r'hacking', r'cyber', r'database', r'chip', r'semiconductor', r'tesla', r'spacecraft',
        r'engineering', r'3d print', r'game dev', r'unreal engine', r'unity',
    ],
    'Science & Math': [
        r'science', r'math', r'physics', r'quantum', r'astronomy', r'space', r'cosmos', r'biology', r'chemistry',
        r'neuroscience', r'psychology', r'evolution', r'climate', r'energy', r'black hole', r'equation',
        r'statistics', r'probability', r'calculus', r'geometry', r'algorithm', r'lab\b', r'experiment',
    ],
    'Religion & Philosophy': [
        r'religion', r'god\b', r'jesus', r'christian', r'bible', r'islam', r'muslim', r'hindu', r'buddh',
        r'spiritual', r'soul', r'consciousness', r'philosophy', r'philosopher', r'ethics', r'morality',
        r'meaning of life', r'stoic', r'jung', r'myth', r'theology', r'faith', r'wisdom', r'purpose',
        r'truth', r'love', r'free will', r'existential', r'meditation',
    ],
}

COMPILED = {k: [re.compile(p, re.I) for p in pats] for k, pats in KEYWORDS.items()}


def configure_paths(wiki: Path) -> None:
    global WIKI, REPORT, SUMMARY_JSON
    WIKI = wiki.expanduser()
    REPORT = WIKI / 'Raw' / 'YouTube' / 'reports' / 'YouTube Channel Content Buckets.md'
    SUMMARY_JSON = WIKI / 'Raw' / 'YouTube' / 'reports' / 'youtube-channel-content-buckets-summary.json'


def norm(s: str | None) -> str:
    return re.sub(r'\s+', ' ', (s or '').strip()).lower()


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute("select 1 from sqlite_master where type='table' and name=?", (name,)).fetchone())


def setup(conn: sqlite3.Connection) -> None:
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS channel_content_categories (
      channel_key TEXT PRIMARY KEY,
      channel_id TEXT,
      channel_name TEXT,
      unique_videos INTEGER NOT NULL DEFAULT 0,
      watch_events INTEGER NOT NULL DEFAULT 0,
      primary_category TEXT NOT NULL,
      priority_rank INTEGER,
      categories_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_json TEXT NOT NULL,
      method TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_content_primary ON channel_content_categories(primary_category, priority_rank);
    CREATE INDEX IF NOT EXISTS idx_channel_content_rank ON channel_content_categories(priority_rank);

    CREATE TABLE IF NOT EXISTS video_content_targets (
      video_id TEXT PRIMARY KEY,
      channel_key TEXT NOT NULL,
      channel_name TEXT,
      primary_category TEXT NOT NULL,
      priority_rank INTEGER,
      categories_json TEXT NOT NULL,
      watch_count INTEGER NOT NULL DEFAULT 0,
      is_ad INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_video_content_primary ON video_content_targets(primary_category, priority_rank);
    CREATE INDEX IF NOT EXISTS idx_video_content_channel ON video_content_targets(channel_key);
    ''')


def get_channel_rows(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    sql = '''
    SELECT
      COALESCE(NULLIF(v.channel_id,''), 'name:' || COALESCE(NULLIF(v.channel_name,''), '[unknown channel]')) AS channel_key,
      NULLIF(v.channel_id,'') AS channel_id,
      COALESCE(NULLIF(v.channel_name,''), '[unknown channel]') AS channel_name,
      COUNT(*) AS unique_videos,
      COALESCE(SUM(v.watch_count),0) AS watch_events,
      GROUP_CONCAT(v.title, ' ||| ') AS titles
    FROM videos v
    WHERE COALESCE(json_extract(v.raw_json,'$.isAd'),0) != 1
    GROUP BY channel_key
    ORDER BY watch_events DESC, unique_videos DESC
    '''
    return [dict(zip([d[0] for d in cur.description], row)) for cur in [conn.execute(sql)] for row in cur.fetchall()]


def likely_music_channel(channel_name: str, titles: list[str]) -> bool:
    """Suppress common artist/music channels whose song titles trigger false topic hits.

    Examples: “War”, “God”, “Truth”, “World”, “AI” inside lyrics/song titles should not
    make an artist channel geopolitics/philosophy/AI.
    """
    n = norm(channel_name)
    if not n or n == '[unknown channel]':
        return False
    music_name_patterns = [
        r'\bvevo\b', r' - topic$', r'\bmusic\b', r'\brecords\b', r'\bofficial\b',
        r'\bband\b', r'\bdj\b', r'\blofi\b', r'\bremix\b', r'\bdubstep\b',
    ]
    if any(re.search(p, n, re.I) for p in music_name_patterns):
        return True
    music_title_hits = 0
    checked = titles[:40]
    for t in checked:
        tl = t.lower()
        if re.search(r'official (video|audio|visualizer|music video)|lyric video|\bfeat\.?\b|\bft\.?\b|remix|cover\)|live on|topic -|provided to youtube', tl):
            music_title_hits += 1
    return bool(checked) and music_title_hits >= max(2, min(6, len(checked) // 3))


def classify(channel_name: str, titles_blob: str, unique_videos: int, watch_events: int) -> dict[str, Any]:
    n = norm(channel_name)
    titles = [t for t in (titles_blob or '').split(' ||| ') if t]
    text = (channel_name + ' ' + ' '.join(titles[:80])).lower()
    score = Counter()
    evidence: dict[str, list[str]] = defaultdict(list)
    method_parts: list[str] = []

    if likely_music_channel(channel_name, titles) and n not in MANUAL:
        return {
            'primary_category': OTHER,
            'priority_rank': None,
            'categories': [OTHER],
            'confidence': 0.86,
            'evidence': {OTHER: ['suppressed likely music/artist channel to avoid song-title false positives']},
            'method': 'likely-music-channel-suppression',
            'scores': {},
        }

    if n in MANUAL:
        for cat in MANUAL[n]:
            score[cat] += 18
            evidence[cat].append(f'manual channel match: {channel_name}')
        method_parts.append('manual-channel')

    # Fuzzy manual contains for canonical names with suffixes like VEVO/Topic removed is not desirable for music,
    # so only exact manual matches above. Keyword scoring handles the rest.
    for cat, patterns in COMPILED.items():
        for pat in patterns:
            matches = pat.findall(text)
            if matches:
                # cap single keyword contribution so channels with one repeated term do not dominate too much
                inc = min(8, len(matches))
                score[cat] += inc
                if len(evidence[cat]) < 5:
                    evidence[cat].append(f'keyword `{pat.pattern}` x{len(matches)}')
        # channel-name hit is strong
        for pat in patterns:
            if pat.search(channel_name or ''):
                score[cat] += 10
                if len(evidence[cat]) < 5:
                    evidence[cat].append(f'channel-name keyword `{pat.pattern}`')
                break

    # Filter low-confidence false positives for broad words by requiring a minimum signal.
    categories = [cat for cat, val in score.items() if val >= 6]
    categories.sort(key=lambda c: (PRIORITY[c], -score[c]))

    if categories:
        primary = categories[0]
        rank = PRIORITY[primary]
        top_score = score[primary]
        confidence = min(0.96, 0.45 + (top_score / 30.0))
        method = '+'.join(method_parts + ['keyword-aggregate'])
    else:
        primary = OTHER
        rank = None
        confidence = 0.25
        categories = [OTHER]
        method = 'unclassified-channel-aggregate'
        evidence[OTHER].append('No requested-bucket channel/title signals above threshold')

    return {
        'primary_category': primary,
        'priority_rank': rank,
        'categories': categories,
        'confidence': round(confidence, 3),
        'evidence': {k: v for k, v in evidence.items() if k in categories or k == OTHER},
        'method': method,
        'scores': dict(score),
    }


def write_report(conn: sqlite3.Connection, generated_at: str) -> dict[str, Any]:
    primary_rows = conn.execute('''
      SELECT primary_category, COUNT(*) unique_videos, SUM(watch_count) watch_events, COUNT(DISTINCT channel_key) channels
      FROM video_content_targets
      WHERE is_ad=0
      GROUP BY primary_category
      ORDER BY CASE primary_category
        WHEN 'AI' THEN 1 WHEN 'Geopolitics' THEN 2 WHEN 'History' THEN 3 WHEN 'Technology' THEN 4
        WHEN 'Science & Math' THEN 5 WHEN 'Religion & Philosophy' THEN 6 ELSE 99 END
    ''').fetchall()
    multi_rows = conn.execute('''
      SELECT c.primary_category, COUNT(*) channels, SUM(c.unique_videos) unique_videos, SUM(c.watch_events) watch_events
      FROM channel_content_categories c
      GROUP BY c.primary_category
      ORDER BY CASE c.primary_category
        WHEN 'AI' THEN 1 WHEN 'Geopolitics' THEN 2 WHEN 'History' THEN 3 WHEN 'Technology' THEN 4
        WHEN 'Science & Math' THEN 5 WHEN 'Religion & Philosophy' THEN 6 ELSE 99 END
    ''').fetchall()
    channel_top = conn.execute('''
      SELECT channel_name, primary_category, unique_videos, watch_events, confidence, categories_json
      FROM channel_content_categories
      ORDER BY CASE primary_category
        WHEN 'AI' THEN 1 WHEN 'Geopolitics' THEN 2 WHEN 'History' THEN 3 WHEN 'Technology' THEN 4
        WHEN 'Science & Math' THEN 5 WHEN 'Religion & Philosophy' THEN 6 ELSE 99 END,
        watch_events DESC
      LIMIT 80
    ''').fetchall()
    total_videos = conn.execute('SELECT COUNT(*) FROM video_content_targets WHERE is_ad=0').fetchone()[0]
    target_videos = conn.execute("SELECT COUNT(*) FROM video_content_targets WHERE is_ad=0 AND primary_category != ?", (OTHER,)).fetchone()[0]
    total_watch = conn.execute('SELECT COALESCE(SUM(watch_count),0) FROM video_content_targets WHERE is_ad=0').fetchone()[0]
    target_watch = conn.execute("SELECT COALESCE(SUM(watch_count),0) FROM video_content_targets WHERE is_ad=0 AND primary_category != ?", (OTHER,)).fetchone()[0]
    channels = conn.execute('SELECT COUNT(*) FROM channel_content_categories').fetchone()[0]
    target_channels = conn.execute('SELECT COUNT(*) FROM channel_content_categories WHERE primary_category != ?', (OTHER,)).fetchone()[0]

    summary = {
        'generated_at': generated_at,
        'method': 'channel-first offline keyword/manual aggregate from channel names and watched video titles',
        'primary_bucket_counts': [
            {'primary_category': r[0], 'unique_videos': r[1], 'watch_events': r[2], 'channels': r[3]} for r in primary_rows
        ],
        'totals': {
            'non_ad_unique_videos': total_videos,
            'priority_bucket_unique_videos': target_videos,
            'other_unique_videos': total_videos - target_videos,
            'non_ad_watch_events': total_watch,
            'priority_bucket_watch_events': target_watch,
            'other_watch_events': total_watch - target_watch,
            'channels': channels,
            'priority_bucket_channels': target_channels,
            'other_channels': channels - target_channels,
        },
    }
    SUMMARY_JSON.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    def pct(n: int, d: int) -> str:
        return '0.0%' if not d else f'{n/d*100:.1f}%'

    lines: list[str] = []
    lines.append('---')
    lines.append('title: YouTube Channel Content Buckets')
    lines.append('type: youtube-enrichment-report')
    lines.append('tags: [youtube, hapa, content-buckets, ai, geopolitics, history, technology, science, philosophy]')
    lines.append(f'last_updated: {generated_at}')
    lines.append('---')
    lines.append('')
    lines.append('# YouTube Channel Content Buckets')
    lines.append('')
    lines.append(f'Last updated: `{generated_at}`')
    lines.append('')
    lines.append('This is a channel-first categorization of Calder’s YouTube watch-history DB into the requested priority buckets: AI, Geopolitics, History, Technology, Science & Math, and Religion & Philosophy. The classifier uses channel names plus watched video titles and records the result back into SQLite.')
    lines.append('')
    lines.append('Important caveat: this is an offline first pass, not a human-audited taxonomy. It is designed to create useful prioritization targets for transcript fetching and later manual correction.')
    lines.append('')
    lines.append('## Target Counts: Primary Channel Bucket')
    lines.append('')
    lines.append('| Bucket | Channels | Unique watched videos | Watch events | Share of unique videos |')
    lines.append('|---|---:|---:|---:|---:|')
    for cat, uv, wc, ch in primary_rows:
        lines.append(f'| {cat} | {ch:,} | {uv:,} | {wc:,} | {pct(uv, total_videos)} |')
    lines.append(f'| Priority buckets total | {target_channels:,} | {target_videos:,} | {target_watch:,} | {pct(target_videos, total_videos)} |')
    lines.append(f'| Other / Unclassified | {channels - target_channels:,} | {total_videos - target_videos:,} | {total_watch - target_watch:,} | {pct(total_videos - target_videos, total_videos)} |')
    lines.append(f'| Grand total non-ad videos | {channels:,} | {total_videos:,} | {total_watch:,} | 100.0% |')
    lines.append('')
    lines.append('## Suggested Transcript Priority Order')
    lines.append('')
    for name, rank in BUCKETS:
        row = next((r for r in primary_rows if r[0] == name), None)
        uv = row[1] if row else 0
        wc = row[2] if row else 0
        lines.append(f'{rank}. {name}: target `{uv:,}` unique watched videos / `{wc:,}` watch events')
    lines.append('')
    lines.append('## Top Categorized Channels')
    lines.append('')
    lines.append('| Channel | Primary | Unique videos | Watch events | Confidence | Other labels |')
    lines.append('|---|---|---:|---:|---:|---|')
    for name, primary, uv, wc, conf, cats_json in channel_top:
        cats = json.loads(cats_json)
        others = ', '.join([c for c in cats if c != primary]) or '-'
        safe_name = str(name).replace('|', '\\|')
        lines.append(f'| {safe_name} | {primary} | {uv:,} | {wc:,} | {float(conf):.2f} | {others} |')
    lines.append('')
    lines.append('## SQLite Tables Written')
    lines.append('')
    lines.append('- `channel_content_categories`: one row per creator/channel aggregate, with primary category, multi-label categories, confidence, and evidence JSON.')
    lines.append('- `video_content_targets`: one row per non-ad video, inheriting the channel primary/multi-label categories for queue targeting.')
    lines.append('- Transcript, metadata, enrichment, and wiki-video jobs were reprioritized from the channel bucket: AI=100, Geopolitics=200, History=300, Technology=400, Science & Math=500, Religion & Philosophy=600, Other/Unclassified=900.')
    lines.append(f'- Summary JSON: `{SUMMARY_JSON}`')
    lines.append('')
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return summary


def run(db: Path, dry_run: bool = False) -> dict[str, Any]:
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    with sqlite3.connect(db) as conn:
        conn.row_factory = sqlite3.Row
        setup(conn)
        rows = get_channel_rows(conn)
        now = generated_at
        chan_records = []
        for row in rows:
            result = classify(row['channel_name'], row['titles'] or '', int(row['unique_videos']), int(row['watch_events']))
            chan_records.append((
                row['channel_key'], row['channel_id'], row['channel_name'], int(row['unique_videos']), int(row['watch_events']),
                result['primary_category'], result['priority_rank'], json.dumps(result['categories'], ensure_ascii=False),
                result['confidence'], json.dumps({'evidence': result['evidence'], 'scores': result['scores']}, ensure_ascii=False),
                result['method'], now,
            ))
        if not dry_run:
            conn.execute('DELETE FROM channel_content_categories')
            conn.execute('DELETE FROM video_content_targets')
            conn.executemany('''
              INSERT INTO channel_content_categories
              (channel_key, channel_id, channel_name, unique_videos, watch_events, primary_category, priority_rank, categories_json, confidence, evidence_json, method, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', chan_records)
            conn.execute('''
              INSERT INTO video_content_targets
              (video_id, channel_key, channel_name, primary_category, priority_rank, categories_json, watch_count, is_ad, updated_at)
              SELECT v.id,
                     COALESCE(NULLIF(v.channel_id,''), 'name:' || COALESCE(NULLIF(v.channel_name,''), '[unknown channel]')) AS channel_key,
                     COALESCE(NULLIF(v.channel_name,''), '[unknown channel]') AS channel_name,
                     c.primary_category,
                     c.priority_rank,
                     c.categories_json,
                     v.watch_count,
                     COALESCE(json_extract(v.raw_json,'$.isAd'),0) AS is_ad,
                     ?
              FROM videos v
              JOIN channel_content_categories c ON c.channel_key = COALESCE(NULLIF(v.channel_id,''), 'name:' || COALESCE(NULLIF(v.channel_name,''), '[unknown channel]'))
              WHERE COALESCE(json_extract(v.raw_json,'$.isAd'),0) != 1
            ''', (now,))
            conn.execute('''
              UPDATE jobs
              SET priority = CASE
                    WHEN kind IN ('transcript','video_metadata','enrichment','wiki_video')
                    THEN COALESCE((SELECT priority_rank * 100 FROM video_content_targets v WHERE v.video_id = jobs.target_id), 900)
                    ELSE priority
                  END,
                  updated_at = ?
              WHERE kind IN ('transcript','video_metadata','enrichment','wiki_video')
                AND EXISTS (SELECT 1 FROM video_content_targets v WHERE v.video_id = jobs.target_id)
            ''', (now,))
            summary = write_report(conn, generated_at)
            conn.commit()
        else:
            summary = {'generated_at': generated_at, 'dry_run_channels': len(chan_records)}
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--wiki', default=str(WIKI))
    parser.add_argument('--db', default='')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    wiki = Path(args.wiki).expanduser()
    configure_paths(wiki)
    db = Path(args.db).expanduser() if args.db else (wiki / 'Raw/YouTube/youtube-watch-history-v2.sqlite')
    summary = run(db, dry_run=args.dry_run)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
