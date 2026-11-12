// Local static server for public/, with clean URLs the way Vercel serves
// them: /reconciliation serves reconciliation.html. No dependencies.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean.endsWith('/') ? [join(clean, 'index.html')] : [clean, `${clean}.html`];
  for (const c of candidates) {
    const file = join(ROOT, c);
    if (!file.startsWith(ROOT)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = await resolve(path);
  if (!file) {
    // As Vercel does: public/404.html for any path with no file
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(await readFile(join(ROOT, '404.html')));
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
