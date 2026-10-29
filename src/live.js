// Live parameters from the public Squeekchain API (CORS-open). Values come back as
// decimal strings, power in 18-decimal units.

const API = "https://api.squeekchain.com";

const fromWei = (value) => Number(BigInt(value) / 10n ** 12n) / 1e6;

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Testnet staking totals and power parameters. */
export async function fetchTestnet() {
  const state = await getJson("/v1/economy/state");
  const { staking, nft } = state;
  return {
    totalNftPower: fromWei(staking.totalNftPower),
    totalSqkPower: fromWei(staking.totalSqkPower),
    totalStaked: fromWei(staking.totalStakedBaseUnits),
    sqkPerPower: fromWei(staking.sqkPerPower),
    referencePower: fromWei(staking.referencePower),
    levelPower: nft.basePower.map(Number),
    generatedAt: state.generatedAt,
  };
}

/** Squeek blocks a day since the wheel was first observed on this deployment. */
export async function fetchPace() {
  const stats = await getJson("/v1/measurement/stats?range=7d");
  const { settledBlockCount, firstObservedAt } = stats.lifetime;
  const days = (Date.now() - Date.parse(firstObservedAt)) / 86_400_000;
  if (!(days > 0.5)) return null;
  return { blocksPerDay: Number(settledBlockCount) / days, since: firstObservedAt };
}
