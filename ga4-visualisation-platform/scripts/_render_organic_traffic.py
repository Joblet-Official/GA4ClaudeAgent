"""Render the 'organic traffic' Agent 5 output as an Agent-6-style HTML report.
Stand-in for Agent 6 (which timed out). Implements the same spec deterministically.
"""
import html, json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "reports" / "2026-05-21_184258_organic-traffic-by-region.html"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = "#1f4e79"; NAVY_DEEP = "#16365a"
S1 = "#1f4e79"; S2 = "#5b9bd5"; S3 = "#c7522a"; S4 = "#70ad47"; S5 = "#8e44ad"; S6 = "#d97706"
REGION_COLORS = {"NA": S1, "EU": S2, "LATAM": S3, "APAC": S4, "MEA": S5, "Other": S6}

# ---------- data straight from Agent 5 ----------
ts_points = [
    {"x":"W08","y":19,  "range":"Feb 16-22"},
    {"x":"W09","y":336, "range":"Feb 23-Mar 1"},
    {"x":"W10","y":81,  "range":"Mar 2-8"},
    {"x":"W11","y":400, "range":"Mar 9-15"},
    {"x":"W12","y":164, "range":"Mar 16-22"},
    {"x":"W13","y":156, "range":"Mar 23-29"},
    {"x":"W14","y":112, "range":"Mar 30-Apr 5"},
    {"x":"W15","y":174, "range":"Apr 6-12"},
    {"x":"W16","y":182, "range":"Apr 13-19"},
    {"x":"W17","y":116, "range":"Apr 20-26"},
    {"x":"W18","y":717, "range":"Apr 27-May 3", "peak": True},
    {"x":"W19","y":299, "range":"May 4-10"},
    {"x":"W20","y":94,  "range":"May 11-17"},
    {"x":"W21","y":51,  "range":"May 18-21", "partial": True},
]
wow_abs = [None,317,-255,319,-236,-8,-44,62,8,-66,601,-418,-205,-43]
wow_pct = [None,1668.42,-75.89,393.83,-59.0,-4.88,-28.21,55.36,4.6,-36.26,518.1,-58.3,-68.56,-45.74]

pivot_rows = [
    {"Week":"W08","Date Range":"Feb 16-22",     "NA":1,  "EU":2, "LATAM":2, "APAC":12, "MEA":2,  "Total":19},
    {"Week":"W09","Date Range":"Feb 23-Mar 1",  "NA":39, "EU":92,"LATAM":29,"APAC":117,"MEA":59, "Total":336},
    {"Week":"W10","Date Range":"Mar 2-8",       "NA":12, "EU":4, "LATAM":1, "APAC":53, "MEA":11, "Total":81},
    {"Week":"W11","Date Range":"Mar 9-15",      "NA":119,"EU":24,"LATAM":15,"APAC":192,"MEA":50, "Total":400},
    {"Week":"W12","Date Range":"Mar 16-22",     "NA":47, "EU":13,"LATAM":9, "APAC":68, "MEA":27, "Total":164},
    {"Week":"W13","Date Range":"Mar 23-29",     "NA":23, "EU":5, "LATAM":10,"APAC":100,"MEA":18, "Total":156},
    {"Week":"W14","Date Range":"Mar 30-Apr 5",  "NA":45, "EU":5, "LATAM":2, "APAC":50, "MEA":10, "Total":112},
    {"Week":"W15","Date Range":"Apr 6-12",      "NA":11, "EU":0, "LATAM":0, "APAC":162,"MEA":1,  "Total":174},
    {"Week":"W16","Date Range":"Apr 13-19",     "NA":22, "EU":0, "LATAM":0, "APAC":159,"MEA":1,  "Total":182},
    {"Week":"W17","Date Range":"Apr 20-26",     "NA":24, "EU":0, "LATAM":31,"APAC":56, "MEA":5,  "Total":116},
    {"Week":"W18","Date Range":"Apr 27-May 3",  "NA":141,"EU":53,"LATAM":50,"APAC":349,"MEA":124,"Total":717,"peak":True},
    {"Week":"W19","Date Range":"May 4-10",      "NA":97, "EU":39,"LATAM":18,"APAC":113,"MEA":32, "Total":299},
    {"Week":"W20","Date Range":"May 11-17",     "NA":23, "EU":4, "LATAM":2, "APAC":55, "MEA":10, "Total":94},
    {"Week":"W21","Date Range":"May 18-21 (partial)","NA":13,"EU":8,"LATAM":2,"APAC":19,"MEA":9,"Total":51,"partial":True},
]
regions_order = ["APAC","NA","MEA","EU","LATAM","Other"]
region_totals = {"NA":617,"EU":249,"LATAM":171,"APAC":1505,"MEA":359,"Other":0}
region_share  = {"NA":21.27,"EU":8.58,"LATAM":5.89,"APAC":51.88,"MEA":12.37,"Other":0.0}

