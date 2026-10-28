#!/usr/bin/env node
/**
 * Daily blog generator. Designed to run once a day (cron / GitHub Actions ).
 *
 * Pipeline:  discover trending questions  ->  pick one not yet covered  ->  research sources
 *            ->  LLM writes the post  ->  automated guardrails + fact-check pass  ->  save markdown
 *            ->  rebuild site (sitemap, RSS, llms.txt)  ->  optional deploy hook / git push.
 *
 * Needs:   LLM_API_KEY or GEMINI_API_KEY (default: Gemini OpenAI-compatible endpoint, model gemini-2.5-flash;
 *           override with LLM_BASE_URL / LLM_MODEL for any other OpenAI-compatible API).
 * Optional: X_BEARER_TOKEN (X recent search for intent signals), TAVILY_API_KEY (better source research),
 *           NETLIFY_BUILD_HOOK (redeploy), GIT_PUSH=1 (commit+push so a git-connected host redeploys),
 *           AUTO_PUBLISH=0 (write to content/drafts/ for human review instead of publishing).
 * Flags:   --dry-run (no files written)  --topic "..."  --mock (no network/LLM; writes a labelled stub to drafts)
 *          --discover-only (print ranked topic candidates and exit)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, slugify } from '../src/md.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
// Gemini via its OpenAI-compatible endpoint is the default when only a Gemini/LLM key is present. No key is ever stored in the repo.
if (!process.env.LLM_API_KEY && process.env.GEMINI_API_KEY) process.env.LLM_API_KEY = process.env.GEMINI_API_KEY;
if (process.env.LLM_API_KEY && !process.env.LLM_BASE_URL) process.env.LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
if (process.env.LLM_BASE_URL && /generativelanguage\.googleapis\.com/.test(process.env.LLM_BASE_URL) && !process.env.LLM_MODEL) process.env.LLM_MODEL = 'gemini-2.5-flash';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const arg = (n) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : undefined; };
const DRY = flag('dry-run'), MOCK = flag('mock');
const UA = 'Mozilla/5.0 (compatible; LendAppealBlogBot/1.0)';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const log = (...a) => console.log('[post]', ...a);

const postsDir = path.join(root, 'content/posts');
const draftsDir = path.join(root, 'content/drafts');
const usedFile = path.join(root, 'content/topics-used.json');
const seeds = JSON.parse(fs.readFileSync(path.join(root, 'content/seeds.json'), 'utf8'));
const used = fs.existsSync(usedFile) ? JSON.parse(fs.readFileSync(usedFile, 'utf8')) : [];

const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).map((w) => w.replace(/s$/, '')).filter((w) => w.length > 2 && !['the', 'and', 'for', 'how', 'does', 'what', 'with', 'your', 'you', 'can', 'are', 'why', 'when', 'that', 'this', 'from', 'about', 'should'].includes(w)));
const jaccard = (a, b) => { const A = tokens(a), B = tokens(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
const existing = () => [...fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).map((f) => parseFrontmatter(fs.readFileSync(path.join(postsDir, f), 'utf8')).meta.title), ...used.map((u) => u.topic)].filter(Boolean);
const covered = (topic) => existing().some((t) => jaccard(t, topic) >= 0.5);

async function getJson(url, opts = {}) { const r = await fetch(url, { headers: { 'user-agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000), ...opts }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

// ---------- 1. discovery ----------
async function discover() {
  const cands = new Map(); // topic -> { score, sources:Set }
  const add = (t, w, src) => { t = t.trim().replace(/\s+/g, ' '); if (t.length < 12 || !/(how|does|can|is|what|when|why|should|do|are|will)\b/i.test(t.split(' ')[0] || '')) return; const k = t.toLowerCase(); const c = cands.get(k) || { topic: t, score: 0, sources: new Set() }; c.score += w; c.sources.add(src); cands.set(k, c); };
  // a) Google autocomplete = what people type into search
  const qs = []; for (const s of seeds.queries) for (const p of seeds.prefixes) qs.push(`${p} ${s}`);
  const batch = qs.sort(() => Math.random() - 0.5).slice(0, 40);
  await Promise.allSettled(batch.map(async (q) => { const j = await getJson('https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(q)); (j[1] || []).forEach((s, i) => add(s, 3 - i * 0.2, 'google-suggest')); }));
  // b) X recent search = what people are asking on social (needs X_BEARER_TOKEN)
  if (process.env.X_BEARER_TOKEN) {
    for (const q of seeds.x_queries) {
      try {
        const j = await getJson('https://api.x.com/2/tweets/search/recent?max_results=100&tweet.fields=public_metrics,lang&query=' + encodeURIComponent(q), { headers: { authorization: 'Bearer ' + process.env.X_BEARER_TOKEN } });
        for (const t of j.data || []) { const first = t.text.split(/(?<=[?.!])\s/).find((s) => /\?$/.test(s.trim())); if (first) add(first.replace(/https?:\S+|@\w+/g, '').trim(), 1 + Math.log10(1 + (t.public_metrics?.like_count || 0) + 3 * (t.public_metrics?.reply_count || 0)), 'x'); }
      } catch (e) { log('X search skipped:', e.message); }
    }
  }
  // c) Reddit (often blocked anonymously; best effort)
  for (const sub of ['CRedit', 'personalfinance']) {
    try { const j = await getJson(`https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent('tradeline OR "authorized user" OR "business credit"')}&restrict_sr=1&sort=top&t=week&limit=25`); for (const c of j.data.children) add(c.data.title, 1 + Math.log10(1 + c.data.score), 'reddit'); } catch { /* ignore */ }
  }
  const list = [...cands.values()].map((c) => ({ ...c, sources: [...c.sources], score: c.score + c.sources.size })).filter((c) => !covered(c.topic)).sort((a, b) => b.score - a.score);
  return list;
}

