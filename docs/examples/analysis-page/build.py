"""Build index.html, a one-page margin review in a consulting layout.

Each exhibit is a Boardplot spec in specs/. The script renders it as inline SVG
for a 720px column and reads the chart's reading. The page text takes its
numbers from the same data and the reading, so text and charts agree.
Run: python3 build.py (needs the boardplot CLI).
"""
import csv, html, json, subprocess
from pathlib import Path

HERE = Path(__file__).parent
THEME = json.loads((HERE.parent / "brand-theme.json").read_text())


def render(name, rows=None, columns=None):
    spec = json.loads((HERE / "specs" / f"{name}.json").read_text())
    spec["options"]["theme"] = THEME
    cmd = ["boardplot", "render", "-", "--width", "720px", "--return", "svg,reading", "--quiet"]
    if rows:
        cmd += ["--rows", str(HERE / "data" / rows), "--columns", columns]
    result = json.loads(subprocess.run(cmd, input=json.dumps(spec), capture_output=True, text=True).stdout)
    if not result["ok"] or result.get("warnings"):
        raise SystemExit(f"{name}: " + json.dumps(result.get("errors") or result["warnings"], indent=2))
    return result["svg"], result["reading"]


def claim(reading, claim_id):
    return next(d["value"] for d in reading["derived"] if d["claimId"] == claim_id)


bridge_svg, bridge = render("margin-bridge", "margin-bridge.csv", "label=driver,value=points,type=kind")
category_svg, _ = render("category-margin")
scatter_svg, _ = render("price-volume")

steps = list(csv.DictReader((HERE / "data" / "margin-bridge.csv").read_text().splitlines()))
start, end = float(steps[0]["points"]), claim(bridge, "wf:total:row-7")
effects = {s["driver"]: float(s["points"]) for s in steps if s["kind"] == "delta"}
cats = {c["category"]: c for c in csv.DictReader((HERE / "data" / "categories.csv").read_text().splitlines())}
revenue = sum(float(c["revenue_q3_eurm"]) for c in cats.values())
apparel = cats["Apparel"]
apparel_drop = float(apparel["gross_margin_pct"]) - float(apparel["gross_margin_py_pct"])
assert round(start + sum(effects.values()), 1) == end, "bridge does not add up"

f = lambda v: f"{v:+.1f}".replace("-", "−")
kpis = [
    ("Gross margin", f"{end:.1f}%", f"{f(end - start)} pts vs Q3 FY25", "bad"),
    ("Revenue", f"€{revenue:.1f}m", "Q3 FY26", ""),
    ("Price effect", f"{f(effects['Price increases'])} pts", "only positive driver", "good"),
    ("Apparel margin", f"{float(apparel['gross_margin_pct']):.1f}%", f"{f(apparel_drop)} pts vs Q3 FY25", "bad"),
]
headline = f"Gross margin fell {start - end:.1f} points to {end:.1f}%: product cost, apparel promotions and mix outran price increases"


def exhibit(number, svg, points):
    items = "".join(f"<li>{html.escape(p)}</li>" for p in points)
    return f"""<section class="exhibit">
  <div class="label">Exhibit {number}</div>
  <div class="row"><figure>{svg}</figure><aside><h3>What it means</h3><ol>{items}</ol></aside></div>
</section>"""


