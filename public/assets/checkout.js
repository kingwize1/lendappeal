/* Checkout: (1) scroll Terms -> sign, (2) details form -> emailed to the order mailbox, (3) payment.
   Sensitive values live only in memory; only the cart is persisted client-side. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var apiMeta = document.querySelector('meta[name=api-base]'); var API = (apiMeta && apiMeta.content) || '';
  var state = { lines: [], total: 0, signed: null, order: null, scrolled: false, busy: false };
  var termsBox = $('#terms-box'), fs = $('#sign-fs'), nameIn = $('#sig-name'), agree = $('#agree'), signBtn = $('#sign-btn'), canvas = $('#sig');
  var ctx = canvas.getContext('2d'), drawing = false, hasInk = false, last = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- summary ---- */
  function renderSummary() {
    var el = $('#summary');
    el.innerHTML = state.lines.map(function (l) { return '<div class="sum-line"><span>' + esc(l.name) + ' &times; ' + l.qty + '</span><strong>' + Cart.money(l.price * l.qty) + '</strong></div>'; }).join('') +
      '<div class="sum-total"><span>Total</span><span>' + Cart.money(state.total) + '</span></div><p class="small muted"><a href="/cart/">Edit cart</a></p>';
  }
  function setStep(n) {
    [1, 2, 3].forEach(function (i) { $('#step-' + i).hidden = i !== n; });
    document.querySelectorAll('#stepper li').forEach(function (li) { var s = +li.dataset.step; li.classList.toggle('is-active', s === n); li.classList.toggle('is-done', s < n); if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    var h = $('#h-step' + n); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); }
  }

  /* ---- 1a. scroll gate ---- */
  function checkScroll() {
    var max = termsBox.scrollHeight - termsBox.clientHeight;
    var pct = max <= 0 ? 100 : Math.min(100, Math.round(termsBox.scrollTop / max * 100));
    $('#scrollbar').style.width = pct + '%';
    if (!state.scrolled && (max <= 0 || termsBox.scrollTop >= max - 4)) {
      state.scrolled = true; fs.disabled = false; syncSign();
      var s = $('#scroll-status'); s.textContent = 'Thank you. You can now sign below.'; s.classList.add('ok');
    }
  }
  termsBox.addEventListener('scroll', checkScroll, { passive: true });

  /* ---- 1b. signature pad ---- */
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; }
  function begin(e) { if (fs.disabled) return; e.preventDefault(); canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 6.3); ctx.fill(); }
  function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; hasInk = true; syncSign(); }
  function end() { drawing = false; }
  ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#12261d'; ctx.fillStyle = '#12261d';
  canvas.addEventListener('pointerdown', begin); canvas.addEventListener('pointermove', move); window.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  $('#sig-clear').addEventListener('click', function () { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; syncSign(); });
  function syncSign() { signBtn.disabled = !(state.scrolled && hasInk && nameIn.value.trim().length >= 3 && agree.checked); }
  nameIn.addEventListener('input', syncSign); agree.addEventListener('change', syncSign);
  signBtn.addEventListener('click', function () {
    if (signBtn.disabled) return;
    var off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height; var o = off.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, off.width, off.height); o.drawImage(canvas, 0, 0);
    state.signed = { name: nameIn.value.trim(), image: off.toDataURL('image/png'), signedAt: new Date().toISOString(), termsVersion: termsBox.dataset.termsVersion, termsHash: termsBox.dataset.termsHash, scrolledToEnd: true, consent: agree.checked };
    var f = document.querySelector('#details [name=fullName]'); if (f && !f.value) f.value = state.signed.name;
    setStep(2);
  });

  /* ---- 2. details ---- */
  var form = $('#details'), ssn = form.elements.ssn;
  ssn.addEventListener('input', function () { var d = ssn.value.replace(/\D/g, '').slice(0, 9); ssn.value = d.length > 5 ? d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5) : d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d; });
  function validSSN(v) { var d = v.replace(/\D/g, ''); if (d.length !== 9) return false; var a = d.slice(0, 3), g = d.slice(3, 5), s = d.slice(5); return a !== '000' && a !== '666' && a[0] !== '9' && g !== '00' && s !== '0000'; }
  function validate() {
    var e = form.elements, errs = [];
    function bad(el, m) { el.classList.add('invalid'); errs.push(m); }
    ['fullName', 'phone', 'email', 'ssn', 'street', 'city', 'state', 'zip'].forEach(function (n) { e[n].classList.remove('invalid'); });
    if (e.fullName.value.trim().split(/\s+/).length < 2) bad(e.fullName, 'Enter your first and last name.');
    if (e.phone.value.replace(/\D/g, '').length < 10) bad(e.phone, 'Enter a 10-digit phone number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e.email.value.trim())) bad(e.email, 'Enter a valid email address.');
    if (!validSSN(e.ssn.value)) bad(e.ssn, 'Enter a valid 9-digit Social Security number.');
    if (e.street.value.trim().length < 4) bad(e.street, 'Enter the street address on your credit file.');
    if (e.city.value.trim().length < 2) bad(e.city, 'Enter the city.');
    if (!/^[A-Za-z]{2}$/.test(e.state.value.trim())) bad(e.state, 'Enter the 2-letter state.');
    if (!/^\d{5}(-\d{4})?$/.test(e.zip.value.trim())) bad(e.zip, 'Enter a 5-digit ZIP code.');
    return errs;
  }
  form.addEventListener('input', function (ev) { ev.target.classList.remove('invalid'); $('#form-error').hidden = true; });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault(); if (state.busy) return;
    var err = $('#form-error'); err.hidden = true;
    var errs = validate(); if (errs.length) { err.textContent = errs[0]; err.hidden = false; form.querySelector('.invalid').focus(); return; }
    if (!state.signed) { setStep(1); return; }
    state.busy = true; var btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'Sending securely…';
    var e = form.elements;
    var payload = {
      cart: state.lines.map(function (l) { return { id: l.id, qty: l.qty }; }),
      signature: state.signed,
      details: { fullName: e.fullName.value.trim(), phone: e.phone.value.trim(), email: e.email.value.trim(), ssn: e.ssn.value.trim(), address: { street: e.street.value.trim(), unit: e.unit.value.trim(), city: e.city.value.trim(), state: e.state.value.trim().toUpperCase(), zip: e.zip.value.trim() } },
      website: e.website.value
    };
    fetch(API + '/api/submit-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.ok) throw new Error(res.j && res.j.error || 'We could not submit your order. Please try again.');
        state.order = res.j; state.busy = false;
        $('#order-ok').textContent = 'Your signed Terms and details were received. Order ' + res.j.orderId + '.';
        if (res.j.paymentMode === 'manual') renderInvoice(); else renderPay();
        setStep(3);
      })
      .catch(function (x) { state.busy = false; btn.disabled = false; btn.textContent = 'Submit order'; err.textContent = x.message; err.hidden = false; });
  });

  /* ---- 3a. manual mode: invoice was emailed automatically ---- */
  function renderInvoice() {
    var o = state.order;
    $('#pay-box').innerHTML = '<div class="pay-card"><p><strong>Invoice ' + esc(o.orderId) + ' &middot; ' + Cart.money(o.total) + ' due</strong></p>' +
      (o.invoiceEmailed ? '<p>We emailed your invoice to <strong>' + esc(o.invoiceTo) + '</strong>. It lists your items, the total and how to pay. Check your spam folder if you do not see it within a few minutes.</p>'
        : '<p>Your order is recorded. We could not send the invoice email automatically, so we will email it to <strong>' + esc(o.invoiceTo) + '</strong> shortly.</p>') +
      '<p class="muted small">Your order is processed once payment is received.</p><p><a class="btn btn-brass" href="/blog/">Read the blog while you wait</a></p></div>';
    try { Cart.clear(); } catch (e) {}
  }

  /* ---- 3b. hosted payment (stripe / gray / redirect) ---- */
  function renderPay() {
    $('#pay-box').innerHTML = '<div class="pay-card"><p><strong>Amount due: ' + Cart.money(state.order.total) + '</strong></p><p class="muted small">You will be taken to our payment processor to complete payment. Card details are never stored on this site.</p><button class="btn btn-brass" type="button" id="pay-btn">Pay ' + Cart.money(state.order.total) + '</button><p id="pay-msg" class="status" role="status"></p></div>';
    $('#pay-btn').addEventListener('click', function () {
      var b = this; b.disabled = true; var m = $('#pay-msg'); m.textContent = 'Preparing payment…';
      fetch(API + '/api/create-payment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: state.order.orderId, token: state.order.token, total: state.order.total }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.mode === 'redirect' && j.url) { m.textContent = 'Redirecting to secure payment…'; window.location.href = j.url; return; }
          if (j.mode === 'manual') { m.className = 'status ok'; m.innerHTML = esc(j.message || 'Payment instructions will be emailed to you.'); try { Cart.clear(); } catch (e) {} return; }
          throw new Error(j.error || 'Payment could not be started.');
        })
        .catch(function (x) { b.disabled = false; m.className = 'status'; m.textContent = x.message; });
    });
  }

  /* ---- boot ---- */
  Cart.lines().then(function (lines) {
    state.lines = lines; state.total = lines.reduce(function (a, l) { return a + l.price * l.qty; }, 0);
    if (!lines.length) { document.querySelector('.co-grid').innerHTML = '<div><p class="lede">Your cart is empty.</p><a class="btn btn-brass" href="/marketplace/">Browse the marketplace</a></div>'; document.getElementById('stepper').hidden = true; return; }
    renderSummary(); checkScroll();
  });
})();
