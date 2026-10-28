#!/usr/bin/env node
// Static site generator: data/products.json + content/posts/*.md  ->  dist/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { esc, inline, render, parseFrontmatter, slugify } from './md.mjs';
import { loadProducts, loadSite } from '../lib/catalog.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
const site = loadSite();
const products = loadProducts();
const API_BASE = (process.env.API_BASE || '').replace(/\/$/, '');
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const cleanName = (n) => n.replace(/[🔥🏆🛡️]\uFE0F?/gu, '').replace(/\s+/g, ' ').replace(/\s*—\s*$/, '').replace(/\s+—\s+(?=—)/, '').trim();
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const abs = (p) => site.siteUrl + p;
const write = (rel, data) => { const f = path.join(dist, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const ordinal = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); };
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// ---------- content ----------
const faqs = JSON.parse(fs.readFileSync(path.join(root, 'content/faq.json'), 'utf8'));
const termsMd = fs.readFileSync(path.join(root, 'content/terms.md'), 'utf8');
const terms = render(termsMd.replace(/^# .*\n/, ''), { headingIds: true });
const termsHash = crypto.createHash('sha256').update(terms.text).digest('hex');

const postsDir = path.join(root, 'content/posts');
const posts = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).map((f) => {
  const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(postsDir, f), 'utf8'));
  const r = render(body);
  const words = r.text.split(/\s+/).length;
  return {
    ...meta, file: f, slug: meta.slug || slugify(meta.title), tags: (meta.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    order: Number(meta.order || 0), updated: meta.updated || meta.date, html: r.html, headings: r.headings.filter((h) => h.level === 2),
    faq: r.faq, answer: r.answer, words, minutes: Math.max(1, Math.round(words / 220)),
  };
}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order));

// ---------- design bits ----------
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${esc(site.name)}"><rect width="48" height="48" fill="#12261d"/><rect x="9" y="27" width="7" height="12" fill="#c99a3b"/><rect x="20.5" y="19" width="7" height="20" fill="#c99a3b"/><rect x="32" y="9" width="7" height="30" fill="#e9c779"/><rect x="7" y="41" width="34" height="2" fill="#f3ecdc"/></svg>`;

const ISSUER_TINT = { Chase: ['#1d3557', '#2b5a8f'], Citi: ['#1b3b5a', '#3a6c9a'], 'Wells Fargo': ['#5b1e26', '#8d3140'], 'Navy Federal': ['#16273f', '#2f4a73'], Discover: ['#4a2a12', '#a8601f'], AMEX: ['#2c3b3a', '#6d8582'], 'TD Bank': ['#18402b', '#2f7a50'] };
function cardArt(p) {
  const [c1, c2] = ISSUER_TINT[p.issuer] || ['#12261d', '#2d5240'];
  const label = p.kind === 'package' ? 'APPROVAL STACK' : p.kind === 'addon' ? 'WARRANTY' : p.kind === 'business' ? 'BUSINESS' : (p.issuer || 'TRADELINE').toUpperCase();
  const lim = p.limit ? money(p.limit) : p.kind === 'business' ? (p.name.match(/\$[\d,]+/) || [''])[0] : '';
  const stamp = p.statement_day ? `<g transform="translate(300 28)"><circle r="23" fill="none" stroke="#e9c779" stroke-width="1.5"/><text y="-2" text-anchor="middle" font-family="Georgia,serif" font-size="19" font-weight="700" fill="#f3ecdc">${p.statement_day}</text><text y="12" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" letter-spacing="1.2" fill="#e9c779">STMT</text></g>` : '';
  if (p.kind === 'addon') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 214" role="img" aria-label="Warranty"><rect width="340" height="214" fill="#f3ecdc"/><rect x="1" y="1" width="338" height="212" fill="none" stroke="#c99a3b" stroke-width="2"/><path d="M170 40l58 20v44c0 36-24 62-58 74-34-12-58-38-58-74V60z" fill="#12261d"/><path d="M143 108l19 19 37-40" fill="none" stroke="#e9c779" stroke-width="9"/><text x="170" y="196" text-anchor="middle" font-family="Georgia,serif" font-size="14" letter-spacing="3" fill="#12261d">REPLACEMENT WARRANTY</text></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 214" role="img" aria-label="${esc(label)} tradeline card illustration"><defs><linearGradient id="g${p.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="340" height="214" fill="url(#g${p.id})"/><g stroke="#ffffff" stroke-opacity=".07">${Array.from({ length: 12 }, (_, k) => `<line x1="0" y1="${k * 20 + 6}" x2="340" y2="${k * 20 + 6}"/>`).join('')}</g><rect x="24" y="62" width="40" height="30" fill="#e9c779"/><path d="M24 77h40M44 62v30" stroke="#a97c24"/><text x="24" y="38" font-family="Georgia,serif" font-size="17" font-weight="700" letter-spacing="3" fill="#f3ecdc">${esc(label)}</text>${stamp}<text x="24" y="150" font-family="Courier New,monospace" font-size="17" letter-spacing="4" fill="#f3ecdc" fill-opacity=".85">•••• •••• •••• ••••</text><text x="24" y="190" font-family="Georgia,serif" font-size="${lim ? 26 : 15}" font-weight="700" fill="#e9c779">${esc(lim || 'AUTHORIZED USER')}</text><text x="316" y="190" text-anchor="end" font-family="Arial,sans-serif" font-size="9" letter-spacing="1.5" fill="#f3ecdc" fill-opacity=".7">${p.opened ? 'OPENED ' + p.opened : 'REPORTING ONLY'}</text></svg>`;
}

