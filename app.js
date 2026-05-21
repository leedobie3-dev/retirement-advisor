// ============================================================================
// app.js — Everything the user sees and interacts with.
//
// This file is the "front of house." It does not do any simulation math
// itself; that all happens in engine.js (running in a Web Worker thread).
//
// Responsibilities, in order:
//   1. Read the client's inputs from the sidebar form.
//   2. Send them to the engine and wait for the results to come back.
//   3. Take those results and paint the dashboard: hero KPIs, heatmap, fan
//      chart, terminal-wealth histogram, allocation donut, and two ranked
//      comparison tables.
//   4. Mark the "Run" button as "dirty" when the user edits a client field
//      so they know their changes are unsaved until they hit the button.
//
// Mapping to the Excel workbook:
//
//   readInputs()        ↔  Excel "Inputs" sheet (B4:B34): all client fields
//   readOpts()          ↔  Excel "Inputs" sheet: paths, block size, selected
//                          allocation, selected withdrawal
//   rankCombos()        ↔  the "HOW WE DETERMINE WHAT'S BEST" priority order
//                          described in the "read me" sheet
//   render()            ↔  Excel "Dashboard" sheet (top-level layout)
//   renderHeatmap()     ↔  Excel "MonteCarlo" sheet, B8:F13 (success grid)
//   renderAllocTable()  ↔  Excel "Dashboard" sheet, A25:G30
//   renderWDTable()     ↔  Excel "Dashboard" sheet, A34:G38
//   renderFan()         ↔  NEW — no Excel equivalent. Shows per-year wealth
//                          percentiles for the currently selected combo.
//   renderHist()        ↔  NEW — no Excel equivalent. Distribution of ending
//                          wealth across paths.
//   renderAllocDonut()  ↔  Visualization of Excel "Strategies" weights for
//                          the currently selected allocation.
// ============================================================================

import { ALLOCATIONS, WITHDRAWALS, STATIC_WEIGHTS } from './data.js';

// ---------- Helpers ----------
// $(...) is a shorthand for "find the HTML element with this id."
// The number formatters turn raw numbers into readable strings:
//   fmtMoney(1_500_000)  →  "$1.50M"
//   fmtMoneyFull(...)    →  "$1,500,000" (used in tooltips)
//   fmtPct(0.985)        →  "98.5%"
const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a/1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a/1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a/1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};
const fmtMoneyFull = (n) => n == null || !isFinite(n) ? '—' :
  `$${Math.round(n).toLocaleString('en-US')}`;
const fmtPct = (n) => n == null ? '—' : `${(n*100).toFixed(1)}%`;

const ALLOC_LABELS = {
  '60_40': '60/40 Classic',
  'EqualWeight': 'Equal Weight',
  'RiskParity': 'Risk Parity',
  'RobustRP': 'Robust Risk Parity',
  'GlidePath': 'Glide Path',
  'AgeBalanceAware': 'Age-Balance Aware',
};
const WD_LABELS = {
  'TradFirst': 'Traditional First',
  'RothFirst': 'Roth First',
  'TaxableFirst': 'Taxable First',
  'Proportional': 'Proportional',
  'TaxAware': 'Tax-Aware',
};

// ---------- State ----------
let lastResult = null;
let worker = null;
let charts = {};

// ---------- Inputs ----------
// readInputs() pulls every value out of the sidebar form into one plain object.
// This is the equivalent of reading cells B4:B34 on the Excel "Inputs" sheet.
function readInputs() {
  return {
    filing: $('filing').value,
    risk: $('risk').value,
    age_now: +$('age_now').value,
    age_ret: +$('age_ret').value,
    age_end: +$('age_end').value,
    taxable: +$('taxable').value,
    traditional: +$('traditional').value,
    roth: +$('roth').value,
    cost_basis: +$('cost_basis').value,
    savings: +$('savings').value,
    spending: +$('spending').value,
    ss_age: +$('ss_age').value,
    ss_amt: +$('ss_amt').value,
  };
}

