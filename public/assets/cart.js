/* Cart store (localStorage) + add-to-cart buttons + header count. No dependencies. */
(function () {
  var KEY = 'wcm_cart';
  var catalogPromise = null;
  function read() { try { var c = JSON.parse(localStorage.getItem(KEY) || '{}'); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; } }
  function write(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} update(); document.dispatchEvent(new CustomEvent('cart:changed')); }
  function count(c) { return Object.values(c).reduce(function (a, b) { return a + b; }, 0); }
  function update() { var n = count(read()); document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = n; el.setAttribute('data-n', n); }); }
  window.Cart = {
    get: read,
    add: function (id, qty) { var c = read(); c[id] = Math.min(20, (c[id] || 0) + (qty || 1)); write(c); },
    set: function (id, qty) { var c = read(); if (qty <= 0) delete c[id]; else c[id] = Math.min(20, qty); write(c); },
    remove: function (id) { var c = read(); delete c[id]; write(c); },
    clear: function () { write({}); },
    count: function () { return count(read()); },
    catalog: function () { return catalogPromise || (catalogPromise = fetch('/assets/catalog.json').then(function (r) { return r.json(); })); },
    lines: function () { var c = read(); return this.catalog().then(function (cat) { var out = []; Object.keys(c).forEach(function (id) { if (cat[id]) out.push({ id: id, qty: c[id], name: cat[id].n, price: cat[id].p, url: cat[id].u }); }); return out; }); },
    money: function (n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  };
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#12261d;color:#f3ecdc;padding:14px 20px;border:2px solid #c99a3b;z-index:50;font:600 .95rem Inter,sans-serif;display:none'; document.body.appendChild(t); }
    t.innerHTML = msg + ' <a href="/cart/" style="color:#e9c779;margin-left:10px">View cart</a>'; t.style.display = 'block';
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b) return;
    var q = 1; var sel = b.getAttribute('data-qty-from'); if (sel) { var el = document.querySelector(sel); q = Math.max(1, parseInt(el && el.value, 10) || 1); }
    window.Cart.add(b.getAttribute('data-add'), q); toast('Added to cart');
  });
  document.addEventListener('DOMContentLoaded', update);
  window.addEventListener('storage', update);
})();
