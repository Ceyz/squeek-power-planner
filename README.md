# Squeek Power Planner 🐹

**Live:** https://squeek-power-planner.duckdns.org/

A SqueekFi planner for [Squeekchain](https://squeekchain.com). Every completed Squeek block issues SQK, shared by
power, and power comes from the Squeeks you deposit **and** the SQK you stake with them. This page answers the
questions that rule raises, and acts on the answers:

- **What should I do with my Squeeks right now?** Connect a wallet (or look up any address) on the Sepolia testnet.
  The page reads your Squeeks, shows what they earn, and lists the next moves with their effect on your share:
  deposit idle Squeeks, claim and stake your rewards, merge ready pairs (choosing which one to keep). Each move is a
  click away, dry-run first, then sent from your own wallet straight to Squeekchain's contracts.
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

The page reads `api.squeekchain.com/v1/economy/state` for the testnet's deposited power and parameters,
`/v1/measurement/stats` for the hamster's measured pace, and `/v1/accounts/{address}` and `/v1/squeeks/{id}` for a
wallet's Squeeks and their on-chain art. Everything else runs in the browser; there is no backend.

## Transactions

The wallet section sends only these calls, from the connected wallet, on Sepolia:

| Move | Call |
|---|---|
| Deposit 1-2 Squeeks | `Squeek.safeTransferFrom(you, Staking, id)` |
| Deposit more | `Squeek.setApprovalForAll(Staking, true)` once, then `Staking.deposit(Squeek, ids)` in batches of 25 |
| Claim and stake | `Staking.claimAndStake()` |
| Merge deposited pair | `Staking.mergeDeposited(Squeek, keep, burn)` |
| Merge pair in the wallet | `Squeek.merge(keep, burn)` (only for Squeeks over the 100-deposit limit) |

Squeek NFT `0xcb98349c134ab983da5bfd80527dfe2552bdb70f`, Staking `0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f`. The page
refuses to offer transactions if the API names other contracts, dry-runs each call with `eth_call` before asking the
wallet, and turns the contracts' errors into plain sentences.

## Run it

```bash
npm start   # http://localhost:8080
npm test    # model, calldata, account parsing and next-move checks
```

No dependencies and no build step; any static host works.

## Layout

- [`src/model.js`](src/model.js): power, issuance and merge maths (pure, tested).
- [`src/moves.js`](src/moves.js): an account's next moves and the transactions behind them (pure, tested).
- [`src/chain.js`](src/chain.js): contract addresses, calldata, wallet helpers (EIP-6963 / EIP-1193).
- [`src/account.js`](src/account.js): an account's Squeeks and rewards from the API, and their art.
- [`src/live.js`](src/live.js): live testnet parameters and pace.
- [`src/wallet-ui.js`](src/wallet-ui.js), [`src/app.js`](src/app.js), [`index.html`](index.html), [`style.css`](style.css): the page.

Fan-made and unofficial; not affiliated with Squeekchain. Not financial advice. MIT licensed.
