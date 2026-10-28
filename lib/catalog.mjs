// Shared by the build and the serverless functions: the authoritative price list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

export function loadProducts({ includeHeld = process.env.PUBLISH_HELD_PRODUCTS === '1' } = {}) {
  const all = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8'));
  return all.filter((p) => p.published || includeHeld);
}
export function loadSite() {
  const s = JSON.parse(fs.readFileSync(path.join(root, 'data/site.json'), 'utf8'));
  if (process.env.SITE_URL) s.siteUrl = process.env.SITE_URL.replace(/\/$/, '');
  return s;
}
