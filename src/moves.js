// What an account should do next with its Squeeks, and the transactions that do it. Pure, no DOM.
// Steps build on each other: deposit idle Squeeks, then compound rewards, then merge deposited pairs.
import { LEVEL_POWER, MAX_TOKENS, sqkPower } from "./model.js";
import {
  DEPOSIT_CHUNK,
  NFT,
  STAKING,
  approveAllData,
  claimAndStakeData,
  depositData,
  mergeData,
  mergeDepositedData,
  safeTransferData,
} from "./chain.js";

const inStaking = (t) => t.custody === "staking";
const inWallet = (t) => t.custody === "wallet";
const byStrength = (a, b) => b.level - a.level || a.id - b.id;

/** Power an account's deposited Squeeks and stake give it. */
export function powerOf(tokens, staked, params) {
  const nft = tokens.filter(inStaking).reduce((sum, t) => sum + t.power, 0);
  const sqk = sqkPower(staked, nft, params);
  return { nft, sqk, total: nft + sqk };
}

/**
 * Share of staking rewards and SQK a day for a given power. `network.totalPower` already counts
 * what the API credits this account with, so that part is swapped out for `power`.
 */
export function earning(power, account, network) {
  const others = Math.max(0, network.totalPower - account.nftPower - account.sqkPower);
  const share = power > 0 ? power / (others + power) : 0;
  return { share, perDay: share * network.stakerPerBlock * network.blocksPerDay };
}

export function summarize(account, network) {
  const power = powerOf(account.tokens, account.staked, network.params);
  return {
    deposited: account.tokens.filter(inStaking).length,
    idle: account.tokens.filter(inWallet).length,
    power,
    ...earning(power.total, account, network),
  };
}

/**
 * This page's milestones for an account, from what it holds now. Not Squeekchain badges.
 * `unlock` names the kind of move that gets a locked one closer.
 */
export function milestones(account, maxTokens = MAX_TOKENS) {
  const deposited = account.tokens.filter(inStaking).length;
  const top = account.tokens.reduce((max, t) => Math.max(max, t.level), 0);
  return [
    { id: "deposit", title: "Clocked in", detail: "A Squeek deposited and earning", done: deposited > 0, unlock: "deposit" },
    { id: "all-in", title: "No slackers", detail: "No Squeek idle in the wallet", done: deposited > 0 && (deposited === account.tokens.length || deposited >= maxTokens), unlock: "deposit" },
    { id: "merge", title: "Level up", detail: "Holds a level 2+ Squeek", done: top >= 2, unlock: "merge" },
    { id: "stake", title: "Compounder", detail: "SQK staked with the Squeeks", done: account.staked > 0, unlock: "claim" },
    { id: "ten", title: "Squad of ten", detail: "10 Squeeks deposited", done: deposited >= 10, unlock: "deposit" },
    { id: "level5", title: "Heavyweight", detail: "Holds a level 5+ Squeek", done: top >= 5, unlock: "merge" },
    { id: "full", title: "Full house", detail: `All ${maxTokens} deposit slots used`, done: deposited >= maxTokens, unlock: "deposit" },
  ];
}

/** Squeek blocks until a Squeek can merge again (0 when ready). */
export const cooldownLeft = (token, coreBlockHeight) => Math.max(0, token.nextMergeHeight - coreBlockHeight);

