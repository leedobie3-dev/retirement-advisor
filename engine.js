// ============================================================================
// engine.js — The Monte Carlo simulator. This is the math.
//
// Plain-English overview, for non-coders:
//
//   The page asks this file: "given a client's age, balances, spending, etc.,
//   how does each of the 30 strategy combinations (6 allocations × 5
//   withdrawal sequences) perform over thousands of possible market futures?"
//
//   This file answers by:
//     1. Manufacturing thousands of "possible futures" of market returns by
//        randomly stitching together 3-year blocks pulled from the actual
//        1928-2024 history. Each future is one Monte Carlo path.
//     2. For each (allocation, withdrawal) pair, walking every path year by
//        year: applying contributions before retirement, then withdrawals,
//        Social Security, federal tax, RMDs, and portfolio growth.
//     3. Recording the ending wealth and total lifetime tax for every path,
//        then reporting percentiles (P10 = bad outcome, P50 = typical, etc.)
//        and the success rate (% of paths where the client never runs out).
//
// This file runs in a "Web Worker" — a separate thread the browser uses for
// heavy computation so the page stays responsive while the simulation runs.
//
// Mapping to the Excel workbook:
//
//   bootstrapReturns()  ↔  Excel sheet "MCRaw" (the bootstrap engine)
//   weightsFor()        ↔  Excel sheet "Strategies" formulas, including the
//                          age-based logic for GlidePath / AgeBalanceAware
//   ordinaryTax()       ↔  tax bracket math used in MCSim_* sheets
//   ltcgTax()           ↔  LTCG-stacking logic used in MCSim_* sheets
//   ssTaxablePortion()  ↔  provisional-income SS taxation logic
//   withdraw()          ↔  the W_Trad / W_Tax / W_Roth columns in each
//                          MCSim_<Alloc> sheet (one set of columns per
//                          withdrawal strategy)
//   simulatePath()      ↔  one row of one MCSim_<Alloc> sheet expanded
//                          across 60 years, equivalent to a single row in
//                          the "Engine" tab's A10:AB59 historical walk
//   runMC()             ↔  the loop that produces "MCResults" (per-combo
//                          terminal real wealth + lifetime tax distributions)
// ============================================================================

import {
  HIST, TAX_SINGLE, RMD_FACTORS, RMD_AGE,
  STATIC_WEIGHTS, RISK_MULT, ALLOCATIONS, WITHDRAWALS,
  REGIME_LABELS, REGIME_P, REGIME_STATIONARY, REGIME_BY_INDEX
} from './data.js';