// ---------- layout ----------
const orgLd = { '@context': 'https://schema.org', '@type': 'Organization', '@id': abs('/#org'), name: site.name, url: abs('/'), logo: abs('/assets/img/logo.svg'), description: site.description, email: site.supportEmail.startsWith('[') ? undefined : site.supportEmail };
const siteLd = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': abs('/#website'), url: abs('/'), name: site.name, publisher: { '@id': abs('/#org') }, potentialAction: { '@type': 'SearchAction', target: abs('/marketplace/') + '?q={search_term_string}', 'query-input': 'required name=search_term_string' } };
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

function layout({ title, desc, path: p, body, jsonld = [], noindex = false, ogType = 'website', bodyClass = '', scripts = [], preload = [] }) {
  const url = abs(p);
  const fullTitle = title.includes(site.shortName) ? title : `${title} | ${site.shortName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta name="theme-color" content="#12261d">
<meta name="api-base" content="${esc(API_BASE)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ${API_BASE}; base-uri 'self'; form-action 'self'">
<link rel="icon" href="/assets/img/logo.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)} blog" href="/blog/feed.xml">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs('/assets/img/og.svg')}">
<meta property="og:locale" content="${site.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="preload" href="/assets/fonts/fraunces-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/style.css">
${[orgLd, siteLd, ...jsonld].map(ld).join('\n')}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<div class="utility"><div class="wrap"><span>Order at least <strong>3 business days</strong> before a line's statement date to make that cycle.</span><span class="util-r"><a href="/faq/">FAQ</a><a href="/terms/">Terms</a></span></div></div>
<header class="masthead">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="${esc(site.name)} home"><img src="/assets/img/logo.svg" width="36" height="36" alt=""><span>${esc(site.name)}</span></a>
    <nav aria-label="Primary" class="nav">
      <a href="/blog/">Blog</a><a href="/marketplace/">Marketplace</a><a href="/faq/">FAQ</a>
      <a class="cart-link" href="/cart/" aria-label="Cart"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-8H6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/></svg><span>Cart</span><b data-cart-count>0</b></a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <div><a class="brand brand-foot" href="/"><img src="/assets/img/logo.svg" width="32" height="32" alt=""><span>${esc(site.name)}</span></a><p class="muted">${esc(site.tagline)}</p><p class="muted small">Operated by ${esc(site.legalName)}. Support: ${esc(site.supportEmail)}</p></div>
    <nav aria-label="Marketplace"><h2>Marketplace</h2><a href="/marketplace/">All products</a><a href="/marketplace/?cat=Tradelines">Tradelines</a><a href="/marketplace/?cat=Business+Tradelines">Business tradelines</a><a href="/cart/">Cart</a></nav>
    <nav aria-label="Learn"><h2>Learn</h2><a href="/blog/">Blog</a>${posts.slice(0, 3).map((x) => `<a href="/blog/${x.slug}/">${esc(x.title.split(':')[0])}</a>`).join('')}<a href="/faq/">FAQ</a></nav>
    <nav aria-label="Legal"><h2>Legal</h2><a href="/terms/">Terms &amp; NDA</a><a href="/privacy/">Privacy</a><a href="/llms.txt">llms.txt</a><a href="/sitemap.xml">Sitemap</a></nav>
  </div>
  <div class="wrap small muted disclosure"><p>We do not guarantee credit approvals, score increases or funding results. Tradelines are for reporting purposes only. Educational content is not legal or financial advice. All sales are final subject to the warranty terms in our <a href="/terms/">Terms of Service</a>.</p><p>&copy; ${new Date().getFullYear()} ${esc(site.legalName)}</p></div>
</footer>
<script src="/assets/cart.js" defer></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
</body>
</html>`;
}

