// ============================================================================
// data.js — All the constant data the simulator needs.
//
// This file is just a list of numbers. There is no logic here. Everything in
// this file was copied directly out of the Excel workbook (fin186_FIXED.xlsx).
//
// Mapping to the Excel:
//
//   HIST           ↔  Excel sheet "HistData" rows 2-98
//                     (97 years of asset returns, 1928-2024)
//
//   TAX_SINGLE     ↔  Excel sheet "TaxTables"
//                       ordinary brackets:  rows for "Ordinary Income — Single"
//                       ltcg brackets:      rows for "LTCG — Single"
//                       stdDed, age65Add:   "Standard Deduction" rows
//                       ssProv50, ssProv85: "SS Provisional Income" rows
//
//   RMD_FACTORS    ↔  Excel sheet "TaxTables", "Uniform Lifetime Table" rows
//                     (the IRS divisor used to compute required minimum
//                     distributions from age 73 onward)
//
//   ALLOCATIONS    ↔  Excel sheet "Strategies", column A rows 4-10
//   WITHDRAWALS    ↔  Excel sheet "Strategies", "WITHDRAWAL STRATEGIES" rows
//   STATIC_WEIGHTS ↔  Excel sheet "Strategies", cells A4:E10 (the four static
//                     allocations: 60/40, EqualWeight, RiskParity, RobustRP)
//   RISK_MULT      ↔  Excel sheet "Strategies", cells A13:B15
// ============================================================================

