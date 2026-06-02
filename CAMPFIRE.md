# CAMPFIRE — Hapa Wiki Viewer

## Campfire identity

- Display name: Hapa Wiki Viewer
- Repository path: this repository root
- Hapa role: local desktop knowledge-interface node for the Hapa Worldbuilding Wiki.
- Canonical wiki input: `HAPA_WIKI_PATH` or `~/Desktop/Hapa_Worldbuilding_Wiki`
- Global wiki note: `[[Nodes/Existing/hapa-wiki-viewer]]`

## What this node does

Verified from repository files on 2026-05-21:

- Starts an Electron desktop app with `npm start`.
- Indexes Markdown pages, frontmatter, wikilinks, backlinks, card metadata, local images/videos, and artifact media matches through `src/wikiIndexer.js`.
- Renders the index through `src/renderer.html` and `src/renderer.js` using an IPC bridge in `src/preload.js`.
- Exposes local WikiOps functions for comments, categories, page appends/writes, page versions, and optional HTTP API from `scripts/wiki-ops.js`.
- Exports a graph/card/facet index to `Raw/app-index/hapa-wiki-viewer-index.json` with `npm run index`.

## What this node should not overclaim

- The Markdown vault remains the source of truth; this app is a local lens and operation surface.
- Runtime health is only proven after `npm start` or a smoke run.
- WikiOps HTTP serving should be treated as local-trust only unless authentication and network binding rules are added.

## Commands

```bash
cd <hapa-wiki-viewer repo>
npm install
npm test
npm run index
npm start
```

Useful operational commands:

```bash
npm run wikiops:status
npm run wikiops:serve
npm run artifacts:status
npm run youtube:status
npm run images:plan
```

## Data boundaries

Inputs:

- Hapa Markdown vault at `HAPA_WIKI_PATH`.
- Optional `HAPA_WIKI_PATH` override for a different Markdown vault.
- Raw sidecar libraries under the wiki `Raw/` tree when import/status scripts are used.

Outputs:

- In-memory Electron index during app runtime.
- JSON app index under `Raw/app-index/`.
- WikiOps SQLite database and reports under `Raw/WikiOps/`.
- Generated/updated wiki notes when append/import/export scripts are run.

## License and attribution posture

Project-level license is MIT under Hapa.ai / Calder Wong. Contributors may opt into Bananas work-contribution tracking as an attribution option. Bananas tracking is additive attribution/accounting and does not remove MIT rights or third-party notice obligations.