// ---------- 2. research ----------
const stripHtml = (h) => h.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function research(topic) {
  let results = [];
  if (process.env.TAVILY_API_KEY) {
    const j = await getJson('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: topic, max_results: 8, include_raw_content: false }) });
    results = (j.results || []).map((r) => ({ url: r.url, title: r.title, text: r.content }));
  } else {
    if (process.env.BRAVE_API_KEY) {
      const j = await getJson('https://api.search.brave.com/res/v1/web/search?count=8&q=' + encodeURIComponent(topic), { headers: { 'x-subscription-token': process.env.BRAVE_API_KEY, accept: 'application/json' } });
      results = (j.web?.results || []).map((r) => ({ url: r.url, title: r.title, text: '' }));
    }
    const r = results.length ? { ok: false } : await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(topic), { headers: { 'user-agent': UA } }); const h = r.ok === false ? '' : await r.text();
    const urls = [...h.matchAll(/result__a"[^>]*href="[^"]*uddg=([^&"]+)/g)].map((m) => decodeURIComponent(m[1])).filter((u, i, a) => a.indexOf(u) === i).slice(0, 8);
    if (!results.length) results = urls.map((url) => ({ url, title: '', text: '' }));
  }
  // Keyless search is often rate-limited (DuckDuckGo returns a bot challenge), so always top up from vetted authoritative pages.
  if (results.length < 4) {
    const trusted = JSON.parse(fs.readFileSync(path.join(root, 'content/trusted-sources.json'), 'utf8'));
    const t = tokens(topic);
    trusted.map((s) => ({ ...s, hit: [...tokens(s.keywords)].filter((w) => t.has(w)).length })).sort((a, b) => b.hit - a.hit).slice(0, 5).forEach((s) => { if (!results.find((r) => r.url === s.url)) results.push({ url: s.url, title: '', text: '' }); });
  }
  // prefer primary/authoritative sources first
  const rank = (u) => (/(\.gov|fanniemae|freddiemac|fhfa|consumerfinance|myfico|experian|equifax|transunion|dnb\.com|vantagescore|federalreserve|ftc\.gov)/.test(u) ? 0 : 1);
  results.sort((a, b) => rank(a.url) - rank(b.url));
  const out = [];
  for (const r of results.slice(0, 7)) {
    try { const res = await fetch(r.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) }); if (!res.ok || !/html|text/.test(res.headers.get('content-type') || '')) continue; const text = stripHtml(await res.text()).slice(0, 6000); if (text.length > 600) out.push({ url: r.url, title: r.title, text }); } catch { /* skip */ }
    if (out.length >= 5) break;
  }
  return out;
}

