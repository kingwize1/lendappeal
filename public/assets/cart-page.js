(function () {
  var root = document.getElementById('cart-root');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    Cart.lines().then(function (lines) {
      if (!lines.length) { root.innerHTML = '<p class="lede">Your cart is empty.</p><p><a class="btn btn-brass" href="/marketplace/">Browse the marketplace</a> <a class="btn btn-ghost" href="/blog/">Read the blog</a></p>'; return; }
      var total = lines.reduce(function (a, l) { return a + l.price * l.qty; }, 0);
      var tl = lines.filter(function (l) { return !/warranty/i.test(l.name); }).reduce(function (a, l) { return a + l.qty; }, 0);
      var wr = lines.filter(function (l) { return /^TRADELINE WARRANTY/i.test(l.name); }).reduce(function (a, l) { return a + l.qty; }, 0);
      root.innerHTML = '<div class="cart-table">' + lines.map(function (l) {
        return '<div class="cart-line"><a href="' + l.url + '"><img src="/assets/img/p-' + l.id + '.svg" alt=""></a><div><a class="nm" href="' + l.url + '">' + esc(l.name) + '</a><div class="muted small">' + Cart.money(l.price) + ' each</div></div>' +
          '<div class="qtyctl" role="group" aria-label="Quantity for ' + esc(l.name) + '"><button type="button" data-dec="' + l.id + '" aria-label="Decrease">&minus;</button><output>' + l.qty + '</output><button type="button" data-inc="' + l.id + '" aria-label="Increase">+</button></div>' +
          '<div><strong class="price" style="font-size:1.25rem">' + Cart.money(l.price * l.qty) + '</strong><br><button class="linkbtn" type="button" data-rm="' + l.id + '">Remove</button></div></div>';
      }).join('') + '</div>' +
        (tl > wr ? '<p class="small muted">Tip: lines marked "Warranty included" are already covered. For other lines, one separate Tradeline Warranty is needed per tradeline you want protected.</p>' : '') +
        '<div class="cart-total"><span class="muted">Subtotal</span><span class="price">' + Cart.money(total) + '</span><a class="btn btn-brass" href="/checkout/">Checkout</a></div><p class="small muted">Next: sign the Terms, enter your credit-file details, then receive your invoice by email. All sales are final.</p>';
    });
  }
  root.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return; var c = Cart.get();
    if (t.dataset.inc) Cart.set(t.dataset.inc, (c[t.dataset.inc] || 0) + 1);
    if (t.dataset.dec) Cart.set(t.dataset.dec, (c[t.dataset.dec] || 0) - 1);
    if (t.dataset.rm) Cart.remove(t.dataset.rm);
  });
  document.addEventListener('cart:changed', render);
  render();
})();
