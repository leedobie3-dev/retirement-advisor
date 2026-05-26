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