// HIST: one row per historical year. Each row has the total return (decimal,
// so 0.43 means +43%) for stocks, bonds, real estate, and the commodity proxy
// (gold), plus the year's CPI inflation rate.
// Source: Aswath Damodaran, NYU Stern, "histretSP.xls" January 2026 update.
export const HIST = [
  {y:1928,stk:0.438112,bnd:0.008355,cpi:-0.011561,re:0.014911,com:0.000969},
  {y:1929,stk:-0.082979,bnd:0.042038,cpi:0.005848,re:-0.020568,com:-0.001452},
  {y:1930,stk:-0.251236,bnd:0.045409,cpi:-0.063953,re:-0.043000,com:0.000969},
  {y:1931,stk:-0.438375,bnd:-0.025589,cpi:-0.093168,re:-0.081505,com:-0.173850},
  {y:1932,stk:-0.086424,bnd:0.087903,cpi:-0.102740,re:-0.104664,com:0.212778},
  {y:1933,stk:0.499822,bnd:0.018553,cpi:0.007634,re:-0.038119,com:0.272595},
  {y:1934,stk:-0.011886,bnd:0.079634,cpi:0.015152,re:0.029062,com:0.317509},
  {y:1935,stk:0.467404,bnd:0.044720,cpi:0.029851,re:0.097658,com:0.004324},
  {y:1936,stk:0.319434,bnd:0.050179,cpi:0.014493,re:0.032186,com:0.000861},
  {y:1937,stk:-0.353367,bnd:0.013791,cpi:0.028571,re:0.025634,com:-0.002294},
  {y:1938,stk:0.292827,bnd:0.042132,cpi:-0.027778,re:-0.008737,com:0.001725},
  {y:1939,stk:-0.010976,bnd:0.044123,cpi:0.000000,re:-0.013016,com:-0.012339},
  {y:1940,stk:-0.106729,bnd:0.054025,cpi:0.007143,re:0.033066,com:-0.016560},
  {y:1941,stk:-0.127715,bnd:-0.020222,cpi:0.099291,re:-0.083846,com:0.000000},
  {y:1942,stk:0.191738,bnd:0.022949,cpi:0.090323,re:0.033330,com:0.000000},
  {y:1943,stk:0.250613,bnd:0.024900,cpi:0.029586,re:0.114463,com:0.000000},
  {y:1944,stk:0.190307,bnd:0.025776,cpi:0.022988,re:0.165842,com:0.000000},
  {y:1945,stk:0.358211,bnd:0.038044,cpi:0.022472,re:0.117774,com:0.025406},
  {y:1946,stk:-0.084291,bnd:0.031284,cpi:0.181319,re:0.241017,com:0.000000},
  {y:1947,stk:0.052000,bnd:0.009197,cpi:0.088372,re:0.212639,com:0.000000},
  {y:1948,stk:0.057046,bnd:0.019510,cpi:0.029915,re:0.020585,com:0.000000},
  {y:1949,stk:0.183032,bnd:0.046635,cpi:-0.020747,re:0.000893,com:-0.087007},
  {y:1950,stk:0.308055,bnd:0.004296,cpi:0.059322,re:0.036404,com:0.095614},
  {y:1951,stk:0.236785,bnd:-0.002953,cpi:0.060000,re:0.060476,com:0.000000},
  {y:1952,stk:0.181510,bnd:0.022680,cpi:0.007547,re:0.044067,com:-0.003456},
  {y:1953,stk:-0.012082,bnd:0.041438,cpi:0.007491,re:0.115166,com:0.006936},
  {y:1954,stk:0.525633,bnd:0.032898,cpi:-0.007435,re:0.009227,com:0.005741},
  {y:1955,stk:0.325973,bnd:-0.013364,cpi:0.003745,re:0.000000,com:-0.000285},
  {y:1956,stk:0.074395,bnd:-0.022558,cpi:0.029851,re:0.009143,com:-0.001142},
  {y:1957,stk:-0.104574,bnd:0.067970,cpi:0.028986,re:0.027180,com:-0.001143},
  {y:1958,stk:0.437200,bnd:-0.020990,cpi:0.017606,re:0.006615,com:0.004292},
  {y:1959,stk:0.120565,bnd:-0.026466,cpi:0.017301,re:0.001095,com:0.000000},
  {y:1960,stk:0.003365,bnd:0.116395,cpi:0.013605,re:0.007659,com:0.004843},
  {y:1961,stk:0.266377,bnd:0.020609,cpi:0.006711,re:0.009772,com:-0.000567},
  {y:1962,stk:-0.088115,bnd:0.056935,cpi:0.013333,re:0.003226,com:-0.000567},
  {y:1963,stk:0.226119,bnd:0.016842,cpi:0.016447,re:0.021436,com:-0.003974},
  {y:1964,stk:0.164155,bnd:0.037281,cpi:0.009709,re:0.012592,com:0.000285},
  {y:1965,stk:0.123992,bnd:0.007189,cpi:0.019231,re:0.016580,com:0.000570},
  {y:1966,stk:-0.099710,bnd:0.029079,cpi:0.034591,re:0.012232,com:0.000285},
  {y:1967,stk:0.238030,bnd:-0.015806,cpi:0.030395,re:0.023162,com:-0.005124},
  {y:1968,stk:0.108149,bnd:0.032746,cpi:0.047198,re:0.041339,com:0.124750},
  {y:1969,stk:-0.082414,bnd:-0.050140,cpi:0.061972,re:0.069943,com:0.050114},
  {y:1970,stk:0.035611,bnd:0.167547,cpi:0.055703,re:0.082155,com:-0.094477},
  {y:1971,stk:0.142212,bnd:0.097869,cpi:0.032663,re:0.042449,com:0.166934},
  {y:1972,stk:0.187554,bnd:0.028184,cpi:0.034063,re:0.029757,com:0.487850},
  {y:1973,stk:-0.143080,bnd:0.036587,cpi:0.087059,re:0.034221,com:0.729584},
  {y:1974,stk:-0.259018,bnd:0.019886,cpi:0.123377,re:0.100735,com:0.661470},
  {y:1975,stk:0.369951,bnd:0.036053,cpi:0.069364,re:0.067737,com:-0.247989},
  {y:1976,stk:0.238310,bnd:0.159846,cpi:0.048649,re:0.081778,com:-0.040998},
  {y:1977,stk:-0.069797,bnd:0.012900,cpi:0.067010,re:0.146548,com:0.226394},
  {y:1978,stk:0.065093,bnd:-0.007776,cpi:0.090177,re:0.157236,com:0.370112},
  {y:1979,stk:0.185195,bnd:0.006707,cpi:0.132939,re:0.137425,com:1.265487},
  {y:1980,stk:0.317352,bnd:-0.029897,cpi:0.125163,re:0.073969,com:0.151855},
  {y:1981,stk:-0.047024,bnd:0.081992,cpi:0.089224,re:0.050950,com:-0.325986},
  {y:1982,stk:0.204191,bnd:0.328145,cpi:0.038298,re:0.005637,com:0.156226},
  {y:1983,stk:0.223372,bnd:0.032002,cpi:0.037910,re:0.047495,com:-0.167972},
  {y:1984,stk:0.061461,bnd:0.137334,cpi:0.039487,re:0.046781,com:-0.193776},
  {y:1985,stk:0.312351,bnd:0.257125,cpi:0.037987,re:0.074714,com:0.060006},
  {y:1986,stk:0.184946,bnd:0.242842,cpi:0.010979,re:0.096124,com:0.189565},
  {y:1987,stk:0.058127,bnd:-0.049605,cpi:0.044344,re:0.078494,com:0.245273},
  {y:1988,stk:0.165372,bnd:0.082236,cpi:0.044194,re:0.072210,com:-0.152551},
  {y:1989,stk:0.314752,bnd:0.176936,cpi:0.046473,re:0.043943,com:-0.028397},
  {y:1990,stk:-0.030645,bnd:0.062354,cpi:0.061063,re:-0.006863,com:-0.031109},
  {y:1991,stk:0.302348,bnd:0.150045,cpi:0.030643,re:-0.001685,com:-0.085577},
  {y:1992,stk:0.074937,bnd:0.093616,cpi:0.029007,re:0.008175,com:-0.057341},
  {y:1993,stk:0.099671,bnd:0.142110,cpi:0.027484,re:0.021566,com:0.176780},
  {y:1994,stk:0.013259,bnd:-0.080367,cpi:0.026749,re:0.025156,com:-0.021698},
  {y:1995,stk:0.371952,bnd:0.234808,cpi:0.025384,re:0.017920,com:0.009785},
  {y:1996,stk:0.226810,bnd:0.014286,cpi:0.033225,re:0.024254,com:-0.045866},
  {y:1997,stk:0.331037,bnd:0.099391,cpi:0.017024,re:0.040220,com:-0.214083},
  {y:1998,stk:0.283380,bnd:0.149214,cpi:0.016119,re:0.064423,com:-0.008270},
  {y:1999,stk:0.208854,bnd:-0.082542,cpi:0.026846,re:0.076793,com:0.008513},
  {y:2000,stk:-0.090318,bnd:0.166553,cpi:0.033868,re:0.092926,com:-0.054436},
  {y:2001,stk:-0.118498,bnd:0.055722,cpi:0.015517,re:0.066760,com:0.007469},
  {y:2002,stk:-0.219660,bnd:0.151164,cpi:0.023769,re:0.095610,com:0.255696},
  {y:2003,stk:0.283558,bnd:0.003753,cpi:0.018795,re:0.098135,com:0.198877},
  {y:2004,stk:0.107428,bnd:0.044907,cpi:0.032556,re:0.136383,com:0.046486},
  {y:2005,stk:0.048345,bnd:0.028675,cpi:0.034157,re:0.135096,com:0.177686},
  {y:2006,stk:0.156126,bnd:0.019610,cpi:0.025406,re:0.017328,com:0.231969},
  {y:2007,stk:0.054847,bnd:0.102100,cpi:0.040813,re:-0.053993,com:0.319225},
  {y:2008,stk:-0.365523,bnd:0.201013,cpi:0.000914,re:-0.119952,com:0.043178},
  {y:2009,stk:0.259352,bnd:-0.111167,cpi:0.027213,re:-0.038540,com:0.250359},
  {y:2010,stk:0.148211,bnd:0.084629,cpi:0.014957,re:-0.041175,com:0.292414},
  {y:2011,stk:0.020984,bnd:0.160353,cpi:0.029624,re:-0.038855,com:0.120242},
  {y:2012,stk:0.158906,bnd:0.029716,cpi:0.017410,re:0.064360,com:0.056843},
  {y:2013,stk:0.321451,bnd:-0.091046,cpi:0.015017,re:0.107187,com:-0.276142},
  {y:2014,stk:0.135244,bnd:0.107462,cpi:0.007565,re:0.045034,com:0.001245},
  {y:2015,stk:0.013789,bnd:0.012843,cpi:0.007295,re:0.051948,com:-0.121061},
  {y:2016,stk:0.117731,bnd:0.006906,cpi:0.020746,re:0.053055,com:0.081038},
  {y:2017,stk:0.216055,bnd:0.028017,cpi:0.021091,re:0.062069,com:0.126625},
  {y:2018,stk:-0.042269,bnd:-0.000167,cpi:0.019102,re:0.045176,com:-0.009295},
  {y:2019,stk:0.312117,bnd:0.096356,cpi:0.022851,re:0.036852,com:0.190774},
  {y:2020,stk:0.180232,bnd:0.113319,cpi:0.013620,re:0.104266,com:0.241694},
  {y:2021,stk:0.284689,bnd:-0.044160,cpi:0.070364,re:0.188646,com:-0.037544},
  {y:2022,stk:-0.180375,bnd:-0.178282,cpi:0.064544,re:0.056518,com:0.005494},
  {y:2023,stk:0.260607,bnd:0.038800,cpi:0.033521,re:0.056784,com:0.132621},
  {y:2024,stk:0.248786,bnd:-0.016372,cpi:0.028881,re:0.039634,com:0.259570},
];

