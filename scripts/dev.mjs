#!/usr/bin/env node
/**
 * dev.mjs: local stand-in for Vercel. Serves public/ with clean URLs and runs api/*.js handlers
 * through a minimal req/res shim, so the site and its functions can be checked without `vercel dev`.
 * Usage: node scripts/dev.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const PORT = Number(process.argv[2]) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml',
};

async function isFile(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

async function resolveStatic(path) {
  const p = join(PUB, decodeURIComponent(path));
  if (!p.startsWith(PUB)) return null;
  for (const c of [p, p + '.html', join(p, 'index.html')]) if (await isFile(c)) return c;
  return null;
}

async function runApi(name, req, res, query) {
  const file = join(ROOT, 'api', name + '.js');
  if (!(await isFile(file))) return false;
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  req.query = query;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  await mod.default(req, res);
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const m = url.pathname.match(/^\/api\/([\w-]+)$/);
    if (m && (await runApi(m[1], req, res, Object.fromEntries(url.searchParams)))) return;
    const file = await resolveStatic(url.pathname);
    if (file) {
      res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      return res.end(await readFile(file));
    }
    res.statusCode = 404;
    res.setHeader('content-type', TYPES['.html']);
    res.end(await readFile(join(PUB, '404.html')));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e?.stack || e));
  }
}).listen(PORT, () => console.log(`dev: http://localhost:${PORT}`));
