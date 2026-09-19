TableSearch
===========

A Power BI custom visual: a table with **a search box under every column header**.

- Type in a header to filter that column; filters combine across columns.
- Click a header to sort — ascending, descending, then off.
- Click a row (ctrl-click for several) to cross-filter the rest of the report.
- Rows are virtualised, so large tables scroll without rendering what is off screen.

Free and open source under the [MIT licence](LICENSE). Contributions welcome.

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
| `src/settings.ts` | the format pane: table, column search and colour settings |
| `style/style.less` | styles |
| `capabilities.json` | data roles, format-pane objects, and the data reduction window |

Field wells
-----------

*Row Identifier* takes the column that identifies a row; *Columns* takes everything else.

Privacy and terms
-----------------

TableSearch makes no network calls, collects nothing and stores nothing.
See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

Author
------

Francesco Mantovani — <https://www.jeeja.biz/>

Bugs and feature requests: <https://github.com/francesco1119/TableSearch/issues>
