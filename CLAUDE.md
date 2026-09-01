# diagrams

A viewer for d2/mermaid diagrams (`diagram-viewer`, Vite + React frontend, `server.js` backend) that documents:

- this repo itself (`tech/self/`)
- sibling personal apps: `hi` (`tech/hi/`), `my-chess` (`tech/my-chess/`), the jbm.eco home domain (`tech/jbm-eco/`)
- local dev environment issues that span apps (`tech/dev/`)
- interview prep: system design (`tech/sd-notes/`), coding (`tech/hackerrank/`)
- d2 language reference (`tech/examples/`)

## Two indexes — don't confuse them

**`pointers.yaml`** (repo root) — hand-maintained. A tree mapping real source files (in this repo and in sibling repos like `../hi`, `../my-chess`) to the `.d2`/`.mmd` files that describe them. `usePointersYaml.ts` fetches it directly and polls every 2s; it drives the navigator tree UI. **A new diagram under `tech/` is invisible in the navigator until it's referenced somewhere in this tree** — creating the `.d2` file is not enough.

  - Diagrams tied to one source file go under that file's path in the tree — the nesting doesn't have to mirror the diagram's own path under `tech/`. E.g. `hi/frontend/src/main.tsx` points to `./tech/hi/seq_frontend.d2`; the source path has a `src/` segment the diagram path doesn't, and that's fine, the two trees aren't meant to match.
  - `spotlight:` is just a manually-curated top-level bucket for whatever's being organized right now — it has no special code behind it (it's rendered like any other branch) and no fixed meaning. Rename or restructure it whenever it stops fitting. New diagrams or diagrams currently being modified can go here.
  - A diagram describing a change that spans multiple files/repos can be pointed to from every location it touches (e.g. `tech/jbm-eco/analytics.d2` is pointed to from all four `index.html` files it changed). When that's better handled as a reusable pattern in `tech/sd-notes/` instead is still an open question — not a settled rule yet.

**`tech/tags.json`** — generated, not hand-edited. Run `node scripts/build-tags-manifest.mjs` after adding or editing diagrams; it scans every `.d2` file for `_quality: {class: compiles|styled|coherent}` markers and rewrites this file. It's gitignored (rebuilt at deploy time) and powers the quality/tag filter, not the navigator tree. Getting a diagram to show up in the tag filter and getting it to show up in the navigator are two separate, unrelated steps. In the UI the tags render as a multi-select chip bar under the navigator search box (selection is OR, persisted in the comma-separated `tag` URL param) plus coloured dots beside each diagram entry.

## Diagram conventions

- Every layer gets a `_quality: {class: compiles}` when it's created — that's the default Claude sets, regardless of whether the diagram actually compiles (if it doesn't, the tag is moot, since a diagram that fails to render isn't visible anyway). Upgrade the tag yourself as you review: `styled` once the visual layout reads well, `coherent` once you've confirmed it accurately represents the technical concept you're trying to convey. This is what `tags.json` indexes.
- Shared styling lives in two root-level files, imported per-diagram with a path relative to the repo root: `classes: @"../../classes"` (all visual classes — `obj_*`/`edge_*`, `_link` glossary nodes, `to_add`/`to_remove`/`unchanged`/`future` for a `fix` layer, sequence and gate classes) and `classes: @"../../tags"` (the `_quality` vocabulary). Class *names* are the contract with `src/diagramSemanticThemes.css`, which keys light/dark colors off them — renaming a class silently breaks its theming. Never put `direction:` in these files: inside a `classes: @` import it's parsed as a class named `direction` and has no effect, so set `direction` in the layer that needs it.
- Debugging write-ups (see `tech/dev/make.d2`, `tech/dev/zombie-processes.d2`, `tech/dev/docker-recreate-bug.d2`) follow: a numbered diagnosis layer or two, then a `fix` layer using the `plan` classes, with `note: {shape: text; label: "..."}` blocks carrying the reasoning.
- Validate with the `d2` CLI before committing: `d2 tech/path/to/file.d2 /tmp/out.svg`.
