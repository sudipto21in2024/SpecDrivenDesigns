#!/usr/bin/env node
// bundle contracts/v1/*.yaml -> contracts/v1-openapi.yaml (LOGI-0015).
// Fragments are verbatim slices; structural headers live here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V1 = path.join(ROOT, 'contracts', 'v1');
const OUT = path.join(ROOT, 'contracts', 'v1-openapi.yaml');
const R = (p) => fs.readFileSync(path.join(V1, p), 'utf8').replace(/\n$/, '');
const ORDER = [
  'head.yaml',
  ['components:', '  securitySchemes:', 'components/security.yaml'],
  ['components:', '  schemas:', 'components/schemas/common.yaml',
    'components/schemas/auth.yaml', 'components/schemas/warehouses.yaml',
    'components/schemas/vehicles.yaml', 'components/schemas/drivers.yaml',
    'components/schemas/shipments.yaml', 'components/schemas/routes.yaml'],
  ['components:', '  responses:', 'components/responses.yaml'],
  ['components:', '  x-role-sets:', 'components/extensions.yaml'],
  ['paths:', 'paths/health.yaml', 'paths/warehouses.yaml',
    'paths/vehicles.yaml', 'paths/drivers.yaml', 'paths/shipments.yaml',
    'paths/shipments-lifecycle.yaml', 'paths/routes.yaml', 'paths/routes-shipments.yaml', 'paths/auth.yaml'],
  'foot.yaml',
];
function build() {
  const out = [];
  out.push('# GENERATED — do not hand-edit. Authorship: contracts/v1/*.yaml.');
  out.push('# Regenerate: node tools/contract/bundle.mjs   Verify: node tools/contract/bundle.mjs --check');
  for (const item of ORDER) {
    if (typeof item === 'string') { out.push(R(item)); continue; }
    const [hdr, ...rest] = item;
    for (const frag of rest) {
      if (frag.endsWith('.yaml') && !['components:', 'paths:'].includes(frag)) {
        if (frag === rest[0] && (hdr === 'components:' || hdr === 'paths:')) {
          // first fragment under a top-level header: emit top header first
        }
      }
      if (frag === 'components:' || frag === 'paths:') { out.push(frag); continue; }
      if (frag.startsWith('  ')) { out.push(frag); continue; }
      out.push(R(frag));
    }
  }
  // Reconstruct precisely: head already holds openapi..tags;
  // then components:/paths: headers need emitting once.
  const parts = [];
  parts.push('# GENERATED — do not hand-edit. Authorship: contracts/v1/*.yaml.');
  parts.push('# Regenerate: node tools/contract/bundle.mjs   Verify: node tools/contract/bundle.mjs --check');
  parts.push(R('head.yaml'));
  parts.push('components:');
  parts.push('  securitySchemes:');
  parts.push(R('components/security.yaml'));
  parts.push('  schemas:');
  for (const f of ['common','auth','warehouses','vehicles','drivers','shipments','routes'])
    parts.push(R('components/schemas/'+f+'.yaml'));
  parts.push('  responses:');
  parts.push(R('components/responses.yaml'));
  parts.push(R('components/extensions.yaml'));
  parts.push('paths:');
  for (const f of ['health','warehouses','vehicles','drivers','shipments','shipments-lifecycle','routes','routes-shipments','auth'])
    parts.push(R('paths/'+f+'.yaml'));
  parts.push(R('foot.yaml'));
  return parts.join('\n') + '\n';
}
const check = process.argv.includes('--check');
const built = build();
if (check) {
  const cur = fs.readFileSync(OUT, 'utf8');
  const norm = (s) => s.split('\n').filter((l) => !l.startsWith('# GENERATED') && !l.startsWith('# Regenerate')).join('\n');
  if (norm(cur) === norm(built)) { console.log('bundle --check: clean'); }
  else {
    console.error('bundle --check: DRIFT — run node tools/contract/bundle.mjs to regenerate');
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUT, built);
  console.log('bundled -> contracts/v1-openapi.yaml (' + built.split('\n').length + ' lines)');
}
