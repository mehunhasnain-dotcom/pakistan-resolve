// Minimal front-matter parser (a small YAML subset, no dependencies).
//
// Supported:
//   key: value                      (strings, numbers, true/false)
//   key: [a, b, "c, d"]             (inline lists)
//   key:                            (block list of scalars)
//     - a
//     - b
//   key:                            (block list of maps)
//     - title: Something
//       url: https://example.org
// Values must stay on a single line. Quote values that start with [ or contain " #".

export function parseFrontMatter(src) {
  const m = src.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  return { data: parseYaml(m[1]), body: m[2] };
}

function splitFlow(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function scalar(v) {
  v = v.trim();
  if (v === '' || v === '~' || v === 'null') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  if (v.startsWith('[') && v.endsWith(']')) return splitFlow(v.slice(1, -1)).map(scalar);
  return v;
}

const KEY = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/;

export function parseYaml(text) {
  const lines = text
    .split('\n')
    .filter((l) => !/^\s*(#.*)?$/.test(l))
    .map((l) => ({ indent: l.match(/^ */)[0].length, text: l.trim() }));
  let i = 0;

  const isItem = (t) => t === '-' || t.startsWith('- ');

  function parseBlock(indent) {
    return isItem(lines[i].text) ? parseList(indent) : parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i].text)) {
      const m = lines[i].text.match(KEY);
      if (!m) throw new Error(`Front matter: cannot parse line "${lines[i].text}"`);
      i++;
      const [, key, val] = m;
      if (val === undefined || val === '') {
        if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isItem(lines[i].text)))) {
          obj[key] = parseBlock(lines[i].indent);
        } else obj[key] = '';
      } else obj[key] = scalar(val);
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
      const rest = lines[i].text.slice(1).trim();
      if (rest === '') {
        i++;
        arr.push(parseBlock(lines[i].indent));
        continue;
      }
      if (KEY.test(rest) && !/^["'\[]/.test(rest)) {
        lines[i] = { indent: indent + 2, text: rest };
        arr.push(parseMap(indent + 2));
      } else {
        i++;
        arr.push(scalar(rest));
      }
    }
    return arr;
  }

  if (!lines.length) return {};
  return parseMap(lines[0].indent);
}
