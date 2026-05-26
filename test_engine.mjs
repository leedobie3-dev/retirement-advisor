// Node.js test harness for engine logic.
// Runs simulations with various inputs to verify behavior.
// Usage: node test_engine.mjs

// Mock the postMessage / Worker environment
globalThis.postMessage = (msg) => {
  if (msg.type === 'result') globalThis._lastResult = msg;
  if (msg.type === 'error') console.error('ENGINE ERROR:', msg.error);
};

// Mock onmessage assignment (engine.js assigns to onmessage at the end)
globalThis._onmessage = null;
Object.defineProperty(globalThis, 'onmessage', {
  set: (fn) => { globalThis._onmessage = fn; },
  get: () => globalThis._onmessage,
});

// Dynamic import (engine.js is an ES module)
const engine = await import('./engine.js');

// Run a simulation with given inputs
function runSim(inputs, opts = {}) {
  const fullOpts = {
    paths: 2000,
    blockLen: 3,
    seed: 42,
    model: 'bootstrap',
    selAlloc: 'EqualWeight',
    selWD: 'TradFirst',
    ...opts,
  };
  globalThis._lastResult = null;
  globalThis._onmessage({ data: { type: 'run', inputs, opts: fullOpts } });
  return globalThis._lastResult;
}

// Default inputs (matches index.html defaults)
const DEFAULTS = {
  filing: 'Single', risk: 'Moderate',
  age_now: 44, age_ret: 66, age_end: 105,
  taxable: 250000, traditional: 400010, roth: 100000, cost_basis: 200000,
  savings: 30000, spending: 80050,
  ss_age: 67, ss_amt: 30000,
};

// === Tests ===

console.log('=== Test 1: Baseline simulation ===');
let r = runSim(DEFAULTS);
console.log('Combos returned:', Object.keys(r.combos).length);
const baseSel = r.combos['EqualWeight_TradFirst'];
console.log('EqualWeight/TradFirst:', {
  success: baseSel.success,
  p10: Math.round(baseSel.p10),
  p50: Math.round(baseSel.p50),
  p90: Math.round(baseSel.p90),
  median_tax: Math.round(baseSel.median_tax),
});
// Check for undefined values
for (const [key, c] of Object.entries(r.combos)) {
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined || Number.isNaN(v)) {
      console.error(`  UNDEFINED/NaN in ${key}.${k}:`, v);
    }
  }
}

console.log('\n=== Test 2: Trad=0 → TradFirst vs RothFirst ===');
r = runSim({ ...DEFAULTS, traditional: 0 });
const tradFirst = r.combos['EqualWeight_TradFirst'];
const rothFirst = r.combos['EqualWeight_RothFirst'];
console.log('TradFirst (trad=0):', { p50: Math.round(tradFirst.p50), success: tradFirst.success, tax: Math.round(tradFirst.median_tax) });
console.log('RothFirst (trad=0):', { p50: Math.round(rothFirst.p50), success: rothFirst.success, tax: Math.round(rothFirst.median_tax) });
console.log('Difference in p50:', Math.round(tradFirst.p50 - rothFirst.p50));
console.log('Difference in tax:', Math.round(tradFirst.median_tax - rothFirst.median_tax));
console.log('(Both should differ — order of Tax vs Roth matters)');

console.log('\n=== Test 3: Cost basis > taxable balance ===');
r = runSim({ ...DEFAULTS, taxable: 100000, cost_basis: 300000 });
const test3 = r.combos['EqualWeight_TaxableFirst'];
console.log('Result with cost_basis(300k) > taxable(100k):', {
  p50: Math.round(test3.p50),
  median_tax: Math.round(test3.median_tax),
});

console.log('\n=== Test 4: Spending sensitivity ===');
const lowSpend = runSim({ ...DEFAULTS, spending: 50000 }).combos['EqualWeight_TradFirst'];
const midSpend = runSim({ ...DEFAULTS, spending: 80000 }).combos['EqualWeight_TradFirst'];
const hiSpend  = runSim({ ...DEFAULTS, spending: 120000 }).combos['EqualWeight_TradFirst'];
console.log('Spend=50k median:', Math.round(lowSpend.p50), 'success:', lowSpend.success);
console.log('Spend=80k median:', Math.round(midSpend.p50), 'success:', midSpend.success);
console.log('Spend=120k median:', Math.round(hiSpend.p50), 'success:', hiSpend.success);
console.log('(median should DECREASE and success should DECREASE as spending increases)');

