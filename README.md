# Hapa Wiki Viewer

Hapa Wiki Viewer is a local Electron desktop app for browsing `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki`, the Markdown/Obsidian-style Hapa worldbuilding wiki. In the Hapa node ecosystem it acts as a read/write knowledge-interface node: it renders canon, node, card, media, and development notes into a searchable local UI while preserving the filesystem vault as the source of truth.

## Verified repository facts

Reviewed on 2026-05-21 from `/Users/calderwong/Desktop/hapa-wiki-viewer`:

- Runtime: Electron app with `src/main.js`, `src/preload.js`, `src/renderer.html`, and `src/renderer.js`.
- Package metadata: `package.json` names the package `hapa-wiki-viewer`, version `0.1.0`, CommonJS entrypoint `src/main.js`, Electron Builder app ID `world.hapa.wiki-viewer`, and product name `Hapa Wiki Viewer`.
- Default input vault: `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki`, overridable with `HAPA_WIKI_PATH` at app startup.
- Main indexer: `src/wikiIndexer.js` scans Markdown, YAML-ish frontmatter, Obsidian wikilinks, backlinks, cards/retrieval metadata, images, videos, and artifact matches.
- Wiki Ops layer: `scripts/wiki-ops.js` provides comments, page versions, categories, append/write operations, and an optional local HTTP API backed by SQLite under `Raw/WikiOps`.
- App index export: `scripts/build-index.js` writes `Raw/app-index/hapa-wiki-viewer-index.json` inside the wiki vault.
- Tests: Node's built-in test runner is configured as `npm test` for `test/*.test.js`.

## Inferred role in Hapa

Hapa Wiki Viewer is best treated as the local human/agent portal for the Hapa knowledge graph rather than the canonical datastore itself. The canonical data remains the Markdown vault and its raw sidecar indexes; this repo supplies a desktop lens, editing/comment operations, and import/index scripts that make the vault navigable by humans and Phamiliar/agent workflows.

## Run and verification commands

```bash
cd /Users/calderwong/Desktop/hapa-wiki-viewer
npm install
npm start
```

Cheap verification:

```bash
npm test
npm run index
```

Build a local macOS app directory:

```bash
npm run build
```

Additional script families exposed in `package.json`:

```bash
npm run images:plan
npm run images:generate
npm run wikiops:status
npm run wikiops:serve
npm run youtube:status
npm run artifacts:status
npm run massivehistory:status
npm run devproto:cards
```

## Inputs and outputs

Primary inputs:

- Markdown/YAML-frontmatter wiki pages in `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki`.
- Obsidian-style `[[wikilinks]]`, card frontmatter (`card_id`, `retrieval_id`, topics/tags/status), Markdown image references, and local video references.
- Optional raw libraries used by scripts, including WikiOps SQLite data, artifact libraries, YouTube/Takeout data, MassiveHistory imports, and Hapa Dev Proto card snapshots.

Primary outputs:

- Electron UI state and rendered desktop windows.
- App index JSON: `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki/Raw/app-index/hapa-wiki-viewer-index.json`.
- WikiOps data: `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki/Raw/WikiOps/wiki-ops.sqlite` plus WAL/SHM files and reports.
- Generated/imported wiki pages or media indexes when the import/export scripts are run.
- Optional packaged app directory: `dist/mac-arm64/Hapa Wiki Viewer.app`.

## Ports, auth, and local access

- `npm start` runs a local Electron desktop window, not a public web server.
- `npm run wikiops:serve` starts the WikiOps HTTP API from `scripts/wiki-ops.js`; test coverage binds it to `127.0.0.1` on a dynamic port. Check the script output when running it for the active port.
- No repository-local authentication layer was found for the Electron UI or WikiOps HTTP API. Treat it as local-trust tooling and avoid binding it to untrusted networks without adding auth.

## Hapa wiki links

- Global wiki root: `/Users/calderwong/Desktop/Hapa_Worldbuilding_Wiki`
- Node note: `[[Nodes/Existing/hapa-wiki-viewer]]`
- Development note: `[[Development/Hapa Wiki Viewer App]]`
- App index output: `[[Raw/app-index/hapa-wiki-viewer-index.json]]`

## Licensing and contribution attribution

Project-level license: MIT under Hapa.ai / Calder Wong. See `LICENSE`.

Third-party dependencies keep their own license notices in `node_modules`, package metadata, and generated Electron bundles. Do not remove those notices when packaging or redistributing.

Contributors may optionally opt into Bananas work-contribution tracking for attribution. Bananas attribution is an additional credit/accounting channel for work performed; it does not replace the MIT license terms or third-party license obligations.
