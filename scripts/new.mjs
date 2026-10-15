#!/usr/bin/env node
// Scaffold a new content file with the correct front matter.
// Usage: npm run new -- <system|explainer|glossary|institution> <slug> "Title"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [kind, slug, ...rest] = process.argv.slice(2);
const title = rest.join(' ');
const dirs = { system: 'systems', explainer: 'explainers', glossary: 'glossary', institution: 'institutions' };

if (!dirs[kind] || !/^[a-z0-9-]+$/.test(slug || '') || !title) {
  console.error('Usage: npm run new -- <system|explainer|glossary|institution> <slug-with-hyphens> "Title"');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
const common = `status: draft\npublished: ${today}\nupdated: ${today}`;
const sourcesStub = `sources:\n  - title: Add a source title\n    url: https://example.org/\n    publisher: Publisher\n    type: primary\n    status: to-collect\n    note: Replace this, then change status to cited once the claim has been checked.`;

const templates = {
  system: `---\ntitle: ${q(title)}\nsummary: One or two sentences for cards and search.\nwhy: Why this system matters to ordinary people.\ntopic: Topic name\n${common}\nflow:\n  - label: Stage one\n    note: What happens here.\n  - label: Stage two\n    note: What happens next.\ninstitutions:\n  - name: Institution name\n    type: Type\n    role: What it does. Unverified until sourced.\n    status: unverified\nplanned_data:\n  - A dataset you intend to add\nglossary: []\nrelated_systems: []\nrelated_explainers: []\n${sourcesStub}\n---\n\n## What the system does\n\nWrite a short, plain-language overview.\n\n## How it works\n\n::: todo Research needed\nDescribe the process and cite each claim.\n:::\n`,
  explainer: `---\ntitle: ${q(title)}\nsummary: One sentence for cards and search.\nquestion: The question this explainer answers?\nshort_answer: A two-sentence answer a reader can use immediately.\n${common}\ntakeaways:\n  - First takeaway\nrelated_systems: []\nrelated_explainers: []\nglossary: []\n${sourcesStub}\n---\n\n## The explanation\n\nWrite the main explanation here.\n`,
  glossary: `---\ntitle: ${q(title)}\nsummary: A one-sentence definition.\nstatus: draft\nupdated: ${today}\nrelated_systems: []\n---\n\nA plain-language explanation, with an example if useful.\n`,
  institution: `---\ntitle: ${q(title)}\nsummary: What this body is and does, in one sentence.\n${common}\nrelated_systems: []\n${sourcesStub}\n---\n\n## Mandate\n\n## Role in the systems it touches\n`,
};

const file = path.join(ROOT, 'content', dirs[kind], `${slug}.md`);
if (fs.existsSync(file)) {
  console.error(`Already exists: ${path.relative(ROOT, file)}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, templates[kind]);
console.log(`Created ${path.relative(ROOT, file)}. Edit it, then run: npm run build`);
