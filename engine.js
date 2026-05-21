// Web Worker: vectorized bootstrap Monte Carlo for retirement strategies.
// Loaded as a module worker. Exposes one message handler that takes client inputs
// and returns per-combo distributions + per-year fan for the selected combo.

import {
  HIST, TAX_SINGLE, RMD_FACTORS, RMD_AGE,
  STATIC_WEIGHTS, RISK_MULT, ALLOCATIONS, WITHDRAWALS
} from './data.js';

// ---------- Bootstrap block resampler ----------
function bootstrapReturns(nPaths, nYears, blockLen, seed) {
  // Returns Float64Array length nPaths*nYears*5: [stk, bnd, re, com, cpi]
  const H = HIST.length;
  const out = new Float64Array(nPaths * nYears * 5);
  let s = seed >>> 0 || 1;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let p = 0; p < nPaths; p++) {
    let y = 0;
    while (y < nYears) {
      const start = Math.floor(rand() * (H - blockLen + 1));
      const end = Math.min(y + blockLen, nYears);
      for (let by = 0; by < end - y; by++) {
        const h = HIST[start + by];
        const i = (p * nYears + y + by) * 5;
        out[i]   = h.stk;
        out[i+1] = h.bnd;
        out[i+2] = h.re;
        out[i+3] = h.com;
        out[i+4] = h.cpi;
      }
      y = end;
    }
  }
  return out;
}

// ---------- Allocation weights ----------
function weightsFor(strategy, age, totalBal, spendNeed, riskMult) {
  const W = STATIC_WEIGHTS[strategy];
  if (W) return W;
  if (strategy === 'GlidePath') {
    let eq = Math.max(0.20, Math.min(0.95, ((110 - age) / 100) * riskMult));
    return [eq, 1 - eq, 0, 0];
  }
  if (strategy === 'AgeBalanceAware') {
    // Equity glides with age, scaled by risk tolerance, reduced if spend/balance burden is high.
    const burden = totalBal > 0 ? Math.min(spendNeed / totalBal, 0.10) : 0.05;
    const eq = Math.max(0.20, Math.min(0.95, ((110 - age) / 100) * riskMult - burden * 2));
    // Diversify the risk sleeve: 65% stocks, 20% RE, 15% commodities
    const stk = eq * 0.65, re = eq * 0.20, com = eq * 0.15;
    const bnd = 1 - stk - re - com;
    return [stk, bnd, re, com];
  }
  return [0.6, 0.4, 0, 0];
}

// ---------- Tax helpers ----------
function ordinaryTax(taxableIncome) {
  let ti = Math.max(0, taxableIncome);
  let tax = 0;
  const B = TAX_SINGLE.ordinary;
  for (let i = 0; i < B.length; i++) {
    const [lo, hi, r] = B[i];
    if (ti <= lo) break;
    tax += (Math.min(ti, hi) - lo) * r;
  }
  return tax;
}

function ltcgTax(ordTaxable, ltcgAmt) {
  // LTCG stacks on top of ordinary taxable income, then taxed at 0/15/20.
  if (ltcgAmt <= 0) return 0;
  let remaining = ltcgAmt;
  let stack = Math.max(0, ordTaxable);
  let tax = 0;
  const B = TAX_SINGLE.ltcg;
  for (let i = 0; i < B.length; i++) {
    const [hi, r] = B[i];
    if (remaining <= 0) break;
    const room = Math.max(0, hi - stack);
    const taxed = Math.min(remaining, room);
    tax += taxed * r;
    remaining -= taxed;
    stack += taxed;
  }
  return tax;
}

function ssTaxablePortion(ssIncome, otherOrdIncome) {
  // 2025 Single thresholds: 25k / 34k provisional income.
  if (ssIncome <= 0) return 0;
  const prov = otherOrdIncome + 0.5 * ssIncome;
  if (prov <= TAX_SINGLE.ssProv50) return 0;
  if (prov <= TAX_SINGLE.ssProv85) {
    return Math.min(0.5 * (prov - TAX_SINGLE.ssProv50), 0.5 * ssIncome);
  }
  const tier1 = Math.min(0.5 * (TAX_SINGLE.ssProv85 - TAX_SINGLE.ssProv50), 0.5 * ssIncome);
  const tier2 = 0.85 * (prov - TAX_SINGLE.ssProv85);
  return Math.min(0.85 * ssIncome, tier1 + tier2);
}

