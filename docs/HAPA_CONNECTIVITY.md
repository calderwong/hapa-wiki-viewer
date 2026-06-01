<!-- HAPA-CONNECTIVITY-DOC:BEGIN -->
# Hapa Connectivity

Generated: 2026-06-01T01:03:18.084Z

This file is a publication-safe cross-link for humans and AIs. It describes how this repo fits into the Hapa system without embedding private local paths, secrets, heavy assets, DB payloads, or generated media.

## Identity

- Node id: `hapa-wiki-viewer`
- Repo name: `hapa-wiki-viewer`
- Hapa system group: `apps` (Apps)
- Target assembly path: `hapa-system/apps/hapa-wiki-viewer`
- Link mode: `local_workspace_pointer_until_remote_exists`

## Role

This repo is a user-facing Hapa app surface that should link back to the shared node, wiki, board, and vault contracts.

## Reads From

- Hapa ecosystem docs and node manifests.
- Wiki pages or operations docs when this node needs canonical human context.
- Second Brain relation exports or memory summaries when this node needs durable recall.

## Writes To

- Source-safe docs, schemas, manifests, or small fixtures that can pass publication preflight.
- User-facing build artifacts only when they are intentionally release assets; generated caches stay ignored.

## Related Hapa Nodes

| Node | Relationship |
| --- | --- |
| `hapa` | Front door and ecosystem map. |
| `Hapa_Worldbuilding_Wiki` | Canonical wiki and operations knowledge. |
| `hapa_second_brain` | Durable memory, SQLite relation exports, and recall surface. |
| `hapa-overwatch-kanban` | Append-only project board and event protocol. |
| `hapa-quest-keeper` | Consolidated Quest board overview and board coverage audit. |
| `hapa-chat-app` | Shares the Apps module group. |
| `hapa-dev-proto` | Shares the Apps module group. |
| `hapa-living-comic` | Shares the Apps module group. |
| `hapa-spaceship-desktop-hijack` | Shares the Apps module group. |
| `capsule` | Shares the Apps module group. |
| `hapa-space` | Shares the Apps module group. |

## Shared Control Surfaces

- `hapa`: front door, operator map, and ecosystem entry point.
- `Hapa_Worldbuilding_Wiki`: canonical human-readable lore, operations, and node documentation.
- `hapa_second_brain`: durable memory, relation exports, and local-first recall surface.
- `hapa-overwatch-kanban`: append-only board/event protocol for node work.
- `hapa-quest-keeper`: consolidated board overview and app coverage audit.
- `$HAPA_VAULT_ROOT`: private companion root for heavy assets, runtime DBs, generated media, and relation exports.

## Publication Boundary

- Publication strategy: `publish_after_cleanup`
- Publication wave: `wave_2_small_dirty_no_remote`
- Current assembly gate: `local_pointer_after_review`

Source code, docs, schemas, and tiny fixtures are Git candidates after preflight. Runtime DBs, WAL/SHM files, local tokens, generated media, model weights, logs, app bundles, and vault exports stay out of public Git and should be represented by pointer manifests or rebuild instructions.

## Open Gates

- Review 14 dirty working-tree entries before pinning.
- Choose GitHub owner, repo name, and private/public visibility before remote creation.

## Safe Next Commands

- `git status --short`
- `Commit only intentional docs/source changes after reviewing the dirty worktree.`
- `Choose GitHub owner, repo name, and private/public visibility before remote creation.`
- `Run gitleaks/history scan before public release.`
- `Do not move repos, create remotes, push, purge, copy heavy assets, or rewrite history without the matching approval gate.`

## Verification

Run the fastest local checks that exist for this repo before publication or assembly:

```bash
git status --short
npm test
```

<!-- HAPA-CONNECTIVITY-DOC:END -->