/** Same-level ready pairs, lowest ids first, never at the maximum level. */
export function pairs(tokens, maximumLevel) {
  const byLevel = new Map();
  for (const t of tokens) {
    if (t.mergeState !== "ready" || t.level >= maximumLevel) continue;
    if (!byLevel.has(t.level)) byLevel.set(t.level, []);
    byLevel.get(t.level).push(t);
  }
  const out = [];
  for (const [level, list] of [...byLevel].sort((a, b) => b[0] - a[0])) {
    list.sort((a, b) => a.id - b.id);
    for (let i = 0; i + 1 < list.length; i += 2) {
      out.push({ level, survivor: list[i].id, donor: list[i + 1].id, gain: LEVEL_POWER[level] - 2 * LEVEL_POWER[level - 1] });
    }
  }
  return out;
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const idRange = (ids) => (ids.length === 1 ? `#${ids[0]}` : `#${ids[0]}…#${ids[ids.length - 1]}`);

/** The transactions behind a deposit: one transfer each for 1-2 Squeeks without approval, else approve once and batch. */
export function depositTxs(ids, from, approved) {
  if (!approved && ids.length <= 2) {
    return ids.map((id) => ({ label: `Deposit #${id}`, to: NFT, data: safeTransferData(from, STAKING, id), effect: { type: "deposit", ids: [id] } }));
  }
  const txs = approved ? [] : [{ label: "Allow Staking to hold your Squeeks", to: NFT, data: approveAllData(STAKING, true), effect: { type: "approve" } }];
  for (const part of chunk(ids, DEPOSIT_CHUNK)) {
    txs.push({ label: `Deposit ${part.length === 1 ? "" : `${part.length} Squeeks, `}${idRange(part)}`, to: STAKING, data: depositData(part), effect: { type: "deposit", ids: part } });
  }
  return txs;
}

/** One merge, through Staking when both Squeeks are deposited, through the NFT when both are in the wallet. */
export function mergeTx(pair, deposited) {
  return {
    label: `Merge #${pair.survivor} + #${pair.donor}`,
    to: deposited ? STAKING : NFT,
    data: deposited ? mergeDepositedData(pair.survivor, pair.donor) : mergeData(pair.survivor, pair.donor),
    effect: { type: "merge", survivor: pair.survivor, donor: pair.donor },
  };
}

/** The optimistic state after a mined transaction, until the API catches up. */
export function applyMove(account, effect, cooldownBlocks = []) {
  switch (effect.type) {
    case "deposit": {
      const ids = new Set(effect.ids);
      return { ...account, tokens: account.tokens.map((t) => (ids.has(t.id) ? { ...t, custody: "staking" } : t)) };
    }
    case "claimAndStake":
      return { ...account, staked: account.staked + account.claimable, claimable: 0 };
    case "merge":
      return {
        ...account,
        tokens: account.tokens
          .filter((t) => t.id !== effect.donor)
          .map((t) => {
            if (t.id !== effect.survivor) return t;
            const level = t.level + 1;
            const wait = cooldownBlocks[level - 1] ?? 0;
            return { ...t, level, power: LEVEL_POWER[level - 1], mergeState: wait > 0 ? "cooldown" : "ready", nextMergeHeight: account.coreBlockHeight + wait };
          }),
      };
    default:
      return account;
  }
}

/**
 * Numbered steps for this account. Each step's figures assume the steps before it are done.
 * A step carries `txs` to send, or `blocked` with the reason it can't run now.
 */
export function planMoves(account, network, { approved = false, maxTokens = MAX_TOKENS } = {}) {
  const params = network.params;
  const steps = [];
  let state = account;
  const now = () => powerOf(state.tokens, state.staked, params).total;
  const paused = account.stakingPaused ? "Staking is paused right now." : null;

  // 1. Idle Squeeks earn nothing.
  const wallet = state.tokens.filter(inWallet).sort(byStrength);
  const room = Math.max(0, maxTokens - state.tokens.filter(inStaking).length);
  const pick = wallet.slice(0, room);
  if (pick.length) {
    const before = now();
    state = applyMove(state, { type: "deposit", ids: pick.map((t) => t.id) });
    steps.push({
      kind: "deposit",
      title: `Put ${pick.length} idle Squeek${pick.length === 1 ? "" : "s"} to work`,
      before,
      after: now(),
      ids: pick.map((t) => t.id),
      txs: depositTxs(pick.map((t) => t.id), account.address, approved),
      blocked: paused,
    });
  } else if (wallet.length) {
    steps.push({ kind: "full", title: `Your account holds the maximum ${maxTokens} deposited Squeeks`, blocked: "Merge deposited pairs below to free slots for the rest." });
  }

  // 2. Rewards waiting to be claimed add power once staked.
  if (state.claimable > 0) {
    const before = now();
    const amount = state.claimable;
    state = applyMove(state, { type: "claimAndStake" });
    steps.push({
      kind: "claim",
      title: "Claim your rewards and stake them",
      amount,
      before,
      after: now(),
      txs: [{ label: "Claim and stake", to: STAKING, data: claimAndStakeData(), effect: { type: "claimAndStake" } }],
      blocked: paused,
    });
  }

  // 3. Deposited pairs: +10% each, one Squeek burned, one slot freed.
  const depositedPairs = pairs(state.tokens.filter(inStaking), account.maximumLevel);
  if (depositedPairs.length) {
    const waitsFor = new Set(steps.find((s) => s.kind === "deposit")?.ids ?? []);
    const before = now();
    steps.push({
      kind: "merge",
      title: `Merge ${depositedPairs.length} deposited pair${depositedPairs.length === 1 ? "" : "s"}`,
      before,
      after: before + depositedPairs.reduce((sum, p) => sum + p.gain * (1 + state.staked / params.referencePower / params.sqkPerPower), 0),
      pairs: depositedPairs.map((p) => ({ ...p, afterDeposit: waitsFor.has(p.survivor) || waitsFor.has(p.donor), deposited: true })),
      blocked: !account.mergesOpen ? "Merges are closed right now." : paused,
    });
  }

  // 4. Squeeks that can't be deposited can still merge in the wallet.
  const leftOver = state.tokens.filter(inWallet);
  const walletPairs = pairs(leftOver, account.maximumLevel);
  if (walletPairs.length) {
    steps.push({
      kind: "merge-wallet",
      title: `Merge ${walletPairs.length} pair${walletPairs.length === 1 ? "" : "s"} still in your wallet`,
      pairs: walletPairs.map((p) => ({ ...p, afterDeposit: false, deposited: false })),
      blocked: !account.mergesOpen ? "Merges are closed right now." : null,
    });
  }

  const cooling = account.tokens
    .filter((t) => t.mergeState === "cooldown")
    .map((t) => ({ id: t.id, level: t.level, blocksLeft: cooldownLeft(t, account.coreBlockHeight) }))
    .sort((a, b) => a.blocksLeft - b.blocksLeft);

  return { steps, cooling };
}
