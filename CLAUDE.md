# How to answer in this project

**Be short. Give one order at a time.**

- No long explanations, no lists of 20 tasks, no "here are the trade-offs".
- Give the single next action. Wait for the result. Then give the next one.
- State findings in one or two sentences. Details only if asked.
- Never dump a multi-phase plan. The user does not want a roadmap, they want the next step.
- If a number or config is wrong, say what's wrong and what to change. Nothing else.

# TableSearch

A **free, open-source Power BI custom visual**: a table with **a search box under every column
header**. Click a header to sort, type to filter that column, click rows to cross-filter the
report.

MIT licensed, public at <https://github.com/francesco1119/TableSearch>, and to be listed free on
AppSource so it can be installed from Power BI's *Get more visuals*.

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

**Do not rename it "TableSorter".** That name was considered and rejected: **jQuery tablesorter**
is a well-known library under exactly it — an AppSource rejection risk on confusing similarity,
and a dead end for trademarking. "TableSearch" clears that. It is still descriptive, so weak to
trademark, but that was accepted.

## Publishing to AppSource

- **Listing is free; certification is separate and optional.** You only need certification for
  the visual to render in Power BI Service exports and email subscriptions. It is the stricter
  track: source review, and **no network calls at all**.
- Submission runs through Partner Center (<https://partner.microsoft.com/dashboard>) and needs a
  verified identity — **start that early, it takes days**. Guide:
  <https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store>.
- The listing still needs one **1366×768 screenshot**. `PRIVACY.md` and `TERMS.md` cover the
  privacy-policy and terms-of-use URLs; `supportUrl` and the 300×300 icon are done.
- AppSource has no payment mechanism for visuals, which is moot here — nothing is being sold.

## Provenance and licence

The visual is **original code**. It started from the archived **`lineupjs/lineup_powerbi`**
wrapper (MIT, Copyright © Samuel Gratzl) around **LineUp.js**, and that engine was dropped once
the product's actual shape was clear (see *Why LineUp was dropped*). No LineUp code remains; the
dataView handling in `src/visual.ts` still owes its shape to that wrapper, so the attribution is
kept there and in `LICENSE`.

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

# State: working, published, unlisted

Verified working in Power BI Desktop on 19 Sep 2026: renders, filters per column, sorts on header
click, cross-filters the report on row click, and the format pane applies. Published to GitHub.
Not yet listed on AppSource. Bundle: **34 KB of JS**, down from 769 KB under LineUp.

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
- **`src/settings.ts`** — the format pane, via `powerbi-visuals-utils-formattingmodel`. Three
  cards: Table (row height, text size, alternate shading), Column search (show/hide), Colors
  (header, text, grid, selected row). Every `name` here must match an entry under `objects` in
  `capabilities.json` exactly, or the pane drops the slice without complaint. Colours and text
  size reach the table as CSS custom properties, so a change restyles it without touching DOM.

## Toolchain

Build with **`npm run package`**, not bare `pbiviz package` — the script adds `--no-stats`,
which suppresses the `webpack.statistics.prod.html` bundle report otherwise written into the
repo root on every build.

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

# Next time — start here

Everything that could be done at the keyboard is done. The visual builds, renders, filters,
sorts and cross-filters, and it is published. What is left needs Power BI Desktop or a browser.

**1. Start the Partner Center identity verification.** <https://partner.microsoft.com/dashboard>.
This is the only multi-day item; nothing else blocks on anything but it. Do it first, then come
back to the rest.

**2. Take a 1366×768 screenshot** of the visual in a report, with a couple of column filters
typed in so the feature is visible. AppSource requires at least one.

**3. Submit the listing.** Everything else it asks for is ready:

| Field | Value |
| --- | --- |
| Package | `dist/TableSearch3D804BA6046746D3AED3E1E1C4BD3370.1.0.0.0.pbiviz` (rebuild with `npm run package`) |
| Support URL | <https://github.com/francesco1119/TableSearch/issues> |
| Privacy policy | <https://github.com/francesco1119/TableSearch/blob/main/PRIVACY.md> |
| Terms of use | <https://github.com/francesco1119/TableSearch/blob/main/TERMS.md> |
| Icon | `assets/icon.png`, 300×300 |

Optional after that, in rough order of value:

- **Tooltips** and **Context Menu** — the two optional features a table visual is most obviously
  missing, and both are cheap.
- **Column resizing and reordering** — the most likely first feature request.
- **High Contrast** and **Keyboard Navigation** — accessibility, and prerequisites if you ever
  want certification.
- **A sample `.pbix`** — optional for listing, expected for certification.

# Outstanding

Known state and limitations, not a to-do list.

- **Published** at <https://github.com/francesco1119/TableSearch>, branch `main`, MIT, public.
  History starts clean; the inherited clone history survives only on the local `tablesearch` and
  `master` branches, which were never pushed and can be deleted.

- **`pbiviz start` cannot generate a dev certificate on this machine**: `New-SelfSignedCertificate:
  Parameter cannot be processed because the parameter name 'Subject' is ambiguous` — a Windows
  PowerShell 5.1 clash. Packaging is unaffected; only watch mode is blocked.
- **9 optional features** flagged by the packager: Allow Interactions, Color Palette, Context
  Menu, High Contrast, Keyboard Navigation, Landing Page, Localizations, Rendering Events,
  Tooltips. None blocks the listing.

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
