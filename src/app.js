import {
  LAUNCH_PARAMS,
  LEVEL_POWER,
  MAX_LEVEL,
  MAX_TOKENS,
  SCHEDULE,
  accountPower,
  emptyCounts,
  mergePlan,
  shareOf,
  sqkPerDay,
  squeekInSqk,
  tokenCount,
} from "./model.js";
import { fetchPace, fetchTestnet } from "./live.js";
import { initWallet } from "./wallet-ui.js";

const $ = (id) => document.getElementById(id);
const COLLECTION_SIZE = 9999;
const STORAGE_KEY = "spp.position";

const live = { testnet: null, pace: null };

// ---------- formatting ----------

const fmtInt = (n) => Math.round(n).toLocaleString();

function fmtNum(n) {
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1e7) return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 });
}

function fmtPct(x) {
  if (x === 0) return "0%";
  if (x < 0.0001) return "<0.01%";
  return `${(x * 100).toLocaleString(undefined, { maximumFractionDigits: x < 0.01 ? 3 : 2 })}%`;
}

const fmtGain = (before, after) => (before > 0 ? ` (+${fmtPct(after / before - 1)})` : "");

function fmtDays(blocks, pace) {
  const days = blocks / pace;
  if (blocks === 0) return "right away";
  return days < 1 ? `≈ ${Math.round(days * 24)} hours` : `≈ ${days.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;
}

function describeCounts(counts) {
  const parts = counts.map((n, i) => (n > 0 ? `${n} × L${i + 1}` : null)).filter(Boolean);
  return parts.length ? parts.join(" + ") : "no Squeeks";
}

// ---------- inputs ----------

function buildLevelInputs() {
  const wrap = $("levels");
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const label = document.createElement("label");
    label.className = "level";
    label.innerHTML = `<span class="lvl">L${level}</span><span class="pw">${fmtInt(LEVEL_POWER[level - 1])}</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.value = "0";
    input.inputMode = "numeric";
    input.id = `lvl-${level}`;
    input.setAttribute("aria-label", `Level ${level} Squeeks`);
    label.append(input);
    wrap.append(label);
  }
}

function fillSelects() {
  for (const phase of SCHEDULE) $("phase").add(new Option(`${phase.label}: ${fmtNum(phase.perBlock)} SQK a block`, phase.id));
  for (let level = 2; level <= MAX_LEVEL; level++) $("target").add(new Option(level === MAX_LEVEL ? "10 (as far as possible)" : String(level), String(level)));
  $("target").value = String(MAX_LEVEL);
}

const num = (id) => Math.max(0, Number($(id).value) || 0);

function readCounts() {
  const counts = emptyCounts();
  for (let level = 1; level <= MAX_LEVEL; level++) counts[level - 1] = Math.floor(num(`lvl-${level}`));
  return counts;
}

function readParams() {
  return {
    ...LAUNCH_PARAMS,
    sqkPerPower: Math.max(1, num("c")),
    referencePower: live.testnet && $("preset").value === "testnet" ? live.testnet.referencePower : LAUNCH_PARAMS.referencePower,
  };
}

/** Minted Squeeks a holding stands for: a level L Squeek used 2^(L-1) of them. */
const mintedEquivalent = (counts) => counts.reduce((sum, n, i) => sum + n * 2 ** i, 0);

function applyPreset(counts) {
  const preset = $("preset").value;
  if (preset === "launch-l1") {
    $("others-nft").value = String(Math.max(0, COLLECTION_SIZE - mintedEquivalent(counts)) * LEVEL_POWER[0]);
    $("others-sqk").value = "0";
  } else if (preset === "testnet" && live.testnet) {
    $("others-nft").value = String(Math.round(live.testnet.totalNftPower));
    $("others-sqk").value = String(Math.round(live.testnet.totalSqkPower));
  }
}

// ---------- rendering ----------