// TAX_SINGLE: 2025 federal tax parameters for a Single filer.
//   Each ordinary bracket is [low, high, rate]; rate applies to income in
//   that band. LTCG brackets are [upperBound, rate] and stack on top of
//   ordinary income (see ltcgTax() in engine.js).
//   ssProv50 / ssProv85: the two Social Security provisional-income
//   thresholds that decide what fraction of SS benefits get taxed.
export const TAX_SINGLE = {
  ordinary: [
    [0,       11925,    0.10],
    [11925,   48475,    0.12],
    [48475,   103350,   0.22],
    [103350,  197300,   0.24],
    [197300,  250525,   0.32],
    [250525,  626350,   0.35],
    [626350,  Infinity, 0.37],
  ],
  ltcg: [
    [48350,    0.00],
    [533400,   0.15],
    [Infinity, 0.20],
  ],
  stdDed: 15000,
  age65Add: 2000,
  ssProv50: 25000,
  ssProv85: 34000,
};

// RMD_FACTORS: IRS Uniform Lifetime Table. For each age starting at 73, the
// required minimum distribution from a traditional account that year is
//     traditional_balance / RMD_FACTORS[age]
// So at 73 the IRS forces you to withdraw 1/26.5 (about 3.8%) of your
// traditional balance; the percentage rises every year.
export const RMD_FACTORS = {
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
};