const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: abs(it[1]) })) });
const crumbHtml = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((it, i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(it[0])}</span>` : `<a href="${it[1]}">${esc(it[0])}</a>`}</li>`).join('')}</ol></nav>`;
const faqLd = (list) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: list.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
const faqHtml = (list) => `<div class="faq">${list.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;

// ---------- product cards ----------
const shortFacts = (p) => p.facts.length ? p.facts : (p.kind === 'business' ? ['Reports to business bureaus'] : p.kind === 'package' ? ['3 tradelines', 'Warranty included'] : []);
function productCard(p) {
  return `<article class="pcard" data-id="${p.id}" data-cat="${esc(p.category)}" data-price="${p.price}" data-name="${esc(p.name.toLowerCase())}">
  <a class="pcard-art" href="/tradelines/${p.slug}/" tabindex="-1" aria-hidden="true"><img src="/assets/img/p-${p.id}.svg" width="340" height="214" loading="lazy" alt=""></a>
  <div class="pcard-body">
    <p class="eyebrow">${esc(p.category)}</p>
    <h3><a href="/tradelines/${p.slug}/">${esc(p.name)}</a></h3>
    <ul class="chips">${shortFacts(p).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <div class="pcard-foot"><p class="price"><span class="sr">Price </span>${money(p.price)}</p><button class="btn btn-brass" type="button" data-add="${p.id}">Add to cart</button></div>
  </div>
</article>`;
}

function descHtml(p) {
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(`<ul class="checks">${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`); list = []; } };
  for (const l of p.description_lines) {
    if (!l) { flush(); continue; }
    if (/^(✅|✔|🛡️?\s*(60|POSTING|FULL|WARRANTY))/u.test(l) && !/^🛡️ (POSTING GUARANTEED:|FULL REPLACEMENT WARRANTY:|WARRANTY INCLUDED:)/u.test(l)) list.push(l);
    else { flush(); out.push(`<p>${esc(l)}</p>`); }
  }
  flush();
  return out.join('\n');
}

// ---------- pages ----------
const latest = posts.slice(0, 3);
const featured = [...products].filter((p) => ['1540', '1534', '1283', '1547', '1511', '1274'].includes(p.id)).sort((a, b) => a.price - b.price);
const postCard = (x, big = false) => `<article class="post-card${big ? ' post-card-lead' : ''}">
  <p class="eyebrow"><time datetime="${x.date}">${fmtDate(x.date)}</time> · ${x.minutes} min read</p>
  <h3><a href="/blog/${x.slug}/">${esc(x.title)}</a></h3>
  <p>${esc(x.description)}</p>
  <p class="tags">${x.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
</article>`;

