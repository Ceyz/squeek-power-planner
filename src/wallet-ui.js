// The "Your Squeeks" section: read a wallet's Squeeks on the testnet, show the next moves with
// their numbers, and send each move from the user's own wallet.
import { connect, discoverWallets, ensureSepolia, readApproved, readBalance, send, simulate, txLink, waitReceipt, walletError } from "./chain.js";
import { fetchAccount, isAddress, squeekImage, squeekImageNow, squeekTraits } from "./account.js";
import { applyMove, cooldownLeft, earning, mergeTx, milestones, planMoves, summarize } from "./moves.js";
import { confetti, reducedMotion, setNumber } from "./fx.js";
import { coatFor, hamsterSvg, iconSvg } from "./pixel.js";

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
const levelColor = (level) => `var(--l${Math.min(10, Math.max(1, level))})`;

/**
 * Tiny DOM builder: el("p", { className: "x" }, "text", child). Strings become text nodes;
 * "aria-*" props become attributes.
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener", textContent: text });
const icon = (name) => el("span", { className: "i", innerHTML: iconSvg(name) });

function chip(level, extra = "") {
  const node = el("span", { className: `chip ${extra}`, textContent: `L${level}` });
  node.style.setProperty("--c", levelColor(level));
  return node;
}

/** Replace a container's children with `nodes`, moving only the ones out of place. */
function reconcile(parent, nodes) {
  nodes.forEach((node, i) => {
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
  });
  while (parent.children.length > nodes.length) parent.lastElementChild.remove();
}

/** Play the entry pop once, then drop it so moving the node later doesn't replay it. */
function popIn(node) {
  node.classList.add("pop-in");
  node.addEventListener("animationend", () => node.classList.remove("pop-in"), { once: true });
  return node;
}

const traitText = (id) => {
  const t = squeekTraits(id);
  return t ? [t.palette, t.illumination].filter(Boolean).join(" · ") : "";
};

