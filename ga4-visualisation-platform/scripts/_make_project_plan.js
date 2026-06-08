// Generate the GA4 Visualisation Platform project plan as a .docx
// Run with: NODE_PATH=C:/Users/zbali/AppData/Roaming/npm/node_modules node scripts/_make_project_plan.js

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageOrientation, PageNumber,
} = require('docx');

const NAVY = '1F4E79';
const NAVY_DEEP = '16365A';
const MUTED = '6B7280';
const RULE = 'D5DAE0';
const INK = '1A1A1A';

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const borders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 80 },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size, italics: opts.italics })],
  });
}
function PR(runs, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 80 },
    alignment: opts.alignment,
    children: runs,
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 40 },
    children: [new TextRun(text)],
  });
}
function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    spacing: { after: 40 },
    children: [new TextRun(text)],
  });
}
function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, color: NAVY, size: 30 })],
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true, color: NAVY, size: 24 })],
  });
}

// Table helpers ---------------------------------------------------------------

function cellTextPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 0 },
    children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size ?? 20 })],
  });
}
function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: NAVY_DEEP, type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [cellTextPara(text, { bold: true, color: 'FFFFFF', size: 20 })],
  });
}
function bodyCell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    children: [cellTextPara(text, { bold: opts.bold, color: opts.color, size: 20 })],
  });
}

// Section: header banner ------------------------------------------------------

function titleBlock() {
  return [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: 'GA4 Visualisation Platform', bold: true, color: INK, size: 44 })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Project Plan — 6-Agent Pipeline', color: MUTED, size: 26 })],
    }),
    new Paragraph({
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 1 } },
      children: [
        new TextRun({ text: 'Owner: ', color: MUTED, size: 18 }),
        new TextRun({ text: 'Shubham Singh', size: 18 }),
        new TextRun({ text: '   ·   ', color: MUTED, size: 18 }),
        new TextRun({ text: 'Property: ', color: MUTED, size: 18 }),
        new TextRun({ text: 'joblet.ai (GA4 516147906)', size: 18 }),
        new TextRun({ text: '   ·   ', color: MUTED, size: 18 }),
        new TextRun({ text: 'Date: ', color: MUTED, size: 18 }),
        new TextRun({ text: 'May 21, 2026', size: 18 }),
      ],
    }),
  ];
}

// Agents table ---------------------------------------------------------------

const TABLE_W = 9360;  // content width on US Letter w/ 1" margins
const colsAgents = [600, 1600, 3400, 3760];