// readOpts() pulls the simulation parameters (how many paths to run, the
// block length, the random seed, and which combo the user has selected).
function readOpts() {
  return {
    paths: +$('pathCount').value,
    blockLen: 3,
    seed: 42,
    model: $('returnModel').value,    // 'bootstrap' or 'markov'
    selAlloc: $('alloc').value,
    selWD: $('wd').value,
  };
}

// ---------- Worker plumbing ----------
// A "Worker" is a separate thread the browser runs the simulation in, so the
// page stays responsive while it crunches numbers. We talk to it by sending
// messages: the page posts "run" with the inputs; the worker posts back
// "progress" updates and finally a "result" message with all the numbers.
function showError(msg) {
  console.error('[Studio]', msg);
  $('overlayTitle').textContent = 'Simulation failed';
  $('overlaySub').textContent = String(msg).slice(0, 240);
  $('runBtn').disabled = false;
  markDirty();
}

function ensureWorker() {
  if (worker) return worker;
  try {
    worker = new Worker('./engine.js', { type: 'module' });
  } catch (e) {
    showError('Cannot start worker: ' + e.message + '. Module workers may not be supported in this browser.');
    return null;
  }
  worker.onerror = (e) => {
    showError(`Worker error: ${e.message || e.filename + ':' + e.lineno}`);
  };
  worker.onmessageerror = (e) => showError('Worker message error');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      $('progressBar').style.width = m.pct + '%';
      $('overlaySub').textContent = m.combo
        ? `Running ${ALLOC_LABELS[m.combo.split('_')[0]] || m.combo.split('_')[0]}, ${WD_LABELS[m.combo.split('_').slice(1).join('_')] || m.combo.split('_')[1]}`
        : m.stage;
    } else if (m.type === 'result') {
      lastResult = m;
      try { render(m); }
      catch (err) { showError('Render error: ' + (err.stack || err.message || err)); return; }
      $('overlay').classList.add('hidden');
      $('runBtn').disabled = false;
      markClean();
      $('progressBar').style.width = '100%';
      setTimeout(() => { $('progressBar').style.width = '0'; }, 600);
    } else if (m.type === 'error') {
      showError(m.error);
    }
  };
  return worker;
}

function runSim() {
  $('overlay').classList.remove('hidden');
  $('overlayTitle').textContent = 'Running';
  $('overlaySub').textContent = 'Resampling paths';
  $('runBtn').disabled = true;
  $('progressBar').style.width = '5%';
  const w = ensureWorker();
  if (!w) return;
  const inputs = readInputs();
  const opts = readOpts();
  w.postMessage({ type: 'run', inputs, opts });
}

// ---------- Recommendation ranking ----------
// rankCombos() applies the priority order described in the Excel "read me"
// sheet under "HOW WE DETERMINE WHAT'S 'BEST'":
//   1. Higher success rate wins.
//   2. Tie-break by P10 (sequence-risk floor) — protects against bad outcomes.
//   3. Tie-break by lower median lifetime tax (efficiency).
//   4. Tie-break by higher median terminal wealth (upside is last).
// The top-ranked combo gets the ★ marker in the heatmap and tables.
function rankCombos(combos) {
  const all = Object.entries(combos).map(([k, v]) => ({ key: k, ...v }));
  all.sort((a, b) => {
    if (b.success !== a.success) return b.success - a.success;
    if (b.p10 !== a.p10) return b.p10 - a.p10;
    if (a.median_tax !== b.median_tax) return a.median_tax - b.median_tax;
    return b.p50 - a.p50;
  });
  return all;
}

