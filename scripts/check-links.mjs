// Verifies every internal href/src in dist/ resolves to a file, and every JSON-LD block parses.
import fs from 'node:fs'; import path from 'node:path';
const dist = new URL('../dist/', import.meta.url).pathname; let bad = 0, pages = 0, ld = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(dist).filter((f) => f.endsWith('.html'))) {
  pages++; const h = fs.readFileSync(f, 'utf8');
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); ld++; } catch (e) { bad++; console.log('BAD JSON-LD in', f); } }
  for (const m of h.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    let p = decodeURIComponent(m[1]); const t = path.join(dist, p.endsWith('/') ? p + 'index.html' : p);
    if (!fs.existsSync(t) && !fs.existsSync(t + '.html')) { bad++; console.log('BROKEN', m[1], 'in', path.relative(dist, f)); }
  }
}
console.log(`${pages} pages, ${ld} JSON-LD blocks, ${bad} problems`); process.exit(bad ? 1 : 0);