function render() {
  const counts = readCounts();
  const staked = num("staked");
  const nftOnly = $("rule").value === "nft-only";
  const params = readParams();
  const pace = Math.max(1, num("pace"));
  const phase = SCHEDULE.find((p) => p.id === $("phase").value) ?? measuredPhase() ?? SCHEDULE[0];

  $("c-field").hidden = nftOnly;
  applyPreset(counts);
  const others = num("others-nft") + (nftOnly ? 0 : num("others-sqk"));

  // 1. Position
  const me = accountPower(counts, staked, params, { nftOnly });
  $("out-nft").textContent = fmtNum(me.nft);
  $("out-mult").textContent = nftOnly ? "n/a" : `× ${fmtNum(me.multiplier)}`;
  $("out-sqk").textContent = fmtNum(me.sqk);
  $("out-total").textContent = fmtNum(me.total);
  $("out-deposit").textContent =
    me.idle > 0
      ? `⚠️ Only ${MAX_TOKENS} Squeeks fit in one account: ${me.idle} of yours earn nothing until you merge them.`
      : `${me.deposited} of ${MAX_TOKENS} deposit slots used.`;

  // 2. Share and SQK
  const share = shareOf(me.total, others);
  const perDay = sqkPerDay(share, phase.perBlock, pace);
  $("out-share").textContent = fmtPct(share);
  $("out-perblock").textContent = fmtNum(phase.perBlock * share);
  $("out-day").textContent = fmtNum(perDay);
  $("out-month").textContent = fmtNum(perDay * 30);

  renderMerge(counts, staked, params, nftOnly, others, phase, pace, me, perDay);
  renderSwap(counts, staked, params, nftOnly);
  saveState();
}

function renderMerge(counts, staked, params, nftOnly, others, phase, pace, me, perDay) {
  const out = $("merge-out");
  const plan = mergePlan(counts, { targetLevel: Number($("target").value), readyNow: !$("fresh").checked });
  if (plan.merges === 0) {
    out.innerHTML = `<p class="muted">Nothing to merge: a merge needs two Squeeks of the same level, below the target level.</p>`;
    return;
  }
  const after = accountPower(plan.counts, staked, params, { nftOnly });
  const afterDay = sqkPerDay(shareOf(after.total, others), phase.perBlock, pace);

  // The single cheapest merge: two Squeeks of the lowest level that has a pair.
  const lowest = counts.findIndex((n, i) => n >= 2 && i < MAX_LEVEL - 1);
  const one = counts.slice();
  one[lowest] -= 2;
  one[lowest + 1] += 1;
  const oneDay = sqkPerDay(shareOf(accountPower(one, staked, params, { nftOnly }).total, others), phase.perBlock, pace);

  const rows = [
    ["Before → after", `${describeCounts(counts)} → ${describeCounts(plan.counts)}`],
    ["Merges", `${plan.merges}, burning ${plan.burned} Squeeks (${tokenCount(counts)} → ${tokenCount(plan.counts)} left to hold or sell)`],
    ["NFT power", `${fmtNum(me.nft)} → ${fmtNum(after.nft)}${fmtGain(me.nft, after.nft)}`],
    ["Your power W", `${fmtNum(me.total)} → ${fmtNum(after.total)}${fmtGain(me.total, after.total)}`],
    ["SQK a day", `${fmtNum(perDay)} → ${fmtNum(afterDay)}${fmtGain(perDay, afterDay)}`],
    ["Time", `last merge after ${fmtInt(plan.finishBlock)} completed blocks, ${fmtDays(plan.finishBlock, pace)} at ${fmtInt(pace)} blocks a day`],
    ["One merge", `merging two L${lowest + 1} adds ${fmtNum(oneDay - perDay)} SQK a day from the next round`],
  ];
  if (me.idle > 0) rows.push(["Deposit limit", `${me.idle} idle Squeeks → ${after.idle}: merging puts them to work`]);

  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const verdict = document.createElement("p");
  verdict.className = "verdict";
  verdict.textContent =
    "Every merge adds 10% of the pair's NFT power" +
    (nftOnly ? "" : " and raises your SQK multiplier") +
    ", so power only goes up. What you give up: a Squeek you could have sold, and the survivor waits out its next cooldown. Merges are permanent.";
  out.replaceChildren(dl, verdict);
}

function renderSwap(counts, staked, params, nftOnly) {
  $("swap-card").hidden = nftOnly;
  if (nftOnly) return;
  const rows = [];
  for (let level = 1; level <= 5; level++) {
    const tr = document.createElement("tr");
    const sqk = squeekInSqk(level, counts, staked, params);
    for (const text of [`Level ${level} Squeek`, fmtInt(LEVEL_POWER[level - 1]), `${fmtNum(sqk)} SQK`]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    rows.push(tr);
  }
  $("swap-rows").replaceChildren(...rows);
  const l1 = squeekInSqk(1, counts, staked, params);
  const full = tokenCount(counts) >= MAX_TOKENS;
  $("swap-note").textContent = full
    ? `You're at the ${MAX_TOKENS}-Squeek deposit limit: a new Squeek only earns once a merge frees a slot, so these figures assume you make room.`
    : `If a level 1 Squeek costs less than ${fmtNum(l1)} SQK, buying it adds more power than staking the same value. ` +
      "The more SQK you stake, the more each Squeek is worth to you; the more Squeeks you hold, the more each staked SQK is worth.";
}

// ---------- persistence (per viewer, optional) ----------

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts: readCounts(), staked: num("staked") }));
  } catch {
    // Storage blocked: the planner works without it.
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved) return false;
    saved.counts.forEach((n, i) => ($(`lvl-${i + 1}`).value = String(n)));
    $("staked").value = String(saved.staked);
    return true;
  } catch {
    return false;
  }
}