// ---------- Render ----------
// render() takes the worker's result and updates every visible part of the
// page. This is the equivalent of all the formulas on the Excel "Dashboard"
// sheet recalculating after you change an input.
function render(m) {
  const opts = readOpts();
  const sel = `${opts.selAlloc}_${opts.selWD}`;
  const combo = m.combos[sel];
  const ranked = rankCombos(m.combos);
  const top = ranked[0];

  // Hero
  $('heroAlloc').textContent = ALLOC_LABELS[opts.selAlloc];
  $('heroWD').textContent = WD_LABELS[opts.selWD];
  $('heroNotes').textContent = combo.success >= 0.95
    ? 'Clears the 95% threshold. P10 and tax efficiency drive the ranking below.'
    : combo.success >= 0.90
    ? 'Below the 95% threshold. Consider a more conservative withdrawal order or a higher-success allocation.'
    : 'High depletion risk. Not appropriate as a primary recommendation.';

  if (top.key !== sel) {
    $('heroRecommend').innerHTML = `Top-ranked by the decision rule: <span class="recommend-pill">${ALLOC_LABELS[top.key.split('_')[0]]}, ${WD_LABELS[top.key.split('_').slice(1).join('_')]}</span> at ${fmtPct(top.success)} success, ${fmtMoney(top.p10)} P10`;
  } else {
    $('heroRecommend').innerHTML = `<span class="recommend-pill">Top-ranked by the decision rule</span>`;
  }

  $('kpiSuccess').textContent = fmtPct(combo.success);
  $('kpiSuccessBar').style.width = (combo.success * 100) + '%';
  $('kpiSuccessBar').style.background = combo.success >= 0.95 ? '#3d6a3a' : combo.success >= 0.90 ? '#946d1a' : '#8a3a2a';
  $('kpiMedian').textContent = fmtMoney(combo.p50);
  $('kpiMedianSub').textContent = `P10 ${fmtMoney(combo.p10)}, P90 ${fmtMoney(combo.p90)}`;
  $('kpiTax').textContent = fmtMoney(combo.median_tax);

  // Meta
  $('metaModel').textContent = m.meta.model === 'markov' ? 'Markov 2-state' : 'Block Bootstrap';
  $('metaPaths').textContent = m.meta.nPaths.toLocaleString();
  $('metaHorizon').textContent = `${m.meta.nYears}y`;
  $('metaSeed').textContent = m.meta.seed;
  $('metaBlock').textContent = m.meta.model === 'markov' ? 'regime-based' : '3y';

  // Heatmap
  renderHeatmap(m.combos, opts, top.key);

  // Fan
  renderFan(m.fanData, opts);

  // Histogram
  renderHist(m.fanData);

  // Allocation donut
  renderAllocDonut(opts);

  // Tables
  renderAllocTable(m.combos, opts, top.key);
  renderWDTable(m.combos, opts, top.key);
}

// renderHeatmap() — builds the 6×5 grid showing success rate for every
// (allocation × withdrawal) combination. Excel equivalent: "MonteCarlo"
// sheet B8:F13. Click any cell to switch the selected combo.
function renderHeatmap(combos, opts, topKey) {
  const el = $('heatmap');
  el.innerHTML = '';
  // Empty top-left corner
  const corner = document.createElement('div');
  corner.className = 'hm-head'; corner.textContent = '';
  el.appendChild(corner);
  // Column headers (withdrawal strategies)
  for (const w of WITHDRAWALS) {
    const h = document.createElement('div');
    h.className = 'hm-head'; h.textContent = WD_LABELS[w];
    el.appendChild(h);
  }
  for (const a of ALLOCATIONS) {
    const rh = document.createElement('div');
    rh.className = 'hm-row-head'; rh.textContent = ALLOC_LABELS[a];
    el.appendChild(rh);
    for (const w of WITHDRAWALS) {
      const key = `${a}_${w}`;
      const c = combos[key];
      const cls = c.success >= 0.95 ? 'ok' : c.success >= 0.90 ? 'warn' : 'bad';
      const sel = (a === opts.selAlloc && w === opts.selWD) ? ' selected' : '';
      const top = key === topKey ? ' top' : '';
      const cell = document.createElement('div');
      cell.className = `hm-cell ${cls}${sel}${top}`;
      cell.innerHTML = `<span class="hm-v">${(c.success*100).toFixed(1)}%</span><span class="hm-s">P10 ${fmtMoney(c.p10)}</span>`;
      cell.title = `${ALLOC_LABELS[a]} × ${WD_LABELS[w]}\nSuccess: ${fmtPct(c.success)}\nP10: ${fmtMoneyFull(c.p10)}\nMedian: ${fmtMoneyFull(c.p50)}\nP90: ${fmtMoneyFull(c.p90)}\nMedian tax: ${fmtMoneyFull(c.median_tax)}`;
      cell.onclick = () => {
        $('alloc').value = a;
        $('wd').value = w;
        if (lastResult) render(lastResult);
      };
      el.appendChild(cell);
    }
  }
}