// ---------------------------------------------------------------------------
// bootstrapReturns()  —  builds the "possible futures"
//
// Excel equivalent: the entire MCRaw sheet (12,000 rows = 200 paths × 60 yrs).
//
// What it does, in plain English:
//   - Picks random starting years from the historical record (1928-2024).
//   - For each pick, copies 3 years in a row from history into the synthetic
//     future. This preserves things like crash sequences (1930, 1931, 1932
//     stay together) instead of mixing them randomly.
//   - Repeats until each path has enough years to cover the full retirement.
//   - Does this for every Monte Carlo path (default 10,000).
//
// The output is one big array of numbers: for each (path, year) we store five
// values — stock return, bond return, real-estate return, commodity return,
// inflation rate — which the year-by-year simulator reads later.
// ---------------------------------------------------------------------------
// Small deterministic RNG so reruns with the same seed give identical paths.
// (Linear congruential generator; not for cryptography, fine for MC.)
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function bootstrapReturns(nPaths, nYears, blockLen, seed) {
  const H = HIST.length;  // 97 historical years available to sample from
  const out = new Float64Array(nPaths * nYears * 5);
  const rand = makeRng(seed);
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

// ---------------------------------------------------------------------------
// markovReturns()  —  regime-switching block bootstrap (alternate sampler)
//
// Excel equivalent: none. This is a new approach.
//
// Procedure for each Monte Carlo path:
//   1. Draw a starting regime from the stationary distribution (35% steady,
//      65% volatile) — this represents "we don't know what regime today
//      really is, so use the long-run average."
//   2. For each simulation year:
//        a. Pick a random historical year that has the CURRENT regime label.
//        b. Copy that year's actual asset returns (stocks, bonds, RE, comm,
//           CPI) into the output. We sample real history, so empirical fat
//           tails are preserved automatically — no Gaussian assumption.
//        c. Roll the dice on the transition matrix REGIME_P to decide the
//           NEXT regime. Steady tends to flip to volatile; volatile tends
//           to persist (expected duration ~2.5 years).
//
// vs. plain bootstrap: blocks of similar-volatility years cluster together
// because the regime transitions are sticky. Crash years are more likely
// to be neighbored by other volatile years than under IID block resampling.
// (Note: these are volatility regimes, not bull/bear in the market-narrative
// sense. The volatile regime contains all crashes AND choppy positive years.)
// ---------------------------------------------------------------------------
function markovReturns(nPaths, nYears, seed) {
  const out = new Float64Array(nPaths * nYears * 5);
  const rand = makeRng(seed + 9001);  // different seed offset from bootstrap
  const steadyIdx = REGIME_BY_INDEX[0];
  const volatileIdx = REGIME_BY_INDEX[1];
  const nSteady = steadyIdx.length, nVolatile = volatileIdx.length;

  for (let p = 0; p < nPaths; p++) {
    // Initial regime drawn from stationary distribution
    let regime = rand() < REGIME_STATIONARY[0] ? 0 : 1;
    for (let y = 0; y < nYears; y++) {
      // Pick a random historical year from the current regime
      const histIdx = regime === 0
        ? steadyIdx[Math.floor(rand() * nSteady)]
        : volatileIdx[Math.floor(rand() * nVolatile)];
      const h = HIST[histIdx];
      const i = (p * nYears + y) * 5;
      out[i]   = h.stk;
      out[i+1] = h.bnd;
      out[i+2] = h.re;
      out[i+3] = h.com;
      out[i+4] = h.cpi;
      // Transition to next regime
      const pNext = REGIME_P[regime][0];
      regime = rand() < pNext ? 0 : 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// weightsFor()  —  decides how the portfolio is split across asset classes
//
// Excel equivalent: the "Strategies" sheet (A4:E10 for the static weights,
// plus the embedded glide-path and age-balance-aware formulas in MCSim_*).
//
// Each strategy returns four numbers that sum to 1:
//     [stocks fraction, bonds fraction, real-estate fraction, commodities fraction]
//
// The four "static" strategies (60/40, EqualWeight, RiskParity, RobustRP)
// always return the same fixed weights from data.js.
//
// The two "dynamic" strategies recompute weights every year of the simulation:
//   GlidePath        — equity glides down as the client ages
//                      (110 - age) / 100, scaled by risk multiplier
//   AgeBalanceAware  — same glide, but cuts equity further when the client's
//                      spending need is large relative to their balance, and
//                      diversifies the equity sleeve into RE and commodities
// ---------------------------------------------------------------------------
function weightsFor(strategy, age, totalBal, spendNeed, riskMult) {
  const W = STATIC_WEIGHTS[strategy];
  if (W) return W;  // 60/40, EqualWeight, RiskParity, RobustRP — fixed weights
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

// ---------------------------------------------------------------------------
// Tax helpers  —  three small functions that together compute federal tax
//
// Excel equivalent: the tax columns embedded in every MCSim_<Alloc> sheet,
// using the bracket numbers from the TaxTables sheet.
//
//   ordinaryTax()      — applies the progressive bracket schedule
//                        (10/12/22/24/32/35/37) to a single income figure.
//
//   ltcgTax()          — long-term capital gains stack ON TOP OF ordinary
//                        taxable income and are taxed at 0/15/20. Where the
//                        gains land in the LTCG bracket schedule depends on
//                        how much ordinary income sits beneath them.
//
//   ssTaxablePortion() — Social Security benefits are taxed only above
//                        "provisional income" thresholds: up to 50% of
//                        benefits become taxable above $25k provisional,
//                        up to 85% above $34k.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// withdraw()  —  decides which accounts to pull from to fund spending
//
// Excel equivalent: the "W_Trad" / "W_Tax" / "W_Roth" columns of each
// MCSim_<Alloc> sheet. Each sheet has these columns repeated five times,
// once per withdrawal strategy (TradFirst, RothFirst, TaxableFirst,
// Proportional, TaxAware).
//
// Given:    a spending need in dollars, and the client's three account
//           balances at the start of the year (traditional, taxable, Roth),
// Returns:  how much to pull from each account this year, plus the cost
//           basis consumed from taxable (which the tax calc needs later).
//
// Required Minimum Distributions are enforced at the end: if the client is
// 73+ with money still in a traditional account, we force the traditional
// withdrawal up to the IRS minimum regardless of strategy.
// ---------------------------------------------------------------------------
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

  // RMD enforcement: if strategy under-withdrew from Trad relative to the IRS
  // RMD, top up Trad. The surplus (RMD that wasn't needed for spending) is
  // returned to the caller, which moves it into the taxable account after tax.
  let rmdSurplus = 0;
  if (age >= RMD_AGE && trad > 0) {
    const f = RMD_FACTORS[Math.min(age, 115)] || RMD_FACTORS[115];
    const rmd = trad / f;
    if (wT < rmd) {
      const extra = Math.min(rmd, trad) - wT;
      wT += extra;
      rmdSurplus = extra;  // this much got withdrawn beyond what spending needed
    }
  }

  const basisConsumed = wX * basisRatio;
  return [wT, wX, wR, basisConsumed, rmdSurplus];
}

// ---------------------------------------------------------------------------
// simulatePath()  —  walks one client through one possible future, year by year
//
// Excel equivalent: one row of an MCSim_<Alloc> sheet "exploded" across the
// 60-year horizon. It is also exactly what the "Engine" sheet (A10:AB59)
// does for a single historical sequence, except we use a bootstrap-drawn
// sequence instead of an actual history.
//
// For each year of the client's plan:
//
//   1. Read the four asset returns and inflation rate for that year (already
//      generated by bootstrapReturns).
//   2. Determine the portfolio weights (allocation) for this age and balance.
//   3. If still working: add the annual savings to the taxable account.
//      If retired: turn on Social Security at ss_age, work out the spending
//      need in nominal dollars (inflated by CPI), pull from accounts via the
//      withdraw() function, compute tax, and pay it.
//   4. Grow the remaining balances by the portfolio return for the year.
//   5. Flag the path as "depleted" if all three accounts hit zero.
//
// The function returns the ending real (inflation-adjusted) wealth and the
// cumulative real tax paid across the whole retirement.
// ---------------------------------------------------------------------------
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
    let rmdSurplus = 0;

    if (!retired) {
      // Accumulation: add savings to taxable, basis grows dollar-for-dollar.
      const sav = inp.savings * cpiPrev;
      tax += sav;
      taxBasis += sav;
    } else {
      // Retirement: withdraw to fund spending. SS turns on at ss_age.
      if (age >= inp.ss_age) ssInc = inp.ss_amt * cpiPrev;
      const gross = Math.max(0, spendNom - ssInc); // SS offsets gross withdrawal need
      [wT, wX, wR, basisConsumed, rmdSurplus] = withdraw(wdStrat, gross, trad, tax, taxBasis, roth, age);

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

      // RMD surplus: forced trad withdrawal beyond what spending needed lands
      // in the taxable account (after-tax money). The tax on it was already
      // included in taxPaid via the wT route. We add gross to taxable; the
      // tax is paid from taxable below, so net cash flow is correct.
      if (rmdSurplus > 0) {
        tax += rmdSurplus;
        taxBasis += rmdSurplus;  // after-tax money, full basis
      }

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

// pct() — pulls the Pth percentile out of a sorted list of numbers.
// Example: pct(sorted, 10) returns the 10th-percentile value.
function pct(sortedArr, p) {
  const n = sortedArr.length;
  if (!n) return 0;
  const k = (n - 1) * p / 100;
  const f = Math.floor(k), c = Math.min(f + 1, n - 1);
  return sortedArr[f] + (sortedArr[c] - sortedArr[f]) * (k - f);
}

// ---------------------------------------------------------------------------
// runMC()  —  the top-level orchestrator
//
// Excel equivalent: this is what produces the "MCResults" sheet (one row per
// path, columns for every alloc × withdrawal combination's terminal real
// wealth and lifetime tax) and the summary pivot on the "MonteCarlo" sheet.
//
// Procedure:
//   1. Build the bootstrap returns once. Every strategy sees the SAME random
//      futures, which makes the comparison apples-to-apples.
//   2. For each of the 30 (allocation, withdrawal) pairs:
//        - Walk every Monte Carlo path through simulatePath().
//        - Collect that pair's terminal-wealth and lifetime-tax distributions.
//        - Compute success rate and percentiles (P10, P25, P50, P75, P90).
//   3. For the user's currently-selected combo, also keep year-by-year wealth
//      so the dashboard can draw the fan chart.
//   4. Send all the numbers back to the page (app.js) as one big message.
// ---------------------------------------------------------------------------
function runMC(inp, opts) {
  const nPaths = opts.paths || 10000;
  const blockLen = opts.blockLen || 3;
  const seed = opts.seed || 42;
  const model = opts.model || 'bootstrap';   // 'bootstrap' or 'markov'
  const nYears = inp.age_end - inp.age_now + 1;

  postMessage({ type: 'progress', stage: 'resampling', pct: 5 });
  // Choose the return-generation model based on the user's toggle.
  const returns = model === 'markov'
    ? markovReturns(nPaths, nYears, seed)
    : bootstrapReturns(nPaths, nYears, blockLen, seed);

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
  postMessage({ type: 'result', combos, fanData, meta: { nPaths, nYears, blockLen, seed, model } });
}

// ---------------------------------------------------------------------------
// Worker entry point. The page (app.js) calls postMessage({type:'run',...})
// and this handler kicks off runMC(). Any error gets sent back as a normal
// message so the page can show it in the overlay instead of crashing silently.
// ---------------------------------------------------------------------------
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
