# Pakistan Resolve: instructions for AI agents

The product brief is `docs/PRODUCT_BRIEF.md`. It is the source of truth for purpose, positioning, information architecture and tone. `README.md` explains the stack and content workflow.

## Non-negotiables

- **Never invent facts, statistics, quotes, dates, sources or URLs.** If something is not supplied or verifiable, leave a `::: todo` box or an empty state instead.
- New content starts as `status: draft`. Do not set `reviewed` or `published` yourself: that requires a human to check claims against cited sources.
- Figures need value, unit, period and source. If you cannot provide all four, omit the figure.
- Sources not actually read stay `status: to-collect`.
- Systems first, news second. Do not turn the site into a news feed or add accounts, ads, comments or chatbots.
- Do not create empty category or system pages to look bigger.

## Conventions

- Zero dependencies. Prefer simple code in `scripts/build.mjs`; keep content in `content/`.
- Run `npm run build` before finishing any change. It validates content and checks internal links.
- Keep one question per explainer; link each to its system, and add glossary terms with `[[slug]]`.
- Plain, calm English; short paragraphs; label facts, official positions, analysis and proposals with `:::` boxes.