// Home
const homeFaq = faqs.slice(0, 6);
write('index.html', layout({
  title: `${site.name}: Credit-Building Tradelines and Expert Guides`,
  desc: site.description, path: '/', bodyClass: 'home', jsonld: [faqLd(homeFaq)],
  body: `
<section class="hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    <p class="eyebrow">Credit knowledge first. Tradelines second.</p>
    <h1>Build credit with your eyes open.</h1>
    <p class="lede">A new guide every day on the questions people actually ask about tradelines, statement dates and business credit, plus a marketplace of seasoned authorized-user lines, Amex lines and business tradelines with the full details up front.</p>
    <div class="cta-row"><a class="btn btn-brass" href="/blog/">Read the blog</a><a class="btn btn-ghost" href="/marketplace/">Browse ${products.length} products</a></div>
    <ul class="proof"><li><strong>${products.length}</strong> products listed</li><li><strong>1-15</strong> business days to post after the statement date</li><li><strong>1</strong> checkout for the whole cart</li></ul>
  </div>
  <aside class="ledger" aria-label="Latest from the blog">
    <p class="ledger-h">Latest entries</p>
    <ol>${posts.slice(0, 5).map((x) => `<li><a href="/blog/${x.slug}/"><span class="l-date">${new Date(x.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span><span class="l-title">${esc(x.title.split(':')[0])}</span><span class="l-min">${x.minutes}m</span></a></li>`).join('')}</ol>
    <a class="ledger-more" href="/blog/">All guides &rarr;</a>
  </aside>
</div></section>

<section class="section"><div class="wrap">
  <div class="sec-head"><h2>Today's reading</h2><a href="/blog/">View all posts</a></div>
  <div class="post-grid">${latest.map((x, i) => postCard(x, i === 0)).join('')}</div>
</div></section>

<section class="section tinted"><div class="wrap">
  <div class="sec-head"><h2>Featured on the marketplace</h2><a href="/marketplace/">See every product</a></div>
  <div class="pgrid">${featured.map(productCard).join('')}</div>
</div></section>

<section class="section"><div class="wrap steps-wrap">
  <h2>How an order works</h2>
  <ol class="steps">
    <li><h3>Pick your lines</h3><p>Check the statement date on each product. Order at least 3 business days before it to make that cycle.</p></li>
    <li><h3>Read and sign the Terms</h3><p>Scroll the full Terms and NDA, then type your name and sign. Signing unlocks only after you reach the end.</p></li>
    <li><h3>Enter your credit-file details</h3><p>Name, phone, email, Social Security number and the address on your credit file, sent over an encrypted connection.</p></li>
    <li><h3>Get your invoice, then wait for posting</h3><p>Your invoice is emailed to you automatically. Lines typically post ${esc(site.postingWindow)}. Verify on all three bureau reports.</p></li>
  </ol>
</div></section>

<section class="section tinted"><div class="wrap narrow">
  <h2>Common questions</h2>
  ${faqHtml(homeFaq)}
  <p><a href="/faq/">More questions answered</a></p>
</div></section>`,
}));

// Marketplace
const cats = [...new Set(products.map((p) => p.category))];
write('marketplace/index.html', layout({
  title: 'Tradeline Marketplace: Seasoned, Amex and Business Tradelines', path: '/marketplace/',
  desc: `Shop ${products.length} tradelines with full descriptions: seasoned bank lines, Amex lines, high-limit lines, packages and business tradelines. Add several to one cart and check out once.`,
  jsonld: [crumbs([['Home', '/'], ['Marketplace', '/marketplace/']]), { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`/tradelines/${p.slug}/`), name: p.name })) }],
  scripts: ['/assets/shop.js'],
  body: `<div class="wrap page-head">${crumbHtml([['Home', '/'], ['Marketplace', '/marketplace/']])}<h1>Marketplace</h1><p class="lede">Every listing shows the statement date, limit and warranty status. Quantities and multiple products check out together.</p>
<div class="toolbar"><div class="chipset" role="group" aria-label="Filter by category"><button type="button" class="chipbtn is-on" data-cat="All" aria-pressed="true">All (${products.length})</button>${cats.map((c) => `<button type="button" class="chipbtn" data-cat="${esc(c)}" aria-pressed="false">${esc(c)} (${products.filter((p) => p.category === c).length})</button>`).join('')}</div>
<label class="sortbox">Sort <select id="sort"><option value="default">Featured order</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option></select></label></div></div>
<div class="wrap"><div class="pgrid" id="grid">${products.map(productCard).join('')}</div><p id="empty" class="muted" hidden>No products match that filter.</p></div>`,
}));

// Product pages + art
for (const p of products) {
  write(`assets/img/p-${p.id}.svg`, cardArt(p));
  const pfaq = [
    { q: `When will this ${p.kind === 'addon' ? 'warranty' : 'tradeline'} post?`, a: p.kind === 'addon' ? 'The warranty covers a verified non-posting within the standard posting window of 1-15 business days after the statement date. Non-posting must be reported by email within 16 business days after the statement date.' : `Tradelines typically post within 1-15 business days after the statement date${p.statement_day ? ` (the ${ordinal(p.statement_day)})` : ''}. Order at least 3 business days before the statement date to make that cycle. Posting to all three bureaus is not guaranteed.` },
    { q: 'Will this raise my credit score?', a: 'We do not guarantee a score increase, approval or funding result. Results depend on your complete credit profile.' },
    { q: 'Is a warranty included?', a: p.warranty_included ? 'Yes. A warranty is included. A verified non-posting qualifies for one replacement of equal or lesser value, subject to the Terms of Service.' : 'A warranty is not included unless the description says so. A separate Tradeline Warranty is available, and one warranty is needed for each tradeline you want protected.' },
  ];
  const related = products.filter((x) => x.id !== p.id && x.category === p.category).slice(0, 3);
  const prodLd = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': abs(`/tradelines/${p.slug}/#product`), name: cleanName(p.name), sku: p.id,
    description: p.description_lines.filter(Boolean).slice(0, 4).join(' ').replace(/\s+/g, ' ').slice(0, 300), image: abs(`/assets/img/p-${p.id}.svg`), category: p.category, brand: { '@type': 'Organization', name: site.name },
    offers: { '@type': 'Offer', url: abs(`/tradelines/${p.slug}/`), priceCurrency: site.currency, price: String(p.price), availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition', seller: { '@id': abs('/#org') } },
  };
  const clean = cleanName(p.name);
  write(`tradelines/${p.slug}/index.html`, layout({
    title: clean, path: `/tradelines/${p.slug}/`, ogType: 'product',
    desc: `${clean}: ${shortFacts(p).join(', ')}. ${money(p.price)}. Add to cart and check out with other products in one order.`.slice(0, 300),
    jsonld: [prodLd, faqLd(pfaq), crumbs([['Home', '/'], ['Marketplace', '/marketplace/'], [clean, `/tradelines/${p.slug}/`]])],
    body: `<div class="wrap product">${crumbHtml([['Home', '/'], ['Marketplace', '/marketplace/'], [clean, `/tradelines/${p.slug}/`]])}
<div class="product-grid">
  <div class="product-media"><img src="/assets/img/p-${p.id}.svg" width="340" height="214" alt="${esc(clean)} illustration"></div>
  <div class="product-buy">
    <p class="eyebrow">${esc(p.category)}</p>
    <h1>${esc(p.name)}</h1>
    <ul class="chips">${shortFacts(p).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="price price-xl">${money(p.price)}</p>
    <div class="buy-row"><label class="qty">Qty <input type="number" min="1" max="20" value="1" inputmode="numeric" id="qty" aria-label="Quantity"></label><button class="btn btn-brass" type="button" data-add="${p.id}" data-qty-from="#qty">Add to cart</button><a class="btn btn-ghost" href="/cart/">View cart</a></div>
    <p class="small muted">All sales final. Results are not guaranteed. <a href="/terms/">Read the Terms</a>.</p>
  </div>
</div>
<section class="prose"><h2>Full description</h2>${descHtml(p)}</section>
<section class="prose"><h2>Questions about this product</h2>${faqHtml(pfaq)}</section>
<section><h2>Related reading</h2><div class="post-grid">${posts.slice(0, 2).map((x) => postCard(x)).join('')}</div></section>
${related.length ? `<section><h2>More in ${esc(p.category)}</h2><div class="pgrid">${related.map(productCard).join('')}</div></section>` : ''}
</div>`,
  }));
}

