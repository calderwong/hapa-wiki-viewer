#!/usr/bin/env python3
"""Conservative long-running/cron-safe YouTube transcript harvester.

This script wraps scripts/youtube-library.js instead of duplicating transcript logic.
It is designed to run repeatedly from cron: one tiny transcript batch, randomized
pauses, and exponential cooldown when YouTube starts blocking the IP.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_WIKI = Path(os.environ.get('HAPA_WIKI_ROOT') or os.environ.get('HAPA_WIKI_PATH') or '~/Hapa_Worldbuilding_Wiki').expanduser()
DEFAULT_DB = Path(os.environ.get('HAPA_YOUTUBE_DB') or DEFAULT_WIKI / 'Raw/YouTube/youtube-watch-history-v2.sqlite').expanduser()
DEFAULT_STATE = Path(os.environ.get('HAPA_YT_GOAL_STATE') or DEFAULT_WIKI / 'Raw/YouTube/reports/transcript-goal-state.json').expanduser()
YOUTUBE_LIBRARY = REPO / 'scripts' / 'youtube-library.js'

BLOCK_PATTERNS = [
    'IpBlocked',
    'too many requests',
    'blocked by YouTube',
    'HTTP Error 429',
    '429 Too Many Requests',
]
TRANSIENT_PATTERNS = [
    'timed out',
    'timeout',
    'temporarily unavailable',
    'Remote end closed connection',
]


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(ts: dt.datetime) -> str:
    return ts.astimezone(dt.timezone.utc).isoformat()


def parse_iso(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except Exception:
        return None


def load_state(path: Path) -> dict:
    if not path.exists():
        return {
            'created_at': iso(now_utc()),
            'consecutive_blocks': 0,
            'consecutive_empty_runs': 0,
            'total_runs': 0,
            'total_successes_seen': 0,
        }
    try:
        return json.loads(path.read_text())
    except Exception:
        return {'created_at': iso(now_utc()), 'state_parse_error': True}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True))


def db_counts(db: Path) -> dict:
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    try:
        jobs = {}
        for row in con.execute('select kind, status, count(*) as n from jobs group by kind, status'):
            jobs.setdefault(row['kind'], {})[row['status']] = row['n']
        one = lambda sql: con.execute(sql).fetchone()[0]
        return {
            'videos': one('select count(*) from videos'),
            'watch_events': one('select count(*) from watch_events'),
            'transcripts': one("select count(*) from transcripts where char_count > 0"),
            'failed_transcripts': one("select count(*) from transcripts where coalesce(error, '') != '' and coalesce(char_count, 0) = 0"),
            'transcript_jobs_pending': jobs.get('transcript', {}).get('pending', 0),
            'transcript_jobs_failed': jobs.get('transcript', {}).get('failed', 0),
            'transcript_jobs_succeeded': jobs.get('transcript', {}).get('succeeded', 0),
            'jobs': jobs,
        }
    finally:
        con.close()


def run_node(db: Path, command: str, limit: int, timeout: int = 900) -> tuple[int, str, str, dict | None]:
    cmd = ['node', '--no-warnings', str(YOUTUBE_LIBRARY), command, '--db', str(db), '--limit', str(limit)]
    proc = subprocess.run(cmd, cwd=str(REPO), text=True, capture_output=True, timeout=timeout)
    parsed = None
    if proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout)
        except Exception:
            parsed = None
    return proc.returncode, proc.stdout, proc.stderr, parsed


def requeue(db: Path, limit: int = 0) -> None:
    # queue-all is idempotent and moves failed transcript jobs back to pending.
    cmd = ['node', '--no-warnings', str(YOUTUBE_LIBRARY), 'queue-all', '--db', str(db)]
    if limit:
        cmd.extend(['--limit', str(limit)])
    subprocess.run(cmd, cwd=str(REPO), text=True, capture_output=True, timeout=600)


def contains_any(text: str, patterns: list[str]) -> bool:
    low = text.lower()
    return any(p.lower() in low for p in patterns)


def summarize_results(parsed: dict | None) -> dict:
    statuses: dict[str, int] = {}
    ids = []
    errors = []
    if parsed and isinstance(parsed.get('results'), list):
        for item in parsed['results']:
            status = item.get('status', 'unknown')
            statuses[status] = statuses.get(status, 0) + 1
            if item.get('id'):
                ids.append(item['id'])
            if item.get('error'):
                errors.append(str(item['error'])[:500])
    return {'statuses': statuses, 'ids': ids, 'errors': errors[:3]}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='Conservative YouTube transcript goal runner')
    ap.add_argument('--db', default=str(DEFAULT_DB))
    ap.add_argument('--state', default=str(DEFAULT_STATE))
    ap.add_argument('--max-attempts', type=int, default=int(os.environ.get('HAPA_YT_GOAL_MAX_ATTEMPTS', '1')),
                    help='Transcript attempts per run. Keep small; default 1.')
    ap.add_argument('--metadata-limit', type=int, default=int(os.environ.get('HAPA_YT_GOAL_METADATA_LIMIT', '5')))
    ap.add_argument('--min-sleep', type=int, default=int(os.environ.get('HAPA_YT_GOAL_MIN_SLEEP', '90')))
    ap.add_argument('--max-sleep', type=int, default=int(os.environ.get('HAPA_YT_GOAL_MAX_SLEEP', '240')))
    ap.add_argument('--base-cooldown-hours', type=float, default=float(os.environ.get('HAPA_YT_GOAL_BASE_COOLDOWN_HOURS', '12')))
    ap.add_argument('--max-cooldown-hours', type=float, default=float(os.environ.get('HAPA_YT_GOAL_MAX_COOLDOWN_HOURS', '96')))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)

    db = Path(args.db)
    state_path = Path(args.state)
    state = load_state(state_path)
    now = now_utc()
    blocked_until = parse_iso(state.get('blocked_until'))

    before = db_counts(db)
    if args.dry_run:
        print(json.dumps({'dry_run': True, 'state': state, 'counts': before}, indent=2))
        return 0

    if blocked_until and now < blocked_until:
        remaining = blocked_until - now
        if args.verbose:
            print(f"Transcript goal paused: cooldown until {state.get('blocked_until')} ({remaining} remaining). transcripts={before['transcripts']} pending={before['transcript_jobs_pending']}")
        return 0

    # Ensure queue exists. Only fully requeue when there are no pending jobs; this
    # avoids immediately retrying known failed jobs after each run.
    if before['transcript_jobs_pending'] <= 0:
        requeue(db)
        before = db_counts(db)

    # Metadata is lower risk and useful even while transcript harvesting is slow.
    metadata_result = None
    if args.metadata_limit > 0:
        try:
            _, meta_out, meta_err, meta_json = run_node(db, 'run-metadata', args.metadata_limit, timeout=900)
            metadata_result = summarize_results(meta_json)
            metadata_result['stderr'] = meta_err[:500]
        except Exception as exc:
            metadata_result = {'error': str(exc)}

    transcript_runs = []
    saw_block = False
    for i in range(max(0, args.max_attempts)):
        if i > 0:
            time.sleep(random.randint(args.min_sleep, args.max_sleep))
        try:
            code, out, err, parsed = run_node(db, 'run-transcripts', 1, timeout=900)
            text = '\n'.join([out, err, json.dumps(parsed or {})])
            summary = summarize_results(parsed)
            summary['exit_code'] = code
            transcript_runs.append(summary)
            if contains_any(text, BLOCK_PATTERNS):
                saw_block = True
                break
            if contains_any(text, TRANSIENT_PATTERNS):
                break
        except subprocess.TimeoutExpired:
            transcript_runs.append({'statuses': {'timeout': 1}, 'ids': [], 'errors': ['run-transcripts timed out']})
            break
        except Exception as exc:
            transcript_runs.append({'statuses': {'error': 1}, 'ids': [], 'errors': [str(exc)]})
            break

    after = db_counts(db)
    gained = after['transcripts'] - before['transcripts']
    state['total_runs'] = int(state.get('total_runs', 0)) + 1
    state['last_run_at'] = iso(now_utc())
    state['last_counts'] = after
    state['last_metadata_result'] = metadata_result
    state['last_transcript_runs'] = transcript_runs

    if saw_block:
        blocks = int(state.get('consecutive_blocks', 0)) + 1
        state['consecutive_blocks'] = blocks
        hours = min(args.max_cooldown_hours, args.base_cooldown_hours * (2 ** max(0, blocks - 1)))
        jitter = random.uniform(0.75, 1.25)
        until = now_utc() + dt.timedelta(hours=hours * jitter)
        state['blocked_until'] = iso(until)
    else:
        state['consecutive_blocks'] = 0
        state.pop('blocked_until', None)

    if gained <= 0:
        state['consecutive_empty_runs'] = int(state.get('consecutive_empty_runs', 0)) + 1
    else:
        state['consecutive_empty_runs'] = 0
        state['total_successes_seen'] = int(state.get('total_successes_seen', 0)) + gained

    save_state(state_path, state)

    message = {
        'transcript_goal': 'progress' if gained else ('blocked' if saw_block else 'no-new-transcripts'),
        'gained_transcripts': gained,
        'total_transcripts': after['transcripts'],
        'pending_transcript_jobs': after['transcript_jobs_pending'],
        'failed_transcript_jobs': after['transcript_jobs_failed'],
        'metadata': metadata_result,
        'transcript_runs': transcript_runs,
        'blocked_until': state.get('blocked_until'),
        'db': str(db),
        'state': str(state_path),
    }
    # Cron/no_agent: print only meaningful progress or new block. Verbose prints every run.
    if args.verbose or gained > 0 or saw_block:
        print(json.dumps(message, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
