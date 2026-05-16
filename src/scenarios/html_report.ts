// ============================================================
// HTML Report Generator (Phase 6)
// Converts SimulationResult (and optional DayResult) into a
// standalone self-contained HTML file with:
//   - Win-rate bar chart (SVG)
//   - Per-combatant stats table
//   - Round distribution histogram (SVG)
//   - Multi-encounter day view (if DayResult supplied)
//   - Zero external dependencies — drop file anywhere and open
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { SimulationResult, CombatantStats } from './simulate';
import { DayResult } from './multiencounter';

// ---- Helpers ------------------------------------------------

function pct(n: number, decimals = 1): string {
  return (n * 100).toFixed(decimals) + '%';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- SVG win-rate bar chart ---------------------------------

function winRateBars(result: SimulationResult): string {
  const W = 540;
  const BAR_H = 32;
  const GAP = 12;
  const LABEL_W = 90;
  const PCT_W = 52;
  const BAR_W = W - LABEL_W - PCT_W - 16;

  const rows: Array<{ label: string; rate: number; color: string }> = [
    { label: 'Party wins',  rate: result.partyWinRate, color: '#1D9E75' },
    { label: 'Enemy wins',  rate: result.enemyWinRate, color: '#D85A30' },
    { label: 'Draws',       rate: result.drawRate,     color: '#888780' },
  ].filter(r => r.rate > 0);

  const H = rows.length * (BAR_H + GAP) - GAP + 16;

  const bars = rows.map((row, i) => {
    const y = i * (BAR_H + GAP);
    const w = Math.round(row.rate * BAR_W);
    return `
      <text x="${LABEL_W - 8}" y="${y + BAR_H / 2 + 5}" text-anchor="end"
            font-size="13" fill="#5F5E5A">${esc(row.label)}</text>
      <rect x="${LABEL_W}" y="${y}" width="${BAR_W}" height="${BAR_H}"
            rx="4" fill="#F1EFE8" />
      <rect x="${LABEL_W}" y="${y}" width="${w}" height="${BAR_H}"
            rx="4" fill="${row.color}" />
      <text x="${LABEL_W + w + 8}" y="${y + BAR_H / 2 + 5}"
            font-size="13" fill="#444441">${pct(row.rate)}</text>`;
  }).join('\n');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
          style="width:100%;max-width:${W}px;display:block">
    ${bars}
  </svg>`;
}

// ---- SVG round distribution histogram -----------------------

function roundHistogram(result: SimulationResult): string {
  if (result.runResults.length === 0) return '';

  // Bucket round counts
  const counts = new Map<number, number>();
  for (const r of result.runResults) {
    counts.set(r.rounds, (counts.get(r.rounds) ?? 0) + 1);
  }
  const minR = Math.min(...counts.keys());
  const maxR = Math.max(...counts.keys());
  const buckets: number[] = [];
  for (let i = minR; i <= maxR; i++) buckets.push(counts.get(i) ?? 0);

  const W = 540;
  const H = 140;
  const PAD = { top: 10, right: 10, bottom: 30, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(...buckets);
  const barW = Math.max(4, Math.floor(chartW / buckets.length) - 2);

  const bars = buckets.map((cnt, i) => {
    const bh = maxCount > 0 ? Math.round((cnt / maxCount) * chartH) : 0;
    const x = PAD.left + Math.round((i / buckets.length) * chartW);
    const y = PAD.top + chartH - bh;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2" fill="#378ADD" opacity="0.75"/>`;
  }).join('\n');

  // X-axis labels (every 2 or 3 rounds)
  const step = buckets.length > 20 ? 3 : buckets.length > 10 ? 2 : 1;
  const xLabels = buckets.map((_, i) => {
    if (i % step !== 0) return '';
    const r = minR + i;
    const x = PAD.left + Math.round((i / buckets.length) * chartW) + barW / 2;
    return `<text x="${x}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#888780">${r}</text>`;
  }).join('');

  // Y-axis label
  const yLabel = `<text x="12" y="${PAD.top + chartH / 2}" text-anchor="middle"
    font-size="11" fill="#888780" transform="rotate(-90,12,${PAD.top + chartH / 2})">runs</text>`;

  // Baseline
  const baseline = `<line x1="${PAD.left}" y1="${PAD.top + chartH}"
    x2="${W - PAD.right}" y2="${PAD.top + chartH}"
    stroke="#D3D1C7" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
          style="width:100%;max-width:${W}px;display:block">
    ${yLabel}${baseline}${bars}${xLabels}
  </svg>`;
}

