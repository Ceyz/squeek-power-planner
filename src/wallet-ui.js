// The "Your Squeeks" section: read a wallet's Squeeks on the testnet, show the next moves with
// their numbers, and send each move from the user's own wallet.
import { connect, discoverWallets, ensureSepolia, readApproved, readBalance, send, simulate, txLink, waitReceipt, walletError } from "./chain.js";
import { fetchAccount, isAddress, squeekImage } from "./account.js";
import { applyMove, cooldownLeft, earning, mergeTx, planMoves, summarize } from "./moves.js";

const EXAMPLE = "0x340c4cdb74ea6ccf98592b9e63ee80f814673ad7";
const FAUCETS = [
  ["Google Cloud", "https://cloud.google.com/application/web3/faucet/ethereum/sepolia"],
  ["Alchemy", "https://www.alchemy.com/faucets/ethereum-sepolia"],
];
const GRID_LIMIT = 24;
const PAIRS_SHOWN = 6;
const REFRESH_MS = 20_000;

const $ = (id) => document.getElementById(id);
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Tiny DOM builder: el("p", { className: "x" }, "text", child). Strings become text nodes. */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener", textContent: text });

export function initWallet({ getNetwork, fill, fmt }) {
  const state = {
    wallets: [],
    wallet: null, // { name, icon, provider }
    connected: null, // lowercase address the wallet shared
    viewing: null, // lowercase address on screen
    api: null, // normalized account as the API last served it
    patches: [], // { effect, block } mined but not yet indexed
    approved: false,
    balance: null,
    busy: false,
    swapped: new Set(),
    status: new Map(), // step key -> { text, hash, tone }
    refreshTimer: null,
  };

  // ---------- current view ----------

  function current() {
    if (!state.api) return null;
    const cooldowns = getNetwork()?.cooldownBlocks ?? [];
    return state.patches.filter((p) => p.block > state.api.safeThroughBlock).reduce((acct, p) => applyMove(acct, p.effect, cooldowns), state.api);
  }

  /** Why a button is disabled, or null. */
  function lockReason(blocked) {
    if (blocked) return blocked;
    if (!state.api?.trusted) return "Transactions are off for this account.";
    if (!state.connected) return "Connect this wallet to do it.";
    if (state.connected !== state.viewing) return "You're looking at another address: connect it to act.";
    if (state.balance === 0n) return "Needs a little Sepolia ETH for gas.";
    if (state.busy) return "Another transaction is in progress.";
    return null;
  }

  // ---------- loading ----------

  function say(text, tone = "") {
    $("wallet-status").textContent = text;
    $("wallet-status").className = `note ${tone}`;
  }

  async function view(address) {
    const account = address.toLowerCase();
    if (account !== state.viewing) {
      state.patches = [];
      state.status.clear();
      state.swapped.clear();
    }
    state.viewing = account;
    say(`Reading ${short(account)} on the Sepolia testnet…`);
    try {
      state.api = await fetchAccount(account);
      say("");
    } catch (err) {
      state.api = null;
      say(`Couldn't read this address: ${err.message}`, "warn");
    }
    if (state.wallet && state.connected === account) await readWalletState();
    render();
    syncUrl();
  }

  async function readWalletState() {
    try {
      await ensureSepolia(state.wallet.provider);
      [state.approved, state.balance] = await Promise.all([readApproved(state.wallet.provider, state.connected), readBalance(state.wallet.provider, state.connected)]);
    } catch (err) {
      say(walletError(err), "warn");
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    if (!state.patches.some((p) => p.block > (state.api?.safeThroughBlock ?? 0))) return;
    state.refreshTimer = setTimeout(async () => {
      try {
        const fresh = await fetchAccount(state.viewing);
        if (fresh.address === state.viewing) state.api = fresh;
        state.patches = state.patches.filter((p) => p.block > state.api.safeThroughBlock);
        render();
      } catch {
        // Keep the patched view; try again on the next tick.
      }
      scheduleRefresh();
    }, REFRESH_MS);
  }

  function syncUrl() {
    try {
      const url = new URL(location.href);
      if (state.viewing && state.viewing !== state.connected) url.searchParams.set("address", state.viewing);
      else url.searchParams.delete("address");
      history.replaceState(null, "", url);
    } catch {
      // Some embeds forbid history changes; the page still works.
    }
  }

  // ---------- wallet ----------

  async function useWallet(wallet) {
    state.wallet = wallet;
    try {
      state.connected = await connect(wallet.provider);
      await ensureSepolia(wallet.provider);
    } catch (err) {
      say(walletError(err), "warn");
      if (!state.connected) state.wallet = null;
      renderConnect();
      return;
    }
    wallet.provider.on?.("accountsChanged", (accounts) => {
      state.connected = accounts?.[0]?.toLowerCase() ?? null;
      if (state.connected) view(state.connected);
      else render();
    });
    wallet.provider.on?.("chainChanged", () => render());
    renderConnect();
    await view(state.connected);
  }

  async function run(key, txs, label) {
    const { provider } = state.wallet;
    state.busy = true;
    render();
    const set = (text, tone = "", hash = null) => {
      state.status.set(key, { text, tone, hash });
      render();
    };
    try {
      for (const [i, tx] of txs.entries()) {
        const of = txs.length > 1 ? ` (${i + 1} of ${txs.length})` : "";
        await ensureSepolia(provider);
        const call = { from: state.connected, to: tx.to, data: tx.data };
        set(`Checking${of}: ${tx.label}…`);
        const refused = await simulate(provider, call);
        if (refused) {
          set(refused, "warn");
          return;
        }
        set(`Confirm in your wallet${of}: ${tx.label}`);
        const hash = await send(provider, call);
        set(`Sent${of}, waiting for the block…`, "", hash);
        const receipt = await waitReceipt(provider, hash);
        if (!receipt) {
          set("Not mined after 10 minutes: check your wallet (it may have been sped up or replaced).", "warn", hash);
          return;
        }
        if (!receipt.ok) {
          set("The transaction failed on chain.", "warn", hash);
          return;
        }
        if (tx.effect.type === "approve") state.approved = true;
        else state.patches.push({ effect: tx.effect, block: receipt.block });
        set(i + 1 < txs.length ? `Done${of}.` : `${label}: done. The figures above already count it; Squeekchain's indexer confirms it in about 3 minutes.`, "ok", hash);
      }
    } catch (err) {
      set(walletError(err), "warn");
    } finally {
      state.busy = false;
      state.balance = await readBalance(provider, state.connected).catch(() => state.balance);
      render();
      scheduleRefresh();
    }
  }

  // ---------- rendering ----------

  function renderConnect() {
    const box = $("wallet-connect");
    if (state.connected) {
      box.replaceChildren(el("span", { className: "connected", textContent: `${state.wallet.name}: ${short(state.connected)} on Sepolia` }));
      if (state.viewing !== state.connected) box.append(el("button", { type: "button", className: "link", textContent: "Show my wallet", onclick: () => view(state.connected) }));
      return;
    }
    if (state.wallets.length === 0) {
      box.replaceChildren(
        el("span", { className: "muted", textContent: "No wallet found in this browser. " }),
        link(`https://metamask.app.link/dapp/${location.host}${location.pathname}`, "Open in MetaMask mobile"),
      );
      return;
    }
    box.replaceChildren(
      ...state.wallets.map((wallet) => {
        const button = el("button", { type: "button", className: "btn", onclick: () => useWallet(wallet) });
        if (wallet.icon?.startsWith("data:image/")) button.append(el("img", { src: wallet.icon, alt: "", className: "wallet-icon" }));
        button.append(state.wallets.length === 1 ? "Connect wallet" : `Connect ${wallet.name}`);
        return button;
      }),
    );
  }

  function tile(label, value, sub, strong = false) {
    return el("div", { className: `tile${strong ? " strong" : ""}` },
      el("span", { className: "label", textContent: label }),
      el("span", { className: "value", textContent: value }),
      sub ? el("span", { className: "sub", textContent: sub }) : null);
  }

  function squeekFigure(id, caption, badge, tone) {
    const img = el("img", { alt: `Squeek #${id}`, width: 96, height: 96, loading: "lazy" });
    squeekImage(id).then((uri) => {
      if (uri) img.src = uri;
      else img.classList.add("missing");
    });
    return el("figure", { className: "squeek" }, img, el("figcaption", {}, el("span", { textContent: caption }), badge ? el("span", { className: `badge ${tone}`, textContent: badge }) : null));
  }

  const days = (blocks, net) => {
    const d = blocks / net.blocksPerDay;
    return d < 1 ? `≈ ${Math.max(1, Math.round(d * 24))} h` : `≈ ${fmt.num(d)} d`;
  };

  function renderGrid(acct, net) {
    const sorted = [...acct.tokens].sort((a, b) => (a.custody === b.custody ? b.level - a.level || a.id - b.id : a.custody === "staking" ? -1 : 1));
    const figures = sorted.slice(0, GRID_LIMIT).map((t) => {
      const wait = cooldownLeft(t, acct.coreBlockHeight);
      const [badge, tone] = t.custody === "wallet" ? ["Idle", "idle"] : t.mergeState === "cooldown" && wait > 0 ? [`Earning · merge in ${days(wait, net)}`, "earn"] : ["Earning", "earn"];
      return squeekFigure(t.id, `#${t.id} · L${t.level}`, badge, tone);
    });
    if (sorted.length > GRID_LIMIT) figures.push(el("p", { className: "muted more", textContent: `and ${sorted.length - GRID_LIMIT} more` }));
    $("squeek-grid").replaceChildren(...figures);
  }

  function statusLine(key) {
    const s = state.status.get(key);
    if (!s) return null;
    return el("p", { className: `tx-status ${s.tone}`, role: "status" }, s.text, s.hash ? " " : null, s.hash ? link(txLink(s.hash), "View on Etherscan") : null);
  }

  function actionButton(text, onclick, blocked) {
    const reason = lockReason(blocked);
    return el("div", { className: "action" },
      el("button", { type: "button", className: "btn", textContent: text, disabled: Boolean(reason), onclick }),
      reason ? el("span", { className: "muted", textContent: reason }) : null);
  }

  function changeLine(step, acct, net) {
    const a = earning(step.before, acct, net);
    const b = earning(step.after, acct, net);
    return `Your power ${fmt.num(step.before)} → ${fmt.num(step.after)}: share of staking rewards ${fmt.pct(a.share)} → ${fmt.pct(b.share)}, about ${fmt.num(a.perDay)} → ${fmt.num(b.perDay)} SQK a day.`;
  }

  function renderPair(pair, deposited, blocked) {
    const key = `merge:${pair.survivor}-${pair.donor}`;
    const flip = state.swapped.has(key);
    const keep = flip ? pair.donor : pair.survivor;
    const burn = flip ? pair.survivor : pair.donor;
    const swap = el("button", { type: "button", className: "link", textContent: "Keep the other one", onclick: () => {
      if (flip) state.swapped.delete(key);
      else state.swapped.add(key);
      render();
    } });
    return el("li", { className: "pair" },
      el("div", { className: "pair-art" }, squeekFigure(keep, `Keep #${keep}`, `L${pair.level} → L${pair.level + 1}`, "earn"), squeekFigure(burn, `Burn #${burn}`, null, "")),
      el("div", { className: "pair-body" },
        el("p", { textContent: `+${fmt.num(pair.gain)} NFT power, and one deposit slot freed.` }),
        swap,
        actionButton(`Merge #${keep} + #${burn}`, () => run(key, [mergeTx({ ...pair, survivor: keep, donor: burn }, deposited)], `Merge #${keep} + #${burn}`), pair.afterDeposit && !blocked ? "After step 1: deposit them first." : blocked),
        statusLine(key)));
  }

  function renderStep(step, n, acct, net) {
    const body = [];
    if (step.kind === "deposit") {
      body.push(el("p", { textContent: `In your wallet they earn nothing. Deposited in Squeekchain's staking contract they do. ${changeLine(step, acct, net)} You can withdraw them later.` }));
      body.push(el("ul", { className: "tx-list" }, ...step.txs.map((tx) => el("li", { textContent: tx.label }))));
      const what = `Deposit ${step.ids.length} Squeek${step.ids.length === 1 ? "" : "s"}`;
      body.push(actionButton(`${what}${step.txs.length > 1 ? ` (${step.txs.length} transactions)` : ""}`, () => run("deposit", step.txs, what), step.blocked));
      if (step.txs.some((tx) => tx.effect.type === "approve")) body.push(el("p", { className: "muted", textContent: "The approval lets Squeekchain's Staking contract, and only it, move your Squeeks when you deposit." }));
      body.push(statusLine("deposit"));
    } else if (step.kind === "claim") {
      body.push(el("p", { textContent: `${fmt.num(step.amount)} SQK of rewards are waiting. Staked, SQK adds power too, multiplied by your Squeeks' power. ${changeLine(step, acct, net)}` }));
      body.push(actionButton(`Claim and stake ${fmt.num(step.amount)} SQK`, () => run("claim", step.txs, `Claim and stake ${fmt.num(step.amount)} SQK`), step.blocked));
      body.push(statusLine("claim"));
    } else if (step.kind === "merge" || step.kind === "merge-wallet") {
      body.push(el("p", { textContent: "Two Squeeks of the same level make one of the next level with 10% more power. The other one is burned for good, so you'll hold fewer Squeeks, and the survivor waits out a cooldown before its next merge." }));
      if (step.kind === "merge") body.push(el("p", { textContent: `All ${step.pairs.length}: ${changeLine(step, acct, net)}` }));
      const shown = step.pairs.slice(0, PAIRS_SHOWN);
      body.push(el("ul", { className: "pairs" }, ...shown.map((pair) => renderPair(pair, step.kind === "merge", step.blocked))));
      if (step.pairs.length > shown.length) body.push(el("p", { className: "muted", textContent: `${step.pairs.length - shown.length} more pair${step.pairs.length - shown.length === 1 ? "" : "s"} after these.` }));
      if (step.blocked) body.push(el("p", { className: "muted", textContent: step.blocked }));
    } else {
      body.push(el("p", { className: "muted", textContent: step.blocked }));
    }
    return el("li", { className: "step" }, el("h3", { textContent: `${n}. ${step.title}` }), ...body);
  }

  function render() {
    renderConnect();
    const acct = current();
    const net = getNetwork();
    $("wallet-out").hidden = !acct;
    if (!acct) return;
    if (!net) {
      say("Loading the testnet's figures…");
      return;
    }
    const sum = summarize(acct, net);
    const who = state.viewing === state.connected ? "Your" : `${short(state.viewing)}'s`;
    $("wallet-title").textContent = `${who} Squeeks`;
    $("wallet-tiles").replaceChildren(
      tile("Earning", fmt.int(sum.deposited), `${fmt.num(sum.power.total)} power`),
      tile("Idle in the wallet", fmt.int(sum.idle), sum.idle ? "earning nothing" : "none"),
      tile("Share of staking rewards", fmt.pct(sum.share), `of ${fmt.num(Math.max(net.totalPower, sum.power.total))} power deposited`),
      tile("SQK a day", fmt.num(sum.perDay), `${fmt.num(acct.earnedWeek)} earned in 7 days`, true),
    );
    $("wallet-extra").textContent = [
      `Staked: ${fmt.num(acct.staked)} SQK`,
      `To claim: ${fmt.num(acct.claimable)} SQK`,
      ...acct.notes,
      ...acct.problems,
    ].join(" · ");

    const empty = acct.tokens.length === 0;
    $("moves-title").hidden = empty;
    $("fill").hidden = empty;
    if (empty) {
      $("squeek-grid").replaceChildren(el("div", { className: "empty" },
        el("p", { className: "muted", textContent: "No Squeeks on this address. The free testnet claim ran out (9,988 Squeeks went to 645 wallets), so there's nothing to act on here yet; the planner below still works with any numbers." }),
        el("button", { type: "button", className: "link", textContent: "See an example holder", onclick: () => view(EXAMPLE) })));
    } else {
      renderGrid(acct, net);
    }

    const plan = planMoves(acct, net, { approved: state.approved });
    const steps = plan.steps.map((step, i) => renderStep(step, i + 1, acct, net));
    // A finished step disappears from the plan; its outcome stays visible here.
    const shown = new Set(plan.steps.flatMap((s) => (s.pairs ? s.pairs.map((p) => `merge:${p.survivor}-${p.donor}`) : [s.kind])));
    $("wallet-recent").replaceChildren(...[...state.status.keys()].filter((key) => !shown.has(key)).map((key) => el("li", {}, statusLine(key))));
    if (acct.tokens.length > 0 && steps.length === 0) steps.push(el("li", { className: "step" }, el("h3", { textContent: "Nothing to do right now" }), el("p", { className: "muted", textContent: "Everything is deposited, nothing is waiting to be claimed and no pair is ready to merge." })));
    $("wallet-steps").replaceChildren(...steps);
    $("wallet-cooling").textContent = plan.cooling.length
      ? `Cooling down: ${plan.cooling.slice(0, 8).map((c) => `#${c.id} (L${c.level}) can merge in ${fmt.int(c.blocksLeft)} Squeek blocks, ${days(c.blocksLeft, net)}`).join("; ")}${plan.cooling.length > 8 ? "…" : ""}.`
      : "";

    const gas = $("wallet-gas");
    gas.hidden = !(state.connected === state.viewing && state.balance === 0n);
    if (!gas.hidden) gas.replaceChildren("This wallet has no Sepolia ETH to pay gas. Free faucets: ", ...FAUCETS.flatMap(([name, url], i) => [i ? ", " : "", link(url, name)]), ".");

    $("fill").onclick = () => {
      fill(acct);
      $("h-position").scrollIntoView({ behavior: "smooth" });
    };
  }

  // ---------- boot ----------

  discoverWallets((wallets) => {
    state.wallets = wallets;
    renderConnect();
  });
  renderConnect();
  $("lookup").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = $("lookup-address").value.trim();
    if (isAddress(value)) view(value);
    else say("That isn't an address: 0x followed by 40 hex characters.", "warn");
  });
  $("example").addEventListener("click", () => view(EXAMPLE));
  try {
    const fromUrl = new URL(location.href).searchParams.get("address");
    if (fromUrl && isAddress(fromUrl)) view(fromUrl);
  } catch {
    // No usable URL: nothing to preload.
  }

  return { render };
}
