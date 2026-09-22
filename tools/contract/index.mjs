#!/usr/bin/env node
// contract slicer (LOGI-0014) — per-resource OpenAPI slice so agents never
// read the whole 650-line yaml. Zero deps. Sections are additive-only, so a
// line-range slicer on `^  /<path>:` + `^    <Name>:` headers is deterministic.
// Usage: node tools/contract/index.mjs show --resource drivers [--fields schemas,x-roles,params,responses]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = path.join(ROOT, 'contracts', 'v1-openapi.yaml');

// resource -> schema names + path prefixes (additive-only; extend per ticket).
const RESOURCES = {
  drivers: { schemas: ['DriverRequest', 'DriverResponse'], paths: ['/drivers', '/drivers/{id}'] },
  vehicles: { schemas: ['VehicleRequest', 'VehicleResponse'], paths: ['/vehicles', '/vehicles/{id}'] },
  warehouses: { schemas: ['WarehouseRequest', 'WarehouseResponse'], paths: ['/warehouses', '/warehouses/{id}'] },
  auth: { schemas: ['LoginRequest', 'RefreshRequest', 'AuthUser', 'TokenResponse'], paths: ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me'] },
};

// Slice contiguous blocks: a 2-space header (`  /x:` or `  components:`-level key)
// keeps all following lines until the next 2-space header. Schema names
// (`    DriverRequest:` = 4-space) are sub-matches — keep them only when the
// enclosing 2-space section is wanted AND the 4-space name matches.
function sliceBlocks(lines, wanted) {
  const out = [];
  let section = null;      // current 2-space header
  let sectionKeep = false; // whole section wanted (a path block)
  let subKeep = false;     // inside a wanted 4-space schema block
  for (const line of lines) {
    const h2 = line.match(/^  (\S[^:]*):\s*(#.*)?$/);
    const h4 = line.match(/^    ([A-Za-z0-9_/{}\-]+):\s*(#.*)?$/);
    if (h2 && !line.startsWith('   ')) {
      section = h2[1];
      sectionKeep = wanted.has(section);
      subKeep = false;
      if (sectionKeep) out.push(line);
      continue;
    }
    if (h4 && section !== null) {
      subKeep = wanted.has(h4[1]);
      if (sectionKeep || subKeep) out.push(line);
      continue;
    }
    if (sectionKeep || subKeep) out.push(line);
  }
  return out;
}

// --- Field-summary modes: structured tables instead of yaml (for qa/backend scans). ---
function summarize(lines, wanted, field) {
  const out = [`# contract summary: ${[...wanted].join(', ')} — ${field}`];
  if (field === 'x-roles') {
    out.push('| path | op | roles |');
    out.push('|---|---|---|');
    let path = '', op = '';
    for (const l of lines) {
      const p = l.match(/^  (\/\S+):\s*$/), o = l.match(/^    (get|post|put|delete|patch):\s*$/), r = l.match(/^\s+x-roles:\s*\[(.*)\]/);
      if (p) path = p[1];
      else if (o) op = o[1];
      else if (r) out.push(`| ${path} | ${op} | ${r[1].trim()} |`);
    }
  } else if (field === 'params') {
    out.push('| path | op | params |');
    out.push('|---|---|---|');
    let path = '', op = '', acc = [], seen = new Map();
    for (const l of lines) {
      const p = l.match(/^  (\/\S+):\s*$/), o = l.match(/^    (get|post|put|delete|patch):\s*$/);
      const n = l.match(/- \{ name: (\w+),/), f = l.match(/schema: \{ type: (\w+)/), s = l.match(/enum: \[(.*)\]/);
      if (p) { path = p[1]; op = ''; acc = []; }
      else if (o) {
        const key = `${path}|${op}`;
        if (op && acc.length && !seen.has(key)) seen.set(key, `| ${path} | ${op} | ${acc.join('; ')} |`);
        op = o[1]; acc = [];
      } else if (n) acc.push(`${n[1]}${s ? `(${s[1]})` : f ? `:${f[1]}` : ''}`);
    }
    const key = `${path}|${op}`;
    if (op && acc.length && !seen.has(key)) seen.set(key, `| ${path} | ${op} | ${acc.join('; ')} |`);
    out.push(...seen.values());
  } else if (field === 'responses') {
    out.push('| path | op | statuses |');
    out.push('|---|---|---|');
    let path = '', op = '', acc = [];
    const flush = () => { if (op) out.push(`| ${path} | ${op} | ${acc.join(', ')} |`); acc = []; };
    for (const l of lines) {
      const p = l.match(/^  (\/\S+):\s*$/), o = l.match(/^    (get|post|put|delete|patch):\s*$/);
      const c = l.match(/^        "(\d{3})":/);
      if (p) { flush(); path = p[1]; op = ''; }
      else if (o) { flush(); op = o[1]; }
      else if (c) acc.push(c[1]);
    }
    flush();
  } else if (field === 'schemas') {
    let inPathSection = false;
    for (const l of lines) {
      if (/^  \//.test(l)) { inPathSection = true; continue; }
      if (inPathSection) continue;
      if (/^\s{4}[A-Z][A-Za-z]+:\s*$/.test(l) || /^\s*required:/.test(l) || /^\s+(properties:|type: object)/.test(l) || /enum: \[/.test(l)) out.push(l.trim());
    }
  } else throw new Error(`unknown field '${field}' (use: x-roles, params, responses, schemas)`);
  return out;
}

function filterFields(lines, fields) {
  return lines; // full-slice mode keeps everything; field modes use summarize()
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== 'show') {
  console.log('contract slicer\n\nUsage:\n  show --resource <name> [--fields x-roles|params|responses|schemas]\n\nResources: ' + Object.keys(RESOURCES).join(', '));
  process.exit(cmd ? 1 : 0);
}
const { values } = parseArgs({ args: rest, options: { resource: { type: 'string' }, fields: { type: 'string' } } });
const res = RESOURCES[values.resource];
if (!res) throw new Error(`unknown resource '${values.resource}' (known: ${Object.keys(RESOURCES).join(', ')})`);
const lines = fs.readFileSync(YAML, 'utf8').split('\n');
const wanted = new Set([...res.schemas, ...res.paths]);
const field = (values.fields ?? '').trim();
const sliced = sliceBlocks(lines, wanted);
if (field) {
  console.log(summarize(sliced, wanted, field).join('\n'));
} else {
  console.log(`# contract slice: ${values.resource} (${sliced.length}/${lines.length} lines)`);
  console.log(sliced.join('\n'));
}
