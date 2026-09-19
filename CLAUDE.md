# How to answer in this project

**Be short. Give one order at a time.**

- No long explanations, no lists of 20 tasks, no "here are the trade-offs".
- Give the single next action. Wait for the result. Then give the next one.
- State findings in one or two sentences. Details only if asked.
- Never dump a multi-phase plan. The user does not want a roadmap, they want the next step.
- If a number or config is wrong, say what's wrong and what to change. Nothing else.

# TableSearch

A **commercial Power BI custom visual**: a table with **a search box under every column header**.
Click a header to sort, type to filter that column, click rows to cross-filter the report.

It is to be **sold**, and the repository is to be **private**. This is a product, not a fork
maintained for the community.

## Identity — do not change these

| | |
| --- | --- |
| Product name | **TableSearch** |
| Visual GUID | `TableSearch3D804BA6046746D3AED3E1E1C4BD3370` |
| Visual class | `TableSearchVisual` (`src/visual.ts`) |
| Settings class | `TableSearchSettings` (`src/settings.ts`) |
| Artifact | `dist/TableSearch3D804BA6046746D3AED3E1E1C4BD3370.1.0.0.0.pbiviz` |

⚠️ **The GUID is permanent.** `pbiviz` derives the output filename from `guid` + `version`, and
Power BI binds reports to the GUID. Changing it after release breaks every report already using the
visual. It was generated fresh for this project — the clone's original
(`lineuppowerbiE314DAA0C5D64CB288D237BF5C4CA3CD`, Samuel Gratzl's) has been replaced.

**The name went through two rounds.** "TableSorter" was rejected: it is Microsoft's name for the
retired visual this replaces (MIT licenses the code, not the trademark), and **jQuery tablesorter**
is a well-known library under that exact name — an AppSource rejection risk on confusing similarity
and a dead end for trademarking. "TableSearch" clears both. It is still descriptive, so weak to
trademark, but that was accepted.

## Commercial constraints, established

- **AppSource has no payment mechanism for visuals.** You list there and enforce licensing
  yourself. That is how paid Power BI visuals actually work.
- **A certified visual may not make network calls.** A phone-home licence check and certification
  are therefore mutually exclusive. Pick one.
- **okviz.com is not a marketplace.** It is a trademark of SQLBI Corp selling its own visuals
  (Smart Filter Pro, Card with States, Synoptic Panel). No submit-your-visual programme; listing
  there would be a partnership conversation, not an upload.
- Submission runs through Partner Center (<https://partner.microsoft.com/dashboard>) and needs a
  verified company identity — **start that early, it takes days**. Guide:
  <https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store>.

## Provenance and licence

The visual is **original code**. It began as the archived **`lineupjs/lineup_powerbi`** wrapper
(MIT, Copyright © Samuel Gratzl) around **LineUp.js**, and that engine was dropped once the
product's actual shape was clear (see *Why LineUp was dropped*). No LineUp code remains; the
dataView handling in `src/visual.ts` still owes its shape to that wrapper, and the MIT notice is
retained at the top of the file.

Two dead attempts at a LineUp visual for Power BI exist. Both are archived and read-only, so
**neither could accept a pull request** — hence a private product rather than an upstream
contribution.

| Repo | State | Base | Verdict |
| --- | --- | --- | --- |
| `microsoft/PowerBI-visuals-TableSorter` | archived **11 Jun 2026**, MIT | LineUp **v1** (`lineup-v1@0.2.0`, Dec 2016) | rejected as a base |
| `lineupjs/lineup_powerbi` | archived **22 Jul 2022**, MIT | **LineUp.js**, current | starting point, since replaced |

Microsoft's TableSorter was never a product: the author was "Microsoft (experimental)" at
`msrvizsupport@microsoft.com` (Microsoft Research, not the Power BI team), every internal dependency
was `@essex/*`, and the README and visual description both said *"This visual is experimental and
not actively being developed, only major issues will be addressed."* It died in a dormant-repo
sweep — issue #69 "[Action Needed] This repo is inactive" (1 Apr 2025) preceded the archive. Last
real commit **6 Sep 2018**; the only later change was a bot adding `SECURITY.md` in Sep 2022.

Its open issues corroborated a source review: **#51** "only shows 1000 rows" (refiled after **#39**
was closed without a fix), **#50** "we are able to add duplicate columns", **#48** header colour,
**#40** rank colors broken. Its build was unrecoverable anyway — webpack 1 inline loader syntax
(`require("!css!sass!…")`), lodash 3 deep paths, `powerbi-visuals-tools@1.11.3` (needs Node 6), and
`node-sass@4`, which cannot compile on modern Node (wants Python 2 and node-gyp 3; confirmed
failing on Node 24).

A clone of the Microsoft repo, with partial source fixes applied before it was abandoned, is still
at `C:\GitHub\PowerBI-visuals-TableSorter`. Nothing there is needed.

## Why LineUp was dropped

LineUp.js was never out of date — 4.18, actively maintained. It was the wrong tool. LineUp is an
opinionated ranking workbench, and nearly every requirement turned out to be the suppression of
one of its features: the sort shortcut arrows, the type icon, Clone / Rename / Delete, the Rank,
Selections and Aggregate Groups support columns, the "filter rows containing missing values"
checkbox, the contains/exact/regex accordion. Stacked and weighted columns — the one thing that
would have justified the engine — are **not** a selling point for this product.

Two of its behaviours were outright blockers:

- **The filter widget ate your typing.** `RenderColumn.updateHeader` answers a filter change by
  calling `summary.remove()` and appending a freshly built summary, destroying the input the user
  is typing into. Typing "Navigant" filtered on "na".
- **It was slow.** That widget calls `summaryStringStats` — a full column scan to build an
  autocomplete datalist — and since a filter change rebuilds *every* header, that ran for every
  column on every keystroke, holding LineUp's busy flag and the wait cursor.

Both were worked around before the rewrite. The rewrite removed the need for the workarounds.

# State: rewritten, builds clean, rendered once

`pbiviz package` succeeds. The LineUp-based version was verified rendering in Desktop on
19 Sep 2026 (463 rows, per-column filter box, cross-filtering). **The rewrite that replaced it has
not yet been loaded into Desktop.** Bundle: **34 KB of JS**, down from 769 KB.

**CSS trap:** in powerbi-visuals-tools 7 the `style` field in `pbiviz.json` is *not* a webpack
entry point — it is ignored, and the package ships with an empty `css` content field, so the
visual renders as unstyled DOM. The LESS must be imported from the source:
`import '../style/style.less';` in `src/visual.ts`. That is how Microsoft's own template does it.

## The code

Three source files, no framework.

- **`src/table.ts`** — the whole widget. Header of label + filter box per column, click-to-sort
  (asc → desc → none), case-insensitive *contains* filter per column, virtualised body, click and
  ctrl-click row selection. Structural rule: **filtering and sorting repaint only the body, never
  the header**, which is what made LineUp's version unusable.
- **`src/visual.ts`** — Power BI only. Selection IDs via
  `createSelectionIdBuilder().withTable(table, i)`, two-way cross-filtering with an
  `applyingSelection` guard, `fetchMoreData` paging against `dataView.metadata.segment`,
  field-well sort, and a resize fast-path that skips re-extraction.
- **`src/settings.ts`** — plain defaults, meaningful once the Format Pane migration lands.

## Toolchain

API 1.10 / tools 2.1 → **API 5.11 / tools 7.2.1**. Installed with **npm** (yarn 1 cannot extract
the old tarballs and is not used here).

Runtime dependency: **`@tanstack/virtual-core`** only. `@tanstack/table-core` was installed and
then removed — npm resolves it to v9, whose API is still in flux, and sorting plus substring
filtering over an array is thirty lines worth owning outright. Virtualisation is the part with
real edge cases, so that one stays.

- `pbiviz.json` — `apiVersion` 5.11.0. **`externalJS` removed** (gone in tools 3+), `dependencies`
  removed. `supportUrl` is **a placeholder** (`https://example.com/tablesearch-support`) purely
  because pbiviz refuses to package without one — replace it.
- `tsconfig.json` — `module: esnext`, `moduleResolution: node`, no `out`, no `.api/*.d.ts`.
  **`strictNullChecks` must stay `false`**: the tool-generated `.tmp/precompile/visualPlugin.ts`
  passes `VisualConstructorOptions | undefined` into the constructor and will not compile otherwise.
  Microsoft's own templates do the same.
- `capabilities.json` — added `privileges: []` and `supportsMultiVisualSelection`, plus a `window`
  data reduction of 30000 rows (there was none, so the host applied its own cap).
- Deleted `dependencies.json` and the vendored `.api/` folder.

# Outstanding

- **No git remote.** `origin` pointed at the archived upstream and has been removed; nothing is
  committed. Create the private repo and repoint. Git history from the original clone is retained.
- **Replace the placeholder `supportUrl`**, and set `gitHubUrl` (or leave it empty).
- **Format Pane migration is required**, not optional — `pbiviz package` reports it as "going to be
  required soon". Needs `getFormattingModel` via `powerbi-visuals-utils-formattingmodel` (already
  installed) plus real `objects` in `capabilities.json`, which makes `src/settings.ts` meaningful
  again.
