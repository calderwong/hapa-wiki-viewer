# Hapa Wiki Viewer

Hapa Wiki Viewer is a local Electron desktop app for browsing `HAPA_WIKI_PATH`, the Markdown/Obsidian-style Hapa worldbuilding wiki. If `HAPA_WIKI_PATH` is not set, it defaults to `~/Desktop/Hapa_Worldbuilding_Wiki`. In the Hapa node ecosystem it acts as a read/write knowledge-interface node: it renders canon, node, card, media, and development notes into a searchable local UI while preserving the filesystem vault as the source of truth.

## Verified repository facts

Reviewed on 2026-05-21 from this repository root:

- Runtime: Electron app with `src/main.js`, `src/preload.js`, `src/renderer.html`, and `src/renderer.js`.
- Package metadata: `package.json` names the package `hapa-wiki-viewer`, version `0.1.0`, CommonJS entrypoint `src/main.js`, Electron Builder app ID `world.hapa.wiki-viewer`, and product name `Hapa Wiki Viewer`.
- Default input vault: `HAPA_WIKI_PATH`, falling back to `~/Desktop/Hapa_Worldbuilding_Wiki` at app startup.
- Main indexer: `src/wikiIndexer.js` scans Markdown, YAML-ish frontmatter, Obsidian wikilinks, backlinks, cards/retrieval metadata, images, videos, and artifact matches.
- Wiki Ops layer: `scripts/wiki-ops.js` provides comments, page versions, categories, append/write operations, and an optional local HTTP API backed by SQLite under `Raw/WikiOps`.
- App index export: `scripts/build-index.js` writes `Raw/app-index/hapa-wiki-viewer-index.json` inside the wiki vault.
- Tests: Node's built-in test runner is configured as `npm test` for `test/*.test.js`.

## Inferred role in Hapa

Hapa Wiki Viewer is best treated as the local human/agent portal for the Hapa knowledge graph rather than the canonical datastore itself. The canonical data remains the Markdown vault and its raw sidecar indexes; this repo supplies a desktop lens, editing/comment operations, and import/index scripts that make the vault navigable by humans and Phamiliar/agent workflows.

## Run and verification commands