function agentsTable() {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('#', colsAgents[0]),
        headerCell('Agent', colsAgents[1]),
        headerCell('What it does', colsAgents[2]),
        headerCell('How it helps', colsAgents[3]),
      ],
    }),
    ...[
      ['1', 'Intent', 'Reads the English question; emits a structured note (metric, scope, ambiguities).', 'Turns messy English into a clean instruction the rest of the line can follow.'],
      ['2', 'Metrics', 'Translates the intent into a valid GA4 query, every field checked against our catalog.', 'Picks the right fields from hundreds; never invents a name — bad input is stopped here.'],
      ['3', 'Gaps', 'Checks region · source · timeline are all explicit before the query runs.', 'Pauses to ask one clear follow-up rather than firing off an underspecified query.'],
      ['4', 'Data Access', 'Hits the live GA4 API and returns raw rows + sampling/quality flags.', 'Only agent that touches GA4; re-validates fields one more time as a safety net.'],
      ['5', 'Data Handling', 'Reshapes rows into pivots, regional groups, derived metrics, neutral data-quality notes.', 'Turns flat rows into the shapes the visual layer needs. Flags facts, not opinions.'],
      ['6', 'Visualisation', 'Renders the finished HTML report — KPI strip, charts, tables, anomaly encoding.', 'Makes wrongness visible at a glance — without ever interpreting it in words.'],
    ].map(([n, name, does, helps], i) =>
      new TableRow({
        children: [
          bodyCell(n, colsAgents[0], { bold: true, fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
          bodyCell(name, colsAgents[1], { bold: true, fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
          bodyCell(does, colsAgents[2], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
          bodyCell(helps, colsAgents[3], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
        ],
      })
    ),
  ];
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: colsAgents,
    rows,
  });
}

// Risks table ----------------------------------------------------------------

const colsRisks = [4400, 4960];

function risksTable() {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('Risk', colsRisks[0]),
        headerCell('Mitigation', colsRisks[1]),
      ],
    }),
    ...[
      ['LLM rate limits during heavy testing', 'Three providers across the three LLM agents; per-agent env overrides; smoke tests rate-limit themselves.'],
      ['GA4 schema drift', 'Weekly catalog refresh script; loader warns when the catalog is > 14 days old.'],
      ['User asks something the agents can’t classify', 'Regex fallback parser planned; in the meantime, Agent 3 surfaces a clarification.'],
      ['Tracking issues in GA4 itself (e.g. broken apply events)', 'Agent 5 flags factually; Agent 6 encodes visually. We never fix GTM — read-only by design.'],
      ['Vercel 60s function timeout', 'Pipeline runs in 5–10 seconds end-to-end. Comfortable margin.'],
    ].map(([risk, mit], i) =>
      new TableRow({
        children: [
          bodyCell(risk, colsRisks[0], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
          bodyCell(mit, colsRisks[1], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
        ],
      })
    ),
  ];
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: colsRisks,
    rows,
  });
}

// Status table ---------------------------------------------------------------

const colsStatus = [1100, 4400, 3860];

function statusTable() {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('State', colsStatus[0]),
        headerCell('Component', colsStatus[1]),
        headerCell('Notes', colsStatus[2]),
      ],
    }),
    ...[
      ['Done', 'Agents 1–6', 'All built, tested against real GA4 data.'],
      ['Done', 'GA4 catalog (378 dimensions, 113 metrics, 10 events)', 'Generated from GA4 metadata + GTM snapshot.'],
      ['Done', 'Tool Layer (GA4 Data API connection)', '~1.5 s per query; supports Vercel JSON-inline credentials.'],
      ['Done', 'End-to-end demo runs', 'Engagement-rate KPI; organic traffic 14-week regional breakdown.'],
      ['Pending', 'React frontend wiring', 'Render Agent 6 output inside the Next.js /run page.'],
      ['Pending', 'Clarification loop in the UI', 'User’s answer to Agent 3 question feeds back through the pipeline.'],
      ['Pending', 'Vercel deployment', 'Repo init, env vars, auth (password or Google SSO).'],
      ['Pending', 'Catalog refresh automation', 'GitHub Actions cron — weekly.'],
    ].map(([state, comp, notes], i) =>
      new TableRow({
        children: [
          bodyCell(state, colsStatus[0], {
            bold: true,
            color: state === 'Done' ? '166534' : 'B45309',
            fill: state === 'Done' ? 'DCFCE7' : 'FEF3C7',
          }),
          bodyCell(comp, colsStatus[1], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
          bodyCell(notes, colsStatus[2], { fill: i % 2 === 0 ? 'F7F8FA' : undefined }),
        ],
      })
    ),
  ];
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: colsStatus,
    rows,
  });
}