// Blog index
write('blog/index.html', layout({
  title: 'Credit Building Blog: Tradelines, Statement Dates and Business Credit', path: '/blog/',
  desc: 'Daily, source-linked answers to the questions people ask about tradelines, authorized users, statement dates, FICO and VantageScore changes, and business credit.',
  jsonld: [crumbs([['Home', '/'], ['Blog', '/blog/']]), { '@context': 'https://schema.org', '@type': 'Blog', '@id': abs('/blog/#blog'), name: `${site.name} Blog`, url: abs('/blog/'), publisher: { '@id': abs('/#org') }, blogPost: posts.slice(0, 20).map((x) => ({ '@type': 'BlogPosting', headline: x.title, url: abs(`/blog/${x.slug}/`), datePublished: x.date })) }],
  body: `<div class="wrap page-head">${crumbHtml([['Home', '/'], ['Blog', '/blog/']])}<h1>The credit-building blog</h1><p class="lede">A new post every day, built from what people are asking in search and on social media. Every claim links to its source.</p></div>
<div class="wrap"><div class="post-grid post-grid-index">${posts.map((x, i) => postCard(x, i === 0)).join('')}</div>
<p class="small muted">Subscribe via <a href="/blog/feed.xml">RSS</a>.</p></div>`,
}));

// Blog posts
for (const x of posts) {
  const idx = posts.indexOf(x);
  const more = posts.filter((y) => y !== x).slice(0, 3);
  const ldPost = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', '@id': abs(`/blog/${x.slug}/#post`), headline: x.title, description: x.description,
    datePublished: x.date, dateModified: x.updated, mainEntityOfPage: abs(`/blog/${x.slug}/`), image: abs('/assets/img/og.svg'), wordCount: x.words, keywords: x.tags.join(', '),
    author: { '@type': 'Organization', name: site.name, url: abs('/') }, publisher: { '@id': abs('/#org') }, inLanguage: 'en-US',
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['blockquote.answer', 'h1'] },
  };
  write(`blog/${x.slug}/index.html`, layout({
    title: x.title, desc: x.description, path: `/blog/${x.slug}/`, ogType: 'article',
    jsonld: [ldPost, ...(x.faq.length ? [faqLd(x.faq)] : []), crumbs([['Home', '/'], ['Blog', '/blog/'], [x.title, `/blog/${x.slug}/`]])],
    body: `<article class="wrap article">
${crumbHtml([['Home', '/'], ['Blog', '/blog/'], [x.title.split(':')[0], `/blog/${x.slug}/`]])}
<header class="article-head"><p class="eyebrow"><time datetime="${x.date}">${fmtDate(x.date)}</time>${x.updated !== x.date ? ` · Updated <time datetime="${x.updated}">${fmtDate(x.updated)}</time>` : ''} · ${x.minutes} min read</p><h1>${esc(x.title)}</h1><p class="lede">${esc(x.description)}</p></header>
<div class="article-grid">
  <aside class="toc" aria-label="On this page"><p>On this page</p><ol>${x.headings.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></aside>
  <div class="prose">${x.html}
    <div class="callout"><h2>Ready to compare lines?</h2><p>Browse seasoned, Amex and business tradelines with the statement date, limit and warranty status on every listing.</p><a class="btn btn-brass" href="/marketplace/">Browse the marketplace</a></div>
    <p class="small muted">Editorial note: ${esc(site.name)} sells tradelines. This article is educational, not legal or financial advice, and no outcome is guaranteed.</p>
  </div>
</div>
${more.length ? `<section class="more"><h2>Keep reading</h2><div class="post-grid">${more.map((y) => postCard(y)).join('')}</div></section>` : ''}
</article>`,
  }));
}

