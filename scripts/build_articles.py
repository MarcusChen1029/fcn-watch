"""Builds learn/<slug>/index.html, learn/index.html and sitemap.xml from scripts/articles.py.

    python scripts/build_articles.py
"""
import html
import json
from datetime import date
from pathlib import Path

from articles import ARTICLES

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://marcuschen1029.github.io/fcn-watch/"
TODAY = date.today().isoformat()


def page(title, description, canonical, body, depth, ld):
    up = "../" * depth
    return f"""<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}｜FCN 監控</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:type" content="article">
<link rel="stylesheet" href="{up}styles.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="{up}">FCN 監控</a>
  <a class="navlink" href="{up}learn/">FCN 教學</a>
  <span class="tag">免費追蹤你持有的 FCN 離 KO、KI 多遠</span>
</div></header>
<main class="wrap">
{body}
</main>
<footer class="wrap foot"><p>本站內容為一般性說明與數學試算，不構成任何投資建議或要約；實際條款、KO/KI 判定、配息與交割以發行機構文件為準。</p></footer>
</body>
</html>
"""


def cta(up):
    return f"""<aside class="panel cta"><h2>你手上的 FCN 現在離 KI 多遠？</h2>
<p>輸入條件一次，之後每次打開都用最新收盤價計算每檔標的距離 KO、KI 的幅度、已領配息和接股試算。免費、不用註冊，資料只存在你的瀏覽器。</p>
<p><a class="button primary" href="{up}">打開 FCN 監控</a></p></aside>"""


def build():
    out = ROOT / "learn"
    links = []
    for a in ARTICLES:
        url = f"{SITE}learn/{a['slug']}/"
        faq_html = "".join(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(ans)}</p></details>"
                           for q, ans in a["faq"])
        others = "".join(f'<li><a href="../{b["slug"]}/">{html.escape(b["h1"])}</a></li>'
                         for b in ARTICLES if b is not a)
        body = f"""<article class="panel prose article">
<p class="crumb"><a href="../../">FCN 監控</a> › <a href="../">FCN 教學</a></p>
<h1>{html.escape(a['h1'])}</h1>
{a['body']}
<h2>常見問題</h2>
{faq_html}
</article>
{cta('../../')}
<nav class="panel"><h2>其他 FCN 教學</h2><ul>{others}</ul></nav>"""
        ld = [
            {"@context": "https://schema.org", "@type": "Article", "headline": a["title"],
             "description": a["description"], "inLanguage": "zh-TW", "dateModified": TODAY,
             "mainEntityOfPage": url},
            {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": ans}}
                for q, ans in a["faq"]]},
        ]
        d = out / a["slug"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(a["title"], a["description"], url, body, 2, ld), encoding="utf-8")
        links.append((a, url))

    items = "".join(f'<li><a href="{a["slug"]}/"><b>{html.escape(a["h1"])}</b></a><br><span class="hint">'
                    f'{html.escape(a["description"])}</span></li>' for a, _ in links)
    body = f"""<section class="hero"><h1>FCN 教學</h1>
<p>KO、KI、履約價、接股、配息，每篇都附實際數字的試算範例。</p></section>
<section class="panel"><ul class="toc">{items}</ul></section>
{cta('../')}"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "FCN 教學", "inLanguage": "zh-TW"}
    (out / "index.html").write_text(
        page("FCN 教學：KO、KI、接股與配息一次看懂", "FCN 結構型商品教學：KO、KI、記憶型 KO、接股與配息的算法，每篇附試算範例。",
             f"{SITE}learn/", body, 1, ld), encoding="utf-8")

    urls = [SITE, f"{SITE}learn/"] + [u for _, u in links]
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc><lastmod>{TODAY}</lastmod></url>\n" for u in urls)
        + "</urlset>\n", encoding="utf-8")
    print(f"built {len(links)} articles + index; sitemap has {len(urls)} urls")


if __name__ == "__main__":
    build()