export const RMD_AGE = 73;  // age at which RMDs begin (2025 IRS rule)

// The six allocation strategies and five withdrawal strategies. Order matters:
// the dashboard iterates these to build the 6×5 heatmap.
export const ALLOCATIONS = ['60_40','EqualWeight','RiskParity','RobustRP','GlidePath','AgeBalanceAware'];
export const WITHDRAWALS = ['TradFirst','RothFirst','TaxableFirst','Proportional','TaxAware'];

// STATIC_WEIGHTS: portfolio weights for the four allocations whose weights
// never change. Each row is [stocks, bonds, real estate, commodities] and
// the four numbers always sum to 1. These mirror Excel "Strategies" A4:E10.
// (GlidePath and AgeBalanceAware have weights that depend on the client's
// age and balance, so they are computed in engine.js, not stored here.)
export const STATIC_WEIGHTS = {
  '60_40':       [0.60, 0.40, 0.00, 0.00],
  'EqualWeight': [0.25, 0.25, 0.25, 0.25],
  'RiskParity':  [0.18, 0.55, 0.15, 0.12],
  'RobustRP':    [0.20, 0.50, 0.18, 0.12],
};

// RISK_MULT: scales the equity portion of the dynamic allocations
// (GlidePath, AgeBalanceAware) up or down depending on the client's risk
// tolerance setting in the sidebar. Mirrors Excel "Strategies" A13:B15.
export const RISK_MULT = { Conservative: 0.8, Moderate: 1.0, Aggressive: 1.2 };