// RSS
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(site.name)} Blog</title><link>${abs('/blog/')}</link><description>${esc(site.description)}</description><language>en-us</language><atom:link href="${abs('/blog/feed.xml')}" rel="self" type="application/rss+xml"/>
${posts.slice(0, 30).map((x) => `<item><title>${esc(x.title)}</title><link>${abs(`/blog/${x.slug}/`)}</link><guid isPermaLink="true">${abs(`/blog/${x.slug}/`)}</guid><pubDate>${new Date(x.date + 'T12:00:00Z').toUTCString()}</pubDate><description>${esc(x.description)}</description></item>`).join('\n')}
</channel></rss>`;
write('blog/feed.xml', rss);

// FAQ
write('faq/index.html', layout({
  title: 'Tradeline FAQ: Posting, Warranty, Terms and Checkout', path: '/faq/',
  desc: 'Answers to common questions about tradelines, authorized users, posting times, warranty, refunds, why we collect your Social Security number, and how checkout works.',
  jsonld: [faqLd(faqs), crumbs([['Home', '/'], ['FAQ', '/faq/']])],
  body: `<div class="wrap narrow page-head">${crumbHtml([['Home', '/'], ['FAQ', '/faq/']])}<h1>Frequently asked questions</h1>${faqHtml(faqs)}<p>Still stuck? Email ${esc(site.supportEmail)}. Questions on social media or messaging apps are not answered.</p></div>`,
}));

// Terms (full page + reused in checkout)
const termsHtml = terms.html;
write('terms/index.html', layout({
  title: 'Terms of Service and NDA', path: '/terms/', desc: `Terms of Service and Non-Disclosure Agreement for tradeline orders with ${site.legalName}, including consent to collect and transmit personal information.`,
  jsonld: [crumbs([['Home', '/'], ['Terms', '/terms/']])],
  body: `<div class="wrap narrow page-head">${crumbHtml([['Home', '/'], ['Terms', '/terms/']])}<h1>Terms of Service and Non-Disclosure Agreement for Tradeline Orders</h1><p class="small muted">Version ${site.termsVersion}</p><div class="prose terms">${termsHtml}</div></div>`,
}));

// Privacy
write('privacy/index.html', layout({
  title: 'Privacy Policy', path: '/privacy/', desc: 'How we collect, use and transmit the personal information you submit when you place a tradeline order.',
  jsonld: [crumbs([['Home', '/'], ['Privacy', '/privacy/']])],
  body: `<div class="wrap narrow page-head">${crumbHtml([['Home', '/'], ['Privacy', '/privacy/']])}<h1>Privacy Policy</h1><div class="prose">
<p>This policy explains what ${esc(site.legalName)} collects when you use ${esc(site.name)} and why.</p>
<h2>What we collect</h2><ul><li>Order details: the products and quantities in your cart.</li><li>Order form: full name, phone number, email address, Social Security number and the address on your credit file.</li><li>Electronic signature: your typed name, drawn signature image, the Terms version you viewed, the date and time, IP address and browser type.</li></ul>
<h2>Why we collect it</h2><p>To process and fulfill your order, verify your identity, communicate about the order, prevent fraud and meet legal obligations. Card issuers and credit bureaus need your Social Security number and credit-file address to match an authorized user to a file.</p>
<h2>How it is sent and who sees it</h2><p>Your information is sent over an encrypted HTTPS connection to our order function and delivered by email to our order-processing mailbox. We share it with card issuers, primary account holders and service providers only as needed to fulfill your order. We do not sell it.</p>
<h2>Your choices</h2><p>Email ${esc(site.supportEmail)} to request access, correction or deletion, subject to records we must keep by law.</p>
<h2>Invoices and payment</h2><p>After you submit an order we email you an invoice. Payment is made through the instructions on the invoice or through our payment processor's hosted page. Card details are never stored on this website.</p>
<h2>Changes</h2><p>We will post updates here. Last updated ${fmtDate(BUILD_DATE)}.</p></div></div>`,
}));

// Cart
write('cart/index.html', layout({
  title: 'Your Cart', path: '/cart/', desc: 'Review products and quantities before you check out.', noindex: true, bodyClass: 'cart-page', scripts: ['/assets/cart-page.js'],
  body: `<div class="wrap page-head"><h1>Your cart</h1><div id="cart-root" aria-live="polite"><p class="muted">Loading your cart…</p></div><noscript><p>JavaScript is required for the cart and checkout.</p></noscript></div>`,
}));

// Checkout
write('checkout/index.html', layout({
  title: 'Checkout', path: '/checkout/', desc: 'Sign the Terms, enter your credit-file details and receive your invoice.', noindex: true, bodyClass: 'checkout-page', scripts: ['/assets/checkout.js'],
  body: `<div class="wrap page-head"><h1>Checkout</h1>
