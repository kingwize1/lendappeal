#!/usr/bin/env python3
"""Scrape every product from the Jotform product list and write data/products.json.

Usage: python3 scripts/scrape-products.py [--offline]   (--offline reuses form.html)
Pricing rule (documented in README): +$300 if original >= $500, else +$200.
"""
import json, re, sys, subprocess, os
from bs4 import BeautifulSoup

URL = "https://form.jotform.com/233397700538057"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "form.html")
if "--offline" not in sys.argv or not os.path.exists(HTML):
    subprocess.run(["curl", "-sL", "-A", "Mozilla/5.0", URL, "-o", HTML], check=True)

soup = BeautifulSoup(open(HTML, encoding="utf-8").read(), "lxml")
CATS = {"non-categorized": "Tradelines", "2002": "Primary Accounts (Auto & Rental)",
        "2004": "Business Tradelines", "2001": "Profile Build Outs"}

def markup(p):  # the pricing rule
    return 300 if p >= 500 else 200

# Title fixes: internal notes / truncated text in the source titles.
TITLE_FIX = {
    "1274": "Business Tradeline — $20,000 Revolving (Creditsafe / D&B / Equifax)",
    "1275": "Business Tradeline — Net 60 $85,000 (Creditsafe / D&B / Equifax)",
    "1476": "125K Auto Loan Primary",
    "1509": "2000 Discover $35,000 (5th)",
    "1511": "🔥 ELITE APPROVAL STACK — 3 Tradelines, FAST POSTING",
}
HOLD = {
    "1014": "Description says 'Real Credit Profiles or CPNs' and 'Backdated' - CPNs are an FTC-flagged scam category.",
    "1288": "'Backdated' auto-loan primary: fabricates account history on a credit file.",
    "1016": "'Backdated' auto-loan primary: fabricates account history on a credit file.",
    "1137": "'Backdated' auto-loan primary: fabricates account history on a credit file.",
    "1476": "'Backdated' auto-loan primary: fabricates account history on a credit file.",
    "1013": "'Public Records' back-end build + backdated primary: fabricated file contents.",
    "1015": "'Public Records' back-end build + backdated primary: fabricated file contents.",
}
KIND = {"1537": "addon", "1511": "package"}

def clean_lines(pid, lines, new_warranty_price):
    out = []
    for l in lines:
        l = re.sub(r"\s+", " ", l).strip()
        if l.startswith("For the Wells Fargo titles"):   # stray internal note in source
            continue
        if re.fullmatch(r"\$\d[\d,]*\.\d\d", l):          # bare original-price line
            continue
        if l.startswith("💲 Price:"):
            continue
        if l == "DESCRIPTION:":
            continue
        l = l.replace("A separate $50 Tradeline Warranty", f"A separate ${new_warranty_price} Tradeline Warranty")
        l = re.sub(r"(?i)camel\s*money\s*gang", "", l)
        out.append(l)
    # collapse repeated blank lines / trim
    res, prev_blank = [], True
    for l in out:
        if not l:
            if prev_blank: continue
            prev_blank = True
        else:
            prev_blank = False
        res.append(l)
    while res and not res[-1]: res.pop()
    return res

def slugify(s):
    s = re.sub(r"[^\x00-\x7f]", "", s)
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s

ISSUERS = ["Chase", "Citi", "Wells Fargo", "Navy Federal", "NFCU", "Discover", "AMEX", "TD Bank", "Bloomingdale", "Home Depot", "Tractor Supply"]
products = []
orig_warranty = None
for it in soup.select("span.form-product-item"):
    if it["pid"] == "1537":
        orig_warranty = float(it.select_one("[id$=_price]").get_text().replace(",", ""))
new_warranty = int(orig_warranty + markup(orig_warranty))

for it in soup.select("span.form-product-item"):
    pid = it["pid"]
    raw_name = it.select_one(".form-product-name").get_text(strip=True)
    orig = float(it.select_one("[id$=_price]").get_text().replace(",", ""))
    lines = [p.get_text() for p in it.select(".payment-jot-editor p")]
    name = TITLE_FIX.get(pid, raw_name)
    name = re.sub(r"\s+", " ", name).strip()
    desc = clean_lines(pid, lines, new_warranty)
    text = " ".join(desc) + " " + raw_name
    cat = CATS[it["categories"]]
    kind = KIND.get(pid) or {"Primary Accounts (Auto & Rental)": "primary", "Business Tradelines": "business",
                             "Profile Build Outs": "build"}.get(cat, "tradeline")
    m_limit = re.search(r"\$(\d[\d,]*)(?:K)?\s*(?:revolving|high|limit|mega|tradeline|\()", name, re.I)
    limit = None
    m = re.search(r"\$([\d,]+)", name)
    if m and kind in ("tradeline",): limit = int(m.group(1).replace(",", ""))
    year = re.match(r"(20\d\d)\s", name)
    stmt = re.search(r"\((\d+)(?:st|nd|rd|th)\)", name, re.I)
    warranty = bool(re.search(r"warranty (?:is )?included|warranty included", text, re.I)) and "Warranty is not included" not in text
    issuer = next((i for i in ISSUERS if i.lower() in name.lower()), None)
    if issuer == "NFCU": issuer = "Navy Federal"
    if issuer in ("Bloomingdale", "Tractor Supply", "Home Depot"): issuer = "Citi"
    facts = []
    if limit: facts.append(f"${limit:,} limit")
    if year: facts.append(f"Opened {year.group(1)}")
    if stmt:
        n = int(stmt.group(1)); v = n % 100
        suf = "th" if 11 <= v <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
        facts.append(f"Statement date: {n}{suf}")
    if warranty: facts.append("Warranty included")
    mk = markup(orig)
    p = dict(
        id=pid, slug=f"{slugify(re.sub(r'(?i)warranty included','',name))}-{pid}",
        name=name, source_name=raw_name, category=cat, kind=kind, issuer=issuer,
        limit=limit, opened=int(year.group(1)) if year else None,
        statement_day=int(stmt.group(1)) if stmt else None,
        warranty_included=warranty, facts=facts,
        original_price=orig, markup=mk, price=int(orig + mk),
        description_lines=desc,
        published=pid not in HOLD,
    )
    if pid in HOLD: p["hold_reason"] = HOLD[pid]
    products.append(p)

json.dump(products, open(os.path.join(ROOT, "data/products.json"), "w"), indent=2, ensure_ascii=False)
print(len(products), "products;", sum(p["published"] for p in products), "published")
for p in products:
    print(f'{p["id"]:>5} {"" if p["published"] else "HELD ":5} ${p["original_price"]:>7.0f} -> ${p["price"]:>5}  {p["name"][:70]}')
