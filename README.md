# Squeek Power Planner 🐹

A SqueekFi calculator for [Squeekchain](https://squeekchain.com). Every completed Squeek block issues SQK, shared by
power, and power comes from the Squeeks you deposit **and** the SQK you stake with them. This page answers the
questions that rule raises:

- **What does my position earn?** NFT power, SQK multiplier, total power, share of each block and SQK a day, for any
  phase of the issuance schedule.
- **Should I merge?** The result of merging every pair you can (up to a chosen level): power and SQK gained, Squeeks
  burned, and how long the cooldown chain takes at the hamster's pace. It also flags Squeeks left idle by the
  100-per-account deposit limit.
- **One more Squeek, or more SQK?** At your position, how much staked SQK adds the same power as one more Squeek of
  each level, which tells you which one to buy.

## The model

```
P = NFT power of your deposited Squeeks          (1,000 at level 1, ×2.2 a level, up to 1,207,269)
Q = S × (1 + P / 1,000) / c                       (S = SQK staked, c = SQK per unit of power)
W = P + Q
share = W / (W + everyone else's power)
```

The formula was checked against `Staking.quotePower` on the Sepolia testnet and reproduces the whitepaper's own
concentration example (96.5%). The full research, every constant with its source, and what is still TBD are in
[docs/MODEL.md](docs/MODEL.md).

**Not final.** Squeekchain marks staking as in active development: `c`, the exit fee, the launch bonus and the year
length are TBD or proposed, and an older docs page still describes 6,900 SQK per block with no staking. The planner
lets you switch to that NFT-only rule. Exit fees, pool fees, gas and prices are not modelled.

## Live data

The page reads `api.squeekchain.com/v1/economy/state` for the testnet's deposited power and parameters, and
`/v1/measurement/stats` for the hamster's measured pace. Everything else runs in the browser; there is no backend.

## Run it

```bash
npm start   # http://localhost:8080
npm test    # model checks: on-chain quotePower cases, whitepaper schedule and example, merge timing
```

No dependencies and no build step; any static host works.

## Layout

- [`src/model.js`](src/model.js): power, issuance and merge maths (pure, tested).
- [`src/live.js`](src/live.js): live testnet parameters and pace.
- [`src/app.js`](src/app.js), [`index.html`](index.html), [`style.css`](style.css): the page.

Fan-made and unofficial; not affiliated with Squeekchain. Not financial advice. MIT licensed.