console.log('\n=== Test 5: All allocations / withdrawals have valid output ===');
r = runSim(DEFAULTS);
let problems = 0;
for (const [key, c] of Object.entries(r.combos)) {
  if (c.p50 === undefined || c.p10 === undefined || c.success === undefined) {
    console.error(`  Missing field in ${key}`);
    problems++;
  }
  if (!Number.isFinite(c.p50) || !Number.isFinite(c.median_tax)) {
    console.error(`  Non-finite in ${key}:`, c);
    problems++;
  }
}
console.log(problems === 0 ? '  All 30 combos OK' : `  ${problems} problems found`);

console.log('\n=== Test 6: RMD surplus handling (post-retirement) ===');
// High traditional + low spending → RMD forces over-withdrawal from trad.
// After fix: surplus should land in taxable, raising terminal wealth.
// Older client makes RMD bite sooner.
const rmdInputs = {
  ...DEFAULTS,
  age_now: 60, age_ret: 62, age_end: 95,  // shorter horizon, retire at 62
  taxable: 100000, traditional: 2000000, roth: 100000, cost_basis: 100000,
  savings: 0, spending: 60000,  // small spending vs huge trad balance
  ss_age: 67, ss_amt: 30000,
};
r = runSim(rmdInputs);
const tradFirstRmd = r.combos['EqualWeight_TradFirst'];
const taxableFirstRmd = r.combos['EqualWeight_TaxableFirst'];
console.log('TradFirst (high trad, low spend):', { p50: Math.round(tradFirstRmd.p50), success: tradFirstRmd.success });
console.log('TaxableFirst (forces RMD topup):', { p50: Math.round(taxableFirstRmd.p50), success: taxableFirstRmd.success });
console.log('(With RMD fix, TaxableFirst should NOT lose the RMD-surplus cash anymore)');

console.log('\n=== Tests done ===');

console.log('\n=== Test 7: All-strategies-fail case ===');
// Tiny balances + huge spending + no SS → all 30 strategies should hit 0% success
const failInputs = {
  ...DEFAULTS,
  taxable: 1000, traditional: 1000, roth: 1000, cost_basis: 1000,
  savings: 0, spending: 200000,
  ss_age: 67, ss_amt: 0,
  age_now: 60, age_ret: 62, age_end: 95,
};
r = runSim(failInputs);
const allFails = Object.values(r.combos).every(c => c.success === 0);
console.log('All 30 combos have 0% success:', allFails);
if (allFails) {
  // Sort by median tax ascending to see who "wins" the tiebreaker
  const ranked = Object.entries(r.combos)
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.success - a.success || b.p10 - a.p10 || a.median_tax - b.median_tax);
  console.log('Top 3 by tax-tiebreaker:');
  for (const c of ranked.slice(0, 3)) {
    console.log(`  ${c.k}: tax=$${Math.round(c.median_tax).toLocaleString()}, p50=$${Math.round(c.p50).toLocaleString()}`);
  }
  console.log('Bottom 3 by tax-tiebreaker:');
  for (const c of ranked.slice(-3)) {
    console.log(`  ${c.k}: tax=$${Math.round(c.median_tax).toLocaleString()}, p50=$${Math.round(c.p50).toLocaleString()}`);
  }
}

console.log('\n=== Test 8: explainTopRank output for different scenarios ===');
// Inline the logic since we can't import from app.js (DOM-bound)
const ALLOC_LABELS = {'60_40':'60/40 Classic','EqualWeight':'Equal Weight','RiskParity':'Risk Parity','RobustRP':'Robust Risk Parity','GlidePath':'Glide Path','AgeBalanceAware':'Age-Balance Aware'};
const WD_LABELS = {'TradFirst':'Traditional First','RothFirst':'Roth First','TaxableFirst':'Taxable First','Proportional':'Proportional','TaxAware':'Tax-Aware'};
const ALLOC_KEYS = ['60_40','EqualWeight','RiskParity','RobustRP','GlidePath','AgeBalanceAware'];
function splitComboKey(key) {
  for (const a of ALLOC_KEYS) if (key.startsWith(a + '_')) return [a, key.slice(a.length + 1)];
  return key.split('_');
}
function fmtMoney(n){if(!isFinite(n))return'—';const a=Math.abs(n);return n<0?'-':''+(a>=1e9?`$${(a/1e9).toFixed(2)}B`:a>=1e6?`$${(a/1e6).toFixed(2)}M`:a>=1e3?`$${(a/1e3).toFixed(0)}k`:`$${a.toFixed(0)}`)}
function fmtPct(n){return`${(n*100).toFixed(1)}%`}