// ---- Per-combatant table rows -------------------------------

function combatantRows(stats: CombatantStats[], partyIds: Set<string>): string {
  return stats.map(s => {
    const isParty = partyIds.has(s.id);
    const badge = isParty
      ? `<span class="badge party">party</span>`
      : `<span class="badge enemy">enemy</span>`;
    const survColor = s.survivalRate >= 0.75 ? '#0F6E56'
                    : s.survivalRate >= 0.4  ? '#BA7517'
                    :                           '#993C1D';
    const surv  = s.survivalRate.toFixed(4);
    const dmg   = s.avgDamageDealt.toFixed(1);
    const hp    = s.avgHpRemaining.toFixed(1);
    const alive = s.avgRoundsAlive.toFixed(1);
    return `<tr>
      <td data-val="${esc(s.name)}">${esc(s.name)} ${badge}</td>
      <td data-val="${surv}" style="color:${survColor};font-weight:500">${pct(s.survivalRate)}</td>
      <td data-val="${dmg}">${dmg}</td>
      <td data-val="${hp}">${hp}</td>
      <td data-val="${alive}">${alive}</td>
    </tr>`;
  }).join('\n');
}

// ---- Day result section (optional) -------------------------

function daySection(day: DayResult): string {
  const W = 540;
  const BAR_H = 22;
  const GAP = 8;
  const LABEL_W = 150;
  const PCT_W = 52;
  const BAR_W = W - LABEL_W - PCT_W - 16;

  const rows = day.encounters.map((enc, i) => {
    const label = day.labels[i] ?? `Encounter ${i + 1}`;
    const rate = enc.partyWinRate;
    const w = Math.round(rate * BAR_W);
    const color = rate >= 0.65 ? '#1D9E75' : rate >= 0.35 ? '#BA7517' : '#D85A30';
    const y = i * (BAR_H + GAP);
    return `
      <text x="${LABEL_W - 8}" y="${y + BAR_H / 2 + 4}" text-anchor="end"
            font-size="12" fill="#5F5E5A">${esc(label)}</text>
      <rect x="${LABEL_W}" y="${y}" width="${BAR_W}" height="${BAR_H}"
            rx="3" fill="#F1EFE8"/>
      <rect x="${LABEL_W}" y="${y}" width="${w}" height="${BAR_H}"
            rx="3" fill="${color}"/>
      <text x="${LABEL_W + w + 8}" y="${y + BAR_H / 2 + 4}"
            font-size="12" fill="#444441">${pct(rate)}</text>`;
  }).join('');

  const svgH = day.encounters.length * (BAR_H + GAP) - GAP + 16;

  return `
    <section>
      <h2>Adventuring day</h2>
      <svg viewBox="0 0 ${W} ${svgH}" xmlns="http://www.w3.org/2000/svg"
           style="width:100%;max-width:${W}px;display:block;margin-bottom:1rem">
        ${rows}
      </svg>
    </section>`;
}

