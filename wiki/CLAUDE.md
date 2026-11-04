# How to maintain the wiki

Andrej Karpathy's "LLM wiki" scheme: knowledge accumulates in linked markdown pages instead of being rebuilt from sources every time.

**Three layers:**
1. **Sources** — `sources/`: screenshots, excerpts, notes on other games. Never edited, only added to. Each source has a summary page next to it (`sources/<topic>.md`): what is visible and what we take from it.
2. **Pages** — `*.md` in the root of `wiki/`: decisions (`adr-*`), design (`design-*`), style (`style-*`), the brief. Written in English, linked to each other with relative links.
3. **Service files** — [index.md](index.md) (table of contents: every page is one row in its section) and [log.md](log.md) (the journal, append-only).

**Operations:**
- **New source:** put it in `sources/`, write a summary, update the affected pages, add a row to `index.md`, add an entry to `log.md` with type `source`.
- **Code change that alters what is described:** fix the page (section, version and date in the header), add an entry to `log.md` with type `code` and links to the pages. One entry — one commit.
- **Check (lint):** no pages without a row in `index.md`, no links to nowhere, outdated material marked with strikethrough or "replaced by …", not silently deleted.

Journal entry format: `## [YYYY-MM-DD] type | short title`, then 1–3 lines and "Pages: …".
