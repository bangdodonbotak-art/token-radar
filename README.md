# Token Radar — radar-2

A token launch radar for the make.fun bounty `token-radar-01`: a program
plus the dashboard it writes, over a sealed DefiLlama snapshot
(`input/snapshot.json` in the kit, 758 protocols at or above $5M TVL,
snapshot date 2026-11-14).

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot,
scores every rankable pre-token protocol with the radar-2 model in
`lib/model.ts`, writes the ranked board to `board.json`, writes the
dashboard's data beside the page as `data.js`, copies `dashboard/` and
`screenshots/` to the output, and writes `dossier.json` with the vendored
make.fun library.

## The model (radar-2)

```
implied = round( tvl x 0.30 x cat x (1 + clamp(7d, -80, 200) / 100 x 0.6)
                 x age x (1 + 0.03 x min(chains - 1, 5)) )
```

- **cat**: a stated category multiple (perpetuals 1.35, Dexs 1.25, lending
  1.20, yield/restaking 1.15, RWA/prediction 1.10, bridges 0.85,
  stablecoins 0.80, other 1.00) — a modelling assumption, disclosed in the
  dashboard, not a fact from the snapshot.
- **age**: a launch-window curve — 0.70 at listing, 1.00 at 540 days, fading
  toward 0.75 after that. Too young is unproven; past three years with no
  token, a protocol has probably decided never to launch.
- **chains**: breadth of adoption, up to x1.15.

## Coverage

178 rows: the whole 40-protocol watchlist, plus every rankable pre-token
protocol below the $50M floor (138). Excluded by the watchlist's own
pre-token rules: 144 pre-token protocols (exchanges, bridges, staking and
restaking products, versioned pools, wrapped/staked products). 20 more pass
the snapshot-visible rules above the floor but are not on the watchlist, so
they are not ranked — the snapshot carries no parent-protocol field, and the
watchlist is the only record of that filter.

Every row carries an 8-step farm plan derived from its own record
(category, chains, TVL, age, seven-day change), including a protocol-specific
risk step. No protocol name is special-cased; no data is invented — every
number comes from the snapshot or is labelled as computed from it.

## The dashboard

Static page, no framework, no network: ranked board with search, category /
chain / TVL filters and sorting, Top 5 spotlight, category and chain
breakdown, a live-token view (top 32 by market cap, with MCap/TVL), a model
sandbox that re-ranks live, per-protocol detail with the model's waterfall
and farm plan, and the full methodology.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Then open `out/dashboard/index.html` (served; it reads `../data.js`).