- **`pbiviz start` cannot generate a dev certificate on this machine**: `New-SelfSignedCertificate:
  Parameter cannot be processed because the parameter name 'Subject' is ambiguous` — a Windows
  PowerShell 5.1 clash. Packaging is unaffected; only watch mode is blocked.
- **8 optional features** flagged by the packager: Allow Interactions, Context Menu, High Contrast,
  Keyboard Navigation, Landing Page, Localizations, Rendering Events, Tooltips. Several are
  effectively expected of a paid visual.
- `assets/icon.png` is still the inherited LineUp icon. Needs its own.
- **Not yet built:** column resizing, column reordering, tooltips, keyboard navigation, and any
  number/date formatting beyond `toLocaleString` / `toLocaleDateString`.

# Where this came from

The user's report is at
`C:\Users\FrancescoMantovani\OneDrive - beqom corporate\Documents\beqom documentation\Power BI\FinOps Old\Services`
(see its own `CLAUDE.md`). The driving requirement was an *Accelarate* page needing a searchable,
filterable database list that cross-filters the page — which native Power BI slicers cannot do,
because a slicer renders the full domain of its column and is **not** narrowed by another visual's
selection, even with `Edit interactions → Filter` set. A plain table visual is narrowed, which is
the interim fix there.

**Deneb** (Vega/Vega-Lite in Power BI; certified, maintained) was tried and works for a sortable,
cross-filtering table, but **cannot put a filter widget under each column header**: Vega's bound
inputs are an HTML form that vega-embed appends *after* the chart, and placement is not a spec
property. On a tall table they land thousands of pixels below the rows. A working three-search-box
Deneb spec is saved at `…\Services\deneb-spec.json`.

That limitation is the reason TableSearch is worth building.
