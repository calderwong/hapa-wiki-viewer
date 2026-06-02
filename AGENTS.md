# Hapa Wiki Viewer Agent Guide

## Node Role

`hapa-wiki-viewer` is the local Electron reader/editor surface for `Hapa_Worldbuilding_Wiki`. It renders, indexes, searches, comments on, and imports into the canonical Markdown vault while leaving that vault as the source of truth.

## Source Of Truth

- `README.md` defines verified app behavior, inputs, outputs, scripts, and local access boundaries.
- `src/` owns Electron main/preload/renderer code and wiki indexing behavior.
- `scripts/` owns index, WikiOps, YouTube, artifact, MassiveHistory, and Dev Proto import helpers.
- `test/` covers indexer and WikiOps behavior.
- `SECURITY.md` defines publication secret checks.
- The canonical content root is provided by `HAPA_WIKI_ROOT` or `HAPA_WIKI_PATH`; local operator defaults may point at the desktop wiki vault.

## Safe Edit Boundaries

- Do not treat viewer-generated indexes or WikiOps SQLite data as the canonical wiki source.
- Do not commit private raw imports, local Takeout data, WikiOps DB sidecars, packaged app bundles, generated media, `.env`, or credential files.
- Keep preload filesystem access narrow and explicit.
- Preserve wikilinks, frontmatter, backlinks, source paths, and retrieval IDs when changing indexing behavior.
- The optional WikiOps HTTP API is local-trust tooling; do not bind it to untrusted networks without auth.

## Hapa Connectivity

- Reads Markdown wiki pages, raw source folders, media references, card metadata, and import/export source libraries.
- Produces viewer state, app indexes, WikiOps comments/versions, generated/imported pages, and navigation/search surfaces.
- Related nodes: `Hapa_Worldbuilding_Wiki`, `hapa-lance-node`, `hapa_second_brain`, `hapa-lore-node`, `hapa-anvil-node`, and Overwatch operations.
- Source code and tiny fixtures can publish; raw/private imports and heavy generated indexes should become vault manifests.

## Verification

```bash
npm test
npm run index
```

Run import scripts only when their target source libraries and wiki-write side effects are intended.