/** A Squeek's art in an <img>, at once if it has loaded before, else when it arrives. */
function art(id, onLoad) {
  const img = el("img", { alt: `Squeek #${id}`, width: 112, height: 112, decoding: "async" });
  const known = squeekImageNow(id);
  if (known) img.src = known;
  else if (known === null) img.classList.add("missing");
  else {
    squeekImage(id).then((uri) => {
      if (uri) img.src = uri;
      else img.classList.add("missing");
      onLoad?.();
    });
  }
  return img;
}

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
    // Display memory, so re-renders move what exists instead of rebuilding it.
    tiles: null,
    cards: new Map(), // Squeek id -> its card in the grid
    more: null,
    counted: new Set(), // addresses whose tiles already counted up from 0
    seenSteps: new Set(),
    trophies: null, // milestone ids done at the last render
    celebrate: false, // a move just landed: a newly reached milestone gets confetti
    cheered: new Set(), // tx hashes already celebrated
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
      state.cards.clear();
      state.seenSteps.clear();
      state.trophies = null;
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

  /** Confetti from a finished move's status line, once per transaction. */
  function cheer(key, hash) {
    if (state.cheered.has(hash)) return;
    state.cheered.add(hash);
    requestAnimationFrame(() => confetti(document.querySelector(`[data-status-key="${CSS.escape(key)}"]`)));
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
        const last = i + 1 === txs.length;
        if (last) state.celebrate = true;
        set(last ? `${label}: done. The figures above already count it; Squeekchain's indexer confirms it in about 3 minutes.` : `Done${of}.`, "ok", hash);
        if (last) cheer(key, hash);
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

  function renderPlayer(acct) {
    const avatar = $("wallet-avatar");
    if (avatar.dataset.address !== acct.address) {
      const coat = coatFor(acct.address);
      avatar.dataset.address = acct.address;
      avatar.title = `This page draws every address its own hamster: ${coat.name}.`;
      avatar.innerHTML = hamsterSvg({ size: 46, coat });
    }
    const who = state.viewing === state.connected ? "Your" : `${short(state.viewing)}'s`;
    $("wallet-title").textContent = `${who} Squeeks`;
    $("wallet-sub").textContent = `${acct.address.slice(0, 10)}…${acct.address.slice(-8)} · Sepolia testnet`;
  }

  function tiles() {
    if (state.tiles) return state.tiles;
    const make = (label, iconName, kind = "") => {
      const value = el("span", { className: "value", textContent: "–" });
      const sub = el("span", { className: "sub" });
      const node = el("div", { className: `tile ${kind}` }, el("span", { className: "label" }, iconName ? icon(iconName) : null, label), value, sub);
      return { node, value, sub };
    };
    state.tiles = {
      earning: make("Earning", "bolt", "power"),
      idle: make("Idle in the wallet", "zzz"),
      share: make("Share of staking rewards"),
      perDay: make("SQK a day", "coin", "strong"),
    };
    $("wallet-tiles").replaceChildren(...Object.values(state.tiles).map((t) => t.node));
    return state.tiles;
  }

  function renderTiles(acct, sum, net) {
    const t = tiles();
    // The first time an address shows, its numbers count up from zero.
    const from = state.counted.has(acct.address) ? {} : { from: 0 };
    state.counted.add(acct.address);
    setNumber(t.earning.value, sum.deposited, fmt.int, from);
    setNumber(t.idle.value, sum.idle, fmt.int, from);
    setNumber(t.share.value, sum.share, fmt.pct, from);
    setNumber(t.perDay.value, sum.perDay, fmt.num, from);
    t.earning.sub.textContent = `${fmt.num(sum.power.total)} power`;
    t.idle.sub.textContent = sum.idle ? "earning nothing" : "none";
    t.share.sub.textContent = `of ${fmt.num(Math.max(net.totalPower, sum.power.total))} power deposited`;
    t.perDay.sub.textContent = `${fmt.num(acct.earnedWeek)} earned in 7 days`;
  }

  const days = (blocks, net) => {
    const d = blocks / net.blocksPerDay;
    return d < 1 ? `≈ ${Math.max(1, Math.round(d * 24))} h` : `≈ ${fmt.num(d)} d`;
  };

  /** A card in the grid, made once per Squeek and repainted in place. */
  function gridCard(id) {
    let card = state.cards.get(id);
    if (card) return card;
    const trait = el("span", { className: "trait", textContent: traitText(id) });
    const frame = el("div", { className: "art" }, art(id, () => (trait.textContent = traitText(id))));
    const lv = el("span", { className: "chip lv" });
    const badge = el("span", { className: "badge" });
    const wait = el("span", { className: "badge wait" });
    const node = popIn(el("figure", { className: "squeek" }, lv, frame, el("figcaption", {}, el("span", { className: "id", textContent: `#${id}` }), trait, badge, wait)));
    card = { node, frame, lv, badge, wait };
    state.cards.set(id, card);
    return card;
  }

  function paint(card, level) {
    card.node.style.setProperty("--c", levelColor(level));
    card.lv.style.setProperty("--c", levelColor(level));
    card.lv.textContent = `L${level}`;
    card.frame.classList.toggle("foil", level >= 8);
  }

  function renderGrid(acct, net) {
    const sorted = [...acct.tokens].sort((a, b) => (a.custody === b.custody ? b.level - a.level || a.id - b.id : a.custody === "staking" ? -1 : 1));
    const nodes = sorted.slice(0, GRID_LIMIT).map((t) => {
      const card = gridCard(t.id);
      paint(card, t.level);
      const idle = t.custody === "wallet";
      const wait = cooldownLeft(t, acct.coreBlockHeight);
      card.node.classList.toggle("idle", idle);
      card.badge.className = `badge ${idle ? "idle" : "earn"}`;
      card.badge.textContent = idle ? "Idle" : "Earning";
      card.wait.hidden = !(t.mergeState === "cooldown" && wait > 0);
      card.wait.textContent = `Merge in ${days(wait, net)}`;
      return card.node;
    });
    if (sorted.length > GRID_LIMIT) {
      state.more ??= el("p", { className: "more" });
      state.more.textContent = `+${sorted.length - GRID_LIMIT} more`;
      nodes.push(state.more);
    }
    reconcile($("squeek-grid"), nodes);
  }

  function renderEmpty() {
    $("squeek-grid").replaceChildren(el("div", { className: "empty", innerHTML: hamsterSvg({ size: 56, asleep: true }) },
      el("div", {},
        el("p", { textContent: "No Squeeks on this address. The free testnet claim ran out (9,988 Squeeks went to 645 wallets), so there's nothing to act on here yet; the planner below still works with any numbers." }),
        el("button", { type: "button", className: "link", textContent: "See an example holder", onclick: () => view(EXAMPLE) }))));
    $("wallet-milestones").replaceChildren();
  }

  function renderMilestones(acct, plan) {
    const list = milestones(acct);
    const done = new Set(list.filter((m) => m.done).map((m) => m.id));
    const fresh = state.celebrate && state.trophies ? list.filter((m) => m.done && !state.trophies.has(m.id)).map((m) => m.id) : [];
    state.trophies = done;
    state.celebrate = false;
    const stepFor = (kind) => plan.steps.find((s) => s.kind === kind || (kind === "merge" && s.kind === "merge-wallet"));
    const items = list.map((m) => {
      const body = [el("span", { className: "ico" }, icon(m.done ? "star" : "lock")), el("span", {}, el("b", { textContent: m.title }), el("small", { textContent: m.detail }))];
      const step = m.done ? null : stepFor(m.unlock);
      const node = step
        ? el("a", { className: "trophy locked", href: `#step-${step.kind}`, title: "Go to the move that gets you closer" }, ...body)
        : el("span", { className: `trophy${m.done ? "" : " locked"}${fresh.includes(m.id) ? " fresh" : ""}` }, ...body);
      return el("li", {}, node);
    });
    const meter = el("div", { className: "meter" }, el("span"));
    meter.setAttribute("aria-hidden", "true");
    meter.style.setProperty("--p", String(done.size / list.length));
    $("wallet-milestones").replaceChildren(
      el("div", { className: "milestones-head" }, el("strong", { textContent: `${done.size}/${list.length}` }), meter, el("span", { textContent: "Planner milestones: this page's, not Squeekchain or Genesis badges" })),
      el("ul", { className: "trophies" }, ...items),
    );
    if (fresh.length) requestAnimationFrame(() => confetti(document.querySelector(".trophy.fresh")));
  }

  function statusLine(key) {
    const s = state.status.get(key);
    if (!s) return null;
    const line = el("p", { className: `tx-status ${s.tone}`, role: "status" }, s.text, s.hash ? " " : null, s.hash ? link(txLink(s.hash), "View on Etherscan") : null);
    line.dataset.statusKey = key;
    return line;
  }

  function actionButton(key, text, onclick, blocked) {
    const reason = lockReason(blocked);
    const button = el("button", { type: "button", className: "btn", textContent: text, disabled: Boolean(reason), onclick });
    button.dataset.key = key;
    return el("div", { className: "action" }, button, reason ? el("span", { className: "muted", textContent: reason }) : null);
  }

  function pill(kind, iconName, text) {
    return el("span", { className: `pill ${kind}` }, iconName ? icon(iconName) : null, text);
  }

  /** What a step gains, as pills, from the same figures as its sentence. */
  function gains(step, acct, net, ...extra) {
    const a = earning(step.before, acct, net);
    const b = earning(step.after, acct, net);
    return el("div", { className: "pills" },
      pill("power", "bolt", `+${fmt.num(step.after - step.before)} power`),
      b.perDay > a.perDay ? pill("sqk", "coin", `≈ +${fmt.num(b.perDay - a.perDay)} SQK a day`) : null,
      ...extra);
  }

  function changeLine(step, acct, net) {
    const a = earning(step.before, acct, net);
    const b = earning(step.after, acct, net);
    return `Your power ${fmt.num(step.before)} → ${fmt.num(step.after)}: share of staking rewards ${fmt.pct(a.share)} → ${fmt.pct(b.share)}, about ${fmt.num(a.perDay)} → ${fmt.num(b.perDay)} SQK a day.`;
  }

  function miniCard(id, level, role) {
    const frame = el("div", { className: "art" }, art(id));
    frame.classList.toggle("foil", level >= 8);
    const node = el("figure", { className: `squeek ${role}` }, chip(level, "lv"), frame, el("figcaption", {}, el("span", { className: "id", textContent: `${role === "keep" ? "Keep" : "Burn"} #${id}` })));
    node.style.setProperty("--c", levelColor(level));
    return node;
  }

  function renderPair(pair, deposited, blocked) {
    const key = `merge:${pair.survivor}-${pair.donor}`;
    const flip = state.swapped.has(key);
    const keep = flip ? pair.donor : pair.survivor;
    const burn = flip ? pair.survivor : pair.donor;
    const swap = el("button", { type: "button", className: "link swap-pick", onclick: () => {
      if (flip) state.swapped.delete(key);
      else state.swapped.add(key);
      render();
    } }, icon("swap"), "Keep the other one");
    swap.dataset.key = `swap:${key}`;
    const result = el("span", { className: "result" }, `L${pair.level + 1}`, el("small", { textContent: `#${keep}` }));
    result.style.setProperty("--c", levelColor(pair.level + 1));
    return el("li", { className: "pair" },
      el("div", { className: "pair-art", "aria-hidden": "true" }, miniCard(keep, pair.level, "keep"), el("span", { className: "op", textContent: "+" }), miniCard(burn, pair.level, "burn"), el("span", { className: "op" }, icon("arrow")), result),
      el("div", { className: "pair-body" },
        el("p", { textContent: `Keep #${keep}, burn #${burn}: +${fmt.num(pair.gain)} NFT power, and one deposit slot freed.` }),
        swap,
        actionButton(key, `Merge #${keep} + #${burn}`, () => run(key, [mergeTx({ ...pair, survivor: keep, donor: burn }, deposited)], `Merge #${keep} + #${burn}`), pair.afterDeposit && !blocked ? "After step 1: deposit them first." : blocked),
        statusLine(key)));
  }

  function renderStep(step, n, acct, net) {
    const body = [];
    if (step.kind === "deposit") {
      body.push(gains(step, acct, net, pill("info", null, `${step.txs.length} transaction${step.txs.length === 1 ? "" : "s"}`)));
      body.push(el("p", { textContent: `In your wallet they earn nothing. Deposited in Squeekchain's staking contract they do. ${changeLine(step, acct, net)} You can withdraw them later.` }));
      body.push(el("ul", { className: "tx-list" }, ...step.txs.map((tx) => el("li", { textContent: tx.label }))));
      const what = `Deposit ${step.ids.length} Squeek${step.ids.length === 1 ? "" : "s"}`;
      body.push(actionButton("deposit", `${what}${step.txs.length > 1 ? ` (${step.txs.length} transactions)` : ""}`, () => run("deposit", step.txs, what), step.blocked));
      if (step.txs.some((tx) => tx.effect.type === "approve")) body.push(el("p", { className: "muted", textContent: "The approval lets Squeekchain's Staking contract, and only it, move your Squeeks when you deposit." }));
      body.push(statusLine("deposit"));
    } else if (step.kind === "claim") {
      body.push(gains(step, acct, net, pill("sqk", "coin", `${fmt.num(step.amount)} SQK to stake`)));
      body.push(el("p", { textContent: `${fmt.num(step.amount)} SQK of rewards are waiting. Staked, SQK adds power too, multiplied by your Squeeks' power. ${changeLine(step, acct, net)}` }));
      body.push(actionButton("claim", `Claim and stake ${fmt.num(step.amount)} SQK`, () => run("claim", step.txs, `Claim and stake ${fmt.num(step.amount)} SQK`), step.blocked));
      body.push(statusLine("claim"));
    } else if (step.kind === "merge" || step.kind === "merge-wallet") {
      const burned = pill("cost", "flame", `−${step.pairs.length} Squeek${step.pairs.length === 1 ? "" : "s"} burned`);
      const cooldown = pill("info", "lock", "Cooldown before the next merge");
      body.push(step.kind === "merge" ? gains(step, acct, net, burned, cooldown) : el("div", { className: "pills" }, burned, cooldown));
      body.push(el("p", { textContent: "Two Squeeks of the same level make one of the next level with 10% more power. The other one is burned for good, so you'll hold fewer Squeeks, and the survivor waits out a cooldown before its next merge." }));
      if (step.kind === "merge") body.push(el("p", { textContent: `All ${step.pairs.length}: ${changeLine(step, acct, net)}` }));
      const shown = step.pairs.slice(0, PAIRS_SHOWN);
      body.push(el("ul", { className: "pairs" }, ...shown.map((pair) => renderPair(pair, step.kind === "merge", step.blocked))));
      if (step.pairs.length > shown.length) body.push(el("p", { className: "muted", textContent: `${step.pairs.length - shown.length} more pair${step.pairs.length - shown.length === 1 ? "" : "s"} after these.` }));
      if (step.blocked) body.push(el("p", { className: "muted", textContent: step.blocked }));
    } else {
      body.push(el("p", { className: "muted", textContent: step.blocked }));
    }
    return stepCard(step.kind, String(n), step.title, body);
  }

  function stepCard(kind, n, title, body) {
    const li = el("li", { className: "step", id: `step-${kind}` },
      el("span", { className: "step-num", "aria-hidden": "true", textContent: n }),
      el("div", { className: "step-body" }, el("h3", {}, el("span", { className: "sr-only", textContent: `${n}. ` }), title), ...body));
    li.dataset.kind = kind;
    if (!state.seenSteps.has(kind)) {
      state.seenSteps.add(kind);
      popIn(li);
    }
    return li;
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
    // Rebuilding the moves drops focus from a clicked button: put it back on its replacement.
    const focusKey = document.activeElement?.closest?.("#wallet-out [data-key]")?.dataset.key;

    const sum = summarize(acct, net);
    renderPlayer(acct);
    renderTiles(acct, sum, net);
    $("wallet-extra").textContent = [
      `Staked: ${fmt.num(acct.staked)} SQK`,
      `To claim: ${fmt.num(acct.claimable)} SQK`,
      ...acct.notes,
      ...acct.problems,
    ].join(" · ");

    const plan = planMoves(acct, net, { approved: state.approved });
    const empty = acct.tokens.length === 0;
    $("moves-title").hidden = empty;
    $("fill").hidden = empty;
    if (empty) renderEmpty();
    else {
      renderGrid(acct, net);
      renderMilestones(acct, plan);
    }

    const steps = plan.steps.map((step, i) => renderStep(step, i + 1, acct, net));
    // A finished step disappears from the plan; its outcome stays visible here.
    const shown = new Set(plan.steps.flatMap((s) => (s.pairs ? s.pairs.map((p) => `merge:${p.survivor}-${p.donor}`) : [s.kind])));
    $("wallet-recent").replaceChildren(...[...state.status.keys()].filter((key) => !shown.has(key)).map((key) => el("li", {}, statusLine(key))));
    if (!empty && steps.length === 0) {
      steps.push(stepCard("none", "✓", "Nothing to do right now", [el("p", { className: "muted", textContent: "Everything is deposited, nothing is waiting to be claimed and no pair is ready to merge." })]));
    }
    $("wallet-steps").replaceChildren(...steps);
    $("wallet-cooling").textContent = plan.cooling.length
      ? `Cooling down: ${plan.cooling.slice(0, 8).map((c) => `#${c.id} (L${c.level}) can merge in ${fmt.int(c.blocksLeft)} Squeek blocks, ${days(c.blocksLeft, net)}`).join("; ")}${plan.cooling.length > 8 ? "…" : ""}.`
      : "";

    const gas = $("wallet-gas");
    gas.hidden = !(state.connected === state.viewing && state.balance === 0n);
    if (!gas.hidden) gas.replaceChildren("This wallet has no Sepolia ETH to pay gas. Free faucets: ", ...FAUCETS.flatMap(([name, url], i) => [i ? ", " : "", link(url, name)]), ".");

    $("fill").onclick = () => {
      fill(acct);
      $("h-position").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
    };

    if (focusKey) {
      const again = document.querySelector(`#wallet-out [data-key="${CSS.escape(focusKey)}"]`);
      if (again && document.activeElement !== again) again.focus({ preventScroll: true });
    }
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
