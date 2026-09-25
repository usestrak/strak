#!/usr/bin/env node
/**
 * build-registry.mjs: writes the static board to public/data/equities.json.
 *
 * The logic lives in lib/registry.mjs, shared with /api/registry. The file is the fallback the site
 * reads when the live route is unavailable, and the snapshot the brand scripts draw from.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../lib/registry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'public', 'data', 'equities.json');

let reg;
try { reg = await buildRegistry(); } catch (e) { console.error(e.message); process.exit(1); }
const rows = reg.equities;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(reg, null, 1));

const byIssuer = rows.reduce((m, r) => ((m[r.issuer] = (m[r.issuer] || 0) + 1), m), {});
const vol = rows.reduce((a, r) => a + r.vol24, 0);
console.log(`equities: ${rows.length}  by issuer: ${JSON.stringify(byIssuer)}  vol24: $${(vol / 1e6).toFixed(1)}M`);
console.log(`with pool: ${rows.filter((r) => r.pool).length}`);
console.log('printed (turnover > 50):', rows.filter((r) => r.turnover > 50).map((r) => `${r.symbol} ${r.turnover}x`).join(', ') || 'none');
console.log('hot (turnover 12-50):', rows.filter((r) => r.turnover > 12 && r.turnover <= 50).map((r) => `${r.symbol} ${r.turnover}x`).join(', ') || 'none');
