// Squeekchain's Sepolia contracts, calldata for the few calls the wallet section sends, and
// EIP-1193 wallet helpers. No library: every call has static arguments or one uint256[].
// Selectors were computed from the ABIs in Squeekchain's own app (the contracts are not
// verified on any explorer).

export const SEPOLIA = { chainId: "0xaa36a7", decimal: "11155111", name: "Sepolia", rpc: "https://sepolia.rpc.thirdweb.com" };
export const EXPLORER = "https://sepolia.etherscan.io";
export const NFT = "0xcb98349c134ab983da5bfd80527dfe2552bdb70f";
export const STAKING = "0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f";
export const STAKING_IMPLEMENTATION = "0xbbb816616d8840bd98094bf5a20f208df089230b";

/** Ids per deposit transaction: about 280k gas each, so 25 stays far below Sepolia's 16.7M per-transaction cap. */
export const DEPOSIT_CHUNK = 25;

// ---------- calldata ----------

export const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

export const approveAllData = (operator, approved) => `0xa22cb465${addressWord(operator)}${word(approved ? 1 : 0)}`;
export const isApprovedData = (owner, operator) => `0xe985e9c5${addressWord(owner)}${addressWord(operator)}`;
export const safeTransferData = (from, to, tokenId) => `0x42842e0e${addressWord(from)}${addressWord(to)}${word(tokenId)}`;
export const mergeData = (survivor, donor) => `0xd1c2babb${word(survivor)}${word(donor)}`;
export const mergeDepositedData = (survivor, donor) => `0x9a96734e${addressWord(NFT)}${word(survivor)}${word(donor)}`;
export const claimAndStakeData = () => "0xcb1a4fc0";

/** `Staking.deposit(collection, tokenIds)`: the array sits after the two head words. */
export const depositData = (tokenIds) =>
  `0xa71604e8${addressWord(NFT)}${word(64)}${word(tokenIds.length)}${tokenIds.map(word).join("")}`;

/** Custom errors of the NFT and Staking contracts a user can hit, by selector. */
const REVERTS = {
  "0x177e802f": "Staking isn't allowed to move your Squeeks yet: approve it first.",
  "0x64283d7b": "One of these Squeeks is no longer in this wallet.",
  "0x942d2be8": "You don't own both Squeeks of this merge.",
  "0x8605db4c": "One of these Squeeks is still cooling down from its last merge.",
  "0xc3464730": "These two Squeeks aren't the same level.",
  "0x2624bbde": "This Squeek is already at the maximum level.",
  "0x19a5efe7": "A Squeek can't merge with itself.",
  "0x9fd30294": "Merges are closed right now.",
  "0xd93c0665": "The contract is paused right now.",
  "0x4cb3183d": "Staking is paused right now.",
  "0x998c19cc": "Staking doesn't hold these Squeeks for you.",
  "0xb2e532de": "Staking refused this deposit (the 100-Squeek limit, or a Squeek it can't take).",
  "0x7e273289": "One of these Squeeks doesn't exist any more (it was merged away).",
};

export function decodeRevert(data) {
  if (typeof data !== "string" || data.length < 10) return "The contract refused this transaction.";
  return REVERTS[data.slice(0, 10).toLowerCase()] ?? `The contract refused this transaction (error ${data.slice(0, 10)}).`;
}

// ---------- wallet (EIP-1193) ----------

/** Wallets that announce themselves (EIP-6963), falling back to `window.ethereum`. */
export function discoverWallets(onChange) {
  const found = new Map();
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = event.detail ?? {};
    if (!info?.uuid || !provider || found.has(info.uuid)) return;
    found.set(info.uuid, { name: info.name, icon: info.icon, provider });
    onChange([...found.values()]);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Wallets answer synchronously; an old-style injected one is only used if none did.
  setTimeout(() => {
    if (found.size === 0 && window.ethereum) {
      found.set("injected", { name: "Browser wallet", icon: null, provider: window.ethereum });
      onChange([...found.values()]);
    }
  }, 300);
}

export async function connect(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("The wallet shared no account.");
  return accounts[0].toLowerCase();
}

export async function ensureSepolia(provider) {
  if ((await provider.request({ method: "eth_chainId" })) === SEPOLIA.chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA.chainId }] });
  } catch (err) {
    if (err?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: SEPOLIA.chainId,
        chainName: SEPOLIA.name,
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [SEPOLIA.rpc],
        blockExplorerUrls: [EXPLORER],
      }],
    });
  }
  if ((await provider.request({ method: "eth_chainId" })) !== SEPOLIA.chainId) throw new Error("Switch your wallet to Sepolia to continue.");
}

export async function readBalance(provider, address) {
  return BigInt(await provider.request({ method: "eth_getBalance", params: [address, "latest"] }));
}

export async function readApproved(provider, owner) {
  const result = await provider.request({ method: "eth_call", params: [{ to: NFT, data: isApprovedData(owner, STAKING) }, "latest"] });
  return BigInt(result || "0x0") === 1n;
}

/** The revert data an RPC error carries, wherever this wallet put it. */
function revertData(err) {
  for (const candidate of [err?.data, err?.data?.data, err?.error?.data, err?.data?.originalError?.data, err?.cause?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) return candidate;
  }
  return null;
}

/** Dry-run a transaction. Returns null when it would succeed, otherwise a sentence. */
export async function simulate(provider, tx) {
  try {
    await provider.request({ method: "eth_call", params: [tx, "latest"] });
    return null;
  } catch (err) {
    const data = revertData(err);
    return data ? decodeRevert(data) : null; // no revert data: an RPC hiccup, let the wallet judge
  }
}

export const send = (provider, tx) => provider.request({ method: "eth_sendTransaction", params: [tx] });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the wallet's node until the transaction is mined. Null after `timeoutMs`. */
export async function waitReceipt(provider, hash, { intervalMs = 3000, timeoutMs = 600_000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
    if (receipt?.blockNumber) return { ok: receipt.status === "0x1", block: Number(BigInt(receipt.blockNumber)) };
    await pause(intervalMs);
  }
  return null;
}

export function walletError(err) {
  if (err?.code === 4001) return "Cancelled in your wallet.";
  if (err?.code === -32002) return "Your wallet already has a request open: open it to answer.";
  return (err?.shortMessage ?? err?.message ?? String(err)).split("\n")[0].slice(0, 200);
}

export const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