// ---------- live data ----------

const MEASURED = "testnet-stakers";

/** What testnet depositors were actually paid per block (most issuance goes to the gacha vault). */
function measuredPhase() {
  if ($("phase").value !== MEASURED || !live.testnet) return null;
  return { id: MEASURED, perBlock: live.testnet.stakerPerBlock };
}

/** Network figures the wallet section needs, or null until the testnet state has loaded. */
function walletNetwork() {
  if (!live.testnet) return null;
  return {
    totalPower: live.testnet.totalNftPower + live.testnet.totalSqkPower,
    stakerPerBlock: live.testnet.stakerPerBlock,
    blocksPerDay: live.pace?.blocksPerDay ?? Math.max(1, num("pace")),
    params: { sqkPerPower: live.testnet.sqkPerPower, referencePower: live.testnet.referencePower },
    cooldownBlocks: live.testnet.cooldownBlocks,
  };
}

/** Put a real account's position in the planner, with everyone else as the rest of the testnet. */
function fillFromAccount(account) {
  const counts = emptyCounts();
  for (const t of account.tokens) counts[t.level - 1] += 1;
  counts.forEach((n, i) => ($(`lvl-${i + 1}`).value = String(n)));
  $("staked").value = String(Math.round(account.staked));
  $("rule").value = "staking";
  if (live.testnet) {
    $("preset").value = "custom";
    $("others-nft").value = String(Math.round(Math.max(0, live.testnet.totalNftPower - account.nftPower)));
    $("others-sqk").value = String(Math.round(Math.max(0, live.testnet.totalSqkPower - account.sqkPower)));
    $("c").value = String(live.testnet.sqkPerPower);
    $("phase").value = MEASURED;
  }
  if (live.pace) $("pace").value = String(Math.round(live.pace.blocksPerDay));
  render();
}

const wallet = initWallet({ getNetwork: walletNetwork, fill: fillFromAccount, fmt: { num: fmtNum, pct: fmtPct, int: fmtInt } });

async function loadLive() {
  try {
    live.testnet = await fetchTestnet();
    const same = live.testnet.levelPower.every((p, i) => p === LEVEL_POWER[i]);
    $("live-status").textContent =
      `Testnet now: ${fmtNum(live.testnet.totalNftPower)} NFT power and ${fmtNum(live.testnet.totalSqkPower)} SQK power deposited, ` +
      `c = ${fmtNum(live.testnet.sqkPerPower)}. Level powers ${same ? "match" : "differ from"} the whitepaper. ` +
      `Depositors have been paid ${fmtNum(live.testnet.stakerPerBlock)} SQK a block on average: most testnet issuance goes to the gacha vault.`;
    $("phase").add(new Option(`Sepolia, what depositors were actually paid: ${fmtNum(live.testnet.stakerPerBlock)} SQK a block`, MEASURED));
  } catch {
    $("live-status").textContent = "Live testnet figures are unavailable right now; launch values still work.";
  }
  try {
    live.pace = await fetchPace();
    if (live.pace) {
      const btn = $("use-pace");
      btn.hidden = false;
      btn.textContent = `Use the measured pace: ${fmtInt(live.pace.blocksPerDay)} a day`;
      btn.addEventListener("click", () => {
        $("pace").value = String(Math.round(live.pace.blocksPerDay));
        render();
      });
    }
  } catch {
    // The whitepaper's 1,078 blocks a day stays.
  }
  render();
  wallet.render();
}

// ---------- boot ----------

buildLevelInputs();
fillSelects();
if (!loadState()) $("lvl-1").value = "4";
document.querySelector("main").addEventListener("input", (e) => {
  if (e.target.id === "others-nft" || e.target.id === "others-sqk") $("preset").value = "custom";
  if (e.target.id === "preset" && e.target.value === "testnet") {
    if (live.testnet) $("c").value = String(live.testnet.sqkPerPower);
    $("phase").value = "testnet";
  }
  if (e.target.id === "preset" && e.target.value === "launch-l1" && $("phase").value === "testnet") $("phase").value = "launch-bonus";
  render();
});
render();
loadLive();
