#!/usr/bin/env node
// spec CLI — extract slices of feature specs without direct whole-file reading.
// Usage: node tools/spec/index.mjs show --ticket <TICKET> [--section ac|summary|actors|preconditions|scope|data|defaults|all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPECS_DIR = path.join(ROOT, 'specs', 'features');

const rawArgs = process.argv.slice(2);
const filteredArgs = rawArgs.filter(a => a !== 'show');

const { values } = parseArgs({
  args: filteredArgs,
  options: {
    ticket: { type: 'string' },
    section: { type: 'string', default: 'ac' },
    help: { type: 'boolean' }
  },
  allowPositionals: true
});

if (values.help || !values.ticket) {
  console.log(`spec slicer CLI

Usage: node tools/spec/index.mjs show --ticket <TICKET> [--section <name>]

Sections:
  ac             Acceptance criteria (AC-1, AC-2, ...) [default]
  summary        Summary and overview
  actors         Actors & roles
  preconditions  Preconditions
  scope          Out of scope
  data           Data touched
  defaults       Open questions & defaults
  all            Entire spec headers and structure outline`);
  process.exit(values.help ? 0 : 1);
}

function findSpecFile(ticket) {
  if (!fs.existsSync(SPECS_DIR)) throw new Error(`specs directory not found: ${SPECS_DIR}`);
  const files = fs.readdirSync(SPECS_DIR);
  const match = files.find(f => f.startsWith(`${values.ticket}-`) || f === `${values.ticket}.md`);
  if (!match) throw new Error(`Spec file for ticket ${values.ticket} not found in ${SPECS_DIR}`);
  return path.join(SPECS_DIR, match);
}

const file = findSpecFile(values.ticket);
const text = fs.readFileSync(file, 'utf8');

const SECTION_MAP = {
  ac: /## 4\. Acceptance criteria[\s\S]*?(?=\n## 5\.|\n## [0-9]|$)/,
  summary: /## 1\. Summary[\s\S]*?(?=\n## 2\.|\n## [0-9]|$)/,
  actors: /## 2\. Actors & roles[\s\S]*?(?=\n## 3\.|\n## [0-9]|$)/,
  preconditions: /## 3\. Preconditions[\s\S]*?(?=\n## 4\.|\n## [0-9]|$)/,
  scope: /## 5\. Out of scope[\s\S]*?(?=\n## 6\.|\n## [0-9]|$)/,
  data: /## 6\. Data touched[\s\S]*?(?=\n## 7\.|\n## [0-9]|$)/,
  defaults: /## 7\. Open questions[\s\S]*?(?=\n## 8\.|\n## [0-9]|$)/
};

const reqSec = values.section.toLowerCase();
if (reqSec === 'all') {
  const lines = text.split('\n');
  const outline = lines.filter(l => l.startsWith('#')).join('\n');
  console.log(`# Spec Outline: ${path.basename(file)}\n${outline}`);
} else if (SECTION_MAP[reqSec]) {
  const match = text.match(SECTION_MAP[reqSec]);
  if (match) {
    console.log(`# Spec: ${path.basename(file)} [section: ${reqSec}]\n${match[0].trim()}`);
  } else {
    console.log(`Section "${reqSec}" not found in ${path.basename(file)}.`);
  }
} else {
  console.error(`Unknown section "${reqSec}". Allowed: ${Object.keys(SECTION_MAP).join(', ')}, all`);
  process.exit(1);
}
