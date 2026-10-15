# Pakistan Resolve

An independent knowledge hub that explains how Pakistan's systems work. This repository holds the MVP website described in [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md).

**Stack:** a zero-dependency static site generator (Node 20+). Content is Markdown with front matter; the build produces plain HTML, CSS and a small JavaScript file in `dist/`, served by Cloudflare Workers Static Assets. No framework, database or backend.

## Quick start

```bash
npm run dev      # build, preview at http://localhost:8787, rebuild on every change
npm run build    # validate content and write dist/
npm run deploy   # build, then: npx wrangler deploy
```

There is nothing to `npm install`. Only deploying needs `wrangler` (fetched by `npx`).

## Deploying to your existing Cloudflare site

The live prototype is at `https://pakistan-resolve.mehunhasnain.workers.dev/`. `wrangler.jsonc` assumes the worker is named `pakistan-resolve`, which is what that address implies. If your worker has a different name, change `name` in `wrangler.jsonc` before deploying, otherwise Cloudflare will create a second worker instead of updating the existing one.

Two routes:

1. **From your computer:** `npx wrangler login` once, then `npm run deploy`.
2. **From a Git repository connected to Cloudflare:** put this project in the repository, set the build command to `npm run build` and the deploy command to `npx wrangler deploy`.

Before the first deployment, check the existing repository for anything this replaces (the current prototype is a single "Coming Soon" page) and keep any analytics or domain settings you rely on.

## How the content fits together

Four content types, each a folder under `content/`, linked by slugs (file names without `.md`):

| Type | Folder | URL | Purpose |
|---|---|---|---|
| System | `content/systems/` | `/systems/<slug>/` | A map of one area of public life: stages, institutions, money, rules, data, debates |
| Explainer | `content/explainers/` | `/explainers/<slug>/` | A short answer to one question, linked into a system |
| Glossary term | `content/glossary/` | `/glossary/#<slug>` | A definition used across pages |
| Institution | `content/institutions/` | `/institutions/<slug>/` | A profile of a body in a system (supported; none written yet) |
| Page | `content/pages/` | `/<slug>/` | About, Editorial standards, Corrections |

Connections are explicit, not guessed. A page lists `related_systems`, `related_explainers`, `related_institutions` and `glossary` in its front matter, and the build checks that every reference exists. In text, `[[tariff]]` links to a glossary term.

The library, search index, sitemap and homepage cards are generated from the same files, so adding a file adds it everywhere.

## Adding or editing content

```bash
npm run new -- explainer why-load-shedding-happens "Why does load-shedding happen?"
```

This creates a draft with the right fields. Then edit it and run `npm run build`.

### Front matter fields

Values must stay on one line. Quote values that contain `#` or start with `[`.

| Field | Used by | Notes |
|---|---|---|
| `title`, `summary` | all | Summary appears on cards and in search |
| `status` | all but pages | `draft`, `reviewed` or `published` |
| `published`, `updated` | all | `YYYY-MM-DD`. Change `updated` whenever you change facts |
| `topic` | systems | Groups items in the library. Explainers and terms inherit from their first related system |
| `why` | systems | One sentence on why it matters |
| `flow` | systems | Ordered list of `label` and `note`, shown as the system-at-a-glance diagram |
| `institutions` | systems | List of `name`, `type`, `role`, `status` (`verified` or `unverified`) |
| `figures` | systems | List of `label`, `value`, `unit`, `period`, `source`, optional `source_url`, `note`. **All five required.** Omit if you have no verified figures |
| `planned_data` | systems | Plain list of data notes you intend to add; shown while `figures` is empty |
| `question`, `short_answer`, `takeaways` | explainers | The question, a two-sentence answer, and bullet takeaways |
| `sources` | all | List of `title`, `status` (`cited` or `to-collect`), and optional `url`, `publisher`, `type`, `date`, `note` |
| `draft_note` | all | Optional custom text for the draft banner |

Source `type` is one of `primary`, `research`, `journalism`, `commentary`.

### Markdown extras

````
[[circular-debt]]                       link to a glossary term

::: fact                                 labelled boxes: fact, official, analysis, proposal, todo, note
Text that is established and sourced.
:::
````

Use these boxes so readers can tell facts, official positions, analysis and proposals apart. `todo` marks a gap that must be filled before review.

### Moving a page from draft to reviewed

1. Replace every `todo` box with sourced text.
2. For each claim, move the supporting source to `status: cited` with `url` and `publisher`.
3. Have someone other than the author check claims against the sources.
4. Set `status: reviewed` and update `updated`.

The build **fails** if a page is Reviewed or Published without a cited source, if a figure lacks unit, period or source, if a related slug does not exist, or if an internal link or anchor is broken.

## Configuration

`site.config.json` holds the site name, tagline, public URL (used for canonical links and the sitemap), `contactEmail` and copyright year. When `contactEmail` is empty, the Corrections page honestly says no contact route exists yet. Set it and rebuild to turn the notice into an email link pre-filled with the page being reported.

## What is and is not verified

- **Every page is a draft.** The seed content is structure, research questions and general definitions. It contains **no statistics, tariffs, prices, dates of events or quotations**.
- Institution roles (NEPRA, OGRA, NTDC, DISCOs and so on) are labelled *Unverified*. They reflect general understanding and need to be checked against founding laws and official sites.
- Sources are all marked `to-collect` and shown under "Where to look (not yet cited)". The web addresses are organisation homepages I could not check from the build environment. Confirm each, then find the specific document.
- Your earlier petrol research notes were not provided, so none were imported.

## Assumptions and limitations

- I could not access your repository (no GitHub account was linked), so this is a fresh project, not edits to existing code. The live prototype was a single "Coming Soon" page, and its branding (name and tagline) is preserved.
- The logo is a text monogram, with "P" in ink and "R" in green, as a placeholder in the spirit of the earlier logo direction. Replace it with the real logo when available (header markup is in `scripts/build.mjs`, favicon in `public/assets/favicon.svg`).
- No social-sharing image yet; links share as text cards. Add an `og:image` once there is artwork.
- Light theme only. Colours were chosen for readable contrast but have not been audited with an accessibility tool.
- Search is client-side over a JSON index. It is fine for hundreds of pages; revisit if the library grows much larger.
- Not built, per the brief: accounts, comments, ads, a chatbot, dashboards, a news ticker. "Featured facts or data" on the homepage is omitted until figures can be sourced and dated.
- English only. Urdu or bilingual content would need a language field and separate routes.
- Not tested in real browsers or Cloudflare. Build, link checking, HTML structure, search and library filter logic were tested locally.

## Project layout

```
content/          Markdown content (the part you edit)
public/assets/    CSS, JavaScript, favicon (copied as-is into dist/)
scripts/          build.mjs (generator, templates, validation), serve.mjs, new.mjs, lib/
site.config.json  Site settings
wrangler.jsonc    Cloudflare deployment settings
dist/             Generated output (do not edit; safe to delete)
docs/             The product brief
```