<ol class="stepper" id="stepper" aria-label="Checkout progress"><li class="is-active" data-step="1"><span>1</span> Terms &amp; signature</li><li data-step="2"><span>2</span> Your details</li><li data-step="3"><span>3</span> Invoice &amp; payment</li></ol>
<div class="co-grid">
<div class="co-main">
<section id="step-1" class="co-step" aria-labelledby="h-step1">
  <h2 id="h-step1">Read the Terms, then sign</h2>
  <p class="muted">Scroll to the very end of the Terms below. The signature pad stays locked until you do.</p>
  <div class="scrollprog" aria-hidden="true"><i id="scrollbar"></i></div>
  <div id="terms-box" class="terms-box prose terms" tabindex="0" role="region" aria-label="Terms of Service and NDA, scrollable" data-terms-version="${site.termsVersion}" data-terms-hash="${termsHash}">${termsHtml}</div>
  <p id="scroll-status" class="status" role="status">Scroll to the end of the Terms to unlock signing.</p>
  <fieldset id="sign-fs" class="sign" disabled>
    <legend>Sign</legend>
    <label class="field"><span>Type your full legal name</span><input id="sig-name" type="text" autocomplete="name" minlength="3" required></label>
    <div class="field"><span id="sig-lbl">Draw your signature</span>
      <div class="sigpad"><canvas id="sig" width="640" height="200" aria-labelledby="sig-lbl" aria-describedby="sig-help"></canvas><span class="sig-x" aria-hidden="true">&times;</span></div>
      <p id="sig-help" class="small muted">Use your mouse, finger or stylus.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="sig-clear">Clear</button></div>
    <label class="check"><input id="agree" type="checkbox"> <span>I have read the Terms and NDA, including Section 11 (consent to collect and transmit my personal information, including my Social Security number) and Section 8 (all sales are final).</span></label>
    <button type="button" class="btn btn-brass" id="sign-btn" disabled>Sign and continue</button>
  </fieldset>
</section>

<section id="step-2" class="co-step" hidden aria-labelledby="h-step2">
  <h2 id="h-step2">Your details</h2>
  <p class="muted">Enter the information exactly as it appears on your credit reports. This is sent to us over an encrypted connection before payment.</p>
  <form id="details" novalidate autocomplete="on">
    <div class="hp" aria-hidden="true"><label>Leave blank <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <label class="field"><span>Full name</span><input name="fullName" type="text" autocomplete="name" required></label>
    <div class="row2"><label class="field"><span>Phone number</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" required></label>
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label></div>
    <label class="field"><span>Social Security number</span><input name="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="123-45-6789" maxlength="11" required><small>Used to match you to your credit file and added to the authorized-user account.</small></label>
    <fieldset class="addr"><legend>Address on your credit file</legend>
      <label class="field"><span>Street address</span><input name="street" type="text" autocomplete="address-line1" required></label>
      <label class="field"><span>Apt / unit (optional)</span><input name="unit" type="text" autocomplete="address-line2"></label>
      <div class="row3"><label class="field"><span>City</span><input name="city" type="text" autocomplete="address-level2" required></label>
      <label class="field"><span>State</span><input name="state" type="text" autocomplete="address-level1" maxlength="2" placeholder="NY" required></label>
      <label class="field"><span>ZIP</span><input name="zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="10" required></label></div>
    </fieldset>
    <p id="form-error" class="error" role="alert" hidden></p>
    <button type="submit" class="btn btn-brass" id="submit-btn">Submit order</button>
  </form>
</section>

<section id="step-3" class="co-step" hidden aria-labelledby="h-step3">
  <h2 id="h-step3">Invoice &amp; payment</h2>
  <p class="status ok" id="order-ok" role="status"></p>
  <div id="pay-box"></div>
