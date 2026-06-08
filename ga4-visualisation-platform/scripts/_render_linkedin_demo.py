"""One-shot renderer for the LinkedIn weekly report demo, mirroring the v2 Agent 6 design.
Produces a self-contained HTML at reports/2026-05-21_175919_linkedin-traffic-weekly-v2.html.
Not part of the production pipeline — purely a visualisation-design proof.
"""
import html
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "reports" / "2026-05-21_175919_linkedin-traffic-weekly-v2.html"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = "#1f4e79"
S1, S2, S3 = "#1f4e79", "#5b9bd5", "#c7522a"

weeks = [
    {"w":"W09","range":"Feb 23-Mar 1","na_s":801,"na_a":2577,"eu_s":26,"eu_a":119,"la_s":11,"la_a":83,"note":"", "peak":False,"partial":False,"warn":None},
    {"w":"W10","range":"Mar 2-8",     "na_s":666,"na_a":1772,"eu_s":20,"eu_a":48, "la_s":12,"la_a":70,"note":"", "peak":False,"partial":False,"warn":None},
    {"w":"W11","range":"Mar 9-15",    "na_s":666,"na_a":2215,"eu_s":298,"eu_a":1566,"la_s":33,"la_a":203,"note":"", "peak":True, "partial":False,"warn":None},
    {"w":"W12","range":"Mar 16-22",   "na_s":183,"na_a":1338,"eu_s":121,"eu_a":812,"la_s":14,"la_a":114,"note":"■ Mar 20-21","peak":False,"partial":False,"warn":"Tracking issues on Mar 20-21."},
    {"w":"W13","range":"Mar 23-29",   "na_s":368,"na_a":6,   "eu_s":201,"eu_a":11, "la_s":25,"la_a":0,  "note":"■ Mar 27-29","peak":False,"partial":False,"warn":"Tracking issues on Mar 27-29. Applies tracking appears broken this week — near-zero applies across all regions despite healthy session counts."},
    {"w":"W14","range":"Mar 30-Apr 5","na_s":19, "na_a":15,  "eu_s":8,  "eu_a":10, "la_s":9, "la_a":26, "note":"■ Mar 30-Apr 1","peak":False,"partial":False,"warn":"Tracking issues on Mar 30 – Apr 1. Sessions and applies both severely suppressed early in the week."},
    {"w":"W15","range":"Apr 7-9",     "na_s":14, "na_a":69,  "eu_s":0,  "eu_a":0,  "la_s":8, "la_a":54, "note":"Partial (3d)","peak":False,"partial":True, "warn":None},
]