// ---------- 3. write ----------
const SYSTEM = `You write educational blog posts for LendAppeal, a credit-building marketplace that sells authorized-user tradelines and business tradelines.
HARD RULES
- Use ONLY facts supported by the SOURCES provided. Do not invent statistics, rules, dates, quotes or URLs. If sources conflict or are thin, say so plainly.
- Never promise or imply guaranteed score increases, approvals or funding. Never give legal or tax advice; suggest a qualified professional where relevant.
- Never recommend or describe CPNs, "backdated" accounts, fabricated public records, credit "privacy numbers", or misrepresenting accounts or income to lenders. If a source mentions these, warn readers away.
- Be accurate about authorized users: the AU is not legally liable for the debt; issuers choose whether and where to report AUs; newer FICO versions weight AU accounts less (per myFICO); manual mortgage underwriting generally excludes AU tradelines (Fannie Mae B3-5.3-06).
- Neutral, helpful tone. At most one soft mention of the marketplace; no hype.
FORMAT (Markdown, exactly this shape)
---
title: <specific, question-led title, <= 70 chars>
slug: <kebab-case>
description: <140-160 chars>
date: ${today}
tags: <3-4 comma-separated tags>
order: 0
---

> **Short answer:** <2-4 sentences that directly answer the question>

## <H2 sections: 4-6, with lists/tables where useful, 900-1300 words total>

## Frequently asked questions

### <Question>
<2-3 sentence answer>
(4-6 questions)

## Sources

- [Readable title (Publisher)](exact URL from SOURCES)
(only URLs from SOURCES; at least 3)`;

async function llm(messages, { json = false } = {}) {
  const base = (process.env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/').replace(/\/$/, '');
  const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.LLM_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.LLM_MODEL || 'gemini-2.5-flash', temperature: 0.3, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }), signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error('LLM ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return (await r.json()).choices[0].message.content;
}