function destroyChart(name) {
  if (charts[name]) { charts[name].destroy(); charts[name] = null; }
}

// renderFan() — draws the year-by-year wealth chart for the selected combo,
// with shaded bands showing the P10-P90 and P25-P75 ranges around the median.
// This visualization is new; the Excel did not have an equivalent chart.
function renderFan(fd, opts) {
  destroyChart('fan');
  const ctx = $('fanChart').getContext('2d');
  const f = fd.fan;
  // Build "band" by stacking p10 -> p25-p10 -> p50-p25 -> p75-p50 -> p90-p75
  // Using filled line dataset technique via Chart.js fill-between.
  const labels = f.ages;
  charts.fan = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'P10', data: f.p10, borderColor: 'transparent', pointRadius: 0, fill: false },
        { label: 'P10 to P90', data: f.p90, backgroundColor: 'rgba(164,74,44,0.08)', borderColor: 'transparent', pointRadius: 0, fill: '-1' },
        { label: 'P25', data: f.p25, borderColor: 'transparent', pointRadius: 0, fill: false },
        { label: 'P25 to P75', data: f.p75, backgroundColor: 'rgba(164,74,44,0.20)', borderColor: 'transparent', pointRadius: 0, fill: '-1' },
        { label: 'Median', data: f.p50, borderColor: '#181818', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.2 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { filter: (it) => ['P10 to P90','P25 to P75','Median'].includes(it.text), color: '#5a5a5a', font: { size: 12, family: 'system-ui' }, boxWidth: 12, boxHeight: 8 } },
        tooltip: {
          backgroundColor: '#181818', titleFont: { family: 'system-ui' }, bodyFont: { family: 'system-ui' },
          callbacks: {
            title: (it) => `Age ${it[0].label}`,
            label: (it) => `${it.dataset.label}: ${fmtMoneyFull(it.parsed.y)}`,
          },
          filter: (it) => ['Median','P10','P25','P75','P90'].some(l => it.dataset.label.includes(l)),
        }
      },
      scales: {
        x: { title: { display: true, text: 'Age', color: '#9a9a9a', font: { size: 12, family: 'system-ui' } }, grid: { color: '#ececea' }, ticks: { color: '#9a9a9a', font: { family: 'system-ui' } } },
        y: { title: { display: true, text: 'Real wealth', color: '#9a9a9a', font: { size: 12, family: 'system-ui' } }, grid: { color: '#ececea' }, ticks: { color: '#9a9a9a', font: { family: 'system-ui' }, callback: (v) => fmtMoney(v) } }
      }
    }
  });
}

// renderHist() — histogram of ending wealth across all paths for the
// selected combo. The leftmost bar is the depleted-paths bucket (shown in
// darker red). New visualization; no Excel equivalent.
function renderHist(fd) {
  destroyChart('hist');
  const ctx = $('termHist').getContext('2d');
  const arr = fd.terms.slice().sort((a,b)=>a-b);
  const max = arr[arr.length-1] || 1;
  // 30 bins, log-ish: use linear up to P99 to avoid tail squashing
  const p99 = arr[Math.floor(arr.length*0.99)] || max;
  const top = Math.min(max, p99 * 1.4);
  const bins = 30;
  const w = top / bins;
  const counts = new Array(bins).fill(0);
  for (const v of arr) {
    if (v < 0) continue;
    const i = Math.min(bins - 1, Math.floor(v / w));
    counts[i]++;
  }
  const labels = counts.map((_, i) => fmtMoney(i * w));
  charts.hist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: counts.map((_, i) => i === 0 ? '#8a3a2a' : '#a44a2c'),
        borderRadius: 0,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#181818', titleFont: { family: 'system-ui' }, bodyFont: { family: 'system-ui' },
          callbacks: {
            title: (it) => `At least ${it[0].label}`,
            label: (it) => `${it.parsed.y} paths`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9a9a9a', font: { family: 'system-ui' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: '#ececea' }, ticks: { color: '#9a9a9a', font: { family: 'system-ui' } }, title: { display: true, text: 'Paths', color: '#9a9a9a', font: { family: 'system-ui' } } }
      }
    }
  });
}

