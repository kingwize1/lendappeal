# LendAppeal

A blog-first, SEO/AEO-ready credit-building marketplace. Static pages (fast, crawlable) + two serverless functions for checkout. No framework, no runtime dependencies.

```
npm run dev        # build + serve on http://localhost:4321  (emails go to ./outbox until a provider key is set)
npm run build      # regenerate dist/ (pages, sitemap.xml, robots.txt, llms.txt, RSS)
npm run post       # generate today's blog post, then rebuild
npm run screenshots  # headless-Chrome walkthrough -> screenshots/
node scripts/check-links.mjs   # link + JSON-LD validation of dist/
```

## What is where

| Path | Purpose |
|---|---|
| `data/products.json` | Every product scraped from the Jotform (28 items). `original_price`, `markup`, `price`, full `description_lines`. `published:false` = held back (see below) |
| `scripts/scrape-products.py` | Re-scrapes the Jotform page into `products.json` (`--offline` reuses `form.html`) |
| `data/site.json` | Brand name, legal-name placeholder, support-email placeholder, order email, terms version |
| `content/posts/*.md` | Blog posts (front-matter + Markdown). 5 seeded |
| `content/terms.md` | Rewritten Terms/NDA (placeholders `[Your Business Name LLC]`, `[support@yourdomain.com]`) |
| `src/build.mjs`, `src/md.mjs` | Static generator + tiny Markdown renderer |
| `public/assets/` | CSS, JS (cart, shop filters, checkout), self-hosted fonts |
| `lib/orders.mjs` | Server logic: re-prices cart, validates, emails the order, starts payment |
| `worker/index.mjs`, `worker/wrangler.toml` | Cloudflare Worker wrapper (production order API) |
| `server.mjs` | Local server that mounts the same order API |
| `scripts/generate-post.mjs` | Daily blog generator |
| `workflows-pending/site.yml`, `worker.yml` (move to `.github/workflows/` once the token has the workflow scope) | Build + deploy to GitHub Pages (with daily post); deploy Worker |

## Pricing rule

`price = original + 300` if the original price is **$500 or more**, otherwise `original + 200`. Implemented in `scripts/scrape-products.py` (`markup()`); recorded per product as `original_price`, `markup`, `price`. The server re-prices every cart from `products.json`, so browser-side tampering cannot change what is charged. The $50 "Tradeline Warranty" therefore sells for $250; product text that said "a separate $50 Tradeline Warranty" was rewritten to the new price.

## Source-text edits (descriptions are otherwise verbatim)

* Bare original-price lines (`$99.00`, `💲 Price: $750`) removed; the site shows the marked-up price.
* A stray internal note pasted into the Wells Fargo $11,000 description ("For the Wells Fargo titles, I would absolutely put…") removed; a leading `DESCRIPTION:` label removed.
* Internal/truncated titles fixed: "(DO NOT ORDER UNLESS YOU BEEN TOLD TO)" and "(SPECIAL OFFER FOR )" and "5 Spots Only!" removed from names (the descriptions still say "Only 5 spots available" / "ONLY 2 SPOTS AVAILABLE": **verify inventory or delete those lines**).
* No "Camel Money Gang" text is present anywhere. The source page's payment-instruction block (another person's Chime/Zelle/BTC details) was **not** copied.
* Issuer logos were not copied. Cards use generated neutral illustrations (no trademarks, no hotlinking).

## Held-back products (`published:false`, 7 of 28) - STILL UNLISTED