function explainTie(top, runner) {
  const [topA, topW] = splitComboKey(top.key);
  const [runA, runW] = splitComboKey(runner.key);
  const runnerName = `${ALLOC_LABELS[runA]} + ${WD_LABELS[runW]}`;
  if (Math.abs(top.success - runner.success) > 0.005) {
    return `Higher survival rate vs ${runnerName} (${fmtPct(top.success)} vs ${fmtPct(runner.success)})`;
  } else if (top.p10 - runner.p10 > 1000) {
    return `Same survival as ${runnerName}, but stronger P10 floor (${fmtMoney(top.p10)} vs ${fmtMoney(runner.p10)})`;
  } else if (runner.median_tax - top.median_tax > 1000) {
    return `Tied with ${runnerName} on survival+P10, lower lifetime tax (${fmtMoney(top.median_tax)} vs ${fmtMoney(runner.median_tax)})`;
  } else if (top.p50 - runner.p50 > 1000) {
    return `Tied with ${runnerName} on primary metrics, higher p50 (${fmtMoney(top.p50)} vs ${fmtMoney(runner.p50)})`;
  }
  return `Essentially tied with ${runnerName} on every metric`;
}

function rank(combos) {
  return Object.entries(combos)
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => b.success - a.success || b.p10 - a.p10 || a.median_tax - b.median_tax || b.p50 - a.p50);
}

// Scenario A: comfortable plan — should pick on survival or P10
console.log('\n[A] Comfortable plan (defaults):');
r = runSim(DEFAULTS);
let ranked = rank(r.combos);
console.log(`  Winner: ${ranked[0].key} (success=${fmtPct(ranked[0].success)}, P10=${fmtMoney(ranked[0].p10)}, tax=${fmtMoney(ranked[0].median_tax)})`);
console.log(`  Why: ${explainTie(ranked[0], ranked[1])}`);

// Scenario B: tight plan — partial success
console.log('\n[B] Tight plan (high spending):');
r = runSim({ ...DEFAULTS, spending: 130000 });
ranked = rank(r.combos);
console.log(`  Winner: ${ranked[0].key} (success=${fmtPct(ranked[0].success)}, P10=${fmtMoney(ranked[0].p10)}, tax=${fmtMoney(ranked[0].median_tax)})`);
console.log(`  Why: ${explainTie(ranked[0], ranked[1])}`);

// Scenario C: failing plan
console.log('\n[C] Failing plan:');
r = runSim({ ...DEFAULTS, spending: 200000 });
ranked = rank(r.combos);
console.log(`  Winner: ${ranked[0].key} (success=${fmtPct(ranked[0].success)}, P10=${fmtMoney(ranked[0].p10)}, tax=${fmtMoney(ranked[0].median_tax)})`);
console.log(`  Why: ${explainTie(ranked[0], ranked[1])}`);

console.log('\n=== Test 9: Already-retired client (age_now > age_ret) ===');
// 70-year-old, "retired at 65", planning to 95. Should simulate immediate
// retirement (no accumulation phase) and depletion math throughout.
const alreadyRetired = {
  ...DEFAULTS,
  age_now: 70, age_ret: 65, age_end: 95,
  taxable: 500000, traditional: 600000, roth: 200000, cost_basis: 250000,
  savings: 0,        // not saving, fully retired
  spending: 60000,
  ss_age: 65,        // SS already started
  ss_amt: 25000,
};
r = runSim(alreadyRetired);
const arResult = r.combos['EqualWeight_TradFirst'];
console.log('Already-retired EqualWeight/TradFirst:', {
  success: arResult.success,
  p10: Math.round(arResult.p10),
  p50: Math.round(arResult.p50),
  p90: Math.round(arResult.p90),
});
console.log('All 30 combos have valid (finite, non-NaN) numbers:',
  Object.values(r.combos).every(c => Number.isFinite(c.p50) && Number.isFinite(c.success)));

// Also test the edge: age_ret way in the past
const longRetired = {
  ...alreadyRetired,
  age_now: 85, age_ret: 60, age_end: 105,
};
r = runSim(longRetired);
const lrResult = r.combos['EqualWeight_TradFirst'];
console.log('Long-retired (85 / retired at 60):', {
  success: lrResult.success,
  p50: Math.round(lrResult.p50),
});
