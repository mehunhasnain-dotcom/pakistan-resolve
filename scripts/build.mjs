#!/usr/bin/env node
// Pakistan Resolve static site generator. No dependencies. Usage: node scripts/build.mjs
//
// content/**/*.md (front matter + Markdown)  ->  dist/**/index.html, search-index.json, sitemap.xml
// Validation runs first: missing required fields, unsourced figures, broken references and
// broken internal links fail the build, so unsourced or inconsistent content cannot ship quietly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter } from './lib/frontmatter.mjs';
import { renderMarkdown, inline, esc, plainText } from './lib/markdown.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const warnings = [];
const errors = [];
const warn = (m) => warnings.push(m);
const fail = (m) => errors.push(m);

/* ------------------------------------------------------------------ helpers */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));
const fmtDate = (d) => {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
};
const readMinutes = (text) => Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const STATUS = { draft: 'Draft', reviewed: 'Reviewed', published: 'Published' };
const SOURCE_TYPES = {
  primary: 'Primary source',
  research: 'Research institution / international body',
  journalism: 'Journalism',
  commentary: 'Commentary',
};
const KINDS = {
  system: { dir: 'systems', label: 'System' },
  explainer: { dir: 'explainers', label: 'Explainer' },
  institution: { dir: 'institutions', label: 'Institution' },
  glossary: { dir: 'glossary', label: 'Glossary term' },
  page: { dir: 'pages', label: 'Page' },
};

/* -------------------------------------------------------------- load content */

