// Live parameters from the public Squeekchain API (CORS-open). Values come back as
// decimal strings, power in 18-decimal units.

const API = "https://api.squeekchain.com";

export const fromWei = (value) => Number(BigInt(value) / 10n ** 12n) / 1e6;

export async function getJson(path) {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const err = new Error(`${path}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Testnet staking totals and power parameters. */
export async function fetchTestnet() {
  const state = await getJson("/v1/economy/state");
  const { staking, nft, mining } = state;
  const fundedBlocks = Number(mining.fundedBlocks);
  return {
    totalNftPower: fromWei(staking.totalNftPower),
    totalSqkPower: fromWei(staking.totalSqkPower),
    totalStaked: fromWei(staking.totalStakedBaseUnits),
    sqkPerPower: fromWei(staking.sqkPerPower),
    referencePower: fromWei(staking.referencePower),
    levelPower: nft.basePower.map(Number),
    // Most testnet issuance goes to the gacha vault: this is what depositors were actually paid per block.
    stakerPerBlock: fundedBlocks > 0 ? fromWei(mining.stakingFundedBaseUnits) / fundedBlocks : 0,
    cooldownBlocks: nft.cooldownBlocks.map(Number),
    mergesOpen: nft.mergesOpen,
    stakingPaused: staking.paused,
    generatedAt: state.generatedAt,
  };
}

/**
 * The wheel at `nowMs`, from `/v1/status`: how fast the hamster runs, whether the reading is
 * fresh, how far it has run, and how much of the next Squeek block is built.
 */
export function parseStatus(status, nowMs = Date.now()) {
  const m = status?.measurement ?? {};
  const builder = status?.builder?.status === "available" ? status.builder : null;
  const head = builder?.projected ?? builder?.anchor ?? null;
  const observed = Date.parse(m.observedAt ?? "");
  const stale = !(m.freshness === "online" && nowMs - observed <= Number(m.staleAfterSeconds ?? 120) * 1000);
  const rpm = stale ? 0 : Math.max(0, Number(m.rpmMilli ?? 0) / 1000);
  return {
    stale,
    running: rpm > 0,
    rpm,
    // Distance run in the current Squeek day (they start at 12:00 UTC).
    todayKm: m.distanceMm === undefined ? null : Number(m.distanceMm) / 1e6,
    height: head ? Number(head.blockHeight) : null,
    // blockProgress counts billionths of the next block.
    progress: head ? Math.min(1, Math.max(0, Number(head.blockProgress) / 1e9)) : null,
    settledAt: builder?.anchor?.confirmedAt ?? null,
  };
}

export async function fetchStatus() {
  return parseStatus(await getJson("/v1/status"), Date.now());
}

/** Squeek blocks a day since the wheel was first observed on this deployment. */
export async function fetchPace() {
  const stats = await getJson("/v1/measurement/stats?range=7d");
  const { settledBlockCount, firstObservedAt } = stats.lifetime;
  const days = (Date.now() - Date.parse(firstObservedAt)) / 86_400_000;
  if (!(days > 0.5)) return null;
  return { blocksPerDay: Number(settledBlockCount) / days, since: firstObservedAt };
}