// renderAllocDonut() — pie chart of asset-class weights for the selected
// allocation. For the four static strategies it pulls from STATIC_WEIGHTS
// in data.js; for the two dynamic strategies it shows a representative
// mid-retirement weighting (10 years after the client's retirement age).
function renderAllocDonut(opts) {
  destroyChart('donut');
  const ctx = $('allocDonut').getContext('2d');
  let weights = STATIC_WEIGHTS[opts.selAlloc];
  let dynamic = false;
  if (!weights) {
    // Show typical mid-retirement weights for dynamic strategies
    const age = +$('age_ret').value + 10;
    const mult = { Conservative: 0.8, Moderate: 1.0, Aggressive: 1.2 }[$('risk').value] || 1;
    if (opts.selAlloc === 'GlidePath') {
      const eq = Math.max(0.20, Math.min(0.95, ((110 - age) / 100) * mult));
      weights = [eq, 1 - eq, 0, 0];
    } else {
      const eq = Math.max(0.20, Math.min(0.95, ((110 - age) / 100) * mult - 0.05));
      const stk = eq * 0.65, re = eq * 0.20, com = eq * 0.15;
      weights = [stk, 1 - stk - re - com, re, com];
    }
    dynamic = true;
  }
  const labels = ['Stocks', 'Bonds', 'Real estate', 'Commodities'];
  const colors = ['#181818', '#a44a2c', '#7a8a6a', '#d8a878'];
  charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: weights, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (it) => `${it.label}: ${(it.parsed*100).toFixed(1)}%` } }
      }
    }
  });
  const leg = $('allocLegend');
  leg.innerHTML = '';
  weights.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'alloc-legend-row';
    row.innerHTML = `<div class="sw"><div class="dot" style="background:${colors[i]}"></div>${labels[i]}</div><div class="val">${(w*100).toFixed(1)}%</div>`;
    leg.appendChild(row);
  });
  if (dynamic) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:#9a9a9a;margin-top:8px;';
    note.textContent = `Dynamic, weights shown for age ${+$('age_ret').value + 10}`;
    leg.appendChild(note);
  }
}