function loadDir(kind) {
  const dir = path.join(ROOT, 'content', KINDS[kind].dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .map((f) => {
      const file = `content/${KINDS[kind].dir}/${f}`;
      const slug = f.replace(/\.md$/, '');
      let parsed;
      try {
        parsed = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (e) {
        fail(`${file}: ${e.message}`);
        parsed = { data: {}, body: '' };
      }
      const item = { ...parsed.data, kind, slug, file, body: parsed.body };
      item.url =
        kind === 'glossary' ? `/glossary/#${slug}` : kind === 'page' ? `/${slug}/` : `/${KINDS[kind].dir}/${slug}/`;
      return item;
    });
}

const systems = loadDir('system');
const explainers = loadDir('explainer');
const institutions = loadDir('institution');
const glossary = loadDir('glossary').sort((a, b) => String(a.title).localeCompare(String(b.title)));
const pages = loadDir('page');
const all = [...systems, ...explainers, ...institutions, ...glossary, ...pages];
const lookup = {
  system: new Map(systems.map((x) => [x.slug, x])),
  explainer: new Map(explainers.map((x) => [x.slug, x])),
  institution: new Map(institutions.map((x) => [x.slug, x])),
  glossary: new Map(glossary.map((x) => [x.slug, x])),
  page: new Map(pages.map((x) => [x.slug, x])),
};

// Explainers and glossary terms inherit a topic from their first related system when none is set.
for (const it of [...explainers, ...glossary, ...institutions]) {
  if (!it.topic) {
    const sys = lookup.system.get(arr(it.related_systems)[0]);
    it.topic = sys?.topic || '';
  }
}

/* --------------------------------------------------------------- validation */

function validate() {
  const required = {
    system: ['title', 'summary', 'why', 'topic', 'status', 'published', 'updated'],
    explainer: ['title', 'summary', 'question', 'short_answer', 'status', 'published', 'updated'],
    institution: ['title', 'summary', 'status', 'updated'],
    glossary: ['title', 'summary', 'status', 'updated'],
    page: ['title', 'summary', 'updated'],
  };
  for (const it of all) {
    const where = it.file;
    for (const f of required[it.kind]) if (!it[f]) fail(`${where}: missing required field "${f}"`);
    if (it.kind !== 'page' && it.status && !STATUS[it.status]) fail(`${where}: status must be draft | reviewed | published`);
    for (const f of ['published', 'updated']) if (it[f] && !isoDate(it[f])) fail(`${where}: "${f}" must be YYYY-MM-DD`);

    for (const [field, kind] of [
      ['related_systems', 'system'],
      ['related_explainers', 'explainer'],
      ['related_institutions', 'institution'],
      ['glossary', 'glossary'],
    ]) {
      for (const slug of arr(it[field])) if (!lookup[kind].has(slug)) fail(`${where}: ${field} refers to unknown ${kind} "${slug}"`);
    }

    for (const s of arr(it.sources)) {
      if (!s.title) fail(`${where}: a source is missing "title"`);
      if (!['cited', 'to-collect'].includes(s.status)) fail(`${where}: source "${s.title}" needs status: cited | to-collect`);
      if (s.status === 'cited' && (!s.url || !s.publisher)) warn(`${where}: cited source "${s.title}" should have url and publisher`);
      if (s.type && !SOURCE_TYPES[s.type]) fail(`${where}: source "${s.title}" has unknown type "${s.type}"`);
    }
    const cited = arr(it.sources).filter((s) => s.status === 'cited');
    if ((it.status === 'reviewed' || it.status === 'published') && it.kind !== 'page' && cited.length === 0) {
      fail(`${where}: status "${it.status}" requires at least one cited source`);
    }

    for (const f of arr(it.figures)) {
      for (const k of ['label', 'value', 'unit', 'period', 'source']) {
        if (f[k] === undefined || f[k] === '') fail(`${where}: figure "${f.label || '?'}" is missing "${k}" (every figure needs value, unit, period and source)`);
      }
    }
  }
}

/* ---------------------------------------------------------------- templates */

const ctx = {
  term: (slug) => lookup.glossary.get(slug),
  warn: (m) => warn(`${ctx.current || ''}: ${m}`),
};
function md(item) {
  ctx.current = item.file;
  return renderMarkdown(item.body, ctx);
}

const badge = (status) => `<span class="badge badge-${status}">${STATUS[status] || 'Draft'}</span>`;

function layout({ title, description, urlPath, main, section = '', noindex = false, type = 'website' }) {
  const fullTitle = title === cfg.name ? `${cfg.name}: ${cfg.tagline}` : `${title} · ${cfg.name}`;
  const canonical = cfg.siteUrl + urlPath;
  const desc = description || cfg.description;
  const nav = [
    ['', '/', 'Home'],
    ['systems', '/systems/', 'Explore Systems'],
    ['library', '/library/', 'Knowledge Library'],
    ['explainers', '/explainers/', 'Explainers'],
    ['about', '/about/', 'About'],
  ]
    .map(([key, href, label]) => `<li><a href="${href}"${section === key ? ' aria-current="page"' : ''}>${label}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#0b5d34">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/style.css">
<script>document.documentElement.className+=' js'</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="${esc(cfg.name)} home">
      <span class="mark" aria-hidden="true"><span class="p">P</span><span class="r">R</span></span>
      <span class="brand-text"><span class="brand-name">${esc(cfg.name)}</span><span class="brand-tag">${esc(cfg.tagline)}</span></span>
    </a>
    <form class="search" role="search" action="/search/" method="get">
      <label class="sr-only" for="site-q">Search the library</label>
      <input id="site-q" type="search" name="q" placeholder="Search the library" autocomplete="off">
      <button type="submit">Search</button>
    </form>
  </div>
  <nav class="wrap primary-nav" aria-label="Main"><ul>${nav}</ul></nav>
</header>
<main id="main">
${main}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-brand">${esc(cfg.name)}</p>
      <p class="muted">${esc(cfg.tagline)}. An independent knowledge hub about how Pakistan's systems work.</p>
      <p class="muted small">Early build: all current pages are drafts under research.</p>
    </div>
    <nav aria-label="Footer">
      <ul class="footer-links">
        <li><a href="/about/">About</a></li>
        <li><a href="/standards/">Editorial standards</a></li>
        <li><a href="/corrections/">Corrections and contact</a></li>
        <li><a href="/glossary/">Glossary</a></li>
        <li><a href="/library/">Knowledge Library</a></li>
      </ul>
    </nav>
  </div>
  <div class="wrap"><p class="muted small">© ${cfg.copyrightYear} ${esc(cfg.name)}. Content is independent and non-partisan.</p></div>
</footer>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

const typeLabel = (it) => KINDS[it.kind].label;

function card(it) {
  const meta = [typeLabel(it), it.topic].filter(Boolean).join(' · ');
  return `<article class="card">
  <p class="card-meta">${esc(meta)}</p>
  <h3><a href="${it.url}">${esc(it.title)}</a></h3>
  <p>${esc(it.question ? it.question : it.summary)}</p>
  <p class="card-foot">${badge(it.status || 'draft')}<span class="muted small">Updated ${fmtDate(it.updated)}</span></p>
</article>`;
}

function draftBanner(it) {
  if ((it.status || 'draft') !== 'draft') return '';
  const note =
    it.draft_note ||
    'This page is a working structure and research plan. It has not been checked against sources, so do not cite it or rely on it yet.';
  return `<aside class="notice notice-draft" role="note"><strong>Draft, not verified.</strong> ${esc(note)} <a href="/standards/">How we label content</a>.</aside>`;
}

function metaLine(it, text) {
  const parts = [badge(it.status || 'draft')];
  if (it.published) parts.push(`<span>Published ${fmtDate(it.published)}</span>`);
  if (it.updated) parts.push(`<span>Updated ${fmtDate(it.updated)}</span>`);
  if (text) parts.push(`<span>${readMinutes(text)} min read</span>`);
  return `<p class="meta-line">${parts.join('')}</p>`;
}

function flowBlock(flow) {
  const steps = arr(flow);
  if (!steps.length) return '';
  return `<ol class="flow" aria-label="Stages of the system">${steps
    .map((s, i) => `<li><span class="flow-n" aria-hidden="true">${i + 1}</span><strong>${esc(s.label)}</strong>${s.note ? `<span>${esc(s.note)}</span>` : ''}</li>`)
    .join('')}</ol>`;
}

function institutionsBlock(it) {
  const list = arr(it.institutions);
  if (!list.length) return '';
  return `<section id="key-institutions" class="block"><h2>Key institutions</h2>
<p class="muted">Who is involved. Roles marked <em>Unverified</em> are working descriptions that still need to be checked against founding laws, mandates or official websites.</p>
<ul class="inst-list">${list
    .map(
      (x) => `<li><strong>${esc(x.name)}</strong>${x.type ? ` <span class="muted">(${esc(x.type)})</span>` : ''}<br>${esc(x.role || '')} <span class="tag">${x.status === 'verified' ? 'Verified' : 'Unverified'}</span></li>`
    )
    .join('')}</ul></section>`;
}

function figuresBlock(it) {
  const figs = arr(it.figures);
  const planned = arr(it.planned_data);
  let inner;
  if (figs.length) {
    inner = `<div class="table-wrap"><table><thead><tr><th scope="col">Indicator</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Period covered</th><th scope="col">Source</th><th scope="col">Definition and caveats</th></tr></thead><tbody>${figs
      .map(
        (f) =>
          `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td><td>${esc(f.unit)}</td><td>${esc(f.period)}</td><td>${f.source_url ? `<a class="external" rel="noopener" href="${esc(f.source_url)}">${esc(f.source)}</a>` : esc(f.source)}</td><td>${esc(f.note || '')}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
  } else {
    inner = `<div class="empty"><p><strong>No figures published yet.</strong> Numbers appear here only when each has a value, unit, period covered and source. Nothing is shown rather than an unchecked number.</p>${
      planned.length ? `<p>Planned data notes for this system:</p><ul>${planned.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
    }</div>`;
  }
  return `<section id="data-and-evidence" class="block"><h2>Data and evidence</h2>${inner}</section>`;
}

function sourcesBlock(it) {
  const src = arr(it.sources);
  const cited = src.filter((s) => s.status === 'cited');
  const todo = src.filter((s) => s.status !== 'cited');
  const fmt = (s) => {
    const bits = [s.publisher, SOURCE_TYPES[s.type], fmtDate(s.date)].filter(Boolean).map(esc).join(' · ');
    const t = s.url ? `<a class="external" rel="noopener" href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title);
    return `<li>${t}${bits ? `<br><span class="muted small">${bits}</span>` : ''}${s.note ? `<br><span class="small">${esc(s.note)}</span>` : ''}</li>`;
  };
  let html = `<section id="sources" class="block"><h2>Sources and further reading</h2>`;
  html += cited.length
    ? `<h3>Cited sources</h3><ol class="sources">${cited.map(fmt).join('')}</ol>`
    : `<div class="notice notice-draft"><strong>No sources cited yet.</strong> Treat everything on this page as unverified until sources are listed here.</div>`;
  if (todo.length) {
    html += `<h3>Where to look (not yet cited)</h3><p class="muted small">Starting points for research. Listing a site here does not mean any claim on this page has been checked against it.</p><ul class="sources">${todo.map(fmt).join('')}</ul>`;
  }
  html += `<p class="small"><a href="/corrections/?page=${encodeURIComponent(it.url)}">Report an error or suggest a source for this page</a></p></section>`;
  return html;
}

function relatedBlock(it) {
  const groups = [];
  const link = (x) => `<li><a href="${x.url}">${esc(x.title)}</a><br><span class="muted small">${esc(x.question || x.summary || '')}</span></li>`;
  const rs = arr(it.related_systems).map((s) => lookup.system.get(s)).filter(Boolean);
  const re = arr(it.related_explainers).map((s) => lookup.explainer.get(s)).filter(Boolean);
  const ri = arr(it.related_institutions).map((s) => lookup.institution.get(s)).filter(Boolean);
  const rg = arr(it.glossary).map((s) => lookup.glossary.get(s)).filter(Boolean);
  if (rs.length) groups.push(`<div><h3>Related systems</h3><ul class="rel">${rs.map(link).join('')}</ul></div>`);
  if (re.length) groups.push(`<div><h3>Related explainers</h3><ul class="rel">${re.map(link).join('')}</ul></div>`);
  if (ri.length) groups.push(`<div><h3>Related institutions</h3><ul class="rel">${ri.map(link).join('')}</ul></div>`);
  if (rg.length)
    groups.push(`<div><h3>Key terms</h3><ul class="chips">${rg.map((g) => `<li><a href="${g.url}" title="${esc(g.summary)}">${esc(g.title)}</a></li>`).join('')}</ul></div>`);
  if (!groups.length) return '';
  return `<section id="related" class="block"><h2>Related reading</h2><div class="rel-grid">${groups.join('')}</div></section>`;
}

function tocBlock(entries) {
  return `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ol>${entries
    .map((e) => `<li><a href="#${e.id}">${esc(e.text)}</a></li>`)
    .join('')}</ol></nav>`;
}

/* ------------------------------------------------------------------- pages */

const outputs = []; // {urlPath, html, lastmod, index}

function emit(urlPath, html) {
  outputs.push({ urlPath, html });
}

function homePage() {
  const featured = lookup.system.get('electricity') || systems[0];
  const latest = [...explainers].sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 3);
  const steps = [
    ['Understand the system', 'Start with a plain-language map of what the system does and why it matters.'],
    ['Identify the institutions', 'See who makes decisions, who regulates, and who delivers.'],
    ['Follow the process and the money', 'Trace how costs, taxes, subsidies and payments move.'],
    ['Inspect the evidence', 'Check figures against sources, with dates, units and definitions.'],
    ['Weigh explanations and trade-offs', 'Separate what is established from what is debated or proposed.'],
  ];
  const topics = [...new Set(systems.map((s) => s.topic))];
  const main = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">${esc(cfg.tagline)}</p>
    <h1>Understand how Pakistan works.</h1>
    <p class="lead">${esc(cfg.name)} breaks down Pakistan's systems, institutions, economy, energy and public issues into clear, sourced explanations, so headlines come with context.</p>
    <p class="actions"><a class="btn btn-primary" href="/systems/">Explore Systems</a><a class="btn" href="/library/">Browse the Knowledge Library</a></p>
    <p class="muted small hero-note">Early build: every page is currently a draft under research and nothing here is verified yet. <a href="/standards/">See how we label content</a>.</p>
  </div>
</section>

${
  featured
    ? `<section class="section"><div class="wrap">
  <p class="eyebrow">Featured system</p>
  <div class="feature">
    <div>
      <h2><a href="${featured.url}">${esc(featured.title)}</a></h2>
      <p>${esc(featured.summary)}</p>
      <p class="actions"><a class="btn btn-primary" href="${featured.url}">Open the ${esc(featured.title.toLowerCase())} system</a> ${badge(featured.status)}</p>
    </div>
    <div>${flowBlock(featured.flow)}</div>
  </div>
</div></section>`
    : ''
}

<section class="section section-alt"><div class="wrap">
  <h2>Explore by system</h2>
  <p class="muted">Only systems with content in progress are shown. More appear as research is completed.</p>
  <div class="grid">${systems.map(card).join('')}</div>
  <p class="muted small">Topics currently covered: ${topics.map(esc).join(', ') || 'none yet'}.</p>
</div></section>

<section class="section"><div class="wrap">
  <h2>How Pakistan Resolve explains a system</h2>
  <ol class="steps">${steps.map(([t, d]) => `<li><strong>${t}</strong><span>${d}</span></li>`).join('')}</ol>
</div></section>

${
  latest.length
    ? `<section class="section section-alt"><div class="wrap">
  <h2>Latest explainers</h2>
  <p class="muted">Short answers to specific questions, each linked to its wider system.</p>
  <div class="grid">${latest.map(card).join('')}</div>
  <p><a href="/explainers/">All explainers</a></p>
</div></section>`
    : ''
}

<section class="section"><div class="wrap narrow">
  <h2>Why trust this project</h2>
  <ul class="plain">
    <li><strong>Systems first, news second.</strong> We explain the machinery behind headlines, not the headlines themselves.</li>
    <li><strong>Sources and dates are visible.</strong> Figures carry a unit, period and source, or they are not shown.</li>
    <li><strong>Honest about uncertainty.</strong> Facts, official positions, analysis and proposals are labelled separately.</li>
  </ul>
  <p><a href="/about/">About the project</a> · <a href="/standards/">Editorial standards</a></p>
</div></section>`;
  emit(
    '/',
    layout({ title: cfg.name, description: cfg.description, urlPath: '/', main, section: '' })
  );
}

function systemsIndex() {
  const roadmap = [
    'Economy and public finance',
    'Taxation and the national budget',
    'Governance and institutions',
    'Public services (health, education)',
    'Agriculture and water',
    'Transport',
    'Political and constitutional development',
  ];
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / Explore Systems</p>
  <h1>Explore Systems</h1>
  <p class="lead">Each system page maps one part of public life: how it works, who is responsible, where money flows, what the evidence says, and what is debated.</p>
</div>
<div class="wrap">
  <div class="grid">${systems.map(card).join('')}</div>
  <section class="block">
    <h2>On the roadmap</h2>
    <p class="muted">These areas are planned but not started. They are listed as plain text on purpose: a page appears only when researched material is ready.</p>
    <ul class="plain">${roadmap.map((r) => `<li>${r}</li>`).join('')}</ul>
  </section>
</div>`;
  emit('/systems/', layout({ title: 'Explore Systems', description: 'System-by-system explanations of how parts of Pakistan work: institutions, money, rules, evidence and debates.', urlPath: '/systems/', main, section: 'systems' }));
}

function systemPage(s) {
  const { html, toc } = md(s);
  const tocEntries = [
    ...toc,
    ...(arr(s.institutions).length ? [{ id: 'key-institutions', text: 'Key institutions' }] : []),
    { id: 'data-and-evidence', text: 'Data and evidence' },
    { id: 'related', text: 'Related reading' },
    { id: 'sources', text: 'Sources and further reading' },
  ];
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / <a href="/systems/">Explore Systems</a> / ${esc(s.title)}</p>
  <p class="eyebrow">System · ${esc(s.topic)}</p>
  <h1>${esc(s.title)}</h1>
  <p class="lead">${esc(s.summary)}</p>
  ${metaLine(s, plainText(s.body))}
  ${draftBanner(s)}
</div>
<div class="wrap doc-layout">
  <aside class="doc-side">${tocBlock(tocEntries)}</aside>
  <article class="doc">
    <section class="block why"><h2 class="h-sm">Why it matters</h2><p>${inline(s.why, ctx)}</p></section>
    ${arr(s.flow).length ? `<section class="block"><h2 class="h-sm">The system at a glance</h2>${flowBlock(s.flow)}${s.flow_note ? `<p class="muted small">${esc(s.flow_note)}</p>` : ''}</section>` : ''}
    <div class="prose">${html}</div>
    ${institutionsBlock(s)}
    ${figuresBlock(s)}
    ${relatedBlock(s)}
    ${sourcesBlock(s)}
  </article>
</div>`;
  emit(s.url, layout({ title: s.title, description: s.summary, urlPath: s.url, main, section: 'systems', type: 'article' }));
}

function explainersIndex() {
  const sorted = [...explainers].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / Explainers</p>
  <h1>Explainers</h1>
  <p class="lead">Short, focused answers to questions readers actually ask. Each explainer stands alone and links into the wider system.</p>
</div>
<div class="wrap">${
    sorted.length
      ? `<div class="grid">${sorted.map(card).join('')}</div>`
      : `<div class="empty"><p><strong>No explainers yet.</strong> Start with <a href="/systems/">Explore Systems</a>.</p></div>`
  }</div>`;
  emit('/explainers/', layout({ title: 'Explainers', description: 'Short, sourced answers to specific questions about how Pakistan works.', urlPath: '/explainers/', main, section: 'explainers' }));
}

function explainerPage(e) {
  const { html, toc } = md(e);
  const takeaways = arr(e.takeaways);
  const tocEntries = [
    ...toc,
    ...(takeaways.length ? [{ id: 'key-takeaways', text: 'Key takeaways' }] : []),
    { id: 'related', text: 'Related reading' },
    { id: 'sources', text: 'Sources and further reading' },
  ];
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / <a href="/explainers/">Explainers</a> / ${esc(e.title)}</p>
  <p class="eyebrow">Explainer${e.topic ? ` · ${esc(e.topic)}` : ''}</p>
  <h1>${esc(e.title)}</h1>
  <p class="question">${esc(e.question)}</p>
  ${metaLine(e, plainText(e.body))}
  ${draftBanner(e)}
</div>
<div class="wrap doc-layout">
  <aside class="doc-side">${tocBlock(tocEntries)}</aside>
  <article class="doc">
    <section class="short-answer"><h2 class="h-sm">Short answer</h2><p>${inline(e.short_answer, ctx)}</p></section>
    <div class="prose">${html}</div>
    ${takeaways.length ? `<section id="key-takeaways" class="block"><h2>Key takeaways</h2><ul>${takeaways.map((t) => `<li>${inline(t, ctx)}</li>`).join('')}</ul></section>` : ''}
    ${relatedBlock(e)}
    ${sourcesBlock(e)}
  </article>
</div>`;
  emit(e.url, layout({ title: e.title, description: e.question, urlPath: e.url, main, section: 'explainers', type: 'article' }));
}

function institutionPage(x) {
  const { html } = md(x);
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / <a href="/library/">Knowledge Library</a> / ${esc(x.title)}</p>
  <p class="eyebrow">Institution</p>
  <h1>${esc(x.title)}</h1>
  <p class="lead">${esc(x.summary)}</p>
  ${metaLine(x, plainText(x.body))}
  ${draftBanner(x)}
</div>
<div class="wrap"><article class="doc doc-single"><div class="prose">${html}</div>${relatedBlock(x)}${sourcesBlock(x)}</article></div>`;
  emit(x.url, layout({ title: x.title, description: x.summary, urlPath: x.url, main, section: 'library', type: 'article' }));
}

function libraryPage() {
  const items = [...systems, ...explainers, ...institutions, ...glossary];
  const typeOrder = ['system', 'explainer', 'institution', 'glossary'];
  items.sort((a, b) => typeOrder.indexOf(a.kind) - typeOrder.indexOf(b.kind) || String(a.title).localeCompare(String(b.title)));
  const types = typeOrder.filter((k) => items.some((i) => i.kind === k));
  const topics = [...new Set(items.map((i) => i.topic).filter(Boolean))].sort();
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / Knowledge Library</p>
  <h1>Knowledge Library</h1>
  <p class="lead">Everything published so far: systems, explainers and glossary terms. Filters are simple on purpose and will grow as the library does.</p>
</div>
<div class="wrap">
  <div class="filters js-only">
    <label>Type <select id="f-type"><option value="">All types</option>${types.map((k) => `<option value="${k}">${KINDS[k].label}${k === 'glossary' ? 's' : k === 'system' ? 's' : 's'}</option>`).join('')}</select></label>
    <label>Topic <select id="f-topic"><option value="">All topics</option>${topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
    <button type="button" id="f-clear" class="btn btn-small">Clear filters</button>
  </div>
  <p id="f-count" class="muted small" aria-live="polite">${items.length} item${items.length === 1 ? '' : 's'}</p>
  <ul class="list" id="lib-list">${items
    .map(
      (i) => `<li class="list-item" data-type="${i.kind}" data-topic="${esc(i.topic || '')}">
    <p class="card-meta">${KINDS[i.kind].label}${i.topic ? ` · ${esc(i.topic)}` : ''}</p>
    <h2 class="h-md"><a href="${i.url}">${esc(i.title)}</a></h2>
    <p>${esc(i.question || i.summary)}</p>
    <p class="card-foot">${badge(i.status || 'draft')}<span class="muted small">Updated ${fmtDate(i.updated)}</span>${i.kind === 'glossary' ? '' : `<span class="muted small">${readMinutes(plainText(i.body))} min read</span>`}</p>
  </li>`
    )
    .join('')}</ul>
  <div id="f-empty" class="empty" hidden><p><strong>Nothing matches those filters.</strong> <a href="/library/">Clear the filters</a> or <a href="/systems/">browse systems</a>.</p></div>
</div>`;
  emit('/library/', layout({ title: 'Knowledge Library', description: 'The searchable library of Pakistan Resolve systems, explainers and glossary terms.', urlPath: '/library/', main, section: 'library' }));
}

function glossaryPage() {
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / <a href="/library/">Knowledge Library</a> / Glossary</p>
  <h1>Glossary</h1>
  <p class="lead">Plain-language definitions for terms that recur across systems. Every term is a draft until it is checked against a cited source.</p>
</div>
<div class="wrap narrow">
  ${glossary.length ? `<nav class="az" aria-label="Jump to term"><ul class="chips">${glossary.map((g) => `<li><a href="#${g.slug}">${esc(g.title)}</a></li>`).join('')}</ul></nav>` : ''}
  ${
    glossary.length
      ? glossary
          .map((g) => {
            const { html } = md(g);
            const sys = arr(g.related_systems).map((s) => lookup.system.get(s)).filter(Boolean);
            return `<article class="term-entry" id="${g.slug}">
  <h2>${esc(g.title)} ${badge(g.status || 'draft')}</h2>
  <p class="term-def">${esc(g.summary)}</p>
  <div class="prose">${html}</div>
  ${sys.length ? `<p class="small">Appears in: ${sys.map((s) => `<a href="${s.url}">${esc(s.title)}</a>`).join(', ')}</p>` : ''}
</article>`;
          })
          .join('\n')
      : `<div class="empty"><p><strong>No glossary terms yet.</strong></p></div>`
  }
</div>`;
  emit('/glossary/', layout({ title: 'Glossary', description: 'Plain-language definitions of terms used across Pakistan Resolve.', urlPath: '/glossary/', main, section: 'library' }));
}

function staticPage(p) {
  const { html } = md(p);
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / ${esc(p.title)}</p>
  <h1>${esc(p.title)}</h1>
  <p class="lead">${esc(p.summary)}</p>
  <p class="meta-line"><span>Updated ${fmtDate(p.updated)}</span></p>
</div>
<div class="wrap narrow"><article class="prose">${html}</article></div>`;
  emit(p.url, layout({ title: p.title, description: p.summary, urlPath: p.url, main, section: p.slug === 'about' ? 'about' : '' }));
}

function correctionsPage(p) {
  const { html } = md(p);
  const email = cfg.contactEmail;
  const contact = email
    ? `<div class="notice"><p><strong>Send a correction or suggestion</strong></p><p><a class="btn btn-primary" id="mailto-link" href="mailto:${esc(email)}?subject=${encodeURIComponent('Pakistan Resolve: correction or suggestion')}">Email ${esc(email)}</a></p><p class="small muted">Please include the page address, what is wrong or missing, and a source if you have one. <span id="page-ref"></span></p></div>`
    : `<div class="notice notice-draft"><p><strong>Contact route not configured yet.</strong> This project does not yet have a public inbox or form. Until one is set up, corrections and suggestions cannot be received through this site.</p><p class="small">Site owner: set <code>contactEmail</code> in <code>site.config.json</code> and rebuild. This notice then becomes an email link, pre-filled with the page being reported.</p></div>`;
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / ${esc(p.title)}</p>
  <h1>${esc(p.title)}</h1>
  <p class="lead">${esc(p.summary)}</p>
</div>
<div class="wrap narrow"><article class="prose">${html}</article>${contact}</div>`;
  emit(p.url, layout({ title: p.title, description: p.summary, urlPath: p.url, main, section: '' }));
}

function searchPage() {
  const main = `<div class="wrap page-head">
  <p class="crumbs"><a href="/">Home</a> / Search</p>
  <h1>Search the library</h1>
  <form class="search search-large" role="search" action="/search/" method="get">
    <label class="sr-only" for="search-q">Search</label>
    <input id="search-q" type="search" name="q" placeholder="For example: tariff, circular debt, petrol price" autocomplete="off">
    <button type="submit">Search</button>
  </form>
</div>
<div class="wrap">
  <div id="search-status" class="muted" aria-live="polite"></div>
  <ol id="search-results" class="results"></ol>
  <div id="search-empty" class="empty" hidden>
    <p><strong>No results.</strong> Try a broader word, or start from a system:</p>
    <ul>${systems.map((s) => `<li><a href="${s.url}">${esc(s.title)}</a></li>`).join('')}</ul>
    <p><a href="/systems/">Browse all systems</a> · <a href="/library/">Browse the library</a></p>
  </div>
  <noscript><p>Search needs JavaScript. You can still <a href="/library/">browse the library</a> or <a href="/systems/">explore systems</a>.</p></noscript>
</div>`;
  emit('/search/', layout({ title: 'Search', description: 'Search Pakistan Resolve.', urlPath: '/search/', main, section: '', noindex: true }));
}

function notFoundPage() {
  const main = `<div class="wrap page-head"><h1>Page not found</h1><p class="lead">That page does not exist, or has moved.</p>
<p class="actions"><a class="btn btn-primary" href="/systems/">Explore Systems</a><a class="btn" href="/library/">Browse the Knowledge Library</a></p></div>`;
  emit('/404.html', layout({ title: 'Page not found', description: 'Page not found.', urlPath: '/404.html', main, noindex: true }));
}

/* ------------------------------------------------------------------- output */

function writeOutputs() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  const pub = path.join(ROOT, 'public');
  if (fs.existsSync(pub)) fs.cpSync(pub, DIST, { recursive: true });

  for (const o of outputs) {
    const file = o.urlPath.endsWith('.html') ? path.join(DIST, o.urlPath) : path.join(DIST, o.urlPath, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, o.html);
  }

  const searchable = [...systems, ...explainers, ...institutions, ...glossary, ...pages.filter((p) => ['about', 'standards'].includes(p.slug))];
  const index = searchable.map((i) => ({
    t: i.title,
    s: i.question ? `${i.question} ${i.summary}` : i.summary,
    ty: KINDS[i.kind].label,
    tp: i.topic || '',
    u: i.url,
    d: i.updated,
    st: i.status || '',
    x: plainText(`${i.short_answer || ''} ${i.body}`).slice(0, 4000),
  }));
  fs.writeFileSync(path.join(DIST, 'search-index.json'), JSON.stringify(index));

  const urls = [
    { u: '/', d: '' },
    { u: '/systems/', d: '' },
    { u: '/library/', d: '' },
    { u: '/explainers/', d: '' },
    { u: '/glossary/', d: '' },
    ...[...systems, ...explainers, ...institutions, ...pages].map((i) => ({ u: i.url, d: i.updated })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((x) => `  <url><loc>${cfg.siteUrl}${x.u}</loc>${isoDate(x.d) ? `<lastmod>${x.d}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /search/\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
}

function checkLinks() {
  const htmlFiles = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) htmlFiles.push(p);
    }
  };
  walk(DIST);
  const ids = new Map();
  const idsOf = (file) => {
    if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    return ids.get(file);
  };
  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
      const [pathPart, hash] = m[1].split('#');
      const clean = pathPart.split('?')[0];
      let target = path.join(DIST, clean);
      if (clean.endsWith('/')) target = path.join(target, 'index.html');
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        fail(`Broken internal link ${m[1]} in ${path.relative(DIST, f)}`);
      } else if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) {
        fail(`Broken anchor ${m[1]} in ${path.relative(DIST, f)}`);
      }
    }
  }
}

/* --------------------------------------------------------------------- run */

validate();
homePage();
systemsIndex();
systems.forEach(systemPage);
explainersIndex();
explainers.forEach(explainerPage);
institutions.forEach(institutionPage);
libraryPage();
glossaryPage();
for (const p of pages) (p.slug === 'corrections' ? correctionsPage : staticPage)(p);
searchPage();
notFoundPage();
writeOutputs();
checkLinks();

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\nBuild failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(
  `Built ${outputs.length} pages (${systems.length} systems, ${explainers.length} explainers, ${glossary.length} glossary terms, ${institutions.length} institutions) into dist/` +
    (warnings.length ? ` with ${warnings.length} warning(s).` : '.')
);
