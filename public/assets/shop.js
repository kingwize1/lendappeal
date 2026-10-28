(function () {
  var grid = document.getElementById('grid'); if (!grid) return;
  var cards = Array.prototype.slice.call(grid.children); var original = cards.slice();
  var cat = 'All', q = '';
  var params = new URLSearchParams(location.search);
  if (params.get('cat')) cat = params.get('cat');
  if (params.get('q')) q = params.get('q').toLowerCase();
  function apply() {
    var shown = 0;
    cards.forEach(function (c) { var ok = (cat === 'All' || c.dataset.cat === cat) && (!q || c.dataset.name.indexOf(q) > -1); c.hidden = !ok; if (ok) shown++; });
    document.getElementById('empty').hidden = shown > 0;
    document.querySelectorAll('.chipbtn').forEach(function (b) { var on = b.dataset.cat === cat; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
  }
  document.querySelectorAll('.chipbtn').forEach(function (b) { b.addEventListener('click', function () { cat = b.dataset.cat; apply(); }); });
  document.getElementById('sort').addEventListener('change', function (e) {
    var v = e.target.value, list = original.slice();
    if (v === 'price-asc') list.sort(function (a, b) { return a.dataset.price - b.dataset.price; });
    if (v === 'price-desc') list.sort(function (a, b) { return b.dataset.price - a.dataset.price; });
    if (v === 'name') list.sort(function (a, b) { return a.dataset.name.localeCompare(b.dataset.name); });
    cards = list; list.forEach(function (c) { grid.appendChild(c); });
  });
  apply();
})();