page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q3 FY26 margin review</title>
<style>
:root {{ --navy:#051C2C; --blue:#2251FF; --grey:#5F6B7A; --rule:#D0D7E1; --panel:#F0F3F7; --good:#0E9F5A; --bad:#D9443A; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:#fff; color:var(--navy); font:15px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; }}
main {{ max-width:1120px; margin:0 auto; padding:40px 24px 64px; }}
.tracker {{ color:var(--blue); font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }}
h1 {{ font-size:30px; line-height:1.2; margin:8px 0 24px; max-width:960px; }}
.kpis {{ display:grid; grid-template-columns:repeat(4,1fr); border-top:2px solid var(--navy); border-bottom:1px solid var(--rule); }}
.kpi {{ padding:16px 16px 18px 0; }}
.kpi + .kpi {{ padding-left:16px; border-left:1px solid var(--rule); }}
.kpi b {{ display:block; font-size:30px; line-height:1.1; margin:4px 0; }}
.kpi span {{ font-size:13px; color:var(--grey); }}
.kpi .good {{ color:var(--good); }} .kpi .bad {{ color:var(--bad); }}
.exhibit {{ margin-top:40px; }}
.label {{ font-size:12px; font-weight:700; color:var(--grey); text-transform:uppercase; letter-spacing:.08em; border-bottom:1px solid var(--rule); padding-bottom:6px; }}
.row {{ display:grid; grid-template-columns:minmax(0,720px) 1fr; gap:32px; margin-top:16px; }}
figure {{ margin:0; }} figure svg {{ display:block; width:100%; height:auto; }}
aside {{ background:var(--panel); padding:20px 22px; align-self:start; }}
aside h3 {{ margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.06em; }}
aside ol {{ margin:0; padding-left:20px; }} aside li {{ margin-bottom:10px; }}
.next {{ margin-top:40px; background:var(--navy); color:#fff; padding:24px 28px; }}
.next h2 {{ margin:0 0 12px; font-size:18px; }}
.next table {{ width:100%; border-collapse:collapse; }}
.next td {{ padding:8px 0; border-top:1px solid rgba(255,255,255,.2); vertical-align:top; }}
.next td:last-child {{ color:#AFC3FF; white-space:nowrap; padding-left:24px; }}
footer {{ margin-top:32px; font-size:12px; color:var(--grey); }}
@media (max-width:900px) {{ .row {{ grid-template-columns:1fr; }} .kpis {{ grid-template-columns:repeat(2,1fr); }} .kpi:nth-child(3) {{ border-left:0; padding-left:0; }} h1 {{ font-size:24px; }} }}
</style></head>
<body><main>
<div class="tracker">Alder Outdoor · Q3 FY26 margin review</div>
<h1>{html.escape(headline)}</h1>
<div class="kpis">{"".join(f'<div class="kpi"><span>{k}</span><b class="{c}">{v}</b><span>{s}</span></div>' for k, v, s, c in kpis)}</div>
{exhibit(1, bridge_svg, [
    f"Price increases added {effects['Price increases']:.1f} points, the only positive driver.",
    f"Product cost inflation took {-effects['Product cost inflation']:.1f} points, almost all of the price gain.",
    f"Apparel promotions ({f(effects['Apparel promotions'])}) and channel and product mix ({f(effects['Channel and product mix'])}) explain the rest of the fall.",
])}
{exhibit(2, category_svg, [
    f"Apparel lost {-apparel_drop:.1f} points and is the largest category at €{float(apparel['revenue_q3_eurm']):.1f}m.",
    "Footwear lost 2.0 points: freight and duties hit imported shoes hardest.",
    "Bike packs launched this year at a 44% margin and dilute the mix.",
])}
{exhibit(3, scatter_svg, [
    "Tents, backpacks and footwear raised prices and still sold more units.",
    f"Apparel cut prices by {-float(apparel['price_change_pct']):.1f}% and still sold {-float(apparel['volume_change_pct']):.1f}% fewer units.",
    "Accessories bought volume with lower prices at the highest margin of all categories.",
])}
<section class="next"><h2>Next steps</h2><table>
<tr><td>Stop blanket apparel promotions; keep markdowns for end-of-season stock only</td><td>Apparel lead · Q4</td></tr>
<tr><td>Re-tender footwear freight and move two suppliers to EU ports</td><td>Supply chain · Q1 FY27</td></tr>
<tr><td>Test a further 3% price rise on tents and backpacks in two markets</td><td>Pricing · Q4</td></tr>
</table></section>
<footer>Invented data for a Boardplot example. Each exhibit is a spec in specs/, drawn by build.py. The page text takes its numbers from the same data and the chart reading.</footer>
</main></body></html>
"""
(HERE / "index.html").write_text(page)
print("wrote index.html")