drill = {
    ("W09","NA"):    {"summary":"801 sessions | 646 users | 2,577 applies | 3.99 applies/user", "rows":[("United States",793,638,2530,3.97),("Canada",5,5,33,6.60),("Mexico",3,3,14,4.67)], "others":None},
    ("W09","EU"):    {"summary":"26 sessions | 25 users | 119 applies | 4.76 applies/user", "rows":[("Spain",5,4,23,5.75),("Germany",4,4,2,0.50),("United Kingdom",3,3,1,0.33),("Ireland",2,2,4,2.00)], "others":("+12 others",12,12,89,None)},
    ("W09","LATAM"): {"summary":"11 sessions | 10 users | 83 applies | 8.30 applies/user", "rows":[("Colombia",3,3,16,5.33),("Dominican Republic",3,2,33,16.50),("Peru",1,1,22,22.00)], "others":("+4 others",4,4,12,None)},

    ("W10","NA"):    {"summary":"666 sessions | 546 users | 1,772 applies | 3.25 applies/user", "rows":[("United States",656,539,1743,3.23),("Canada",5,4,19,4.75),("Mexico",5,3,10,3.33)], "others":None},
    ("W10","EU"):    {"summary":"20 sessions | 18 users | 48 applies | 2.67 applies/user", "rows":[("Italy",4,3,6,2.00),("Germany",2,2,8,4.00),("Slovenia",2,1,13,13.00),("Sweden",2,2,0,0.00),("United Kingdom",2,2,2,1.00)], "others":("+8 others",8,8,19,None)},
    ("W10","LATAM"): {"summary":"12 sessions | 12 users | 70 applies | 5.83 applies/user", "rows":[("Brazil",9,9,63,7.00),("Argentina",1,1,7,7.00)], "others":("+2 others",2,2,0,None)},

    ("W11","NA"):    {"summary":"666 sessions | 593 users | 2,215 applies | 3.74 applies/user", "rows":[("United States",647,576,2142,3.72),("Canada",16,14,48,3.43),("Mexico",3,3,25,8.33)], "others":None},
    ("W11","EU"):    {"summary":"298 sessions | 270 users | 1,566 applies | 5.80 applies/user", "rows":[("Germany",160,145,962,6.63),("United Kingdom",33,30,37,1.23),("Netherlands",21,19,103,5.42),("Italy",11,8,77,9.63),("Greece",10,9,10,1.11),("Spain",10,10,79,7.90),("France",8,8,31,3.88),("Switzerland",5,3,27,9.00),("Ireland",4,3,51,17.00),("Poland",4,4,12,3.00)], "others":("+16 others",32,31,177,None)},
    ("W11","LATAM"): {"summary":"33 sessions | 31 users | 203 applies | 6.55 applies/user", "rows":[("Brazil",11,10,104,10.40),("Colombia",7,7,14,2.00),("Venezuela",3,2,5,2.50),("Dominican Republic",2,2,6,3.00),("Puerto Rico",2,2,41,20.50)], "others":("+8 others",8,8,33,None)},

    ("W12","NA"):    {"summary":"183 sessions | 158 users | 1,338 applies | 8.47 applies/user", "rows":[("United States",178,153,1322,8.64),("Canada",4,4,9,2.25),("Mexico",1,1,7,7.00)], "others":None},
    ("W12","EU"):    {"summary":"121 sessions | 102 users | 812 applies | 7.96 applies/user", "rows":[("Germany",46,40,340,8.50),("Netherlands",19,15,98,6.53),("Greece",7,2,13,6.50),("Hungary",7,5,23,4.60),("United Kingdom",7,7,30,4.29),("Portugal",6,6,49,8.17),("Spain",6,6,21,3.50),("Austria",4,4,16,4.00),("Italy",4,4,32,8.00),("France",3,2,24,12.00),("Poland",3,2,38,19.00)], "others":("+9 others",9,9,128,None)},
    ("W12","LATAM"): {"summary":"14 sessions | 12 users | 114 applies | 9.50 applies/user", "rows":[("Brazil",8,7,31,4.43),("Uruguay",2,1,50,50.00),("Venezuela",2,2,18,9.00)], "others":("+2 others",2,2,15,None)},

    ("W13","NA"):    {"summary":"368 sessions | 331 users | 6 applies | 0.02 applies/user", "rows":[("United States",361,325,6,0.02),("Canada",5,4,0,0.00),("Mexico",2,2,0,0.00)], "others":None},
    ("W13","EU"):    {"summary":"201 sessions | 173 users | 11 applies | 0.06 applies/user", "rows":[("Germany",108,89,10,0.11),("Netherlands",29,24,0,0.00),("United Kingdom",10,9,1,0.11),("Italy",9,7,0,0.00),("France",5,5,0,0.00),("Poland",5,5,0,0.00),("Romania",5,4,0,0.00),("Spain",5,5,0,0.00)], "others":("+12 others",25,25,0,None)},
    ("W13","LATAM"): {"summary":"25 sessions | 22 users | 0 applies | 0.00 applies/user", "rows":[("Brazil",14,12,0,0.00),("Argentina",3,3,0,0.00)], "others":("+5 others",8,7,0,None)},

    ("W14","NA"):    {"summary":"19 sessions | 13 users | 15 applies | 1.15 applies/user", "rows":[("United States",15,9,8,0.89),("Canada",3,3,7,2.33),("Mexico",1,1,0,0.00)], "others":None},
    ("W14","EU"):    {"summary":"8 sessions | 5 users | 10 applies | 2.00 applies/user", "rows":[("Germany",3,1,4,4.00),("Netherlands",2,2,0,0.00),("Serbia",2,1,5,5.00),("Albania",1,1,1,1.00)], "others":None},
    ("W14","LATAM"): {"summary":"9 sessions | 9 users | 26 applies | 2.89 applies/user", "rows":[("Brazil",5,5,25,5.00),("Argentina",2,2,0,0.00),("Chile",2,2,1,0.50)], "others":None},

    ("W15","NA"):    {"summary":"14 sessions | 13 users | 69 applies | 5.31 applies/user", "rows":[("Mexico",8,7,67,9.57),("Canada",5,5,2,0.40),("United States",1,1,0,0.00)], "others":None},
    ("W15","EU"):    None,
    ("W15","LATAM"): {"summary":"8 sessions | 7 users | 54 applies | 7.71 applies/user", "rows":[("Dominican Republic",3,2,29,14.50),("Colombia",2,2,9,4.50),("Ecuador",1,1,9,9.00)], "others":("+2 others",2,2,7,None)},
}

