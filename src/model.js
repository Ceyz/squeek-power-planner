// Proof of Squeek power, issuance and merge maths. Pure functions, no DOM.
// Every constant is traced in docs/MODEL.md.

export const MAX_LEVEL = 10;

/** NFT power by level (index 0 = level 1). Whitepaper proposal, identical to Staking.basePower on Sepolia. */
export const LEVEL_POWER = [1000, 2200, 4840, 10648, 23426, 51536, 113380, 249436, 548759, 1207269];

/** Completed Squeek blocks a Squeek of level L must wait before merging (index 0 = level 1). Whitepaper. */
export const MERGE_COOLDOWN = [1000, 3000, 7000, 14000, 21000, 28000, 35000, 42000, 49000];

/** Squeeks one account can deposit (Staking.MAX_TOKENS on Sepolia). */
export const MAX_TOKENS = 100;

export const LAUNCH_PARAMS = {
  sqkPerPower: 40, // `c`: TBD at launch, 40 on the Sepolia testnet
  referencePower: 1000, // `P_ref`
  blocksPerDay: 1078,
};

const YEAR_BLOCKS = 393_470;
const BONUS_BLOCKS = 97_020;
const BONUS_PER_BLOCK = 105_000_000 / BONUS_BLOCKS;
const LAUNCH_BASE = 1_890_000_000 - 105_000_000;
const TESTNET_BASE = 2_100_000_000 - 105_000_000;

/** SQK issued per completed Squeek block in each phase of the three-year halving schedule. */
export const SCHEDULE = [
  { id: "launch-bonus", label: "First 90 days (launch bonus)", blocks: BONUS_BLOCKS, perBlock: (LAUNCH_BASE * 4) / 7 / YEAR_BLOCKS + BONUS_PER_BLOCK },
  { id: "year-1", label: "Rest of year 1", blocks: YEAR_BLOCKS - BONUS_BLOCKS, perBlock: (LAUNCH_BASE * 4) / 7 / YEAR_BLOCKS },
  { id: "year-2", label: "Year 2", blocks: YEAR_BLOCKS, perBlock: (LAUNCH_BASE * 2) / 7 / YEAR_BLOCKS },
  { id: "year-3", label: "Year 3", blocks: YEAR_BLOCKS, perBlock: LAUNCH_BASE / 7 / YEAR_BLOCKS },
  { id: "testnet", label: "Sepolia testnet today", blocks: BONUS_BLOCKS, perBlock: (TESTNET_BASE * 4) / 7 / YEAR_BLOCKS + BONUS_PER_BLOCK },
];

export const emptyCounts = () => new Array(MAX_LEVEL).fill(0);

export const tokenCount = (counts) => counts.reduce((sum, n) => sum + n, 0);

export function nftPower(counts, levelPower = LEVEL_POWER) {
  return counts.reduce((sum, n, i) => sum + n * levelPower[i], 0);
}

/** `Q = S × (1 + P / P_ref) / c`, or 0 under the NFT-only rule. */
export function sqkPower(staked, nft, params, nftOnly = false) {
  if (nftOnly || staked <= 0) return 0;
  return (staked * (1 + nft / params.referencePower)) / params.sqkPerPower;
}

/**
 * Keep the strongest Squeeks when an account holds more than it can deposit.
 * Returns the deposited counts and how many are left in the wallet earning nothing.
 */
export function deposited(counts, maxTokens = MAX_TOKENS) {
  const out = emptyCounts();
  let room = maxTokens;
  for (let i = MAX_LEVEL - 1; i >= 0 && room > 0; i--) {
    out[i] = Math.min(counts[i], room);
    room -= out[i];
  }
  return { counts: out, idle: tokenCount(counts) - tokenCount(out) };
}

/** Full breakdown of an account's power. */
export function accountPower(counts, staked, params, { nftOnly = false, maxTokens = MAX_TOKENS } = {}) {
  const dep = deposited(counts, maxTokens);
  const p = nftPower(dep.counts);
  const q = sqkPower(staked, p, params, nftOnly);
  return { nft: p, sqk: q, total: p + q, multiplier: 1 + p / params.referencePower, deposited: tokenCount(dep.counts), idle: dep.idle };
}

export function shareOf(power, othersPower) {
  const total = power + othersPower;
  return total > 0 ? power / total : 0;
}

export const sqkPerDay = (share, perBlock, blocksPerDay) => share * perBlock * blocksPerDay;

/**
 * Merge every pair possible, lowest level first, up to `targetLevel`.
 * Tracks when each Squeek becomes mergeable (in completed blocks from now) so the
 * result says how long the whole plan takes. `readyNow` = existing Squeeks are past
 * their cooldown; otherwise they start a level 1 cooldown (fresh mints).
 */
export function mergePlan(counts, { targetLevel = MAX_LEVEL, readyNow = true, cooldown = MERGE_COOLDOWN } = {}) {
  const ready = counts.map((n, i) => new Array(n).fill(readyNow ? 0 : i === 0 ? cooldown[0] : 0));
  let merges = 0;
  let finishBlock = 0;
  for (let i = 0; i < Math.min(targetLevel, MAX_LEVEL) - 1; i++) {
    ready[i].sort((a, b) => a - b);
    while (ready[i].length >= 2) {
      const a = ready[i].shift();
      const b = ready[i].shift();
      const at = Math.max(a, b);
      merges += 1;
      finishBlock = Math.max(finishBlock, at);
      // The survivor rises a level and starts that level's cooldown (none at the cap).
      ready[i + 1].push(i + 1 < cooldown.length ? at + cooldown[i + 1] : at);
    }
  }
  return { counts: ready.map((list) => list.length), merges, burned: merges, finishBlock };
}

/**
 * How much SQK, staked, adds the same power as one more Squeek of `level`
 * at the current position. Infinity under the NFT-only rule.
 */
export function squeekInSqk(level, counts, staked, params) {
  const p = nftPower(deposited(counts).counts);
  const add = LEVEL_POWER[level - 1];
  const gainFromSqueek = add + sqkPower(staked, p + add, params) - sqkPower(staked, p, params);
  const gainPerSqk = (1 + p / params.referencePower) / params.sqkPerPower;
  return gainFromSqueek / gainPerSqk;
}
