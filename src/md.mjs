// Tiny dependency-free Markdown renderer (subset used by posts + terms).
export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

export function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/.test(u);
    return `<a href="${u}"${ext ? ' rel="noopener nofollow" target="_blank"' : ''}>${t}</a>`;
  });
  return out;
}

// Returns { html, headings:[{level,text,id}], faq:[{q,a}], answer, text }
export function render(body, { headingIds = true } = {}) {
  const lines = body.replace(/\r/g, '').split('\n');
  const html = [];
  const headings = [];
  const faq = [];
  let answer = '';
  let i = 0;
  let inFaq = false;
  let faqCur = null;
  const plain = [];
  const flushPara = (buf) => {
    if (!buf.length) return;
    const t = buf.join(' ');
    html.push(`<p>${inline(t)}</p>`);
    plain.push(t);
    if (faqCur) faqCur.a.push(t);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      const level = m[1].length; const text = m[2].trim();
      const id = slugify(text);
      if (level === 2) { inFaq = /frequently asked/i.test(text); faqCur = null; }
      if (level === 3 && inFaq) { faqCur = { q: text, a: [] }; faq.push(faqCur); }
      headings.push({ level, text, id });
      html.push(`<h${level}${headingIds ? ` id="${id}"` : ''}>${inline(text)}</h${level}>`);
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      const t = buf.join(' ');
      const isAns = /^\*\*Short answer:?\*\*/.test(t);
      if (isAns && !answer) answer = t.replace(/^\*\*Short answer:?\*\*\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      html.push(`<blockquote class="${isAns ? 'answer' : ''}"${isAns ? ' data-speakable="true"' : ''}><p>${inline(t)}</p></blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && lines[i + 1] && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]); const bodyRows = rows.slice(2).map(cells);
      html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      plain.push(items.join('. '));
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      html.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      plain.push(items.join('. '));
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\||\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
    flushPara(buf);
  }
  return {
    html: html.join('\n'),
    headings,
    faq: faq.map((f) => ({ q: f.q, a: f.a.join(' ') })).filter((f) => f.a),
    answer,
    text: plain.join(' '),
  };
}