`1014` (Rental Primary, "Real Credit Profiles or CPNs"), `1288/1016/1137/1476` (Backdated Auto Loan Primaries), `1013` Profile Car Build and `1015` Medical Build Profile ("250+/200+ Public Records", backdated primary). These describe fabricated/backdated account history or CPNs, which is fraud-adjacent (FTC warns on CPNs) and will get the site and any merchant account shut down. They are in `products.json` with a `hold_reason`. To list them anyway: `PUBLISH_HELD_PRODUCTS=1 npm run build` (the owner's call and risk).

## Hosting architecture (GitHub-only front end + free serverless API)

```
GitHub repo (main)
 ├─ GitHub Actions "site.yml"  (on push, daily 11:17 UTC, manual)
 │    1. [daily] scripts/generate-post.mjs  -> Gemini writes post -> commit to content/posts
 │    2. node src/build.mjs                  -> dist/ (pages, sitemap, RSS, llms.txt)
 │    3. deploy to GitHub Pages (HTTPS, optional custom domain)
 └─ GitHub Actions "worker.yml" -> deploys worker/ to Cloudflare Workers (free plan)

Browser (GitHub Pages)  --HTTPS POST-->  Cloudflare Worker  (/api/submit-order, /api/create-payment)
                                           ├─ re-prices the cart from the bundled catalog, validates everything
                                           ├─ Resend API: (1) order + full SSN + signature -> the order mailbox (`ORDER_TO_EMAIL`)
                                           └─ Resend API: (2) invoice -> buyer, BCC the order mailbox (`ORDER_TO_EMAIL`)
```

GitHub Pages is static-only, so the order endpoint cannot live there: the Worker is the "server". It runs the same `lib/orders.mjs` as the local dev server. Pages cannot set response headers; the site ships a CSP `<meta>` and the Worker sets CORS (`ALLOWED_ORIGIN`) so only your site can call it.
**Use a custom domain, or a repo named `<user>.github.io`**: all links are root-relative, so a project-page URL like `user.github.io/repo/` would break them.

## Checkout flow

1. **Terms** in a scroll box; the signature fieldset is `disabled` until the box is scrolled to the end; then type your full name, draw a signature, tick consent, press Sign.
2. **Details form** (only after signing): full name, phone, email, SSN (validated), address on credit file.
3. On submit the Worker re-prices the cart, validates server-side (signature PNG, consent flags, terms version), and **emails the full order including the complete SSN** to `the order mailbox (`ORDER_TO_EMAIL`)` (cart, typed + drawn signature as `signature.png`, timestamps, IP, user-agent, SHA-256 of the Terms). If that email fails the buyer sees an error and nothing proceeds.
4. **Payment = `manual` (current):** an **invoice is emailed to the buyer automatically** (BCC to `the order mailbox (`ORDER_TO_EMAIL`)`; it never contains the SSN) and the page confirms it. If the invoice send fails the owner gets an "ACTION NEEDED" email. Edit the "How to pay" text with `INVOICE_PAYMENT_INSTRUCTIONS`.
5. **Gray hook (later):** set `PAYMENT_PROVIDER=gray` and secret `GRAY_PAYMENT_URL` (hosted-page URL; placeholders `{orderId} {amount} {amountCents}`). The checkout then shows a Pay button that redirects to it (`/api/create-payment`, HMAC-verified), and the invoice step is skipped. `redirect` and `stripe` modes also exist.

Security note (the owner's explicit choice): SSNs are sent in plaintext email. Nothing is stored by the site (no database; the SSN lives in browser memory, the TLS request and the email). Use a dedicated mailbox with 2FA, delete old orders, and consider PGP/S-MIME or a vault link before volume.

## Setup checklist (what you still need)

1. **GitHub**: create the repo, push, Settings > Pages > Source: *GitHub Actions*. Repo **variables**: `SITE_URL`, `API_BASE`, `CUSTOM_DOMAIN`. Repo **secrets**: `LLM_API_KEY` (Gemini), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; optional `TAVILY_API_KEY`, `X_BEARER_TOKEN`. (Workflow files live in `workflows-pending/` until the token has the `workflow` scope (see that folder's README).)
2. **Cloudflare** (free): then `cd worker && npx wrangler secret put RESEND_API_KEY` and `... put ORDER_SIGNING_SECRET`; edit `worker/wrangler.toml` vars (`SITE_URL`, `ALLOWED_ORIGIN`, `FROM_EMAIL`). Set `API_BASE` to the `*.workers.dev` URL.
3. **Resend** (free tier): verify a sending domain; Resend will not send from a Gmail address or to arbitrary recipients from its test sender. Buyer invoices need a verified domain.
4. **Domain** (recommended): for the Pages site, the verified email sender, and trust.
5. **Gemini API key**: create in Google AI Studio, store as the `LLM_API_KEY` repo secret. **Never commit it.**
6. Later: Gray merchant account -> `PAYMENT_PROVIDER=gray`.

## Daily blog job

`workflows-pending/site.yml` (to be copied to `.github/workflows/`) runs `scripts/generate-post.mjs` daily with `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/` and `LLM_MODEL=gemini-2.5-flash`, commits the new post, rebuilds (sitemap, RSS, llms.txt) and redeploys Pages in the same run (commits made by `GITHUB_TOKEN` do not trigger other workflows, so build and deploy are in one workflow). Pipeline: (1) **discover** questions (Google Autocomplete over `content/seeds.json`, X recent search if `X_BEARER_TOKEN`, Reddit best-effort), skipping covered topics; (2) **research** (Tavily/Brave if keyed, DuckDuckGo, plus vetted pages in `content/trusted-sources.json`); (3) **write** under strict accuracy/compliance rules; (4) **guardrails**: front-matter, short-answer box, >=3 FAQ items, >=3 sources that must be among the fetched URLs, word count, banned phrases, then an LLM **fact-check**; failures save to `content/drafts/` instead of publishing; (5) save, rebuild, deploy.
Local test: `npm run post:dry` (discovery only), `node scripts/generate-post.mjs --mock --dry-run`.

## SEO / AEO

Semantic HTML, one H1 per page, canonical + Open Graph + Twitter tags, JSON-LD (Organization, WebSite, Product+Offer, FAQPage, BlogPosting with speakable, BreadcrumbList, ItemList, Blog), `sitemap.xml`, `robots.txt` (AI crawlers allowed; cart/checkout `noindex`), `llms.txt` + `llms-full.txt`, RSS, a "Short answer" box and FAQ on every post, self-hosted fonts, zero third-party scripts, no framework JS.
No reviews or ratings are fabricated; add real `aggregateRating` only when you have real reviews.
