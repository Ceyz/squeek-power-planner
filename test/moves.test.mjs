import test from "node:test";
import assert from "node:assert/strict";
import { NFT, STAKING } from "../src/chain.js";
import { LAUNCH_PARAMS } from "../src/model.js";
import { applyMove, depositTxs, earning, milestones, pairs, planMoves, powerOf, summarize } from "../src/moves.js";

const HOLDER = "0xffb26838df0c32966fc15a4b375a2759014f9108";
const network = { totalPower: 69_200, stakerPerBlock: 16, blocksPerDay: 1000, params: LAUNCH_PARAMS };

const token = (id, level, custody, mergeState = "ready", nextMergeHeight = 0) => ({ id, level, custody, power: [1000, 2200, 4840][level - 1], mergeState, nextMergeHeight });

function account(tokens, extra = {}) {
  const deposited = tokens.filter((t) => t.custody === "staking").reduce((sum, t) => sum + t.power, 0);
  return {
    address: HOLDER,
    tokens,
    staked: 0,
    claimable: 0,
    nftPower: deposited,
    sqkPower: 0,
    coreBlockHeight: 4135,
    mergesOpen: true,
    stakingPaused: false,
    maximumLevel: 10,
    ...extra,
  };
}

const wallet20 = () => account(Array.from({ length: 20 }, (_, i) => token(5101 + i, 1, "wallet")));

test("an account with no Squeeks gets no steps", () => {
  const { steps, cooling } = planMoves(account([]), network);
  assert.deepEqual(steps, []);
  assert.deepEqual(cooling, []);
  assert.equal(summarize(account([]), network).share, 0);
});

test("20 idle Squeeks: deposit them, then merge the 10 pairs", () => {
  const { steps } = planMoves(wallet20(), network);
  assert.deepEqual(steps.map((s) => s.kind), ["deposit", "merge"]);
  const [deposit, merge] = steps;
  assert.equal(deposit.before, 0);
  assert.equal(deposit.after, 20_000);
  assert.equal(deposit.txs.length, 2, "approval, then one batch");
  assert.equal(deposit.txs[0].to, NFT);
  assert.equal(deposit.txs[1].to, STAKING);
  assert.equal(merge.pairs.length, 10);
  assert.ok(merge.pairs.every((p) => p.afterDeposit && p.deposited && p.gain === 200));
  assert.equal(merge.after - merge.before, 2000);
});

test("approval already granted skips that transaction", () => {
  const { steps } = planMoves(wallet20(), network, { approved: true });
  assert.equal(steps[0].txs.length, 1);
  assert.equal(steps[0].txs[0].to, STAKING);
});

test("one or two Squeeks go over by plain transfer, no approval", () => {
  const txs = depositTxs([7, 8], HOLDER, false);
  assert.equal(txs.length, 2);
  assert.ok(txs.every((tx) => tx.to === NFT && tx.data.startsWith("0x42842e0e")));
  assert.equal(depositTxs(Array.from({ length: 120 }, (_, i) => i + 1), HOLDER, true).length, 5, "chunks of 25");
});

test("share counts the account's API power once", () => {
  const acct = account([token(1, 1, "staking")]);
  const { share, perDay } = earning(1000, acct, network);
  assert.equal(share, 1000 / 69_200);
  assert.equal(perDay, share * 16 * 1000);
  // Depositing 20 more: others stay 68,200.
  assert.equal(earning(21_000, acct, network).share, 21_000 / (68_200 + 21_000));
});

test("mixed custody: deposit the wallet ones, claim, then merge only deposited pairs", () => {
  const acct = account([token(8930, 1, "staking"), token(8935, 1, "wallet"), token(8936, 1, "wallet"), token(8937, 1, "wallet")], { claimable: 882 });
  const { steps } = planMoves(acct, network);
  assert.deepEqual(steps.map((s) => s.kind), ["deposit", "claim", "merge"]);
  assert.equal(steps[1].amount, 882);
  assert.ok(steps[1].after > steps[1].before, "staking rewards adds SQK power");
  assert.deepEqual(steps[2].pairs.map((p) => [p.survivor, p.donor, p.afterDeposit]), [[8930, 8935, true], [8936, 8937, true]]);
});