</section>
</div>
<aside class="co-side" aria-label="Order summary"><h2>Order summary</h2><div id="summary"></div></aside>
</div></div>`,
}));

write('order-complete/index.html', layout({
  title: 'Order received', path: '/order-complete/', desc: 'Your order information was received.', noindex: true, scripts: [],
  body: `<div class="wrap narrow page-head"><h1>Thank you. Your order was received.</h1><p class="lede">We have your signed Terms and order details. Watch your email for confirmation and next steps. Lines typically post ${esc(site.postingWindow)}.</p><p><a class="btn btn-brass" href="/blog/">Read the blog while you wait</a></p></div><script>try{localStorage.removeItem('wcm_cart')}catch(e){}</script>`,
}));

write('404.html', layout({ title: 'Page not found', path: '/404.html', desc: 'That page does not exist.', noindex: true, body: `<div class="wrap narrow page-head"><h1>Page not found</h1><p><a href="/">Go home</a> or <a href="/blog/">read the blog</a>.</p></div>` }));

// ---------- machine-readable ----------
const urls = [
  ['/', BUILD_DATE, 'daily', '1.0'], ['/blog/', posts[0]?.date || BUILD_DATE, 'daily', '0.9'], ['/marketplace/', BUILD_DATE, 'weekly', '0.9'], ['/faq/', BUILD_DATE, 'monthly', '0.6'], ['/terms/', BUILD_DATE, 'yearly', '0.3'], ['/privacy/', BUILD_DATE, 'yearly', '0.2'],
  ...posts.map((x) => [`/blog/${x.slug}/`, x.updated, 'monthly', '0.8']),
  ...products.map((p) => [`/tradelines/${p.slug}/`, BUILD_DATE, 'weekly', '0.7']),
];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, f, pr]) => `<url><loc>${abs(u)}</loc><lastmod>${d}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /cart/\nDisallow: /checkout/\nDisallow: /order-complete/\nDisallow: /api/\n\n# AI answer engines are welcome to index and cite public pages.\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\nUser-agent: CCBot\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('llms.txt', `# ${site.name}\n\n> ${site.description}\n\nThis site publishes a daily educational blog about tradelines, authorized users, statement dates and business credit, and runs a marketplace selling tradelines. Prices are in USD. No score, approval or funding outcome is guaranteed.\n\n## Blog\n${posts.map((x) => `- [${x.title}](${abs(`/blog/${x.slug}/`)}): ${x.description}`).join('\n')}\n\n## Marketplace\n- [All products](${abs('/marketplace/')}): ${products.length} listings with full descriptions\n${products.map((p) => `- [${cleanName(p.name)}](${abs(`/tradelines/${p.slug}/`)}): ${money(p.price)}`).join('\n')}\n\n## Policies\n- [FAQ](${abs('/faq/')})\n- [Terms of Service and NDA](${abs('/terms/')})\n- [Privacy](${abs('/privacy/')})\n`);
write('llms-full.txt', `# ${site.name} - full text\n\n${posts.map((x) => `## ${x.title}\nURL: ${abs(`/blog/${x.slug}/`)}\nPublished: ${x.date}\n\n${x.answer ? 'Short answer: ' + x.answer + '\n\n' : ''}${x.html.replace(/<h[1-4][^>]*>/g, '\n### ').replace(/<\/(p|li|h[1-4]|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}`).join('\n\n---\n\n')}\n\n## FAQ\n${faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n')}\n`);
write('assets/catalog.json', JSON.stringify(Object.fromEntries(products.map((p) => [p.id, { n: p.name, p: p.price, u: `/tradelines/${p.slug}/`, c: p.category, k: p.kind, w: p.warranty_included }]))));
write('assets/img/logo.svg', logoSvg);
write('assets/img/og.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f3ecdc"/><rect x="48" y="48" width="1104" height="534" fill="none" stroke="#12261d" stroke-width="3"/><g transform="translate(96 96) scale(2.2)">${logoSvg.replace(/<svg[^>]*>|<\/svg>/g, '')}</g><text x="96" y="330" font-family="Georgia,serif" font-size="76" font-weight="700" fill="#12261d">Build credit with</text><text x="96" y="420" font-family="Georgia,serif" font-size="76" font-weight="700" fill="#12261d">your eyes open.</text><text x="96" y="510" font-family="Arial,sans-serif" font-size="30" fill="#8a6418">${esc(site.name)} - tradelines and daily guides</text></svg>`);

// copy static
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }
copyDir(path.join(root, 'public'), dist);
write('.nojekyll', '');
if (process.env.CUSTOM_DOMAIN) write('CNAME', process.env.CUSTOM_DOMAIN.trim() + '\n');
console.log(`built: ${products.length} products, ${posts.length} posts -> ${path.relative(process.cwd(), dist) || dist}`);