def fmt_int(v): return f"{v:,}"
def fmt_dec(v): return f"{v:.2f}"

def heat_bg(v, vmax, base="31,78,121"):
    if vmax == 0:
        return "transparent", "#1a1a1a"
    r = v / vmax
    r = max(0.06, min(1.0, r))
    color = "#fff" if r > 0.55 else "#1a1a1a"
    return f"rgba({base},{r:.3f})", color

def is_anomaly(applies, sessions):
    return sessions >= 100 and applies <= sessions * 0.05

def stacked_bar_master():
    W, H = 720, 280
    padL, padR, padT, padB = 44, 24, 36, 48
    innerW = W - padL - padR
    innerH = H - padT - padB
    n = len(weeks)
    gap = 16
    barW = (innerW - gap*(n-1)) / n
    totals = [w["na_s"]+w["eu_s"]+w["la_s"] for w in weeks]
    ymax = max(totals)
    ytop = ((ymax // 250) + 1) * 250

    svg = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    for tick in range(0, ytop+1, 250):
        y = padT + innerH * (1 - tick/ytop)
        svg.append(f'<line x1="{padL}" x2="{W-padR}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e5e7eb" stroke-width="1"/>')
        svg.append(f'<text x="{padL-6}" y="{y+3:.1f}" font-size="10" fill="#6b7280" text-anchor="end">{tick:,}</text>')
    for i, w in enumerate(weeks):
        x = padL + i*(barW+gap)
        y0 = padT + innerH
        na_h = (w["na_s"]/ytop) * innerH
        eu_h = (w["eu_s"]/ytop) * innerH
        la_h = (w["la_s"]/ytop) * innerH
        svg.append(f'<rect x="{x:.1f}" y="{y0-na_h:.1f}" width="{barW:.1f}" height="{na_h:.1f}" fill="{S1}"/>')
        svg.append(f'<rect x="{x:.1f}" y="{y0-na_h-eu_h:.1f}" width="{barW:.1f}" height="{eu_h:.1f}" fill="{S2}"/>')
        svg.append(f'<rect x="{x:.1f}" y="{y0-na_h-eu_h-la_h:.1f}" width="{barW:.1f}" height="{la_h:.1f}" fill="{S3}"/>')
        total = w["na_s"]+w["eu_s"]+w["la_s"]
        svg.append(f'<text x="{x+barW/2:.1f}" y="{y0-na_h-eu_h-la_h-6:.1f}" font-size="11" font-weight="600" fill="#1a1a1a" text-anchor="middle">{total:,}</text>')
        svg.append(f'<text x="{x+barW/2:.1f}" y="{H-padB+16}" font-size="11" fill="#1a1a1a" text-anchor="middle">{w["w"]}</text>')
        svg.append(f'<text x="{x+barW/2:.1f}" y="{H-padB+30}" font-size="10" fill="#6b7280" text-anchor="middle">{html.escape(w["range"])}</text>')
        if w["warn"]:
            svg.append(f'<line x1="{x+barW/2:.1f}" x2="{x+barW/2:.1f}" y1="{padT}" y2="{y0}" stroke="#b71c1c" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.75"/>')
            svg.append(f'<rect x="{x+barW/2-8:.1f}" y="{padT-22}" width="16" height="16" fill="#b71c1c" rx="2"/>')
            svg.append(f'<text x="{x+barW/2:.1f}" y="{padT-10}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">!</text>')
        if w["peak"]:
            svg.append(f'<rect x="{x+barW/2-18:.1f}" y="{padT-22}" width="36" height="16" fill="#fff7d6" stroke="#d4a017" stroke-width="1" rx="2"/>')
            svg.append(f'<text x="{x+barW/2:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#8a6d00" text-anchor="middle">PEAK</text>')
        if w["partial"]:
            svg.append(f'<line x1="{x+barW/2:.1f}" x2="{x+barW/2:.1f}" y1="{padT}" y2="{y0}" stroke="#1f4e79" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.6"/>')
            svg.append(f'<rect x="{x+barW/2-24:.1f}" y="{padT-22}" width="48" height="16" fill="#e8f1fb" stroke="#1f4e79" stroke-width="1" rx="2"/>')
            svg.append(f'<text x="{x+barW/2:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#1f4e79" text-anchor="middle">PARTIAL</text>')
    svg.append(f'<line x1="{padL}" x2="{padL}" y1="{padT}" y2="{padT+innerH}" stroke="#6b7280"/>')
    svg.append(f'<line x1="{padL}" x2="{W-padR}" y1="{padT+innerH}" y2="{padT+innerH}" stroke="#6b7280"/>')
    svg.append(f'<text x="{padL-30}" y="{padT-8}" font-size="10" fill="#6b7280">Sessions</text>')
    svg.append('</svg>')
    return "\n".join(svg)

def hbar(rows, vmax, primary_col=3, label_col=0, width=380, row_h=20, top_n=10):
    rows_sorted = sorted(rows, key=lambda r: r[primary_col], reverse=True)[:top_n]
    n = len(rows_sorted)
    H = n*row_h + 16
    labelW = 130
    barAreaW = width - labelW - 60
    if vmax == 0:
        vmax = 1
    svg = [f'<svg width="{width}" height="{H}" viewBox="0 0 {width} {H}" xmlns="http://www.w3.org/2000/svg">']
    for i, r in enumerate(rows_sorted):
        y = 4 + i*row_h
        v = r[primary_col]
        bw = barAreaW * (v / vmax)
        svg.append(f'<text x="{labelW-6}" y="{y+row_h-6}" font-size="11" fill="#1a1a1a" text-anchor="end">{html.escape(str(r[label_col]))}</text>')
        svg.append(f'<rect x="{labelW}" y="{y+3}" width="{bw:.1f}" height="{row_h-8}" fill="{NAVY}" rx="2"/>')
        vstr = fmt_int(v) if isinstance(v,int) else fmt_dec(v)
        svg.append(f'<text x="{labelW+bw+6:.1f}" y="{y+row_h-6}" font-size="11" fill="#1a1a1a">{vstr}</text>')
    svg.append('</svg>')
    return "\n".join(svg)

def master_table():
    cols = {
        "na_s": max(w["na_s"] for w in weeks),
        "na_a": max(w["na_a"] for w in weeks),
        "eu_s": max(w["eu_s"] for w in weeks),
        "eu_a": max(w["eu_a"] for w in weeks),
        "la_s": max(w["la_s"] for w in weeks),
        "la_a": max(w["la_a"] for w in weeks),
    }
    head = ('<thead><tr>'
            '<th>Week</th><th>Date Range</th>'
            '<th class="num">NA Sess</th><th class="num">NA Applies</th>'
            '<th class="num">EU Sess</th><th class="num">EU Applies</th>'
            '<th class="num">LATAM Sess</th><th class="num">LATAM Applies</th>'
            '<th>Notes</th></tr></thead>')
    body = ['<tbody>']
    anomalies = []
    for w in weeks:
        cls = []
        if w["peak"]: cls.append("accent")
        if w["partial"]: cls.append("partial")
        clsattr = f' class="{" ".join(cls)}"' if cls else ""
        def cell(key, value, sessions_for_anomaly=None, applies_for_anomaly=None):
            bg, fg = heat_bg(value, cols[key])
            extra = ""
            if sessions_for_anomaly is not None and applies_for_anomaly is not None and is_anomaly(applies_for_anomaly, sessions_for_anomaly):
                extra = ' anomaly'
                anomalies.append((w["w"], key, value, sessions_for_anomaly))
            return f'<td class="num heat-cell{extra}" style="background:{bg};color:{fg}">{fmt_int(value)}</td>'
        wk_cell = f'<td>{w["w"]}'
        if w["peak"]: wk_cell += ' <span class="peak-tag">peak</span>'
        wk_cell += '</td>'
        dr_cell = f'<td>{html.escape(w["range"])}{" (partial, 3d)" if w["partial"] else ""}</td>'
        notes = w["note"]
        if "Partial" in notes:
            notes_html = f'<td><span class="note-marker info">{html.escape(notes)}</span></td>'
        elif notes:
            notes_html = f'<td><span class="note-marker">{html.escape(notes)}</span></td>'
        else:
            notes_html = '<td></td>'
        body.append(f'<tr{clsattr}>' + wk_cell + dr_cell
            + cell("na_s", w["na_s"])
            + cell("na_a", w["na_a"], sessions_for_anomaly=w["na_s"], applies_for_anomaly=w["na_a"])
            + cell("eu_s", w["eu_s"])
            + cell("eu_a", w["eu_a"], sessions_for_anomaly=w["eu_s"], applies_for_anomaly=w["eu_a"])
            + cell("la_s", w["la_s"])
            + cell("la_a", w["la_a"], sessions_for_anomaly=w["la_s"], applies_for_anomaly=w["la_a"])
            + notes_html + '</tr>')
    body.append('</tbody>')
    table = '<table class="report">' + head + "".join(body) + '</table>'
    if anomalies:
        bits = []
        for (wkid, ckey, val, sess) in anomalies:
            region_label = {"na_a":"NA","eu_a":"EU","la_a":"LATAM"}.get(ckey,"?")
            bits.append(f"{wkid} {region_label} Applies = {val} with sessions = {sess}")
        table += f'<div class="footnote">* Near-zero applies with non-trivial sessions: {"; ".join(bits)}.</div>'
    return table

def region_table(rows, others):
    applies_max = max([r[3] for r in rows] + [0])
    head = '<thead><tr><th>Country</th><th class="num">Sessions</th><th class="num">Users</th><th class="num">Applies</th><th class="num">Applies/User</th></tr></thead>'
    body = ['<tbody>']
    for r in rows:
        country, s, u, a, au = r
        if applies_max > 0:
            bg, fg = heat_bg(a, applies_max)
        else:
            bg, fg = "transparent", "#1a1a1a"
        anomaly_cls = " anomaly" if is_anomaly(a, s) else ""
        body.append(
            f'<tr><td>{html.escape(country)}</td>'
            f'<td class="num">{fmt_int(s)}</td>'
            f'<td class="num">{fmt_int(u)}</td>'
            f'<td class="num heat-cell{anomaly_cls}" style="background:{bg};color:{fg}">{fmt_int(a)}</td>'
            f'<td class="num">{fmt_dec(au)}</td></tr>')
    if others:
        oc, os_, ou, oa, _ = others
        body.append(
            f'<tr class="muted"><td>{html.escape(oc)}</td>'
            f'<td class="num">{fmt_int(os_)}</td>'
            f'<td class="num">{fmt_int(ou)}</td>'
            f'<td class="num">{fmt_int(oa)}</td>'
            f'<td class="num">—</td></tr>')
    body.append('</tbody>')
    return '<table class="report">' + head + "".join(body) + '</table>'

def week_section(w):
    suffix = ""
    if w["peak"]:
        suffix = ' <span class="peak-tag">peak</span>'
    if w["partial"]:
        suffix = ' <span class="partial-tag">partial · 3 days</span>'
    out = [f'<section><h2>{w["w"]} — {html.escape(w["range"])}{suffix}</h2>']
    if w["warn"]:
        out.append(f'<div class="callout warn">■ {html.escape(w["warn"])}</div>')
    region_names = [("NA","North America"),("EU","Europe"),("LATAM","LATAM")]
    for code, label in region_names:
        d = drill.get((w["w"], code))
        if d is None:
            out.append(f'<h3>{label} — 0 sessions</h3>')
            continue
        out.append(f'<h3>{label} — {html.escape(d["summary"])}</h3>')
        all_rows = d["rows"]
        n_visible = len(all_rows) + (1 if d["others"] else 0)
        if n_visible >= 5:
            applies_max = max(r[3] for r in all_rows) if all_rows else 1
            out.append('<div class="chart-wrap">' + hbar(all_rows, applies_max, primary_col=3, label_col=0) + '</div>')
        out.append(region_table(d["rows"], d["others"]))
    out.append('</section>')
    return "\n".join(out)

tot_sess = sum(w["na_s"]+w["eu_s"]+w["la_s"] for w in weeks)
tot_apps = sum(w["na_a"]+w["eu_a"]+w["la_a"] for w in weeks)
weeks_with_issues = sum(1 for w in weeks if w["warn"])

kpi_row = (
    '<div class="kpi-row">'
    f'<div class="kpi"><div class="label">Total Sessions</div><div class="value">{fmt_int(tot_sess)}</div><div class="sub">across 3 regions · 7 weeks</div></div>'
    f'<div class="kpi"><div class="label">Total Applies</div><div class="value">{fmt_int(tot_apps)}</div><div class="sub">job_apply event</div></div>'
    f'<div class="kpi"><div class="label">Weeks Flagged</div><div class="value">{weeks_with_issues}</div><div class="sub">tracking-issue notes</div></div>'
    f'<div class="kpi"><div class="label">Period</div><div class="value">7w</div><div class="sub">Feb 23 – Apr 9, 2026</div></div>'
    '</div>'
)

legend = (
    '<div class="legend">'
    f'<span><span class="sw" style="background:{S1}"></span>North America</span>'
    f'<span><span class="sw" style="background:{S2}"></span>Europe</span>'
    f'<span><span class="sw" style="background:{S3}"></span>LATAM</span>'
    '<span><span class="sw" style="background:#b71c1c"></span>Tracking-issue week</span>'
    '<span><span class="sw" style="background:#fff7d6;border:1px solid #d4a017"></span>Peak</span>'
    '<span><span class="sw" style="background:#e8f1fb;border:1px solid #1f4e79"></span>Partial</span>'
    '</div>'
)

master = (
    '<section>'
    '<h2>Weekly Summary by Region</h2>'
    f'<div class="chart-wrap">{stacked_bar_master()}</div>'
    f'{legend}'
    f'{master_table()}'
    '</section>'
)

week_sections = "\n".join(week_section(w) for w in weeks)

CSS = """
:root {
  --bg:#ffffff;--ink:#1a1a1a;--muted:#6b7280;--rule:#e5e7eb;
  --navy:#1f4e79;--navy-deep:#16365a;
  --warn-bg:#fce8e6;--warn-ink:#b71c1c;--warn-line:#d93025;
  --info-bg:#e8f1fb;--info-ink:#1f4e79;
  --accent:#fff7d6;--partial-tint:#f3f4f6;
}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:32px 40px;max-width:1180px}
h1{font-size:28px;font-weight:700;margin:0 0 4px}
.subtitle{color:var(--muted);margin-bottom:12px}
hr.rule{border:0;border-top:1px solid var(--navy);margin:12px 0 18px}
.context-strip{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 18px}
.ctx{font-size:12px;padding:6px 12px;border:1px solid var(--rule);border-radius:8px;background:#fff;color:var(--ink)}
.ctx .k{color:var(--muted);margin-right:6px;font-weight:600}
.ctx.warn{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn-ink)}
.ctx.info{background:var(--info-bg);border-color:var(--info-ink);color:var(--info-ink)}
h2{color:var(--navy);font-size:19px;font-weight:700;margin:28px 0 12px;display:flex;align-items:baseline;gap:10px}
h2 .peak-tag{background:var(--accent);color:#8a6d00;font-size:11px;padding:2px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
h2 .partial-tag{background:var(--info-bg);color:var(--info-ink);font-size:11px;padding:2px 8px;border-radius:4px;font-weight:700}
h3{color:var(--navy);font-size:15px;font-weight:700;margin:18px 0 6px}
table.report{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:13px}
table.report thead th{background:var(--navy-deep);color:#fff;font-weight:600;padding:8px 10px;text-align:left;white-space:nowrap}
table.report th.num,table.report td.num{text-align:right}
table.report tbody td{padding:7px 10px;border-bottom:1px solid var(--rule);position:relative}
table.report tbody tr.accent{background:#fffbe8}
table.report tbody tr.accent td:first-child{box-shadow:inset 3px 0 0 #d4a017}
table.report tbody tr.partial{background:var(--partial-tint);font-style:italic;color:var(--muted)}
table.report tbody tr.muted td{color:var(--muted)}
table.report tbody tr td .peak-tag{background:var(--accent);color:#8a6d00;font-size:10px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-left:6px}
table.report td.anomaly{box-shadow:inset 3px 0 0 var(--warn-line);color:var(--warn-ink)!important;font-weight:700}
table.report td.anomaly::after{content:"*";color:var(--warn-line);margin-left:4px;vertical-align:super;font-size:10px}
.callout{padding:8px 12px;margin:8px 0 12px;border-radius:4px;font-size:13px}
.callout.warn{background:var(--warn-bg);color:var(--warn-ink);border-left:3px solid var(--warn-line)}
.callout.info{background:var(--info-bg);color:var(--info-ink);border-left:3px solid var(--info-ink)}
.footnote{font-size:12px;color:var(--muted);margin:-8px 0 18px}
.kpi{display:inline-flex;flex-direction:column;align-items:flex-start;padding:18px 22px;border:1px solid var(--rule);border-radius:10px;min-width:200px;gap:4px;background:#fff}
.kpi .value{font-size:36px;font-weight:700;line-height:1;color:var(--ink)}
.kpi .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.kpi .sub{color:var(--muted);font-size:12px;margin-top:4px}
.kpi-row{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 22px}
.chart-wrap{margin:8px 0 4px}
.chart-wrap svg{display:block;max-width:100%;height:auto}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--ink);margin:6px 0 14px}
.legend .sw{display:inline-block;width:12px;height:12px;margin-right:6px;border-radius:2px;vertical-align:middle}
.note-marker{color:var(--warn-ink);font-size:12px;white-space:nowrap}
.note-marker.info{color:var(--info-ink)}
"""

title = "LinkedIn Traffic — Weekly Performance Report"
subtitle = "Week-by-week breakdown by region (North America, Europe, LATAM) | Feb 23 – Apr 9, 2026 (7 weeks)"

ctx_strip = (
    '<div class="context-strip">'
    '<span class="ctx"><span class="k">Period</span>Feb 23 – Apr 9, 2026 (49 days · 7 weeks)</span>'
    '<span class="ctx"><span class="k">Region</span>NA · EU · LATAM</span>'
    '<span class="ctx"><span class="k">Source</span>All sources</span>'
    '<span class="ctx"><span class="k">As of</span>May 21, 2026</span>'
    '<span class="ctx warn"><span class="k">⛑</span>Tracking issues in 3 weeks</span>'
    '<span class="ctx info"><span class="k">⛑</span>Partial week included</span>'
    '</div>'
)

doc = (
    '<!doctype html>\n'
    '<html lang="en"><head><meta charset="utf-8">'
    f'<title>{html.escape(title)}</title>'
    f'<style>{CSS}</style></head>'
    '<body>'
    '<header>'
    f'<h1>{html.escape(title)}</h1>'
    f'<div class="subtitle">{html.escape(subtitle)}</div>'
    '<hr class="rule">'
    f'{ctx_strip}'
    '</header>'
    '<main>'
    f'{kpi_row}'
    f'{master}'
    f'{week_sections}'
    '</main>'
    '</body></html>'
)

OUT.write_text(doc, encoding="utf-8")
print(f"WROTE: {OUT}")
print(f"size_bytes: {OUT.stat().st_size}")
