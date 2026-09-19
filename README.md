TableSearch
===========

A Power BI custom visual: a table with **a search box under every column header**.

- Type in a header to filter that column; filters combine across columns.
- Click a header to sort — ascending, descending, then off.
- Click a row (ctrl-click for several) to cross-filter the rest of the report.
- Rows are virtualised, so large tables scroll without rendering what is off screen.

Commercial software. This repository is private and the visual is not open source; the MIT
notice in `src/visual.ts` covers the wrapper it was derived from. See `CLAUDE.md` for provenance.

Build
-----

```
npm install
npm run package
```

The packaged visual lands in `dist/` and is imported into Power BI Desktop through
*Insert → More visuals → Import a visual from a file*.

`pbiviz start` (watch mode) additionally needs a dev certificate, which currently fails to
generate on Windows PowerShell 5.1; packaging is unaffected.

Layout
------

| Path | |
| --- | --- |
| `src/visual.ts` | Power BI plumbing: dataView, selection IDs, cross-filtering, paging |
| `src/table.ts` | the table widget — header, filtering, sorting, virtualised body |
| `src/settings.ts` | defaults, pending the Format Pane migration |
| `style/style.less` | styles |
| `capabilities.json` | data roles and the data reduction window |

Field wells
-----------

*Row Identifier* takes the column that identifies a row; *Columns* takes everything else.
