// Standalone load-bench for the backend (not a Playwright test).
// Usage: node bench.mjs [options]
//   --url http://localhost:5199/api/v1/health
//   --concurrency 128            // in-flight requests
//   --duration 15                // seconds
//   --rounds 3                   // runs, for a warm-up + measurement split
//   --auth email pass            // optional: login, then hammer the token (test concurrency)
import http from 'node:http';

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    url: { type: 'string', default: 'http://localhost:5199/api/v1/health' },
    concurrency: { type: 'string', default: '64' },
    duration: { type: 'string', default: '10' },
    rounds: { type: 'string', default: '2' },
    authEmail: { type: 'string', default: '' },
    authPassword: { type: 'string', default: '' },
  },
});

const opts = values;
const url = new URL(opts.url);
const pool = url.host;
const token = opts.authEmail && opts.authPassword
  ? (await login(opts.authEmail, opts.authPassword)).accessToken
  : null;
const hdr = token ? { Authorization: `Bearer ${token}` } : {};

const concurrency = Number(opts.concurrency);
const duration = Number(opts.duration) * 1000;
const rounds = Number(opts.rounds);

function request(path) {
  return new Promise((resolve) => {
    const r = http.request(
      { host: pool, port: 5199, path, method: 'GET', headers: hdr },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, latency: Date.now() - t0, bytes: chunks.reduce((a, c) => a + c.length, 0) }));
      },
    );
    r.on('error', (e) => resolve({ status: e.code ?? 'ERR', latency: Date.now() - t0, error: String(e) }));
    r.end();
  });
}

async function login(email, password) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: pool, port: 5199, path: '/api/v1/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(`login parse: ${b}`)); }
        });
      },
    );
    r.write(JSON.stringify({ email, password }));
    r.end();
  });
}

async function runRound(name) {
  const lat = [];
  let completed = 0;
  const t0 = Date.now();
  const jobs = [];

  for (let i = 0; i < concurrency; i++) {
    jobs.push(setTimeout(() => {
      const t0 = Date.now();
      http.request(
        { host: pool, port: 5199, path: url.pathname, method: 'GET', headers: hdr },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => { lat.push(Date.now() - t0); completed++; });
        },
      ).on('error', () => { lat.push(Date.now() - t0); completed++; }).end();
    }, Math.random() * 100));
  }
  await new Promise((r) => setTimeout(r, duration));
  // drain in flight
  while (completed < concurrency) { await new Promise((res) => setTimeout(res, 50)); }
  const p50 = quantile(lat, 0.5);
  const p95 = quantile(lat, 0.95);
  const p99 = quantile(lat, 0.99);
  const ok = lat.filter((l) => l <= 5000).length;
  const rate = (completed / ((Date.now() - t0) / 1000)).toFixed(1);
  console.log(`[${name}] conc=${concurrency} s=${duration / 1000} completed=${completed} req/s=${rate} | p50=${p50}ms p95=${p95}ms p99=${p99}ms | ${ok}/${lat.length}<=5s | mean=${lat.reduce((a, b) => a + b, 0) / lat.length}ms`);
}

function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
}

(async () => {
  for (let i = 0; i < rounds; i++) {
    console.log(`round ${i + 1}/${rounds}`);
    await runRound(`round ${i + 1}`);
  }
})();