// ---- CSS ----------------------------------------------------

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.6;
    background: #F7F6F2; color: #2C2C2A;
    padding: 2rem 1rem;
  }
  .container { max-width: 680px; margin: 0 auto; }
  header { margin-bottom: 2rem; }
  header h1 { font-size: 22px; font-weight: 600; color: #2C2C2A; }
  header .meta { font-size: 13px; color: #888780; margin-top: 4px; }
  section { background: #fff; border: 1px solid #E2E0D8;
            border-radius: 12px; padding: 1.25rem 1.5rem;
            margin-bottom: 1.25rem; }
  h2 { font-size: 14px; font-weight: 600; text-transform: uppercase;
       letter-spacing: 0.06em; color: #888780; margin-bottom: 1rem; }
  .section-header { display:flex; align-items:center;
                    justify-content:space-between; margin-bottom:1rem; }
  .section-header h2 { margin-bottom:0; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
               gap: 12px; margin-bottom: 1.25rem; }
  .stat { background: #F7F6F2; border-radius: 8px; padding: 0.75rem 1rem; }
  .stat-label { font-size: 11px; color: #888780; text-transform: uppercase;
                letter-spacing: 0.05em; margin-bottom: 4px; }
  .stat-value { font-size: 20px; font-weight: 600; color: #2C2C2A; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase;
       letter-spacing: 0.05em; color: #888780; padding: 0 8px 8px 0;
       border-bottom: 1px solid #E2E0D8; cursor:pointer; user-select:none;
       white-space:nowrap; }
  th:hover { color: #2C2C2A; }
  th .sort-icon { display:inline-block; margin-left:4px; opacity:0.35; font-style:normal; }
  th.sorted-asc .sort-icon, th.sorted-desc .sort-icon { opacity:1; }
  td { padding: 8px 8px 8px 0; border-bottom: 0.5px solid #F1EFE8; vertical-align: middle; }
  tbody tr:hover td { background: #FAFAF7; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; font-size: 10px; padding: 2px 7px;
           border-radius: 99px; margin-left: 6px; font-weight: 500; }
  .badge.party { background: #E1F5EE; color: #0F6E56; }
  .badge.enemy { background: #FAECE7; color: #993C1D; }
  .btn { font-size:11px; padding:4px 10px; border-radius:6px;
         border:1px solid #D0CEC5; background:#F7F6F2; color:#5F5E5A;
         cursor:pointer; font-family:inherit; }
  .btn:hover { background:#EDECEA; }
  footer { font-size: 12px; color: #B4B2A9; text-align: center; margin-top: 1.5rem; }
  a { color: #185FA5; text-decoration: none; }
`;

// ── Inline JS: click-to-sort + CSV export ────────────────────

const JS = `
(function(){
  var tbl=document.getElementById('combatant-table');
  if(!tbl)return;
  var tbody=tbl.querySelector('tbody');
  var ths=Array.from(tbl.querySelectorAll('thead th'));
  var types=ths.map(function(h){return h.dataset.sort||'text';});
  var col=-1,asc=true;
  ths.forEach(function(th,ci){
    th.innerHTML=th.textContent+'<em class="sort-icon">&#11021;</em>';
    th.addEventListener('click',function(){
      if(col===ci){asc=!asc;}else{col=ci;asc=true;}
      ths.forEach(function(h){h.classList.remove('sorted-asc','sorted-desc');
        var ic=h.querySelector('.sort-icon');if(ic)ic.textContent='&#11021;';});
      th.classList.add(asc?'sorted-asc':'sorted-desc');
      var ic=th.querySelector('.sort-icon');
      if(ic)ic.textContent=asc?'&#9650;':'&#9660;';
      var rows=Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a,b){
        var av=a.cells[ci]?a.cells[ci].dataset.val||a.cells[ci].textContent.trim():'';
        var bv=b.cells[ci]?b.cells[ci].dataset.val||b.cells[ci].textContent.trim():'';
        var cmp=types[ci]==='num'?parseFloat(av||'0')-parseFloat(bv||'0'):av.localeCompare(bv);
        return asc?cmp:-cmp;
      });
      rows.forEach(function(r){tbody.appendChild(r);});
    });
  });
  var btn=document.getElementById('btn-csv');
  if(btn)btn.addEventListener('click',function(){
    var lines=[ths.map(function(th){
      return '"'+(th.textContent||'').replace(/[&#9650;&#9660;&#11021;]/g,'').trim()+'"';
    }).join(',')];
    Array.from(tbody.querySelectorAll('tr')).forEach(function(row){
      lines.push(Array.from(row.cells).map(function(td){
        return '"'+(td.dataset.val||td.textContent||'').trim().replace(/"/g,'""')+'"';
      }).join(','));
    });
    var blob=new Blob([lines.join('\n')],{type:'text/csv'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='combat-stats.csv';a.click();
  });
})();
`;

// ---- Main export --------------------------------------------

export interface HTMLReportOptions {
  title?: string;
  /** IDs of party members (used to colour badge in table) */
  partyIds?: string[];
  day?: DayResult;
}

/**
 * Generate a standalone HTML report from a SimulationResult.
 *
 * @example
 * const html = generateHTMLReport(result, { title: 'Fighter vs Zombie Horde', partyIds: ['fighter-1'] });
 * fs.writeFileSync('report.html', html);
 */
export function generateHTMLReport(
  result: SimulationResult,
  opts: HTMLReportOptions = {}
): string {
  const title = opts.title ?? 'D&D 5e Combat Simulation';
  const partySet = new Set<string>(opts.partyIds ?? []);
  const now = new Date().toLocaleString();

  const statsTable = combatantRows(result.combatantStats, partySet);
  const winBars    = winRateBars(result);
  const histogram  = roundHistogram(result);
  const daySec     = opts.day ? daySection(opts.day) : '';

  const avgRoundsStr = result.avgRounds.toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>${CSS}</style>
</head>
<body>
<div class="container">

  <header>
    <h1>${esc(title)}</h1>
    <div class="meta">Generated ${now} &nbsp;·&nbsp; ${result.runs} simulations</div>
  </header>

  <section>
    <h2>Outcome</h2>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Party win rate</div>
        <div class="stat-value">${pct(result.partyWinRate)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Enemy win rate</div>
        <div class="stat-value">${pct(result.enemyWinRate)}</div>
      </div>
      ${result.drawRate > 0 ? `<div class="stat">
        <div class="stat-label">Draw rate</div>
        <div class="stat-value">${pct(result.drawRate)}</div>
      </div>` : ''}
      <div class="stat">
        <div class="stat-label">Avg rounds</div>
        <div class="stat-value">${avgRoundsStr}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Round range</div>
        <div class="stat-value">${result.minRounds}–${result.maxRounds}</div>
      </div>
    </div>
    ${winBars}
  </section>

  <section>
    <h2>Round distribution</h2>
    ${histogram || '<p style="color:#888780;font-size:13px">No per-run data available (runResults empty).</p>'}
  </section>

  <section>
    <div class="section-header">
      <h2>Per-combatant statistics</h2>
      <button class="btn" id="btn-csv">Export CSV</button>
    </div>
    <table id="combatant-table">
      <thead>
        <tr>
          <th data-sort="text">Name</th>
          <th data-sort="num">Survival</th>
          <th data-sort="num">Avg dmg dealt</th>
          <th data-sort="num">Avg HP left</th>
          <th data-sort="num">Avg rounds alive</th>
        </tr>
      </thead>
      <tbody>
        ${statsTable}
      </tbody>
    </table>
  </section>

  ${daySec}

  <footer>
    D&amp;D 5e Combat Sim &nbsp;·&nbsp;
    <a href="https://github.com/mcabel/dnd-combat-sim">github.com/mcabel/dnd-combat-sim</a>
  </footer>

</div>
<script>${JS}</script>
</body>
</html>`;
}

/**
 * Write the HTML report to disk.
 * Creates parent directories if they don't exist.
 *
 * @returns Resolved absolute path of the file written.
 */
export function saveHTMLReport(
  result: SimulationResult,
  outputPath: string,
  opts: HTMLReportOptions = {}
): string {
  const resolved = path.resolve(outputPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, generateHTMLReport(result, opts), 'utf-8');
  return resolved;
}