// Build document --------------------------------------------------------------

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },  // 11pt body
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: 'Arial', size: 30, bold: true, color: NAVY },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: 'Arial', size: 24, bold: true, color: NAVY },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } } }],
      },
      {
        reference: 'numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } } }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },  // 0.75" top/bottom, 1" sides
      },
    },
    children: [
      ...titleBlock(),

      H1('1. What we’re building'),
      P('A web app where anyone on the team types a question about Google Analytics in plain English — "how many applies last week from Germany?", "what does organic traffic look like?" — and gets back a finished visual report: tables, charts, KPI cards, anomalies highlighted automatically.'),
      P('The system pulls the right data, organises it, and presents it. It does not interpret. The reader does the thinking; the report just makes the picture impossible to misread.'),

      H1('2. Why this is worth doing'),
      bullet('Marketing and growth need daily GA4 numbers. Today, those numbers come through a person who pulls them by hand.'),
      bullet('GA4’s own UI is fast for one person clicking around — slow for shared, repeatable reporting.'),
      bullet('Reports we’d otherwise build by hand in PDF (like the LinkedIn weekly traffic recap) can come out of a single typed question.'),

      H1('3. Success criteria'),
      numbered('A non-technical user can ask a GA4 question in plain English and get a finished report in under 30 seconds.'),
      numbered('Every report carries the framing the reader needs — period, region, source, sample size, data freshness — visibly, never implicitly.'),
      numbered('Anomalies (broken tracking, partial weeks, sampled data) are visually obvious through layout and colour, not buried in footnotes.'),
      numbered('The system never invents a field, a number, or an opinion. Every value is traceable back to GA4.'),

      H1('4. Architecture'),
      P('A linear pipeline of six small agents, each with one job. The orchestrator is plain code — no loops, no recursion.'),
      new Paragraph({
        spacing: { before: 80, after: 120 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: 'Question  →  Intent  →  Metrics  →  Gaps  →  Data Access  →  Data Handling  →  Visualisation  →  Report',
          font: 'Consolas', size: 20, color: NAVY,
        })],
      }),

      H1('5. The agents'),
      agentsTable(),
      P('Each agent refuses to do anything outside its lane. Agent 4 never interprets. Agent 5 never invents. Agent 6 never editorialises — it just shows the broken cell with a red border and lets the eye land there first.',
        { before: 80, italics: true, color: MUTED }),

      H1('6. Current status'),
      statusTable(),

      H1('7. Phases'),
      bullet('Phase 1 — Pipeline (done). Six agents, GA4 connection, catalog, contracts between agents.'),
      bullet('Phase 2 — Frontend integration (2–3 days). Wire Agent 6’s output into the Next.js /run page. Hook the clarification dialog so user answers feed back through.'),
      bullet('Phase 3 — Deploy (1 day). Git push to GitHub → Vercel import → env vars → password or Google SSO.'),
      bullet('Phase 4 — Stress test (1 week of real use). Team asks real questions. Patch whichever agent breaks first — likely Agent 1 (edge-case classifications) or Agent 2 (missing field combinations).'),
      bullet('Phase 5 — Optional. Richer derived metrics in Agent 5 (apply/session ratios, percentile ranks). More chart types in Agent 6 (heatmaps, small multiples). Additional sources (GSC) deferred.'),

      H1('8. Risks'),
      risksTable(),

      H1('9. Out of scope (explicitly)'),
      bullet('Diagnostic reasoning ("why is traffic down?") — the system surfaces facts, not causes.'),
      bullet('GTM modifications — read-only access by design.'),
      bullet('Multi-property comparison.'),
      bullet('Custom dashboards or pinned reports — every report is generated on demand from a question.'),
      bullet('Google Search Console integration (deferred).'),

      H1('10. Next 5 working days'),
      numbered('Wire Agent 6’s HTML output into the /run React page.'),
      numbered('Hook the Agent 3 clarification answers back into the pipeline.'),
      numbered('Initialise the git repo, push to GitHub, import into Vercel.'),
      numbered('Set env vars and credentials in Vercel; deploy preview.'),
      numbered('Add auth (password or Google SSO); share the URL with the team.'),

      new Paragraph({
        spacing: { before: 240, after: 0 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: 'End of plan. Living document — update as the agents change.',
          italics: true, color: MUTED, size: 18,
        })],
      }),
    ],
  }],
});

const OUT = path.join(__dirname, '..', 'docs', 'GA4-Viz-Platform-Project-Plan.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('WROTE:', OUT);
  console.log('size_bytes:', fs.statSync(OUT).size);
});
