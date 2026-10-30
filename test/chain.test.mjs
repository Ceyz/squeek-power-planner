import test from "node:test";
import assert from "node:assert/strict";
import {
  NFT,
  STAKING,
  approveAllData,
  claimAndStakeData,
  decodeRevert,
  depositData,
  isApprovedData,
  mergeData,
  mergeDepositedData,
  safeTransferData,
  simulate,
  waitReceipt,
  walletError,
} from "../src/chain.js";

const HOLDER = "0xffb26838df0c32966fc15a4b375a2759014f9108";
const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");

// Expected calldata was produced once with viem's encodeFunctionData and pasted here.
test("calldata matches a reference ABI encoder", () => {
  assert.equal(approveAllData(STAKING, true), `0xa22cb465${pad(STAKING)}${pad("1")}`);
  assert.equal(isApprovedData(HOLDER, STAKING), `0xe985e9c5${pad(HOLDER)}${pad(STAKING)}`);
  assert.equal(safeTransferData(HOLDER, STAKING, 5101), `0x42842e0e${pad(HOLDER)}${pad(STAKING)}${pad("13ed")}`);
  assert.equal(mergeData(5101, 5102), `0xd1c2babb${pad("13ed")}${pad("13ee")}`);
  assert.equal(mergeDepositedData(5101, 5102), `0x9a96734e${pad(NFT)}${pad("13ed")}${pad("13ee")}`);
  assert.equal(claimAndStakeData(), "0xcb1a4fc0");
  assert.equal(
    depositData([5101, 5102, 5103]),
    "0xa71604e8000000000000000000000000cb98349c134ab983da5bfd80527dfe2552bdb70f" +
      "0000000000000000000000000000000000000000000000000000000000000040" +
      "0000000000000000000000000000000000000000000000000000000000000003" +
      "00000000000000000000000000000000000000000000000000000000000013ed" +
      "00000000000000000000000000000000000000000000000000000000000013ee" +
      "00000000000000000000000000000000000000000000000000000000000013ef",
  );
});

test("known reverts become sentences", () => {
  assert.match(decodeRevert("0x177e802f" + "00".repeat(64)), /approve it first/);
  assert.match(decodeRevert("0x8605db4c"), /cooling down/);
  assert.match(decodeRevert("0xdeadbeef"), /error 0xdeadbeef/);
  assert.match(decodeRevert(undefined), /refused/);
});

test("simulate reads revert data wherever the wallet nests it", async () => {
  const failing = (err) => ({ request: async () => { throw err; } });
  assert.equal(await simulate({ request: async () => "0x" }, {}), null);
  assert.match(await simulate(failing({ data: "0x9fd30294" }), {}), /Merges are closed/);
  assert.match(await simulate(failing({ data: { data: "0x64283d7b" } }), {}), /no longer in this wallet/);
  assert.match(await simulate(failing({ error: { data: "0x177e802f" } }), {}), /approve/);
  assert.equal(await simulate(failing(new Error("network down")), {}), null);
});

test("waitReceipt polls until the transaction is mined", async () => {
  let polls = 0;
  const provider = { request: async () => (++polls < 3 ? null : { blockNumber: "0x10", status: "0x1" }) };
  assert.deepEqual(await waitReceipt(provider, "0xabc", { intervalMs: 1 }), { ok: true, block: 16 });
  const failed = { request: async () => ({ blockNumber: "0x11", status: "0x0" }) };
  assert.deepEqual(await waitReceipt(failed, "0xabc", { intervalMs: 1 }), { ok: false, block: 17 });
  assert.equal(await waitReceipt({ request: async () => null }, "0xabc", { intervalMs: 1, timeoutMs: 5 }), null);
});

test("wallet errors read as plain sentences", () => {
  assert.equal(walletError({ code: 4001 }), "Cancelled in your wallet.");
  assert.match(walletError({ code: -32002 }), /already has a request open/);
  assert.equal(walletError(new Error("boom\nstack")), "boom");
});
