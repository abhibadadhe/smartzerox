#!/usr/bin/env node
/**
 * Lightweight load smoke test — hits health + optional authenticated endpoints.
 *
 * Usage:
 *   node scripts/loadTest.js
 *   node scripts/loadTest.js --url http://localhost:5000 --concurrency 10 --requests 100
 *   node scripts/loadTest.js --token <JWT> --shopkeeper
 */

require('dotenv').config();
const axios = require('axios');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE_URL = getArg('url', 'http://localhost:5000');
const CONCURRENCY = parseInt(getArg('concurrency', '5'), 10);
const TOTAL = parseInt(getArg('requests', '50'), 10);
const TOKEN = getArg('token', process.env.LOAD_TEST_TOKEN || '');
const SHOPKEEPER = args.includes('--shopkeeper');

async function runOne(client, i) {
  const start = Date.now();
  try {
    if (SHOPKEEPER && TOKEN) {
      await client.get('/api/orders/incomplete-jobs', { headers: { Authorization: `Bearer ${TOKEN}` } });
    } else {
      await client.get('/health');
    }
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, status: err.response?.status, message: err.message };
  }
}

async function main() {
  const client = axios.create({ baseURL: BASE_URL, timeout: 15000 });
  console.log(`Load test: ${TOTAL} requests, concurrency ${CONCURRENCY}, target ${BASE_URL}${SHOPKEEPER ? ' (shopkeeper)' : ' (/health)'}`);

  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < TOTAL) {
      const i = idx++;
      results.push(await runOne(client, i));
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsed = Date.now() - t0;

  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const p99 = times[Math.floor(times.length * 0.99)] || 0;

  console.log('\n--- Results ---');
  console.log(`Success: ${ok}/${results.length}  Fail: ${fail}`);
  console.log(`Total time: ${elapsed}ms  RPS: ${(results.length / (elapsed / 1000)).toFixed(1)}`);
  console.log(`Latency ms — p50: ${p50}  p95: ${p95}  p99: ${p99}`);

  if (fail > 0) {
    const sample = results.find(r => !r.ok);
    console.log(`Sample error: ${sample?.status} ${sample?.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