// ---------- Withdrawal logic ----------
// Returns [wTrad, wTax, wRoth, basisConsumed]. Withdrawals taken from BoY balances.
function withdraw(strategy, need, trad, tax, taxBasis, roth, age) {
  let wT = 0, wX = 0, wR = 0;
  let remaining = need;
  const basisRatio = tax > 0 ? Math.min(1, taxBasis / tax) : 0;

  if (strategy === 'TradFirst') {
    wT = Math.min(remaining, trad); remaining -= wT;
    wX = Math.min(remaining, tax);  remaining -= wX;
    wR = Math.min(remaining, roth); remaining -= wR;
  } else if (strategy === 'RothFirst') {
    wR = Math.min(remaining, roth); remaining -= wR;
    wX = Math.min(remaining, tax);  remaining -= wX;
    wT = Math.min(remaining, trad); remaining -= wT;
  } else if (strategy === 'TaxableFirst') {
    wX = Math.min(remaining, tax);  remaining -= wX;
    wT = Math.min(remaining, trad); remaining -= wT;
    wR = Math.min(remaining, roth); remaining -= wR;
  } else if (strategy === 'Proportional') {
    const total = trad + tax + roth;
    if (total > 0) {
      const draw = Math.min(remaining, total);
      wT = draw * (trad / total);
      wX = draw * (tax  / total);
      wR = draw * (roth / total);
      remaining -= draw;
    }
  } else if (strategy === 'TaxAware') {
    // Fill ordinary up to top of 12% bracket from Trad, then Taxable (LTCG), then more Trad, then Roth.
    const cap12 = 48475;
    const trad12 = Math.min(remaining, trad, cap12);
    wT = trad12; remaining -= wT;
    const xDraw = Math.min(remaining, tax);
    wX = xDraw; remaining -= wX;
    const moreT = Math.min(remaining, trad - wT);
    wT += moreT; remaining -= moreT;
    wR = Math.min(remaining, roth); remaining -= wR;
  }

  // RMD enforcement
  if (age >= RMD_AGE && trad > 0) {
    const f = RMD_FACTORS[Math.min(age, 115)] || RMD_FACTORS[115];
    const rmd = trad / f;
    if (wT < rmd) {
      // Top up Trad withdrawal to RMD; the extra cash isn't needed for spending,
      // but the IRS forces it. Push surplus into Taxable (after tax).
      const extra = Math.min(rmd, trad) - wT;
      wT += extra;
    }
  }

  const basisConsumed = wX * basisRatio;
  return [wT, wX, wR, basisConsumed];
}

