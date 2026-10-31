// One account's Squeeks, stake and rewards from Squeekchain's public API, and the Squeeks' art.
import { NFT, SEPOLIA, STAKING, STAKING_IMPLEMENTATION } from "./chain.js";
import { fromWei, getJson } from "./live.js";

export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);

const MAX_PAGES = 30;

/** Every page of `/v1/accounts/{address}`. A cursor is tied to one indexed block, so a stale one restarts the walk once. */
export async function fetchAccount(address) {
  const account = address.toLowerCase();
  for (let attempt = 0; attempt < 2; attempt++) {
    const pages = [];
    let cursor = null;
    try {
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = await getJson(`/v1/accounts/${account}?${query}`);
        pages.push(page);
        cursor = page.nextCursor ?? null;
      } while (cursor && pages.length < MAX_PAGES);
      return normalizeAccount(pages);
    } catch (err) {
      if (attempt === 0 && pages.length > 0 && err.status >= 400 && err.status < 500) continue;
      throw err;
    }
  }
  throw new Error("The account changed while it was being read; try again.");
}

/** Pages of the account API -> the shape the wallet section works with (plain numbers, SQK in whole units). */
export function normalizeAccount(pages) {
  const first = pages[0];
  const tokens = pages.flatMap((page) => page.tokens ?? []).map((t) => ({
    id: Number(t.tokenId),
    custody: t.custody,
    level: Number(t.level),
    power: Number(t.basePower),
    nextMergeHeight: Number(t.nextMergeHeight),
    mergeState: t.mergeState ?? "unknown",
  }));
  const expected = Number(first.tokenCounts?.staking ?? 0) + Number(first.tokenCounts?.wallet ?? 0);

  const problems = [];
  if (first.identities?.genesis?.toLowerCase() !== NFT || first.identities?.staking?.proxy?.toLowerCase() !== STAKING) {
    problems.push("The API names different Squeekchain contracts than this page expects, so it offers no transactions.");
  }
  if (first.chain?.chainId !== SEPOLIA.decimal) problems.push("The API is not serving the Sepolia deployment.");
  const notes = [];
  if (first.identities?.staking?.implementation?.toLowerCase() !== STAKING_IMPLEMENTATION) {
    notes.push("Squeekchain upgraded the Staking contract since this page was written; every transaction is still dry-run first.");
  }
  if (tokens.length < expected) notes.push(`Showing ${tokens.length} of ${expected} Squeeks.`);

  return {
    address: first.account,
    tokens,
    staked: fromWei(first.stake.principalBaseUnits),
    claimable: fromWei(first.rewards.claimableBaseUnits),
    nftPower: fromWei(first.power.nftPower),
    sqkPower: fromWei(first.power.sqkPower),
    earnedWeek: (first.earnings ?? []).reduce((sum, day) => sum + fromWei(day.earnedBaseUnits), 0),
    coreBlockHeight: Number(first.economy.coreBlockHeight),
    mergesOpen: first.economy.mergesOpen,
    stakingPaused: first.economy.stakingPaused,
    maximumLevel: Number(first.economy.maximumLevel),
    safeThroughBlock: Number(first.chain?.safeThroughBlock ?? 0),
    trusted: problems.length === 0,
    problems,
    notes,
  };
}

// ---------- art ----------

const images = new Map();
const loaded = new Map(); // id -> uri or null, once known: lets a re-render show art without a blank frame
const traits = new Map(); // id -> { palette, illumination } from the same metadata
const queue = [];
let running = 0;
const PARALLEL = 4;

function pump() {
  while (running < PARALLEL && queue.length) {
    const { id, resolve } = queue.shift();
    running++;
    getJson(`/v1/squeeks/${id}`)
      .then((squeek) => {
        const uri = squeek.metadata?.imageDataUri;
        const trait = (type) => squeek.metadata?.attributes?.find((a) => a.traitType === type)?.value ?? null;
        traits.set(id, { palette: trait("Palette"), illumination: trait("Illumination") });
        return typeof uri === "string" && uri.startsWith("data:image/svg+xml;base64,") ? uri : null;
      })
      .catch(() => null)
      .then((uri) => {
        running--;
        loaded.set(id, uri);
        resolve(uri);
        pump();
      });
  }
}

/** A Squeek's on-chain art as an SVG data URI (null if unavailable). Four requests at a time, cached. */
export function squeekImage(id) {
  if (!images.has(id)) {
    images.set(id, new Promise((resolve) => {
      queue.push({ id, resolve });
      pump();
    }));
  }
  return images.get(id);
}

/** The art if it has already loaded (undefined if not yet known). */
export const squeekImageNow = (id) => loaded.get(id);

/** A Squeek's Palette and Illumination traits, once its metadata has loaded. */
export const squeekTraits = (id) => traits.get(id) ?? null;