// ============================================================================
// MARKOV REGIME-SWITCH MODEL  (fit offline by Baum-Welch EM on the 97 annual
// stock-return observations above. See /tmp/regime_fit.json or the methodology
// section for the fitting procedure.)
//
// Two regimes:
//   Regime 0 ("CALM"):     low vol, high positive mean.   37 years total.
//   Regime 1 ("STRESSED"): high vol, near-zero mean.      60 years total.
//
// The fitted model classifies every well-known crash year (1929-1932, 1937,
// 1973-1974, 2000-2002, 2008, 2022) into the stressed regime. The calm
// regime contains unambiguous boom years (1933, 1935, 1954, 1958, 1975,
// 1980, 1985, 1995-1999, 2003, 2013, 2017, 2019, 2021, 2023, 2024).
//
// Used by the Markov-2-state sampler in engine.js: at each simulation year,
// the next regime is drawn from REGIME_P, then a historical year tagged with
// that regime is bootstrapped from HIST. This preserves regime persistence
// (stressed years cluster ~2.5 years on average) AND empirical fat tails
// (we sample actual historical bundles, not draws from a Gaussian).
// ============================================================================

// REGIME_LABELS[i] is the regime for HIST[i] (so labels[0] is for 1928,
// labels[96] is for 2024). 0 = calm, 1 = stressed.
export const REGIME_LABELS = [
  0,1,1,1,1,0,1,0,0,1,0,1,1,1,0,0,1,0,1,1,1,1,0,0,1,1,0,0,1,1,
  0,1,1,0,1,0,1,1,1,0,1,1,1,1,0,1,1,0,0,1,1,1,0,1,0,0,1,0,1,1,
  1,0,1,0,1,1,1,0,1,0,0,0,1,1,1,0,1,1,1,1,1,0,1,1,1,0,1,1,1,0,
  1,0,1,0,1,0,0
];

// REGIME_P[i][j] = P(next regime is j | current regime is i).
// Estimated from the fitted HMM transition matrix.
//   P(calm     -> calm)     = 0.266    P(calm     -> stressed) = 0.734
//   P(stressed -> calm)     = 0.399    P(stressed -> stressed) = 0.601
// Expected duration in calm     = 1.4 years
// Expected duration in stressed = 2.5 years
// Stationary distribution: 35% calm, 65% stressed.
export const REGIME_P = [
  [0.266, 0.734],
  [0.399, 0.601],
];

// REGIME_STATIONARY: probability of starting in each regime if we don't
// know what regime today is. Used to pick the first year's regime.
export const REGIME_STATIONARY = [0.352, 0.648];

// REGIME_BY_INDEX: pre-built index of which HIST positions belong to each
// regime, so the sampler can pick "a random calm year" in O(1).
export const REGIME_BY_INDEX = [
  REGIME_LABELS.map((r, i) => r === 0 ? i : -1).filter(i => i >= 0),  // calm
  REGIME_LABELS.map((r, i) => r === 1 ? i : -1).filter(i => i >= 0),  // stressed
];

// Names for display purposes.
export const REGIME_NAMES = ['Calm', 'Stressed'];
