Privacy Policy
==============

**TableSearch** — a Power BI custom visual.
Last updated: 19 September 2026.

Summary
-------

TableSearch collects nothing, stores nothing, and sends nothing anywhere. It has no network
access of any kind.

What the visual does with your data
-----------------------------------

TableSearch renders the data Power BI hands it, inside the report, in your browser or in Power BI
Desktop on your own machine. Sorting, filtering and row selection all happen in memory, in that
same session.

The visual:

- makes **no network requests** — no analytics, no telemetry, no error reporting, no fonts or
  scripts fetched from anywhere at runtime;
- sets **no cookies** and writes nothing to local storage;
- does **not** transmit, copy, or retain your data outside the Power BI report;
- contains **no advertising** and no third-party tracking.

Nothing you put in the visual's field wells ever reaches the author or any other party. When the
report closes, the visual's state is gone.

Third-party code
----------------

TableSearch bundles one open-source library,
[`@tanstack/virtual-core`](https://github.com/TanStack/virtual) (MIT), used to render only the
rows currently on screen. It runs locally and makes no network calls either.

Data handled by Microsoft
-------------------------

Your report data is governed by Microsoft's own terms for Power BI, not by this policy. If you
install TableSearch from AppSource, Microsoft may record that installation; see the
[Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

Changes
-------

Any change to this policy will be published in this file, in the repository at
<https://github.com/francesco1119/TableSearch>, with the date above updated.

Contact
-------

Francesco Mantovani — <https://www.jeeja.biz/>
Issues and questions: <https://github.com/francesco1119/TableSearch/issues>