top_countries = [
    ("India",1058,36.47),("United States",446,15.37),("Canada",127,4.38),("Kenya",97,3.34),
    ("Pakistan",89,3.07),("South Africa",72,2.48),("Philippines",57,1.96),("Indonesia",44,1.52),
    ("Mexico",44,1.52),("Bangladesh",43,1.48),("Australia",42,1.45),("Brazil",38,1.31),
    ("Nigeria",36,1.24),("Argentina",30,1.03),("Malaysia",25,0.86),
]
top_others = ("+96 others",653,22.51)

dq_notes = {
    "W21":("info","Partial week: W21 covers 4 of 7 days (May 18-21); today is 2026-05-21 (Thursday)."),
    "W18":("info","W18 total 717 is 4.48x the rolling median (160) of weekly totals across W08-W21; below the 5x threshold but notably elevated."),
    "W09":("info","W09 total 336 is 2.10x the rolling median (160)."),
    "W11":("info","W11 total 400 is 2.50x the rolling median (160)."),
    "W08":("info","W08 total 19 is unusually low relative to the rolling median (160); date range Feb 16-22 falls at the start of the requested window."),
}

total_sessions = sum(p["y"] for p in ts_points)
peak_total = max(p["y"] for p in ts_points)
peak_week = next(p for p in ts_points if p["y"] == peak_total)

def fmt_int(v): return f"{v:,}"
def fmt_dec(v): return f"{v:.2f}"
def fmt_pct(v): return f"{v:.2f}%"
def heat_bg(v, vmax, base="31,78,121"):
    if vmax == 0: return "transparent", "#1a1a1a"
    r = max(0.06, min(1.0, v / vmax))
    color = "#fff" if r > 0.55 else "#1a1a1a"
    return f"rgba({base},{r:.3f})", color

