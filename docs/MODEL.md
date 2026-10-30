# The reward model this planner uses

Researched on 2026-10-29 from the Squeekchain docs, the whitepaper and direct `eth_call`s to the current Sepolia
testnet. Squeekchain marks staking as "in active development": treat every launch value below as the published
proposal, not a promise.

## Power: Proof of Squeek

An account's power `W` decides its share of every completed Squeek block's SQK:

```
P = Σ NFT power of the account's deposited Squeeks
Q = S × (1 + P / P_ref) / c          S = SQK staked by the account
W = P + Q
share = W / (W + everyone else's power)
```

| Parameter | Value | Status |
| --- | --- | --- |
| NFT power by level 1..10 | 1,000 · 2,200 · 4,840 · 10,648 · 23,426 · 51,536 · 113,380 · 249,436 · 548,759 · 1,207,269 | Whitepaper (proposed) and `Staking.basePower(genesis, L)` on Sepolia: identical |
| `P_ref` | 1,000 (one level 1 Squeek doubles the account's SQK power) | Whitepaper (proposed), `powerParameters()` on Sepolia |
| `c`, SQK per unit of power at the base rate | 40 on Sepolia | Whitepaper: **TBD** for launch |
| Squeeks deposited per account | 100 | `Staking.MAX_TOKENS()` on Sepolia; not in the whitepaper |

The formula was checked against `Staking.quotePower(principal, nftPower)` on Sepolia
(`0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f`):

| S (SQK) | P | Contract | Formula |
| ---: | ---: | ---: | ---: |
| 40 | 0 | 1 | 40 / 40 × 1 = 1 |
| 40 | 1,000 | 2 | 1 × 2 = 2 |
| 40,000 | 1,000 | 2,000 | 1,000 × 2 = 2,000 |
| 40,000 | 2,200 | 3,200 | 1,000 × 3.2 = 3,200 |
| 1,000 | 4,840 | 146 | 25 × 5.84 = 146 |
| 0 | 1,000 | 0 | 0 |

`accountPower(account)` returns `P` and `Q` separately; the testnet account `0x32cd…acc41` reads `(24,000, 0)`:
24 level 1 Squeeks, nothing staked.

## Merging

- Two Squeeks of the **same level** merge into one Squeek a level higher; the donor is burned (docs: Merging Squeeks).
- Each level is worth 10% more than the two Squeeks it combines (2 × 1,000 → 2,200), so a merge raises `P` by 10% of
  the pair, and raises the SQK multiplier `1 + P / P_ref` with it.
- The survivor keeps earning with the pair's combined power until the next round, then switches to its new level.
- A level `L` Squeek stands for `2^(L−1)` minted Squeeks; level 10 is the cap.
- Cooldown before a Squeek can merge again, in completed Squeek blocks (whitepaper, fixed forever in SqueekNFT):
  level 1: 1,000 · 2: 3,000 · 3: 7,000 · 4: 14,000 · 5: 21,000 · 6: 28,000 · 7: 35,000 · 8: 42,000 · 9: 49,000.
  When a freshly minted Squeek's first cooldown ends is TBD. The Sepolia testnet uses 0 for level 1.

## Issuance (whitepaper, proposed)

2.1B SQK cap; 210M premine for liquidity; SqueekMining issues 1.89B over three "years" of 393,470 blocks each,
halving every year (base 4/7, 2/7, 1/7), plus a 105M launch bonus over the first 97,020 blocks:

| Phase | Blocks | SQK per block | Issued |
| --- | ---: | ---: | ---: |
| First 90 days, with bonus | 97,020 | 3,674.57 | 356.5M |
| Rest of year 1 | 296,450 | 2,592.32 | 768.5M |
| Year 2 | 393,470 | 1,296.16 | 510.0M |
| Year 3 | 393,470 | 648.08 | 255.0M |

The Sepolia testnet runs the same shape without the premine (`issuanceSchedule()`: `firstPeriodRate` 2,897.30 SQK,
`halvingBlocks` 393,470, `launchBonus` 105M over 97,020 blocks).

A "year" is a number of blocks, not a calendar year: the whitepaper sizes it at 1,078 blocks a day, and a busier
hamster finishes it sooner.

**What testnet depositors actually get.** On Sepolia almost all issuance goes to the gacha vault: by block 4,135,
`mining.stakingFundedBaseUnits` was 66,881 SQK against 16.39M for the vault, so depositors were paid about 16 SQK a
block. The planner offers that figure as the "Sepolia, what depositors were actually paid" phase, and the wallet section
uses it for every "SQK a day" estimate. Checked against a real depositor: one level 1 Squeek, 1.45% of the deposited
power, earned 882 SQK over its first three days, close to the 253 a day the estimate gives.

## Known conflicts and what is left out

- The docs page "How SQK is issued" and the developer reference still describe an older deployment: 6,900 SQK per
  block, no halving, power from NFT levels only. The whitepaper and the live testnet both use the halving schedule and
  the staking formula above, so the planner follows them, and offers the NFT-only rule as an option.
- Not modelled: the exit fee on unstaking (TBD at launch; Sepolia policy 2% to 60%, rising with stake that left in the
  last 7 days), the stakers' 75% share of the pool's 1% swap fee (split TBD), and the testnet-only gacha curve.
- Everyone else's power is an input. It changes as people deposit, merge and restake, so every daily figure is a
  snapshot under the stated assumptions, not a forecast.

## Sources

- Whitepaper: https://docs.squeekchain.com/whitepaper/ (Economy, Squeeks, Staking, Merging)
- Docs: https://docs.squeekchain.com/squeeks/power/, https://docs.squeekchain.com/squeeks/merge/,
  https://docs.squeekchain.com/rewards/staking/, https://docs.squeekchain.com/rewards/creation/
- Developer reference: https://docs.squeekchain.com/developers/mining/
- Live testnet parameters: https://api.squeekchain.com/v1/economy/state
- Accounts and Squeeks: https://api.squeekchain.com/v1/accounts/{address}, https://api.squeekchain.com/v1/squeeks/{id}
- Contract calls (Squeek NFT `0xcb98349c…b70f`, Staking `0x4b67b739…ea4f` on Sepolia): ABIs from Squeekchain's own app,
  as the contracts are not verified on an explorer; every call the page sends was dry-run with `eth_simulateV1` from a
  real holder's address (approve, batch deposit, claim and stake, deposited merge).