// ---------- Single-path simulator ----------
function simulatePath(inp, allocStrat, wdStrat, returns, pIdx, nYears, recordYearly) {
  let trad = inp.traditional;
  let tax  = inp.taxable;
  let taxBasis = inp.cost_basis;
  let roth = inp.roth;
  let cpi = 1;
  let lifeTaxReal = 0;
  let depleted = false;
  const yearly = recordYearly ? [] : null;
  const riskMult = RISK_MULT[inp.risk] || 1;

  for (let y = 0; y < nYears; y++) {
    const age = inp.age_now + y;
    const ri = (pIdx * nYears + y) * 5;
    const rStk = returns[ri], rBnd = returns[ri+1], rRE = returns[ri+2], rCom = returns[ri+3], dCpi = returns[ri+4];
    const retired = age >= inp.age_ret;

    // CPI advance happens during the year; use end-of-year CPI for nominal scaling
    const cpiPrev = cpi;
    cpi = cpi * (1 + dCpi);

    // Allocation (dynamic for some strategies)
    const total = trad + tax + roth;
    const spendNom = inp.spending * cpiPrev;
    const W = weightsFor(allocStrat, age, total, spendNom, riskMult);
    const portR = W[0]*rStk + W[1]*rBnd + W[2]*rRE + W[3]*rCom;

    let wT = 0, wX = 0, wR = 0, taxPaid = 0, basisConsumed = 0;
    let ssInc = 0;

    if (!retired) {
      // Accumulation: add savings to taxable, basis grows dollar-for-dollar.
      const sav = inp.savings * cpiPrev;
      tax += sav;
      taxBasis += sav;
    } else {
      // Retirement: withdraw to fund spending. SS turns on at ss_age.
      if (age >= inp.ss_age) ssInc = inp.ss_amt * cpiPrev;
      const gross = Math.max(0, spendNom - ssInc); // SS offsets gross withdrawal need
      [wT, wX, wR, basisConsumed] = withdraw(wdStrat, gross, trad, tax, taxBasis, roth, age);

      // Tax: ordinary = wTrad + taxable_SS; LTCG = wX - basisConsumed
      const ssTaxable = ssTaxablePortion(ssInc, wT);
      const ordIncome = wT + ssTaxable;
      const dedu = TAX_SINGLE.stdDed + (age >= 65 ? TAX_SINGLE.age65Add : 0);
      const ordTaxable = Math.max(0, ordIncome - dedu);
      const ltcgAmt = Math.max(0, wX - basisConsumed);
      taxPaid = ordinaryTax(ordTaxable) + ltcgTax(ordTaxable, ltcgAmt);

      // Apply withdrawals + reduce taxable basis
      trad = Math.max(0, trad - wT);
      tax  = Math.max(0, tax  - wX);
      roth = Math.max(0, roth - wR);
      taxBasis = Math.max(0, taxBasis - basisConsumed);

      // Pay tax out of taxable account (if possible, else trad)
      if (tax >= taxPaid) { tax -= taxPaid; taxBasis = Math.max(0, taxBasis - taxPaid * (taxBasis>0?Math.min(1,taxBasis/(tax+taxPaid)):0)); }
      else { const fromTax = tax; tax = 0; taxBasis = 0; trad = Math.max(0, trad - (taxPaid - fromTax)); }

      lifeTaxReal += taxPaid / cpi;

      if (trad + tax + roth <= 0 && y < nYears - 1) {
        depleted = true;
      }
    }

    // Apply growth on EoY balances
    trad = trad * (1 + portR);
    tax  = tax  * (1 + portR);
    roth = roth * (1 + portR);

    if (yearly) yearly.push({
      age, phase: retired ? 'retire' : 'accum',
      cpi: cpi, portR,
      ssInc, spendNom, gross: retired ? Math.max(0, spendNom - ssInc) : 0,
      wT, wX, wR, taxPaid,
      eoyTrad: trad, eoyTax: tax, eoyRoth: roth, eoyTotal: trad+tax+roth,
      realTotal: (trad+tax+roth) / cpi
    });

    if (depleted) {
      // Continue but balances stay zero; rest of years are recorded as zeros for completeness.
      trad = tax = roth = 0;
    }
  }

  const termReal = (trad + tax + roth) / cpi;
  return { termReal, lifeTaxReal, depleted, yearly };
}

// ---------- Percentile helper ----------
function pct(sortedArr, p) {
  const n = sortedArr.length;
  if (!n) return 0;
  const k = (n - 1) * p / 100;
  const f = Math.floor(k), c = Math.min(f + 1, n - 1);
  return sortedArr[f] + (sortedArr[c] - sortedArr[f]) * (k - f);
}

