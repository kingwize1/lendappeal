// Platform-neutral order API (Web standard Request/Response + WebCrypto only).
// Runs unchanged in a Cloudflare Worker (production) and in Node (local dev server).
//   const api = createApi({ env, products, site, devOutbox? });  api.handle(request) -> Response
const enc = new TextEncoder();
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const ctEq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export function createApi({ env = {}, products, site, devOutbox = null }) {
  const allowedOrigin = env.ALLOWED_ORIGIN || '*';
  const isProd = () => env.ENVIRONMENT === 'production';
  const secret = () => env.ORDER_SIGNING_SECRET || (isProd() ? '' : 'dev-only-secret-change-me');
  const catalog = Object.fromEntries(products.filter((p) => p.published || env.PUBLISH_HELD_PRODUCTS === '1').map((p) => [p.id, p]));
  const cors = { 'access-control-allow-origin': allowedOrigin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } });

  async function sign(orderId, total) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${orderId}|${total}`)));
  }
  const hits = new Map();
  const limited = (ip) => { const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < 3600e3); arr.push(now); hits.set(ip, arr); return arr.length > 12; };

  function priceCart(cart) {
    if (!Array.isArray(cart) || !cart.length || cart.length > 40) throw new Error('Your cart is empty or invalid.');
    let total = 0; const lines = [];
    for (const it of cart) {
      const p = catalog[String(it.id)]; const qty = Math.floor(Number(it.qty));
      if (!p || !(qty >= 1 && qty <= 20)) throw new Error('Your cart contains an unavailable product. Please review your cart.');
      lines.push({ id: p.id, name: p.name, qty, unit: p.price, line: p.price * qty }); total += p.price * qty;
    }
    return { lines, total };
  }

  function validate(d) {
    const err = (m) => { throw new Error(m); };
    const s = (v) => String(v ?? '').trim();
    const name = s(d.fullName), phone = s(d.phone).replace(/[^\d+()\-.\s]/g, ''), email = s(d.email), ssn = s(d.ssn).replace(/\D/g, '');
    if (name.split(/\s+/).length < 2 || name.length > 120) err('Please enter your first and last name.');
    if (phone.replace(/\D/g, '').length < 10 || phone.length > 30) err('Please enter a valid phone number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 160) err('Please enter a valid email address.');
    if (ssn.length !== 9 || ['000', '666'].includes(ssn.slice(0, 3)) || ssn[0] === '9' || ssn.slice(3, 5) === '00' || ssn.slice(5) === '0000') err('Please enter a valid 9-digit Social Security number.');
    const a = d.address || {};
    const addr = { street: s(a.street), unit: s(a.unit), city: s(a.city), state: s(a.state).toUpperCase(), zip: s(a.zip) };
    if (addr.street.length < 4 || addr.city.length < 2 || !/^[A-Z]{2}$/.test(addr.state) || !/^\d{5}(-\d{4})?$/.test(addr.zip)) err('Please enter the full address on your credit file.');
    return { name, phone, email, ssn: `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`, addr };
  }

  const addrLine = (d) => `${d.addr.street}${d.addr.unit ? ', ' + d.addr.unit : ''}, ${d.addr.city}, ${d.addr.state} ${d.addr.zip}`;

  function buildOrderEmail({ orderId, priced, d, sig, meta, mode }) {
    const addr = addrLine(d);
    const rows = priced.lines.map((l) => `${l.qty} x ${l.name} @ ${money(l.unit)} = ${money(l.line)}`);
    const text = [
      `NEW ORDER ${orderId}`, `Total: ${money(priced.total)} (payment NOT yet taken at time of this email; payment mode: ${mode})`, '',
      'CUSTOMER', `Full name: ${d.name}`, `Phone: ${d.phone}`, `Email: ${d.email}`, `Social Security number: ${d.ssn}`, `Address on credit file: ${addr}`, '',
      'CART', ...rows, '',
      'SIGNATURE / TERMS', `Typed signature: ${sig.name}`, `Signed at (client clock, ISO): ${sig.signedAt}`, `Received at (server, ISO): ${meta.receivedAt}`,
      `Terms version: ${sig.termsVersion}`, `Terms SHA-256: ${sig.termsHash}`, `Scrolled to end of Terms: ${sig.scrolledToEnd ? 'yes' : 'no'}`, `Consent to collect/transmit personal info (Section 11): ${sig.consent ? 'yes' : 'no'}`,
      `IP: ${meta.ip}`, `User agent: ${meta.ua}`, '', '(Drawn signature image attached as signature.png)',
    ].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2>New order ${esc(orderId)}</h2><p><strong>Total ${money(priced.total)}</strong> &mdash; payment not yet taken when this was sent (mode: ${esc(mode)}).</p>
<h3>Customer</h3><table cellpadding="6" style="border-collapse:collapse" border="1"><tr><td>Full name</td><td>${esc(d.name)}</td></tr><tr><td>Phone</td><td>${esc(d.phone)}</td></tr><tr><td>Email</td><td>${esc(d.email)}</td></tr><tr><td>Social Security number</td><td><strong>${esc(d.ssn)}</strong></td></tr><tr><td>Address on credit file</td><td>${esc(addr)}</td></tr></table>
<h3>Cart</h3><table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th>Qty</th><th>Product</th><th>Unit</th><th>Line</th></tr>${priced.lines.map((l) => `<tr><td>${l.qty}</td><td>${esc(l.name)}</td><td>${money(l.unit)}</td><td>${money(l.line)}</td></tr>`).join('')}<tr><td colspan="3"><strong>Total</strong></td><td><strong>${money(priced.total)}</strong></td></tr></table>
<h3>Signature &amp; Terms</h3><ul><li>Typed signature: ${esc(sig.name)}</li><li>Signed (client clock): ${esc(sig.signedAt)}</li><li>Received (server): ${esc(meta.receivedAt)}</li><li>Terms version: ${esc(sig.termsVersion)}</li><li>Terms SHA-256: <code>${esc(sig.termsHash)}</code></li><li>Scrolled to end of Terms: ${sig.scrolledToEnd ? 'yes' : 'no'}</li><li>Consent (Section 11): ${sig.consent ? 'yes' : 'no'}</li><li>IP: ${esc(meta.ip)}</li><li>User agent: ${esc(meta.ua)}</li></ul><p>Drawn signature attached as <em>signature.png</em>.</p></div>`;
    return { text, html, subject: `New order ${orderId} - ${money(priced.total)} - ${d.name}` };
  }

  // Buyer-facing invoice. Never contains the SSN.
  function buildInvoice({ orderId, priced, d, receivedAt }) {
    const how = env.INVOICE_PAYMENT_INSTRUCTIONS || `To pay, reply to this email (${site.supportEmail}) and we will send secure payment instructions. Your order is processed once payment is received. Please include invoice number ${orderId}.`;
    const date = receivedAt.slice(0, 10);
    const text = [`INVOICE ${orderId}`, `${site.name}`, `Date: ${date}   Terms: due upon receipt`, '', `Bill to: ${d.name} <${d.email}>`, '', ...priced.lines.map((l) => `${l.qty} x ${l.name} @ ${money(l.unit)} = ${money(l.line)}`), '', `TOTAL DUE: ${money(priced.total)}`, '', how, '', 'All sales are final subject to the warranty terms in the Terms of Service you signed. We do not guarantee any score increase, approval or funding result.', `Questions: ${site.supportEmail}`].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#12261d"><h2 style="margin-bottom:0">Invoice ${esc(orderId)}</h2><p style="margin-top:4px;color:#555">${esc(site.name)} &middot; ${esc(date)} &middot; due upon receipt</p><p>Bill to: <strong>${esc(d.name)}</strong> (${esc(d.email)})</p>
<table cellpadding="8" style="border-collapse:collapse;width:100%" border="1"><tr style="background:#12261d;color:#fff"><th align="left">Qty</th><th align="left">Item</th><th align="right">Unit</th><th align="right">Amount</th></tr>${priced.lines.map((l) => `<tr><td>${l.qty}</td><td>${esc(l.name)}</td><td align="right">${money(l.unit)}</td><td align="right">${money(l.line)}</td></tr>`).join('')}<tr><td colspan="3" align="right"><strong>Total due</strong></td><td align="right"><strong>${money(priced.total)}</strong></td></tr></table>
<p><strong>How to pay:</strong> ${esc(how)}</p><p style="font-size:12px;color:#555">All sales are final subject to the warranty terms in the Terms of Service you signed. We do not guarantee any score increase, approval or funding result. Questions: ${esc(site.supportEmail)}</p></div>`;
    return { text, html, subject: `Invoice ${orderId} from ${site.name} - ${money(priced.total)} due` };
  }

  async function sendEmail({ to, bcc, subject, text, html, attachments = [], replyTo }) {
    const from = env.FROM_EMAIL || 'orders@example.com';
    if (env.EMAIL_PROVIDER === 'postmark' && env.POSTMARK_TOKEN) {
      const r = await fetch('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': env.POSTMARK_TOKEN, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ From: from, To: to, Bcc: bcc, Subject: subject, TextBody: text, HtmlBody: html, ReplyTo: replyTo, MessageStream: 'outbound', Attachments: attachments.map((a) => ({ Name: a.filename, Content: a.content, ContentType: a.type })) }) });
      if (!r.ok) throw new Error('postmark ' + r.status + ' ' + (await r.text()));
      return;
    }
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], ...(bcc ? { bcc: [bcc] } : {}), subject, text, html, reply_to: replyTo, attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) }) });
      if (!r.ok) throw new Error('resend ' + r.status + ' ' + (await r.text()));
      return;
    }
    if (devOutbox && !isProd()) { await devOutbox({ to, bcc, from, subject, text, attachments }); return; }
    throw new Error('No email provider configured (set RESEND_API_KEY or POSTMARK_TOKEN).');
  }

  const provider = () => env.PAYMENT_PROVIDER || 'manual';

  async function submitOrder(req) {
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
    const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
    if (limited(ip)) return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    if (isProd() && !secret()) return json({ ok: false, error: 'Server is not configured.' }, 500);
    let body; try { const raw = await req.text(); if (raw.length > 900_000) throw new Error('big'); body = JSON.parse(raw); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    if (body.website) return json({ ok: true, orderId: 'LA-OK', total: 0, token: 'x', paymentMode: 'manual' }); // honeypot
    try {
      const priced = priceCart(body.cart);
      const d = validate(body.details || {});
      const sig = body.signature || {};
      if (!sig.scrolledToEnd || !sig.consent) throw new Error('The Terms must be read to the end and accepted.');
      if (String(sig.name || '').trim().length < 3) throw new Error('A typed signature is required.');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig.image || '') || sig.image.length > 600_000) throw new Error('A drawn signature is required.');
      if (sig.termsVersion !== site.termsVersion) throw new Error('The Terms were updated. Please reload the page and sign again.');
      const orderId = 'LA-' + Date.now().toString(36).toUpperCase() + hex(crypto.getRandomValues(new Uint8Array(2))).toUpperCase();
      const receivedAt = new Date().toISOString();
      const meta = { receivedAt, ip, ua: (req.headers.get('user-agent') || '').slice(0, 200) };
      const sigClean = { name: String(sig.name).trim().slice(0, 120), signedAt: String(sig.signedAt || '').slice(0, 40), termsVersion: sig.termsVersion, termsHash: String(sig.termsHash || '').slice(0, 64), scrolledToEnd: true, consent: true };
      const mode = provider();
      const to = env.ORDER_TO_EMAIL;
      if (!to) throw new Error('ORDER_TO_EMAIL is not configured (provider)');
      const mail = buildOrderEmail({ orderId, priced, d, sig: sigClean, meta, mode });
      // 1) The order (with SSN + signature) MUST reach the owner before anything else happens.
      await sendEmail({ to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: d.email, attachments: [{ filename: 'signature.png', content: sig.image.split(',')[1], type: 'image/png' }] });
      // 2) Manual mode: invoice goes to the buyer automatically, owner is copied. Failure here is non-fatal (owner already has the order).
      let invoiceEmailed = false;
      if (mode === 'manual') {
        const inv = buildInvoice({ orderId, priced, d, receivedAt });
        try { await sendEmail({ to: d.email, bcc: to, subject: inv.subject, text: inv.text, html: inv.html, replyTo: site.supportEmail }); invoiceEmailed = true; }
        catch (e) { console.error('invoice email failed:', e.message); await sendEmail({ to, subject: `ACTION NEEDED: invoice for ${orderId} did not send to ${d.email}`, text: `The automatic invoice email to ${d.email} failed (${e.message}). Please send the invoice manually.\n\n${inv.text}` }).catch(() => {}); }
      }
      return json({ ok: true, orderId, total: priced.total, token: await sign(orderId, priced.total), paymentMode: mode, invoiceEmailed, invoiceTo: d.email });
    } catch (e) {
      const known = /cart|product|name|phone|email address|Social|address|Terms|signature/i.test(e.message) && !/provider|resend|postmark/i.test(e.message);
      console.error('submit-order failed:', e.message);
      return json({ ok: false, error: known ? e.message : 'We could not submit your order right now. Please try again in a few minutes or email ' + site.supportEmail + '.' }, known ? 400 : 502);
    }
  }

  // Only used when PAYMENT_PROVIDER is stripe / redirect / gray. Manual mode needs no call (invoice already sent).
  async function createPayment(req) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const { orderId, token } = b || {}; const total = Number(b?.total);
    if (!orderId || !token || !Number.isFinite(total)) return json({ error: 'Invalid payment request.' }, 400);
    if (!ctEq(String(token), await sign(orderId, total))) return json({ error: 'Payment request could not be verified.' }, 403);
    const mode = provider(); const base = site.siteUrl;
    if (mode === 'stripe' && env.STRIPE_SECRET_KEY) {
      const f = new URLSearchParams({ mode: 'payment', success_url: `${base}/order-complete/?o=${encodeURIComponent(orderId)}`, cancel_url: `${base}/checkout/`, client_reference_id: orderId, 'metadata[orderId]': orderId });
      f.set('line_items[0][price_data][currency]', 'usd'); f.set('line_items[0][price_data][product_data][name]', `${site.name} order ${orderId}`); f.set('line_items[0][price_data][unit_amount]', String(Math.round(total * 100))); f.set('line_items[0][quantity]', '1');
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
      const j = await r.json(); if (!r.ok) { console.error('stripe error', j); return json({ error: 'Payment provider declined to start the session.' }, 502); }
      return json({ mode: 'redirect', url: j.url });
    }
    // HOOK FOR GRAY (gray.co / Gray Merchants) or any hosted payment page: set PAYMENT_PROVIDER=gray (or redirect)
    // and GRAY_PAYMENT_URL (or PAYMENT_REDIRECT_URL) to the hosted-page URL. Placeholders: {orderId} {amount} {amountCents} {email}
    const tpl = mode === 'gray' ? env.GRAY_PAYMENT_URL : mode === 'redirect' ? env.PAYMENT_REDIRECT_URL : '';
    if (tpl) return json({ mode: 'redirect', url: tpl.replace('{orderId}', encodeURIComponent(orderId)).replace('{amountCents}', String(Math.round(total * 100))).replace('{amount}', total.toFixed(2)) });
    return json({ mode: 'manual', message: `Order ${orderId} is recorded and an invoice was emailed to you.` });
  }

  async function handle(req) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (pathname === '/api/submit-order') return submitOrder(req);
    if (pathname === '/api/create-payment') return createPayment(req);
    if (pathname === '/api/health') return json({ ok: true });
    return json({ error: 'Not found' }, 404);
  }
  return { handle, submitOrder, createPayment };
}