test("over 100 Squeeks: deposit the strongest up to the limit, merge the rest in the wallet", () => {
  const tokens = [...Array.from({ length: 98 }, (_, i) => token(i + 1, 1, "staking")), token(500, 2, "wallet"), ...Array.from({ length: 6 }, (_, i) => token(600 + i, 1, "wallet"))];
  const { steps } = planMoves(account(tokens), network, { approved: true });
  const deposit = steps.find((s) => s.kind === "deposit");
  assert.deepEqual(deposit.ids, [500, 600], "level 2 first, then the lowest id");
  const walletMerge = steps.find((s) => s.kind === "merge-wallet");
  assert.deepEqual(walletMerge.pairs.map((p) => [p.survivor, p.donor]), [[601, 602], [603, 604]]);
  assert.ok(walletMerge.pairs.every((p) => !p.deposited));

  const full = planMoves(account([...Array.from({ length: 100 }, (_, i) => token(i + 1, 1, "staking")), token(900, 1, "wallet")]), network);
  assert.equal(full.steps[0].kind, "full");
});

test("paused staking and closed merges block steps with a reason", () => {
  const paused = planMoves({ ...wallet20(), stakingPaused: true }, network).steps;
  assert.match(paused[0].blocked, /paused/);
  const closed = planMoves({ ...wallet20(), mergesOpen: false }, network).steps;
  assert.equal(closed[0].blocked, null);
  assert.match(closed[1].blocked, /closed/);
});

test("cooling Squeeks don't pair, and say how long they wait", () => {
  const acct = account([token(1, 2, "staking", "cooldown", 7135), token(2, 2, "staking", "ready"), token(3, 2, "staking", "ready")]);
  const { steps, cooling } = planMoves(acct, network);
  assert.deepEqual(steps[0].pairs.map((p) => [p.survivor, p.donor, p.gain]), [[2, 3, 4840 - 4400]]);
  assert.deepEqual(cooling, [{ id: 1, level: 2, blocksLeft: 3000 }]);
  assert.deepEqual(pairs([token(9, 1, "staking"), { ...token(10, 1, "staking"), level: 10 }], 10), []);
});

test("applyMove patches the account until the API catches up", () => {
  let acct = wallet20();
  acct = applyMove(acct, { type: "deposit", ids: [5101, 5102] });
  assert.equal(powerOf(acct.tokens, 0, LAUNCH_PARAMS).nft, 2000);
  acct = applyMove(acct, { type: "merge", survivor: 5101, donor: 5102 }, [0, 3000]);
  assert.equal(acct.tokens.length, 19);
  const survivor = acct.tokens.find((t) => t.id === 5101);
  assert.deepEqual([survivor.level, survivor.power, survivor.mergeState, survivor.nextMergeHeight], [2, 2200, "cooldown", 7135]);
  acct = applyMove({ ...acct, claimable: 50, staked: 10 }, { type: "claimAndStake" });
  assert.deepEqual([acct.staked, acct.claimable], [60, 0]);
  assert.equal(applyMove(acct, { type: "approve" }), acct);
});

test("milestones follow the account's Squeeks and stake", () => {
  const done = (acct) => milestones(acct).filter((m) => m.done).map((m) => m.id);
  assert.deepEqual(done(account([])), []);
  assert.deepEqual(done(wallet20()), []);
  assert.deepEqual(done(account([token(1, 1, "staking"), token(2, 2, "wallet")])), ["deposit", "merge"]);
  assert.deepEqual(done(account([token(1, 3, "staking")], { staked: 40 })), ["deposit", "all-in", "merge", "stake"]);
  // At the deposit limit, Squeeks left in the wallet are not slackers.
  const full = account([token(1, 1, "staking"), token(2, 1, "staking"), token(3, 1, "wallet")]);
  assert.deepEqual(milestones(full, 2).filter((m) => m.done).map((m) => m.id), ["deposit", "all-in", "full"]);
});
