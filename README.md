# Retirement Strategy Studio

Interactive Monte Carlo for retirement allocation and withdrawal decisions.

Bootstrap resampling of 1928 to 2024 annual returns in 3-year blocks. Six allocation strategies, five withdrawal sequences, evaluated across 10,000 paths in the browser via a Web Worker. No backend.

## Live site

Published at: https://leedobie3-dev.github.io/retirement-advisor/

## Local development

```
python3 -m http.server 8765
open http://127.0.0.1:8765/
```

ES module workers require the page be served over HTTP, not opened as a file.

## Files

- `index.html` page structure
- `styles.css` styling
- `app.js` UI, charts, worker plumbing
- `engine.js` Monte Carlo engine (runs in a Web Worker)
- `data.js` historical returns and 2025 federal tax tables

## Engine

- Bootstrap MC, configurable 2k to 10k paths, 3-year blocks, deterministic seed
- Cost basis tracked dynamically
- Social Security taxation via provisional income (50% and 85% thresholds)
- RMDs enforced after age 73 using the Uniform Lifetime Table
- AgeBalanceAware reduces equity when spending or balance burden is high
- Tax paid out of taxable first, then traditional; LTCG stacks on top of ordinary income

## Source

Underlying logic and historical data extracted from a FIN 186 retirement strategy workbook (Damodaran 1928 to 2024 returns, 2025 federal Single brackets).
