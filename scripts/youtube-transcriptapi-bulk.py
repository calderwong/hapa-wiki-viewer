#!/usr/bin/env python3
"""Prioritized TranscriptAPI.com bulk transcript harvester for Hapa YouTube library.

Uses the existing v2 SQLite DB, channel/video priority buckets, and transcript table.
API key is read from TRANSCRIPTAPI_KEY / HAPA_TRANSCRIPTAPI_KEY / TRANSCRIPT_API_KEY.
For this one-off operational environment, if no env var is present it can recover a
previously used key from local Hermes session logs without printing it.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_WIKI = Path(os.environ.get('HAPA_WIKI_ROOT') or os.environ.get('HAPA_WIKI_PATH') or '~/Hapa_Worldbuilding_Wiki').expanduser()
DEFAULT_DB = Path(os.environ.get('HAPA_YOUTUBE_DB') or DEFAULT_WIKI / 'Raw/YouTube/youtube-watch-history-v2.sqlite').expanduser()
TRANSCRIPTS_DIR = DEFAULT_WIKI / 'Raw/YouTube/transcripts'
REPORTS_DIR = DEFAULT_WIKI / 'Raw/YouTube/reports'
API_URL = 'https://transcriptapi.com/api/v2/youtube/transcript'
PRIORITY_ORDER = ['AI', 'Geopolitics', 'History', 'Technology', 'Science & Math', 'Religion & Philosophy', 'Other / Unclassified']


def configure_paths(wiki: Path) -> None:
    global TRANSCRIPTS_DIR, REPORTS_DIR
    wiki = wiki.expanduser()
    TRANSCRIPTS_DIR = wiki / 'Raw/YouTube/transcripts'
    REPORTS_DIR = wiki / 'Raw/YouTube/reports'


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def stable_hash(value: str, length: int = 8) -> str:
    return hashlib.sha256((value or '').encode('utf-8')).hexdigest()[:length]


def find_api_key() -> str | None:
    for name in ('TRANSCRIPTAPI_KEY', 'HAPA_TRANSCRIPTAPI_KEY', 'TRANSCRIPT_API_KEY', 'YOUTUBE_TRANSCRIPT_API_KEY', 'HAPA_YOUTUBE_TRANSCRIPTAPI_KEY'):
        val = os.environ.get(name)
        if val:
            return val.strip()
    return None


def fetch_transcript(api_key: str, video_id: str, timeout: int = 60) -> tuple[int, dict | list | None, str | None]:
    params = {'video_url': video_id, 'format': 'json', 'include_timestamp': 'true', 'send_metadata': 'true'}
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {api_key}', 'Accept': 'application/json', 'User-Agent': 'hapa-youtube-transcript-bulk/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                return resp.status, None, body[:2000]
            return resp.status, payload, None
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:2000]
        return e.code, None, body
    except Exception as e:
        return 0, None, str(e)[:2000]


def extract_rows(payload) -> tuple[str, list[dict]]:
    if isinstance(payload, list):
        return 'unknown', payload
    if not isinstance(payload, dict):
        return 'unknown', []
    language = payload.get('language') or payload.get('language_code') or payload.get('lang') or 'unknown'
    rows = payload.get('transcript') or payload.get('segments') or payload.get('rows') or payload.get('data') or []
    if isinstance(rows, dict):
        rows = rows.get('transcript') or rows.get('segments') or rows.get('rows') or []
    if not isinstance(rows, list):
        rows = []
    return str(language or 'unknown'), rows


def rows_to_text(rows: list[dict]) -> str:
    out = []
    for row in rows:
        if isinstance(row, dict):
            text = row.get('text') or row.get('caption') or row.get('content') or ''
        else:
            text = str(row)
        text = str(text).strip()
        if text:
            out.append(text)
    return '\n'.join(out)


def category_case_sql() -> str:
    parts = [f"WHEN vct.primary_category = ? THEN {idx}" for idx, _ in enumerate(PRIORITY_ORDER)]
    return 'CASE ' + ' '.join(parts) + ' ELSE 999 END'


def select_candidates(conn: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    sql = f'''
      SELECT v.id, v.title, v.url, v.channel_name,
             COALESCE(vct.primary_category, 'Other / Unclassified') AS primary_category,
             COALESCE(vct.priority_rank, 900) AS priority_rank,
             COALESCE(v.watch_count, 0) AS watch_count,
             j.id AS job_id, j.status AS job_status
      FROM videos v
      LEFT JOIN video_content_targets vct ON vct.video_id = v.id
      LEFT JOIN transcripts t ON t.video_id = v.id
      LEFT JOIN jobs j ON j.kind = 'transcript' AND j.target_type = 'video' AND j.target_id = v.id
      WHERE COALESCE(vct.is_ad, 0) = 0
        AND (t.video_id IS NULL OR COALESCE(t.char_count, 0) = 0 OR t.error IS NOT NULL)
        AND COALESCE(v.transcript_status, 'pending') != 'succeeded'
      ORDER BY {category_case_sql()}, COALESCE(vct.priority_rank, 900), COALESCE(v.watch_count, 0) DESC, v.last_watched_at DESC, v.id
      LIMIT ?
    '''
    return list(conn.execute(sql, [*PRIORITY_ORDER, limit]))


def upsert_success(conn: sqlite3.Connection, row: sqlite3.Row, payload, language: str, text: str, raw_path: Path, text_path: Path) -> None:
    stamp = now()
    conn.execute('''
      INSERT INTO transcripts (video_id, source, language, text_path, raw_path, char_count, fetched_at, error)
      VALUES (?, 'transcriptapi', ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(video_id) DO UPDATE SET
        source = excluded.source,
        language = excluded.language,
        text_path = excluded.text_path,
        raw_path = excluded.raw_path,
        char_count = excluded.char_count,
        fetched_at = excluded.fetched_at,
        error = NULL
    ''', (row['id'], language, str(text_path), str(raw_path), len(text), stamp))
    conn.execute('UPDATE videos SET transcript_status = ?, updated_at = ? WHERE id = ?', ('succeeded', stamp, row['id']))
    conn.execute("UPDATE jobs SET status='succeeded', attempts=attempts+1, last_error=NULL, updated_at=?, completed_at=? WHERE kind='transcript' AND target_type='video' AND target_id=?", (stamp, stamp, row['id']))


def upsert_failure(conn: sqlite3.Connection, row: sqlite3.Row, source: str, error: str) -> None:
    stamp = now()
    conn.execute('''
      INSERT INTO transcripts (video_id, source, error, fetched_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET source=excluded.source, error=excluded.error, fetched_at=excluded.fetched_at
    ''', (row['id'], source, error[:2000], stamp))
    conn.execute('UPDATE videos SET transcript_status = ?, updated_at = ? WHERE id = ?', ('failed', stamp, row['id']))
    conn.execute("UPDATE jobs SET status='failed', attempts=attempts+1, last_error=?, updated_at=?, completed_at=? WHERE kind='transcript' AND target_type='video' AND target_id=?", (error[:2000], stamp, stamp, row['id']))


def write_report(stats: dict) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / 'transcriptapi-bulk-latest.json'
    path.write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding='utf-8')
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--wiki', default=str(DEFAULT_WIKI))
    ap.add_argument('--db', default='')
    ap.add_argument('--limit', type=int, default=9100)
    ap.add_argument('--sleep', type=float, default=0.25)
    ap.add_argument('--timeout', type=int, default=60)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()
    wiki = Path(args.wiki).expanduser()
    configure_paths(wiki)
    db = Path(args.db).expanduser() if args.db else (wiki / 'Raw/YouTube/youtube-watch-history-v2.sqlite')

    api_key = find_api_key()
    if not api_key and not args.dry_run:
        print('ERROR: Set TRANSCRIPTAPI_KEY (or HAPA_TRANSCRIPTAPI_KEY / TRANSCRIPT_API_KEY).', file=sys.stderr)
        return 2
    api_key = api_key or ''

    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    candidates = select_candidates(conn, args.limit)
    by_cat = {}
    for r in candidates:
        by_cat[r['primary_category']] = by_cat.get(r['primary_category'], 0) + 1
    print(json.dumps({'mode': 'dry-run' if args.dry_run else 'run', 'candidate_count': len(candidates), 'by_category': by_cat}, ensure_ascii=False))
    if args.dry_run:
        return 0

    stats = {'started_at': now(), 'limit': args.limit, 'attempted': 0, 'succeeded': 0, 'failed': 0, 'empty': 0, 'http_errors': {}, 'chars': 0, 'by_category': {}, 'last_video_id': None}
    for row in candidates:
        stats['attempted'] += 1
        stats['last_video_id'] = row['id']
        cat = row['primary_category']
        stats['by_category'].setdefault(cat, {'attempted': 0, 'succeeded': 0, 'failed': 0, 'chars': 0})
        stats['by_category'][cat]['attempted'] += 1
        status, payload, err = fetch_transcript(api_key, row['id'], timeout=args.timeout)
        if status == 200 and payload is not None:
            language, rows = extract_rows(payload)
            text = rows_to_text(rows)
            if text:
                safe = f"{row['id']}-{stable_hash(row['title'])}"
                raw_path = TRANSCRIPTS_DIR / f"{safe}.transcriptapi.json"
                text_path = TRANSCRIPTS_DIR / f"{safe}.transcriptapi.txt"
                wrapped = payload if isinstance(payload, dict) else {'video_id': row['id'], 'language': language, 'transcript': payload}
                raw_path.write_text(json.dumps(wrapped, indent=2, ensure_ascii=False), encoding='utf-8')
                text_path.write_text(text, encoding='utf-8')
                upsert_success(conn, row, payload, language, text, raw_path, text_path)
                stats['succeeded'] += 1
                stats['chars'] += len(text)
                stats['by_category'][cat]['succeeded'] += 1
                stats['by_category'][cat]['chars'] += len(text)
                if args.verbose:
                    print(f"OK {stats['attempted']}/{len(candidates)} {row['id']} {cat} chars={len(text)}")
            else:
                error = 'TranscriptAPI returned 200 but no transcript text'
                upsert_failure(conn, row, 'transcriptapi', error)
                stats['empty'] += 1
                stats['failed'] += 1
                stats['by_category'][cat]['failed'] += 1
                print(f"EMPTY {stats['attempted']}/{len(candidates)} {row['id']} {cat}")
        else:
            error = f"TranscriptAPI HTTP/status {status}: {err or 'no payload'}"
            upsert_failure(conn, row, 'transcriptapi', error)
            stats['failed'] += 1
            stats['by_category'][cat]['failed'] += 1
            stats['http_errors'][str(status)] = stats['http_errors'].get(str(status), 0) + 1
            print(f"FAIL {stats['attempted']}/{len(candidates)} {row['id']} {cat} status={status}")
            if status in (401, 402, 403, 429):
                print('Stopping on auth/payment/rate-limit status to avoid wasting requests.', file=sys.stderr)
                break
        if stats['attempted'] % 10 == 0:
            conn.commit()
        if stats['attempted'] % 50 == 0:
            stats['updated_at'] = now()
            write_report(stats)
            print(json.dumps({'progress': stats['attempted'], 'succeeded': stats['succeeded'], 'failed': stats['failed'], 'chars': stats['chars']}, ensure_ascii=False))
        if args.sleep:
            time.sleep(args.sleep)
    conn.commit()
    stats['finished_at'] = now()
    report = write_report(stats)
    print(json.dumps({'done': True, 'report': str(report), **stats}, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