const BANNED = [/guarantee[sd]?\s+(an?\s+)?(approval|score|funding|increase)/i, /\bCPNs?\b(?![^.]*(scam|illegal|avoid|fraud|warn))/i, /back-?dated/i, /bypass/i, /100%\s+(safe|legal|guaranteed)/i, /get(ting)?\s+around\s+(lenders|underwriting)/i];
function check(md, srcUrls) {
  const problems = [];
  const { meta, body } = parseFrontmatter(md);
  for (const k of ['title', 'slug', 'description', 'date', 'tags']) if (!meta[k]) problems.push('missing frontmatter ' + k);
  if (!/^>\s*\*\*Short answer:?\*\*/m.test(body)) problems.push('missing short-answer blockquote');
  const faqQ = (body.split(/## Frequently asked questions/i)[1] || '').split(/## Sources/i)[0].match(/^### /gm) || [];
  if (faqQ.length < 3) problems.push('needs >= 3 FAQ questions');
  const links = [...(body.split(/## Sources/i)[1] || '').matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  if (links.length < 3) problems.push('needs >= 3 source links');
  for (const l of links) if (!srcUrls.has(l)) problems.push('source URL not in provided sources: ' + l);
  const words = body.split(/\s+/).length; if (words < 700 || words > 2400) problems.push('word count ' + words);
  for (const re of BANNED) if (re.test(body)) problems.push('banned phrase ' + re);
  return problems;
}

function mockPost(topic) {
  return `---\ntitle: ${topic.replace(/\?$/, '')}? (MOCK DRAFT)\nslug: mock-${slugify(topic).slice(0, 40)}\ndescription: Mock draft generated without network access to test the daily pipeline end to end.\ndate: ${today}\ntags: mock, pipeline-test\norder: 0\n---\n\n> **Short answer:** This is a mock post used to test the generator. It is never published automatically.\n\n## Section\n\nLorem ipsum placeholder.\n\n## Frequently asked questions\n\n### Is this real?\nNo.\n\n## Sources\n\n- [Example](https://example.com/)\n`;
}

// ---------- main ----------
(async () => {
  let topic = arg('topic');
  let candidates = [];
  if (!topic && !MOCK) {
    candidates = await discover();
    log(`${candidates.length} uncovered candidates; top 8:`); candidates.slice(0, 8).forEach((c) => log(' -', c.score.toFixed(1), c.topic, `[${c.sources.join(',')}]`));
    if (flag('discover-only')) return;
    topic = candidates[0]?.topic;
  }
  if (!topic) { // fallback queue
    const q = JSON.parse(fs.readFileSync(path.join(root, 'content/topic-queue.json'), 'utf8')).topics.filter((t) => !covered(t));
    topic = q[0]; log('using queue topic:', topic);
  }
  if (!topic) { log('No uncovered topic found. Add more to content/topic-queue.json.'); process.exit(3); }
  log('topic:', topic);

  if (MOCK) { const md = mockPost(topic); fs.mkdirSync(draftsDir, { recursive: true }); const f = path.join(draftsDir, `${today}-mock.md`); if (!DRY) fs.writeFileSync(f, md); log('mock draft', DRY ? '(dry run)' : f); return; }
  if (!process.env.LLM_API_KEY) { log('LLM_API_KEY (or GEMINI_API_KEY) is not set. Discovery worked, but I cannot write the post.'); process.exit(2); }

  const sources = await research(topic);
  if (sources.length < 3) { log('Only', sources.length, 'usable sources found; refusing to publish an unsourced post.'); process.exit(4); }
  const srcUrls = new Set(sources.map((s) => s.url));
  const srcBlock = sources.map((s, i) => `SOURCE ${i + 1}: ${s.url}\n${s.text}`).join('\n\n');
  const user = `TOPIC / QUESTION: ${topic}\nSearch/social signals: ${(candidates[0]?.sources || ['manual']).join(', ')}\n\nSOURCES:\n${srcBlock}`;
  let md = await llm([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]);
  md = md.replace(/^```(?:markdown|md)?\n?|```$/g, '').trim();
  let problems = check(md, srcUrls);
  for (let attempt = 0; problems.length && attempt < 2; attempt++) {
    log('revising, problems:', problems);
    md = (await llm([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: md }, { role: 'user', content: 'Fix these problems and return the full corrected post only:\n- ' + problems.join('\n- ') }])).replace(/^```(?:markdown|md)?\n?|```$/g, '').trim();
    problems = check(md, srcUrls);
  }
  // fact-check pass
  let factOk = false;
  if (!problems.length) {
    const fc = JSON.parse(await llm([{ role: 'system', content: 'You are a strict fact-checker. Compare the DRAFT against the SOURCES. Return JSON {"ok":boolean,"unsupported":[strings]} listing any factual claim (numbers, rules, dates, legal statements) not supported by the sources.' }, { role: 'user', content: `DRAFT:\n${md}\n\nSOURCES:\n${srcBlock}` }], { json: true }));
    factOk = !!fc.ok && !(fc.unsupported || []).length;
    if (!factOk) { log('fact-check flagged:', fc.unsupported); problems.push('fact-check: ' + (fc.unsupported || []).join(' | ')); }
  }
  const { meta } = parseFrontmatter(md);
  const slug = slugify(meta.slug || meta.title || topic);
  const publish = problems.length === 0 && process.env.AUTO_PUBLISH !== '0';
  const dir = publish ? postsDir : draftsDir; const file = path.join(dir, `${today}-${slug}.md`);
  if (DRY) { log('dry run; would write', path.relative(root, file), publish ? '(PUBLISH)' : '(DRAFT)'); log(md.slice(0, 600)); return; }
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, md + '\n');
  used.push({ topic, date: today, slug, published: publish, problems }); fs.writeFileSync(usedFile, JSON.stringify(used, null, 2));
  log(publish ? 'published' : 'saved as DRAFT (needs review)', path.relative(root, file));
  if (!publish) process.exit(5);

  execSync('node src/build.mjs', { cwd: root, stdio: 'inherit' });
  if (process.env.GIT_PUSH === '1') { execSync(`git add content && git -c user.name="blog-bot" -c user.email="blog-bot@users.noreply" commit -m "Daily post: ${slug}" && git push`, { cwd: root, stdio: 'inherit' }); }
  if (process.env.NETLIFY_BUILD_HOOK) { const r = await fetch(process.env.NETLIFY_BUILD_HOOK, { method: 'POST' }); log('deploy hook', r.status); }
})().catch((e) => { console.error('[post] failed:', e.message); process.exit(1); });