// ---------- Main runner ----------
function runMC(inp, opts) {
  const nPaths = opts.paths || 10000;
  const blockLen = opts.blockLen || 3;
  const seed = opts.seed || 42;
  const nYears = inp.age_end - inp.age_now + 1;

  postMessage({ type: 'progress', stage: 'resampling', pct: 5 });
  const returns = bootstrapReturns(nPaths, nYears, blockLen, seed);

  const combos = {};
  const fanData = {};   // per combo: year-by-year totals array (for selected combo, kept high-res)
  const totalCombos = ALLOCATIONS.length * WITHDRAWALS.length;
  let done = 0;

  // We need year-by-year only for the selected combo to draw the fan chart.
  const selKey = `${opts.selAlloc}_${opts.selWD}`;

  for (const a of ALLOCATIONS) {
    for (const w of WITHDRAWALS) {
      const key = `${a}_${w}`;
      const isSel = key === selKey;
      const terms = new Float64Array(nPaths);
      const taxes = new Float64Array(nPaths);
      const depletions = new Uint8Array(nPaths);
      // For selected combo only, keep year-by-year real totals for fan + sample paths
      const yrTotals = isSel ? new Float64Array(nPaths * nYears) : null;

      for (let p = 0; p < nPaths; p++) {
        const r = simulatePath(inp, a, w, returns, p, nYears, isSel);
        terms[p] = r.termReal;
        taxes[p] = r.lifeTaxReal;
        depletions[p] = r.depleted ? 1 : 0;
        if (yrTotals && r.yearly) {
          for (let y = 0; y < nYears; y++) yrTotals[p * nYears + y] = r.yearly[y].realTotal;
        }
      }

      // Summarize
      const sortedT = Array.from(terms).sort((a,b)=>a-b);
      const sortedTax = Array.from(taxes).sort((a,b)=>a-b);
      const success = 1 - depletions.reduce((s,v)=>s+v,0)/nPaths;
      combos[key] = {
        success: +success.toFixed(4),
        depletion: +(1-success).toFixed(4),
        p10: pct(sortedT, 10),
        p25: pct(sortedT, 25),
        p50: pct(sortedT, 50),
        p75: pct(sortedT, 75),
        p90: pct(sortedT, 90),
        median_tax: pct(sortedTax, 50),
        p10_tax: pct(sortedTax, 10),
        p90_tax: pct(sortedTax, 90),
      };

      if (isSel) {
        // Fan: per-year p10/p25/p50/p75/p90
        const fan = { years: [], ages: [], p10:[], p25:[], p50:[], p75:[], p90:[] };
        for (let y = 0; y < nYears; y++) {
          const slice = new Array(nPaths);
          for (let p = 0; p < nPaths; p++) slice[p] = yrTotals[p*nYears + y];
          slice.sort((a,b)=>a-b);
          fan.years.push(y);
          fan.ages.push(inp.age_now + y);
          fan.p10.push(pct(slice,10));
          fan.p25.push(pct(slice,25));
          fan.p50.push(pct(slice,50));
          fan.p75.push(pct(slice,75));
          fan.p90.push(pct(slice,90));
        }
        // 30 sample paths (every Nth path for spaghetti)
        const samples = [];
        const step = Math.max(1, Math.floor(nPaths / 30));
        for (let p = 0; p < nPaths && samples.length < 30; p += step) {
          const series = new Array(nYears);
          for (let y = 0; y < nYears; y++) series[y] = yrTotals[p*nYears + y];
          samples.push(series);
        }
        fanData.fan = fan;
        fanData.samples = samples;
        // Terminal wealth distribution for selected combo (raw, for histogram)
        fanData.terms = Array.from(terms);
        fanData.taxes = Array.from(taxes);
      }

      done++;
      postMessage({ type: 'progress', stage: 'simulating', pct: 5 + Math.round(85 * done / totalCombos), combo: key });
    }
  }

  postMessage({ type: 'progress', stage: 'finalizing', pct: 95 });
  postMessage({ type: 'result', combos, fanData, meta: { nPaths, nYears, blockLen, seed } });
}

// ---------- Message handler ----------
onmessage = (e) => {
  const { type, inputs, opts } = e.data;
  if (type === 'run') {
    try {
      runMC(inputs, opts);
    } catch (err) {
      postMessage({ type: 'error', error: String(err && err.stack || err) });
    }
  }
};
