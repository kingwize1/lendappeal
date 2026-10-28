// Headless Chrome walkthrough that saves screenshots and exercises the full checkout against the local server.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4321';
const out = new URL('../screenshots/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 1366, height: 900 });
const shot = async (name, full = true) => { await page.screenshot({ path: out + name + '.png', fullPage: full }); console.log('saved', name); };
const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'networkidle0' }); };

await go('/'); await shot('01-home'); await page.screenshot({ path: out + '01b-home-hero-viewport.png' });
await go('/marketplace/'); await shot('02-marketplace');
await go('/tradelines/2023-chase-10-000-22nd-fast-posting-1540/'); await shot('03-product-page');
await go('/blog/'); await shot('04-blog-index');
await go('/blog/when-do-tradelines-post-statement-dates/'); await shot('05-blog-post'); await page.screenshot({ path: out + '05b-blog-post-viewport.png' });

// cart with several products + quantities
await go('/tradelines/2023-chase-10-000-22nd-fast-posting-1540/');
await page.evaluate(() => { Cart.add('1540', 2); Cart.add('1537', 2); Cart.add('1534', 1); });
await go('/cart/'); await shot('06-cart');

await go('/checkout/'); await shot('07-checkout-step1-locked');
const lockedState = await page.evaluate(() => ({ fieldsetDisabled: document.getElementById('sign-fs').disabled, btnDisabled: document.getElementById('sign-btn').disabled }));
console.log('before scroll', lockedState);
// try to draw while locked (must not leave ink)
const box = await (await page.$('#sig')).boundingBox();
await page.mouse.move(box.x + 30, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 200, box.y + 100); await page.mouse.up();
// scroll terms gradually to bottom
await page.evaluate(async () => { const t = document.getElementById('terms-box'); t.scrollIntoView(); for (let i = 0; i < 40; i++) { t.scrollTop += 120; await new Promise((r) => setTimeout(r, 30)); } });
await new Promise((r) => setTimeout(r, 300));
console.log('after scroll', await page.evaluate(() => ({ fieldsetDisabled: document.getElementById('sign-fs').disabled, status: document.getElementById('scroll-status').textContent })));
await page.type('#sig-name', 'King Wize Example');
const b2 = await (await page.$('#sig')).boundingBox();
await page.mouse.move(b2.x + 40, b2.y + 120); await page.mouse.down();
for (let i = 0; i < 30; i++) await page.mouse.move(b2.x + 40 + i * 14, b2.y + 100 + Math.sin(i / 2) * 40);
await page.mouse.up();
await page.click('#agree');
await page.evaluate(() => document.getElementById('sign-fs').scrollIntoView());
await shot('08-checkout-step1-signed', false);
await page.click('#sign-btn'); await new Promise((r) => setTimeout(r, 400));
await shot('09-checkout-step2-details');
// validation error first
await page.click('#submit-btn'); await new Promise((r) => setTimeout(r, 200)); await shot('10-checkout-step2-validation', false);
await page.type('[name=phone]', '5551234567'); await page.type('[name=email]', 'test.buyer@example.com'); await page.type('[name=ssn]', '123456789');
await page.type('[name=street]', '100 Main St'); await page.type('[name=unit]', 'Apt 4'); await page.type('[name=city]', 'Brooklyn'); await page.type('[name=state]', 'ny'); await page.type('[name=zip]', '11201');
await shot('11-checkout-step2-filled');
await page.click('#submit-btn'); await page.waitForSelector('#step-3:not([hidden])', { timeout: 8000 });
await shot('12-checkout-step3-invoice-sent');
console.log('invoice text:', await page.$eval('#pay-box', (e) => e.innerText.slice(0, 160)));
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await go('/'); await shot('14-home-mobile');
console.log('console/page errors:', errors);
await browser.close();