# ---------- line chart with annotations ----------
def line_chart_sessions():
    W, H = 760, 300
    padL, padR, padT, padB = 50, 24, 40, 50
    innerW = W - padL - padR
    innerH = H - padT - padB
    n = len(ts_points)
    xs = [padL + i * (innerW / (n - 1)) for i in range(n)]
    ys_raw = [p["y"] for p in ts_points]
    ymax = max(ys_raw)
    ytop = ((ymax // 100) + 1) * 100
    ys = [padT + innerH * (1 - v / ytop) for v in ys_raw]

    out = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    # gridlines
    for tick in range(0, ytop + 1, 100):
        y = padT + innerH * (1 - tick / ytop)
        out.append(f'<line x1="{padL}" x2="{W-padR}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e5e7eb" stroke-width="1"/>')
        out.append(f'<text x="{padL-6}" y="{y+3:.1f}" font-size="10" fill="#6b7280" text-anchor="end">{tick:,}</text>')
    # annotation markers (vertical lines for peak, partial, anomaly)
    for i, p in enumerate(ts_points):
        x = xs[i]
        if p.get("peak"):
            out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{padT}" y2="{padT+innerH}" stroke="#d4a017" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>')
            out.append(f'<rect x="{x-18:.1f}" y="{padT-22}" width="36" height="16" fill="#fff7d6" stroke="#d4a017" rx="2"/>')
            out.append(f'<text x="{x:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#8a6d00" text-anchor="middle">PEAK</text>')
        if p.get("partial"):
            out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{padT}" y2="{padT+innerH}" stroke="#1f4e79" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>')
            out.append(f'<rect x="{x-24:.1f}" y="{padT-22}" width="48" height="16" fill="#e8f1fb" stroke="#1f4e79" rx="2"/>')
            out.append(f'<text x="{x:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#1f4e79" text-anchor="middle">PARTIAL</text>')
    # polyline
    pts = " ".join(f"{xs[i]:.1f},{ys[i]:.1f}" for i in range(n))
    out.append(f'<polyline fill="none" stroke="{NAVY}" stroke-width="2" points="{pts}"/>')
    # area under the curve, faintly
    area_pts = pts + f" {xs[-1]:.1f},{padT+innerH:.1f} {xs[0]:.1f},{padT+innerH:.1f}"
    out.append(f'<polygon fill="{NAVY}" opacity="0.08" points="{area_pts}"/>')
    # circles + week labels
    for i, p in enumerate(ts_points):
        is_special = p.get("peak") or p.get("partial")
        r = 5 if is_special else 3
        fill = "#d4a017" if p.get("peak") else "#1f4e79" if p.get("partial") else NAVY
        out.append(f'<circle cx="{xs[i]:.1f}" cy="{ys[i]:.1f}" r="{r}" fill="{fill}" stroke="#fff" stroke-width="1.5"/>')
        # value label above point for peak / partial / large values
        if is_special or p["y"] >= ymax * 0.4:
            ty = ys[i] - 10
            out.append(f'<text x="{xs[i]:.1f}" y="{ty:.1f}" font-size="11" font-weight="600" fill="#1a1a1a" text-anchor="middle">{p["y"]:,}</text>')
        # x-axis tick label
        out.append(f'<text x="{xs[i]:.1f}" y="{H-padB+16}" font-size="10" fill="#1a1a1a" text-anchor="middle">{p["x"]}</text>')
    # axis lines
    out.append(f'<line x1="{padL}" x2="{padL}" y1="{padT}" y2="{padT+innerH}" stroke="#6b7280"/>')
    out.append(f'<line x1="{padL}" x2="{W-padR}" y1="{padT+innerH}" y2="{padT+innerH}" stroke="#6b7280"/>')
    out.append(f'<text x="{padL-30}" y="{padT-22}" font-size="10" fill="#6b7280">Sessions</text>')
    out.append('</svg>')
    return "\n".join(out)

# ---------- stacked-bar chart (week x region) ----------
def stacked_bar_pivot():
    W, H = 760, 320
    padL, padR, padT, padB = 50, 24, 50, 50
    innerW = W - padL - padR
    innerH = H - padT - padB
    n = len(pivot_rows)
    gap = 10
    barW = (innerW - gap * (n - 1)) / n
    totals = [r["Total"] for r in pivot_rows]
    ymax = max(totals)
    ytop = ((ymax // 100) + 1) * 100
    out = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    for tick in range(0, ytop + 1, 100):
        y = padT + innerH * (1 - tick / ytop)
        out.append(f'<line x1="{padL}" x2="{W-padR}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e5e7eb" stroke-width="1"/>')
        out.append(f'<text x="{padL-6}" y="{y+3:.1f}" font-size="10" fill="#6b7280" text-anchor="end">{tick:,}</text>')
    for i, r in enumerate(pivot_rows):
        x = padL + i * (barW + gap)
        y0 = padT + innerH
        cum = 0
        for region in regions_order:
            v = r.get(region, 0)
            if v == 0:
                continue
            h = (v / ytop) * innerH
            out.append(f'<rect x="{x:.1f}" y="{y0-cum-h:.1f}" width="{barW:.1f}" height="{h:.1f}" fill="{REGION_COLORS[region]}"/>')
            cum += h
        total = r["Total"]
        out.append(f'<text x="{x+barW/2:.1f}" y="{y0-cum-6:.1f}" font-size="10" font-weight="600" fill="#1a1a1a" text-anchor="middle">{total:,}</text>')
        out.append(f'<text x="{x+barW/2:.1f}" y="{H-padB+16}" font-size="10" fill="#1a1a1a" text-anchor="middle">{r["Week"]}</text>')
        if r.get("peak"):
            out.append(f'<rect x="{x+barW/2-18:.1f}" y="{padT-22}" width="36" height="16" fill="#fff7d6" stroke="#d4a017" rx="2"/>')
            out.append(f'<text x="{x+barW/2:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#8a6d00" text-anchor="middle">PEAK</text>')
        if r.get("partial"):
            out.append(f'<rect x="{x+barW/2-24:.1f}" y="{padT-22}" width="48" height="16" fill="#e8f1fb" stroke="#1f4e79" rx="2"/>')
            out.append(f'<text x="{x+barW/2:.1f}" y="{padT-10}" font-size="10" font-weight="700" fill="#1f4e79" text-anchor="middle">PARTIAL</text>')
    out.append(f'<line x1="{padL}" x2="{padL}" y1="{padT}" y2="{padT+innerH}" stroke="#6b7280"/>')
    out.append(f'<line x1="{padL}" x2="{W-padR}" y1="{padT+innerH}" y2="{padT+innerH}" stroke="#6b7280"/>')
    out.append(f'<text x="{padL-30}" y="{padT-30}" font-size="10" fill="#6b7280">Sessions</text>')
    out.append('</svg>')
    return "\n".join(out)

# ---------- donut chart ----------
def donut_regions():
    import math
    W, H = 320, 260
    cx, cy, r = 140, 130, 80
    out = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    total = sum(region_totals.values())
    angle = -math.pi / 2  # start at top
    for region in regions_order:
        v = region_totals.get(region, 0)
        if v == 0:
            continue
        frac = v / total
        sweep = frac * 2 * math.pi
        x1 = cx + r * math.cos(angle)
        y1 = cy + r * math.sin(angle)
        angle2 = angle + sweep
        x2 = cx + r * math.cos(angle2)
        y2 = cy + r * math.sin(angle2)
        large = 1 if sweep > math.pi else 0
        # outer arc filled with thick stroke gives donut effect
        out.append(f'<path d="M {x1:.1f} {y1:.1f} A {r} {r} 0 {large} 1 {x2:.1f} {y2:.1f}" fill="none" stroke="{REGION_COLORS[region]}" stroke-width="34"/>')
        # label outside the wedge for slices >= 5%
        if frac >= 0.05:
            mid = angle + sweep / 2
            lx = cx + (r + 22) * math.cos(mid)
            ly = cy + (r + 22) * math.sin(mid)
            out.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="11" font-weight="600" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle">{region} {frac*100:.1f}%</text>')
        angle = angle2
    out.append(f'<text x="{cx}" y="{cy-4}" font-size="22" font-weight="700" fill="#1a1a1a" text-anchor="middle">{total:,}</text>')
    out.append(f'<text x="{cx}" y="{cy+14}" font-size="10" fill="#6b7280" text-anchor="middle">Total Sessions</text>')
    out.append('</svg>')
    return "\n".join(out)

# ---------- horizontal bar (top countries) ----------
def hbar_top_countries():
    W = 760
    rows = top_countries[:10]
    n = len(rows)
    row_h = 26
    H = n * row_h + 18
    labelW = 150
    valueW = 70
    barAreaW = W - labelW - valueW - 24
    vmax = max(r[1] for r in rows)
    out = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    for i, (country, s, share) in enumerate(rows):
        y = 4 + i * row_h
        bw = barAreaW * (s / vmax)
        out.append(f'<text x="{labelW-6}" y="{y+row_h-8}" font-size="12" fill="#1a1a1a" text-anchor="end">{html.escape(country)}</text>')
        out.append(f'<rect x="{labelW}" y="{y+4}" width="{bw:.1f}" height="{row_h-12}" fill="{NAVY}" rx="2"/>')
        out.append(f'<text x="{labelW+bw+8:.1f}" y="{y+row_h-8}" font-size="12" fill="#1a1a1a">{s:,} ({share:.1f}%)</text>')
    out.append('</svg>')
    return "\n".join(out)

# ---------- tables ----------
def time_series_table():
    smax = max(p["y"] for p in ts_points)
    head = ('<thead><tr><th>Week</th><th>Date Range</th>'
            '<th class="num">Sessions</th><th class="num">WoW (abs)</th><th class="num">WoW (%)</th>'
            '<th>Notes</th></tr></thead>')
    body = ['<tbody>']
    for i, p in enumerate(ts_points):
        cls = []
        if p.get("peak"): cls.append("accent")
        if p.get("partial"): cls.append("partial")
        clsattr = f' class="{" ".join(cls)}"' if cls else ""
        bg, fg = heat_bg(p["y"], smax)
        a = wow_abs[i]
        pct = wow_pct[i]
        if a is None:
            wow_a_html = '<td class="num">—</td>'
            wow_p_html = '<td class="num">—</td>'
        else:
            a_sign = "▲" if a > 0 else "▼" if a < 0 else "•"
            p_sign = "▲" if pct > 0 else "▼" if pct < 0 else "•"
            a_cls = "delta up" if a > 0 else "delta down" if a < 0 else "delta"
            wow_a_html = f'<td class="num"><span class="{a_cls}">{a_sign} {abs(a):,}</span></td>'
            wow_p_html = f'<td class="num"><span class="{a_cls}">{p_sign} {abs(pct):.1f}%</span></td>'
        note_html = ""
        if p["x"] in dq_notes:
            sev, txt = dq_notes[p["x"]]
            note_html = f'<span class="note-marker {sev}">⚑ flagged</span>'
        wk_cell = f'<td>{p["x"]}{(" <span class=\"peak-tag\">peak</span>" if p.get("peak") else "")}</td>'
        dr_cell = f'<td>{html.escape(p["range"])}{" (partial, 4d)" if p.get("partial") else ""}</td>'
        body.append(f'<tr{clsattr}>{wk_cell}{dr_cell}'
                    f'<td class="num heat-cell" style="background:{bg};color:{fg}">{p["y"]:,}</td>'
                    f'{wow_a_html}{wow_p_html}<td>{note_html}</td></tr>')
    body.append('</tbody>')
    return '<table class="report">' + head + "".join(body) + '</table>'

def pivot_table_html():
    col_maxes = {region: max(r.get(region,0) for r in pivot_rows) for region in regions_order if any(r.get(region,0) for r in pivot_rows)}
    total_max = max(r["Total"] for r in pivot_rows)
    head = '<thead><tr><th>Week</th><th>Date Range</th>'
    for region in regions_order:
        if region not in col_maxes: continue
        head += f'<th class="num">{region}</th>'
    head += '<th class="num">Total</th><th>Notes</th></tr></thead>'
    body = ['<tbody>']
    for r in pivot_rows:
        cls = []
        if r.get("peak"): cls.append("accent")
        if r.get("partial"): cls.append("partial")
        clsattr = f' class="{" ".join(cls)}"' if cls else ""
        wk_cell = f'<td>{r["Week"]}{" <span class=\"peak-tag\">peak</span>" if r.get("peak") else ""}</td>'
        dr_cell = f'<td>{html.escape(r["Date Range"])}</td>'
        row = wk_cell + dr_cell
        for region in regions_order:
            if region not in col_maxes: continue
            v = r.get(region, 0)
            bg, fg = heat_bg(v, col_maxes[region])
            row += f'<td class="num heat-cell" style="background:{bg};color:{fg}">{v:,}</td>'
        tbg, tfg = heat_bg(r["Total"], total_max)
        row += f'<td class="num heat-cell" style="background:{tbg};color:{tfg};font-weight:700">{r["Total"]:,}</td>'
        if r["Week"] in dq_notes:
            sev, _ = dq_notes[r["Week"]]
            row += f'<td><span class="note-marker {sev}">⚑</span></td>'
        else:
            row += '<td></td>'
        body.append(f'<tr{clsattr}>{row}</tr>')
    body.append('</tbody>')
    return '<table class="report">' + head + "".join(body) + '</table>'

def region_summary_table():
    head = '<thead><tr><th>Region</th><th class="num">Sessions</th><th class="num">Share</th><th>Top member</th></tr></thead>'
    top_members = {"APAC":"India","NA":"United States","MEA":"Kenya","EU":"Switzerland (visible)","LATAM":"Brazil","Other":"—"}
    body = ['<tbody>']
    vmax = max(region_totals.values())
    sorted_regions = sorted(regions_order, key=lambda x: region_totals.get(x,0), reverse=True)
    for region in sorted_regions:
        v = region_totals[region]
        if v == 0: continue
        bg, fg = heat_bg(v, vmax)
        body.append(f'<tr><td><span class="region-sw" style="background:{REGION_COLORS[region]}"></span>{region}</td>'
                    f'<td class="num heat-cell" style="background:{bg};color:{fg}">{v:,}</td>'
                    f'<td class="num">{region_share[region]:.2f}%</td>'
                    f'<td>{top_members.get(region,"")}</td></tr>')
    body.append('</tbody>')
    return '<table class="report">' + head + "".join(body) + '</table>'

def top_countries_table():
    smax = max(r[1] for r in top_countries)
    head = '<thead><tr><th>Country</th><th class="num">Sessions</th><th class="num">Share</th><th>Bar</th></tr></thead>'
    body = ['<tbody>']
    for country, s, share in top_countries:
        bg, fg = heat_bg(s, smax)
        pct = (s / smax) * 100
        body.append(f'<tr><td>{html.escape(country)}</td>'
                    f'<td class="num heat-cell" style="background:{bg};color:{fg}">{s:,}</td>'
                    f'<td class="num">{share:.2f}%</td>'
                    f'<td style="min-width:200px"><div class="inline-bar" style="width:{pct:.1f}%"></div></td></tr>')
    # others rollup
    oc, os_, oshare = top_others
    body.append(f'<tr class="muted"><td>{html.escape(oc)}</td>'
                f'<td class="num">{os_:,}</td>'
                f'<td class="num">{oshare:.2f}%</td><td></td></tr>')
    body.append('</tbody>')
    return '<table class="report">' + head + "".join(body) + '</table>'

# ---------- KPI row ----------
kpi_row = (
    '<div class="kpi-row">'
    f'<div class="kpi"><div class="label">Total Organic Sessions</div><div class="value">{fmt_int(total_sessions)}</div><div class="sub">Feb 16 – May 21, 2026 (14 weeks)</div></div>'
    f'<div class="kpi"><div class="label">Peak Week</div><div class="value">{peak_week["x"]}</div><div class="sub">{peak_week["y"]:,} sessions · {html.escape(peak_week["range"])}</div></div>'
    f'<div class="kpi"><div class="label">Top Region</div><div class="value">APAC</div><div class="sub">{region_totals["APAC"]:,} sessions · {region_share["APAC"]:.1f}%</div></div>'
    f'<div class="kpi"><div class="label">Top Country</div><div class="value">India</div><div class="sub">1,058 sessions · 36.5%</div></div>'
    '</div>'
)

# ---------- context strip ----------
ctx_strip = (
    '<div class="context-strip">'
    '<span class="ctx"><span class="k">Period</span>Feb 16 – May 21, 2026 (95 days · 14 weeks)</span>'
    '<span class="ctx"><span class="k">Region</span>All countries</span>'
    '<span class="ctx"><span class="k">Source</span>Organic Search</span>'
    '<span class="ctx"><span class="k">As of</span>May 21, 2026</span>'
    '<span class="ctx info"><span class="k">⚑</span>Partial week included (W21)</span>'
    '<span class="ctx info"><span class="k">⚑</span>1 elevated week (W18 ≈ 4.5× median)</span>'
    '</div>'
)

# ---------- sections ----------
sec_trend = f'''
<section>
  <h2>Sessions over time</h2>
  <div class="chart-wrap">{line_chart_sessions()}</div>
  <div class="legend">
    <span><span class="sw" style="background:{NAVY}"></span>Weekly sessions</span>
    <span><span class="sw" style="background:#fff7d6;border:1px solid #d4a017"></span>Peak week</span>
    <span><span class="sw" style="background:#e8f1fb;border:1px solid #1f4e79"></span>Partial week</span>
  </div>
  {time_series_table()}
  <div class="footnote">Notes column flags weeks with a data-quality observation (peak, partial, or anomaly vs. rolling median). Hover the chip for details below.</div>
</section>'''

# data quality callouts for trend section
trend_callouts_html = ''.join(
    f'<div class="callout info">⚑ <strong>{wk}:</strong> {html.escape(txt)}</div>'
    for wk, (sev, txt) in sorted(dq_notes.items())
)

sec_regional = f'''
<section>
  <h2>Where does organic traffic come from?</h2>
  <div class="section-grid two-col">
    <div>
      <div class="chart-wrap">{donut_regions()}</div>
    </div>
    <div>
      {region_summary_table()}
    </div>
  </div>
</section>'''

sec_pivot = f'''
<section>
  <h2>Week by region — stacked view</h2>
  <div class="chart-wrap">{stacked_bar_pivot()}</div>
  <div class="legend">'''
for region in regions_order:
    if region_totals.get(region,0) == 0: continue
    sec_pivot += f'<span><span class="sw" style="background:{REGION_COLORS[region]}"></span>{region}</span>'
sec_pivot += '''
    <span><span class="sw" style="background:#fff7d6;border:1px solid #d4a017"></span>Peak</span>
    <span><span class="sw" style="background:#e8f1fb;border:1px solid #1f4e79"></span>Partial</span>
  </div>
  ''' + pivot_table_html() + '''
</section>'''

sec_countries = f'''
<section>
  <h2>Top countries (period total)</h2>
  <div class="chart-wrap">{hbar_top_countries()}</div>
  {top_countries_table()}
  <div class="footnote">Bar column shows each country as a share of the top country (India). +96 others = remaining tail summed for context.</div>
</section>'''

# ---------- CSS ----------
CSS = """
:root {
  --bg:#ffffff;--ink:#1a1a1a;--muted:#6b7280;--rule:#e5e7eb;
  --navy:#1f4e79;--navy-deep:#16365a;
  --warn-bg:#fce8e6;--warn-ink:#b71c1c;--warn-line:#d93025;
  --info-bg:#e8f1fb;--info-ink:#1f4e79;
  --accent:#fff7d6;--partial-tint:#f3f4f6;
  --good:#166534;--good-bg:#dcfce7;--bad:#b71c1c;--bad-bg:#fee2e2;
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
table.report{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:13px}
table.report thead th{background:var(--navy-deep);color:#fff;font-weight:600;padding:8px 10px;text-align:left;white-space:nowrap}
table.report th.num,table.report td.num{text-align:right}
table.report tbody td{padding:7px 10px;border-bottom:1px solid var(--rule);position:relative}
table.report tbody tr.accent{background:#fffbe8}
table.report tbody tr.accent td:first-child{box-shadow:inset 3px 0 0 #d4a017}
table.report tbody tr.partial{background:var(--partial-tint);font-style:italic;color:var(--muted)}
table.report tbody tr.muted td{color:var(--muted)}
table.report tbody tr td .peak-tag{background:var(--accent);color:#8a6d00;font-size:10px;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-left:6px}
.delta{font-size:12px;padding:2px 8px;border-radius:999px;font-weight:600;display:inline-flex;align-items:center;gap:4px}
.delta.up{color:var(--good);background:var(--good-bg)}
.delta.down{color:var(--bad);background:var(--bad-bg)}
.callout{padding:8px 12px;margin:8px 0 12px;border-radius:4px;font-size:13px}
.callout.warn{background:var(--warn-bg);color:var(--warn-ink);border-left:3px solid var(--warn-line)}
.callout.info{background:var(--info-bg);color:var(--info-ink);border-left:3px solid var(--info-ink)}
.footnote{font-size:12px;color:var(--muted);margin:-8px 0 18px}
.kpi{display:inline-flex;flex-direction:column;align-items:flex-start;padding:18px 22px;border:1px solid var(--rule);border-radius:10px;min-width:210px;gap:4px;background:#fff}
.kpi .value{font-size:36px;font-weight:700;line-height:1;color:var(--ink)}
.kpi .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.kpi .sub{color:var(--muted);font-size:12px;margin-top:4px}
.kpi-row{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 22px}
.chart-wrap{margin:8px 0 4px}
.chart-wrap svg{display:block;max-width:100%;height:auto}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--ink);margin:6px 0 14px}
.legend .sw{display:inline-block;width:12px;height:12px;margin-right:6px;border-radius:2px;vertical-align:middle}
.region-sw{display:inline-block;width:10px;height:10px;margin-right:8px;border-radius:2px;vertical-align:middle}
.section-grid.two-col{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:start}
.note-marker{color:var(--warn-ink);font-size:11px;padding:2px 8px;border-radius:4px;background:var(--warn-bg)}
.note-marker.info{color:var(--info-ink);background:var(--info-bg)}
.inline-bar{display:inline-block;height:10px;background:var(--navy);border-radius:2px}
"""

title = "Organic Search Traffic — Weekly Breakdown by Region"
subtitle = "All countries · Organic Search only | Feb 16 – May 21, 2026 (14 weeks)"

doc = (
    '<!doctype html>\n'
    f'<html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>'
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
    f'{sec_trend}'
    f'{trend_callouts_html}'
    f'{sec_regional}'
    f'{sec_pivot}'
    f'{sec_countries}'
    '</main>'
    '</body></html>'
)

OUT.write_text(doc, encoding="utf-8")
print(f"WROTE: {OUT}")
print(f"size_bytes: {OUT.stat().st_size}")