// renderAllocTable() — holds the withdrawal strategy fixed and compares all
// six allocations side by side. Excel equivalent: "Dashboard" sheet A25:G30.
// The fill bar in the last column shows each row's Median as a fraction of
// the largest Median in the table (quick eyeball rank).
function renderAllocTable(combos, opts, topKey) {
  const tbody = $('allocTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('allocCmpWD').textContent = WD_LABELS[opts.selWD];
  const rows = ALLOCATIONS.map(a => {
    const c = combos[`${a}_${opts.selWD}`];
    return { alloc: a, ...c };
  });
  rows.sort((a, b) => b.success - a.success || b.p10 - a.p10);
  const maxP50 = Math.max(...rows.map(r => r.p50));
  for (const r of rows) {
    const sel = r.alloc === opts.selAlloc ? ' selected' : '';
    const isTop = `${r.alloc}_${opts.selWD}` === topKey ? ' top-rec' : '';
    const cls = r.success >= 0.95 ? 'ok' : r.success >= 0.90 ? 'warn' : 'bad';
    const tr = document.createElement('tr');
    tr.className = `${sel}${isTop}`.trim();
    tr.innerHTML = `
      <td>${ALLOC_LABELS[r.alloc]}</td>
      <td><span class="pill ${cls}">${fmtPct(r.success)}</span></td>
      <td>${fmtMoney(r.p10)}</td>
      <td>${fmtMoney(r.p50)}</td>
      <td>${fmtMoney(r.p90)}</td>
      <td>${fmtMoney(r.median_tax)}</td>
      <td>${fmtPct(r.depletion)}</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${(r.p50/maxP50*100).toFixed(0)}%"></div></div></td>
    `;
    tr.onclick = () => { $('alloc').value = r.alloc; if (lastResult) render(lastResult); };
    tr.style.cursor = 'pointer';
    tbody.appendChild(tr);
  }
}

// renderWDTable() — the mirror of renderAllocTable: holds the allocation
// fixed and compares all five withdrawal strategies. Excel equivalent:
// "Dashboard" sheet A34:G38.
function renderWDTable(combos, opts, topKey) {
  const tbody = $('wdTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('wdCmpAlloc').textContent = ALLOC_LABELS[opts.selAlloc];
  const rows = WITHDRAWALS.map(w => {
    const c = combos[`${opts.selAlloc}_${w}`];
    return { wd: w, ...c };
  });
  rows.sort((a, b) => b.success - a.success || b.p10 - a.p10);
  const maxP50 = Math.max(...rows.map(r => r.p50));
  for (const r of rows) {
    const sel = r.wd === opts.selWD ? ' selected' : '';
    const isTop = `${opts.selAlloc}_${r.wd}` === topKey ? ' top-rec' : '';
    const cls = r.success >= 0.95 ? 'ok' : r.success >= 0.90 ? 'warn' : 'bad';
    const tr = document.createElement('tr');
    tr.className = `${sel}${isTop}`.trim();
    tr.innerHTML = `
      <td>${WD_LABELS[r.wd]}</td>
      <td><span class="pill ${cls}">${fmtPct(r.success)}</span></td>
      <td>${fmtMoney(r.p10)}</td>
      <td>${fmtMoney(r.p50)}</td>
      <td>${fmtMoney(r.p90)}</td>
      <td>${fmtMoney(r.median_tax)}</td>
      <td>${fmtPct(r.depletion)}</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${(r.p50/maxP50*100).toFixed(0)}%"></div></div></td>
    `;
    tr.onclick = () => { $('wd').value = r.wd; if (lastResult) render(lastResult); };
    tr.style.cursor = 'pointer';
    tbody.appendChild(tr);
  }
}

// ---------- Input wiring ----------
// Hook up the form controls so they actually do things:
//   - Clicking "Run Simulation" triggers a full rerun.
//   - Changing the selected allocation or withdrawal just repaints the
//     dashboard with already-computed data (no simulation needed).
//   - Editing any client field marks the Run button as "dirty" (turns it
//     terracotta) so the user knows the simulation is stale until they
//     click it. The simulation deliberately does NOT auto-run on every
//     keystroke — that would be expensive and disorienting.
$('runBtn').onclick = runSim;

// Re-render (no full re-sim) when selection changes
['alloc','wd'].forEach(id => {
  $(id).addEventListener('change', () => {
    if (lastResult) render(lastResult);
  });
});

// Mark the Run button as "dirty" when client-profile inputs change, so the user
// knows their edits haven't been applied yet. The run only fires on click.
const reSimInputs = ['filing','risk','age_now','age_ret','age_end','taxable','traditional','roth','cost_basis','savings','spending','ss_age','ss_amt','pathCount','returnModel'];
function markDirty() {
  const btn = $('runBtn');
  btn.classList.add('dirty');
  btn.textContent = 'Apply Changes';
}
function markClean() {
  const btn = $('runBtn');
  btn.classList.remove('dirty');
  btn.textContent = 'Run Simulation';
}
reSimInputs.forEach(id => {
  $(id).addEventListener('input', markDirty);
  $(id).addEventListener('change', markDirty);
});

// Initial run
runSim();
