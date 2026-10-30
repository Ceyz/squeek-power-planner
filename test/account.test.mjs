import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAccount } from "../src/account.js";

// A trimmed real response of /v1/accounts/{address} (Sepolia, 2026-10-30).
const page = () => ({
  account: "0x340c4cdb74ea6ccf98592b9e63ee80f814673ad7",
  chain: { chainId: "11155111", safeThroughBlock: "12025795" },
  identities: {
    genesis: "0xcb98349c134ab983da5bfd80527dfe2552bdb70f",
    staking: { proxy: "0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f", implementation: "0xbbb816616d8840bd98094bf5a20f208df089230b" },
  },
  economy: { currentRound: "551", coreBlockHeight: "4135", mergesOpen: true, stakingPaused: false, maximumLevel: 10 },
  rewards: { claimableBaseUnits: "882095557099818565430" },
  power: { nftPower: "1000000000000000000000", sqkPower: "0" },
  stake: { principalBaseUnits: "0" },
  earnings: [
    { date: "2026-10-28", earnedBaseUnits: "137186894702969185103" },
    { date: "2026-10-29", earnedBaseUnits: "476761676533365642017" },
    { date: "2026-10-30", earnedBaseUnits: "268146985863483738309" },
  ],
  tokens: [
    { tokenId: "8930", custody: "staking", level: 1, basePower: "1000", nextMergeHeight: "0", mergeState: "ready" },
    { tokenId: "8935", custody: "wallet", level: 1, basePower: "1000", nextMergeHeight: "0", mergeState: "ready" },
  ],
  tokenCounts: { staking: "1", wallet: "1" },
  nextCursor: null,
});

test("normalizeAccount turns base units and strings into plain numbers", () => {
  const acct = normalizeAccount([page()]);
  assert.equal(acct.address, "0x340c4cdb74ea6ccf98592b9e63ee80f814673ad7");
  assert.deepEqual(acct.tokens[0], { id: 8930, custody: "staking", level: 1, power: 1000, nextMergeHeight: 0, mergeState: "ready" });
  assert.equal(acct.nftPower, 1000);
  assert.equal(acct.claimable, 882.095557);
  assert.ok(Math.abs(acct.earnedWeek - 882.095556) < 1e-6);
  assert.equal(acct.coreBlockHeight, 4135);
  assert.equal(acct.safeThroughBlock, 12025795);
  assert.equal(acct.trusted, true);
  assert.deepEqual(acct.notes, []);
});

test("pages are joined, and a short read is flagged", () => {
  const second = { ...page(), tokens: [{ tokenId: "8936", custody: "wallet", level: 1, basePower: "1000", nextMergeHeight: "0", mergeState: "ready" }] };
  const first = { ...page(), tokenCounts: { staking: "1", wallet: "3" } };
  const acct = normalizeAccount([first, second]);
  assert.deepEqual(acct.tokens.map((t) => t.id), [8930, 8935, 8936]);
  assert.match(acct.notes[0], /Showing 3 of 4/);
});

test("contracts other than the expected ones disable transactions", () => {
  const forged = page();
  forged.identities.staking.proxy = "0x000000000000000000000000000000000000dead";
  const acct = normalizeAccount([forged]);
  assert.equal(acct.trusted, false);
  assert.match(acct.problems[0], /different Squeekchain contracts/);

  const upgraded = page();
  upgraded.identities.staking.implementation = "0x1111111111111111111111111111111111111111";
  assert.equal(normalizeAccount([upgraded]).trusted, true);
  assert.match(normalizeAccount([upgraded]).notes[0], /upgraded/);
});
