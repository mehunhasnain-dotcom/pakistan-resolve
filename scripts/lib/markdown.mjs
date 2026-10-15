// Small, dependency-free Markdown renderer tailored to Pakistan Resolve content.
//
// Beyond common Markdown (headings, lists, tables, quotes, code, links, bold/italic) it supports:
//   [[term-slug]]            link to a glossary term
//   ::: fact | official | analysis | proposal | todo | note   (optional title)
//   ...content...
//   :::                      labelled statement boxes, so facts, positions, analysis and
//                            proposals are visibly different (never by colour alone)

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

export const CALLOUTS = {
  fact: 'Fact',
  official: 'Official position',
  analysis: 'Analysis',
  proposal: 'Proposal',
  todo: 'Research needed',
  note: 'Note',
};

function safeUrl(u) {
  u = u.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '#'; // block javascript:, data:, etc.
  return u;
}

export function inline(text, ctx = {}) {
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = esc(text);
  text = text.replace(/\[\[([a-z0-9-]+)\]\]/g, (m, slug) => {
    const t = ctx.term?.(slug);
    if (!t) {
      ctx.warn?.(`Unknown glossary term [[${slug}]]`);
      return m;
    }
    return `<a class="term" href="/glossary/#${slug}" title="${esc(t.summary || '')}">${esc(t.title)}</a>`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const href = safeUrl(u.replace(/&amp;/g, '&'));
    const ext = /^https?:/i.test(href);
    return `<a href="${esc(href)}"${ext ? ' class="external" rel="noopener"' : ''}>${t}</a>`;
  });
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[n])}</code>`);
  return text;
}

const LIST_START = /^(\s*)([-*]|\d+\.)\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function startsBlock(line, next) {
  return (
    /^```/.test(line) ||
    /^:::/.test(line) ||
    /^#{1,4}\s/.test(line) ||
    /^>/.test(line) ||
    /^(-{3,}|\*{3,})\s*$/.test(line) ||
    LIST_START.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next))
  );
}

function splitRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseList(lines, i, ctx, used) {
  const first = lines[i].match(LIST_START);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    const mm = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (!mm || mm[1].length !== baseIndent) break;
    const buf = [mm[3]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) {
        const nxt = lines[i + 1];
        if (nxt !== undefined && /^\s+\S/.test(nxt) && nxt.match(/^(\s*)/)[1].length > baseIndent) {
          buf.push('');
          i++;
          continue;
        }
        break;
      }
      const ind = l.match(/^(\s*)/)[1].length;
      if (ind > baseIndent) {
        buf.push(l.slice(Math.min(ind, baseIndent + 2)));
        i++;
        continue;
      }
      break;
    }
    items.push(buf);
  }
  const tag = ordered ? 'ol' : 'ul';
  const html = items
    .map((buf) => {
      let inner = blocks(buf, ctx, [], used);
      if (!buf.includes('')) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return `<li>${inner}</li>`;
    })
    .join('');
  return { html: `<${tag}>${html}</${tag}>`, next: i };
}

function blocks(lines, ctx, toc, used) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    let m = line.match(/^:::\s*([a-z]+)\s*(.*)$/);
    if (m && CALLOUTS[m[1]]) {
      const [, type, title] = m;
      const buf = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const inner = blocks(buf, ctx, [], used);
      out.push(
        `<aside class="callout callout-${type}"><p class="callout-label">${CALLOUTS[type]}${
          title.trim() ? `: ${esc(title.trim())}` : ''
        }</p>${inner}</aside>`
      );
      continue;
    }

    m = line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length;
      const raw = m[2];
      let id = slugify(raw.replace(/[*`]|\[\[|\]\]/g, ''));
      let n = 2;
      const base = id;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      if (level === 2) toc.push({ id, text: raw.replace(/[*`]/g, '').replace(/\[\[([^\]]+)\]\]/g, '$1') });
      out.push(`<h${level} id="${id}">${inline(raw, ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${blocks(buf, ctx, [], used)}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }

    if (LIST_START.test(line)) {
      const r = parseList(lines, i, ctx, used);
      out.push(r.html);
      i = r.next;
      continue;
    }

    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i], lines[i + 1])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' ').trim(), ctx)}</p>`);
  }
  return out.join('\n');
}

export function renderMarkdown(src, ctx = {}) {
  const toc = [];
  const used = new Set();
  const html = blocks(src.replace(/\r\n/g, '\n').split('\n'), ctx, toc, used);
  return { html, toc };
}

// Plain text for the search index and reading-time estimates.
export function plainText(src) {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`|_-]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
