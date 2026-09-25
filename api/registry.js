/**
 * /api/registry: the live equity board.
 *
 * Same builder as scripts/build-registry.mjs, run on demand. The CDN keeps each answer for five
 * minutes, so one upstream refresh (one Jupiter call, four DexScreener calls) serves every visitor
 * in that window. If the upstreams fail, the client falls back to the static /data/equities.json.
 */
import { buildRegistry } from '../lib/registry.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const reg = await buildRegistry({ tries: 2 });
    if (!reg.count) throw new Error('empty');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({ ...reg, live: true });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=15');
    return res.status(502).json({ error: 'registry unavailable' });
  }
}
