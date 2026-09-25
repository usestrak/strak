#!/usr/bin/env node
/**
 * snapshot.mjs: one hourly line of the whole board, kept forever.
 *
 * Run by .github/workflows/snapshot.yml every hour. Appends a compact snapshot to
 * history/<YYYY-MM-DD>.ndjson and records every stock above 50x in history/cases.json, so spikes
 * like IONQ at 152.4x are caught with their date instead of by luck.
 *
 * Line format: {"t": <unix ms>, "rows": [[symbol, issuer, price, liq, vol24, turnover], ...]}
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../lib/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'history');
const CASES = join(DIR, 'cases.json');
const r2 = (n) => Math.round(n * 100) / 100;

const reg = await buildRegistry();
const t = reg.updatedAt;
const day = new Date(t).toISOString().slice(0, 10);
mkdirSync(DIR, { recursive: true });

const rows = reg.equities.map((e) => [e.symbol, e.issuer, +e.price.toPrecision(6), Math.round(e.liq), Math.round(e.vol24), r2(e.turnover)]);
appendFileSync(join(DIR, `${day}.ndjson`), JSON.stringify({ t, rows }) + '\n');

// A case is the first hour a stock is seen above 50x on a given day; later hours update its peak.
const cases = existsSync(CASES) ? JSON.parse(readFileSync(CASES, 'utf8')) : [];
for (const e of reg.equities.filter((x) => x.turnover > 50)) {
  const hit = cases.find((c) => c.date === day && c.address === e.address);
  const row = { date: day, t, symbol: e.symbol, ticker: e.ticker, issuer: e.issuer, address: e.address, pool: e.pool || null, turnover: r2(e.turnover), vol24: Math.round(e.vol24), liq: Math.round(e.liq) };
  if (!hit) cases.push(row);
  else if (row.turnover > hit.turnover) Object.assign(hit, row);
}
writeFileSync(CASES, JSON.stringify(cases, null, 1) + '\n');

const hot = reg.equities.filter((e) => e.turnover > 12).map((e) => `${e.symbol} ${e.turnover}x`);
console.log(`${new Date(t).toISOString()}  ${reg.count} stocks  above 12x: ${hot.join(', ') || 'none'}`);