```bash
cd <hapa-wiki-viewer repo>
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

- Markdown/YAML-frontmatter wiki pages in `HAPA_WIKI_PATH`.
- Obsidian-style `[[wikilinks]]`, card frontmatter (`card_id`, `retrieval_id`, topics/tags/status), Markdown image references, and local video references.
- Optional raw libraries used by scripts, including WikiOps SQLite data, artifact libraries, YouTube/Takeout data, MassiveHistory imports, and Hapa Dev Proto card snapshots.

Primary outputs:

- Electron UI state and rendered desktop windows.
- App index JSON: `HAPA_WIKI_PATH/Raw/app-index/hapa-wiki-viewer-index.json`.
- WikiOps data: `HAPA_WIKI_PATH/Raw/WikiOps/wiki-ops.sqlite` plus WAL/SHM files and reports.
- Generated/imported wiki pages or media indexes when the import/export scripts are run.
- Optional packaged app directory: `dist/mac-arm64/Hapa Wiki Viewer.app`.

## Ports, auth, and local access

- `npm start` runs a local Electron desktop window, not a public web server.
- `npm run wikiops:serve` starts the WikiOps HTTP API from `scripts/wiki-ops.js`; test coverage binds it to `127.0.0.1` on a dynamic port. Check the script output when running it for the active port.
- No repository-local authentication layer was found for the Electron UI or WikiOps HTTP API. Treat it as local-trust tooling and avoid binding it to untrusted networks without adding auth.

## Hapa wiki links

- Global wiki root: `HAPA_WIKI_PATH`
- Node note: `[[Nodes/Existing/hapa-wiki-viewer]]`
- Development note: `[[Development/Hapa Wiki Viewer App]]`
- App index output: `[[Raw/app-index/hapa-wiki-viewer-index.json]]`

## Licensing and contribution attribution

Project-level license: MIT under Hapa.ai / Calder Wong. See `LICENSE`.

Third-party dependencies keep their own license notices in `node_modules`, package metadata, and generated Electron bundles. Do not remove those notices when packaging or redistributing.

Contributors may optionally opt into Bananas work-contribution tracking for attribution. Bananas attribution is an additional credit/accounting channel for work performed; it does not replace the MIT license terms or third-party license obligations.

<!-- HAPA-README-SCREENSHOT-2026-05-22 -->



## Hapa ecosystem context

<p>
  <img src="docs/assets/hapa-ecosystem-context/overview.jpg" alt="Hapa ecosystem context visual showing modular nodes, human and AI-agent interfaces, Hapa Cards, avatar-agents, Second Brain, and wiki enrichment loop" width="100%">
</p>

### Shared ecosystem pattern

Hapa is built as a constellation of modular nodes. Each node owns a focused capability, but participates in a shared protocol for provenance, handoff, cards, memory, and operations.

Every node is designed for both human operators and AI agents. The target contract is three surfaces: a UI for direct human review/control, an API for node-to-node and agent calls, and a CLI for scripted runs, audits, and handoffs. Individual repos may be at different maturity levels, but the public contract is that humans and agents can inspect, operate, and verify the node.

Hapa nodes power AI agents and avatar-agents that build new nodes and enhance existing ones. As work moves through the ecosystem, it is mined for utility, wisdom, and repeatable logic, then distilled into Hapa Cards: portable packets of skills, context, memories, and operational patterns.

Humans and AIs use Hapa Cards to discuss, ideate, prototype, and deploy increasingly complex workflows through a playable, card-collecting mechanic. Collaboration history, skills, work artifacts, and canonical decisions are stored in [hapa-second-brain](https://github.com/calderwong/hapa-second-brain), enriched into [Hapa Worldbuilding Wiki](https://github.com/calderwong/hapa-worldbuilding-wiki) entries, and converted back into cards. Avatar-agents can also be combined or specialized into purpose-built identities with their own storage, lore, canon, card decks, skills, and protocols.

### Purpose

Desktop/browser viewer for the Hapa Worldbuilding Wiki, with navigation over Nodes, Names, Cards, Music, Timeline, and document views.

### Current status

- Status: **active wiki navigation app**.
- Local source root: this repository root.
- This README is intended to be useful to both human operators and future agents: it should explain what the node is for, what it consumes, what it emits, how it connects to other Hapa nodes, and what should stay out of git.

### Inputs

- Markdown wiki vault files, generated indexes, search/filter terms, operator navigation actions

### Outputs

- Rendered wiki pages, navigation dashboards, search results, and local viewer state

### Interfaces

- Electron app/renderer
- Markdown vault reader
- Local viewer UI

### Related Hapa nodes

- [Hapa AG / Dev Proto](https://github.com/calderwong/hapa-dev-proto-private) — Primary local-first app; many nodes feed it cards, assets, chat, debug, or projection data.
- [Hapa Worldbuilding Wiki](https://github.com/calderwong/hapa-worldbuilding-wiki) — Canonical Markdown graph for lore, nodes, names, cards, systems, and provenance.
- [Overwatch](https://github.com/calderwong/overwatch) — Operations map: inventory, source index, task inbox, protocols, and runbooks.
- [Hapa Telemetry Node](https://github.com/calderwong/hapa-telemetry-node) — Discovery/monitoring hub for node health, capabilities, launchers, and relationships.
- [Hapa Keys Node](https://github.com/calderwong/hapa-keys-node) — Local key vault used by authenticated nodes and tools.
- [Hapa Lore Node](https://github.com/calderwong/hapa-lore-node) — Chronicle/canon service for daily progress, lore, and searchable wisdom.
- [Hapa Anvil Node](https://github.com/calderwong/hapa-anvil-node) — Card standardization/evaluation/forge node for turning raw card ideas into usable artifacts.
- [Hapa Janus World Node](https://github.com/calderwong/hapa-janus-world-node) — World-state truth kernel and event tape for Janus/desktop simulation work.
- [Hapa MLX Station](https://github.com/calderwong/hapa-mlx-station) — Apple Silicon media-generation station that produces visual/audio assets for cards, wiki, and production runs.
- [Hapa Lance Node](https://github.com/calderwong/hapa-lance-node) — Local indexing/projection layer for cards, wiki chunks, embeddings, and multimodal records.

### Operating contract

- Treat generated media, local databases, model weights, dependency folders, build outputs, app bundles, and secrets as runtime artifacts unless this README explicitly says otherwise.
- Prefer loopback/local operation first; expose network services only with explicit auth and operator intent.
- When this node produces artifacts for another node, record enough provenance for the receiving node or wiki page to recover the source path, command, prompt, or API request.
- Keep `README.md`, `LICENSE`, `NOTICE.md` where applicable, and repo-local screenshots current as the node evolves.
