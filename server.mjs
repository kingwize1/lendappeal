#!/usr/bin/env node
// Local server: serves dist/ and mounts the SAME order API the Cloudflare Worker runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './lib/orders.mjs';
import { loadProducts, loadSite } from './lib/catalog.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
try { for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const live = !!(process.env.RESEND_API_KEY || process.env.POSTMARK_TOKEN);
const api = createApi({
  env: process.env, products: loadProducts(), site: loadSite(),
  devOutbox: async ({ to, bcc, from, subject, text, attachments }) => {
    const dir = path.join(root, 'outbox'); fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`);
    fs.writeFileSync(base + '.txt', `TO: ${to}\nBCC: ${bcc || ''}\nFROM: ${from}\nSUBJECT: ${subject}\n\n${text}\n`);
    for (const a of attachments) fs.writeFileSync(base + '-' + a.filename, Buffer.from(a.content, 'base64'));
  },
});

const dist = path.join(root, 'dist');
const PORT = Number(process.env.PORT || 4321);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const out = await api.handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(out.status, Object.fromEntries(out.headers)); return res.end(Buffer.from(await out.arrayBuffer()));
    }
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    let file = path.join(dist, p);
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(dist, '404.html'))); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
}).listen(PORT, '0.0.0.0', () => console.log(`Serving dist/ on http://localhost:${PORT} (email: ${live ? 'live provider' : 'dev outbox -> ./outbox'})`));
