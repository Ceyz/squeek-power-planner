import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_PARAMS,
  LEVEL_POWER,
  SCHEDULE,
  accountPower,
  deposited,
  emptyCounts,
  mergePlan,
  nftPower,
  shareOf,
  sqkPerDay,
  sqkPower,
  squeekInSqk,
} from "../src/model.js";

const params = LAUNCH_PARAMS;
const counts = (byLevel) => {
  const c = emptyCounts();
  for (const [level, n] of Object.entries(byLevel)) c[Number(level) - 1] = n;
  return c;
};
const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

test("sqkPower reproduces Staking.quotePower read on Sepolia", () => {
  // [staked SQK, NFT power, quotePower result]
  for (const [s, p, onChain] of [
    [40, 0, 1],
    [40, 1000, 2],
    [40000, 1000, 2000],
    [40000, 2200, 3200],
    [1000, 4840, 146],
    [0, 1000, 0],
  ]) {
    close(sqkPower(s, p, params), onChain);
  }
});

test("each level is worth 10% more than the two Squeeks it merges", () => {
  for (let i = 0; i < LEVEL_POWER.length - 1; i++) {
    close(LEVEL_POWER[i + 1] / (2 * LEVEL_POWER[i]), 1.1, 1e-4);
  }
});

test("issuance schedule matches the whitepaper table and the testnet contract", () => {
  const issued = (id) => {
    const phase = SCHEDULE.find((p) => p.id === id);
    return phase.perBlock * phase.blocks;
  };
  close(issued("launch-bonus") / 1e6, 356.5, 1e-3);
  close(issued("year-1") / 1e6, 768.5, 1e-3);
  close(issued("year-2") / 1e6, 510.0, 1e-6);
  close(issued("year-3") / 1e6, 255.0, 1e-6);
  const launchTotal = ["launch-bonus", "year-1", "year-2", "year-3"].reduce((sum, id) => sum + issued(id), 0);
  close(launchTotal, 1_890_000_000, 1e-9);
  // issuanceSchedule().firstPeriodRate on Sepolia: 2,897.298396... SQK, plus the 105M / 97,020 launch bonus.
  close(SCHEDULE.find((p) => p.id === "testnet").perBlock, 2897.2983963199226 + 105_000_000 / 97_020, 1e-9);
});

test("reproduces the whitepaper's concentration example (96.5%)", () => {
  // One account with 10% of Squeek power and 10% of staked SQK, against 3,000 accounts with three level 1 Squeeks.
  const others = 3000;
  const otherNft = 3 * LEVEL_POWER[0];
  const whaleNft = (others * otherNft) / 9; // 10% of all NFT power
  const whaleStake = 1;
  const otherStake = (9 * whaleStake) / others; // the other 90% of stake, spread evenly
  const whaleQ = sqkPower(whaleStake, whaleNft, params);
  const othersQ = others * sqkPower(otherStake, otherNft, params);
  close(whaleQ / (whaleQ + othersQ), 0.9653, 1e-4);
});

test("accountPower deposits at most 100 Squeeks, strongest first", () => {
  const holding = counts({ 1: 110, 3: 5 });
  const dep = deposited(holding);
  assert.equal(dep.counts[2], 5);
  assert.equal(dep.counts[0], 95);
  assert.equal(dep.idle, 15);
  const power = accountPower(holding, 0, params);
  assert.equal(power.nft, 95 * 1000 + 5 * 4840);
  assert.equal(power.deposited, 100);
});

test("accountPower adds the multiplied SQK power unless the NFT-only rule is chosen", () => {
  const holding = counts({ 1: 1 });
  assert.equal(accountPower(holding, 40000, params).total, 1000 + 2000);
  assert.equal(accountPower(holding, 40000, params, { nftOnly: true }).total, 1000);
});

test("mergePlan carries pairs upward and times the cooldown chain", () => {
  const plan = mergePlan(counts({ 1: 16 }));
  assert.equal(plan.counts[4], 1);
  assert.equal(nftPower(plan.counts), LEVEL_POWER[4]);
  assert.equal(plan.merges, 15);
  // Ready now: merge at 0, then wait the level 2, 3 and 4 cooldowns.
  assert.equal(plan.finishBlock, 3000 + 7000 + 14000);
  // Fresh mints also wait the level 1 cooldown first.
  assert.equal(mergePlan(counts({ 1: 16 }), { readyNow: false }).finishBlock, 1000 + 3000 + 7000 + 14000);
});

test("mergePlan leaves odd Squeeks and respects the target level", () => {
  const plan = mergePlan(counts({ 1: 3 }));
  assert.deepEqual(plan.counts.slice(0, 2), [1, 1]);
  assert.equal(plan.merges, 1);
  const capped = mergePlan(counts({ 1: 8 }), { targetLevel: 2 });
  assert.equal(capped.counts[1], 4);
  assert.equal(capped.counts[2], 0);
});

test("squeekInSqk prices one more Squeek in staked SQK", () => {
  assert.equal(squeekInSqk(1, emptyCounts(), 0, params), 40000);
  assert.equal(squeekInSqk(1, counts({ 1: 1 }), 0, params), 20000);
  close(squeekInSqk(1, counts({ 1: 1 }), 40000, params), 40000);
});

test("share and daily SQK", () => {
  assert.equal(shareOf(1000, 99000), 0.01);
  assert.equal(shareOf(0, 0), 0);
  close(sqkPerDay(0.01, 2592.32, 1078), 27945.21, 1e-6);
});
