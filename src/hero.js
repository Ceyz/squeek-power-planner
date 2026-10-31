// The wheel at the top of the page: turns with the real hamster wheel and shows the Squeek block
// being built. Reads Squeekchain's public status every 30 seconds while the tab is visible.
import { fetchStatus } from "./live.js";
import { reducedMotion } from "./fx.js";
import { hamsterSvg } from "./pixel.js";

const POLL_MS = 30_000;
// Faster than this the 8 spokes strobe on a 60 Hz screen; the true rpm is in the text.
const MAX_DRAWN_RPM = 70;
const $ = (id) => document.getElementById(id);

const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function initHero({ fmt }) {
  const wheel = $("wheel");
  if (!wheel) return;
  const ring = wheel.querySelector(".wheel-ring");
  const art = { running: hamsterSvg({ size: 64 }), idle: hamsterSvg({ size: 64, asleep: true }) };
  let mood = null;
  let target = 0; // degrees a second the drawn wheel should reach
  let speed = 0;
  let angle = 0;
  let lastFrame = 0;
  let spinning = false;
  let timer = null;

  function spin(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    speed += (target - speed) * Math.min(1, dt * 2); // ease in and out, never jump
    angle = (angle + speed * dt) % 360;
    ring.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    if (Math.abs(speed) > 0.5 || target > 0) requestAnimationFrame(spin);
    else spinning = false;
  }

  function show(s) {
    const next = s.stale ? "stale" : s.running ? "running" : "idle";
    if (next !== mood) {
      mood = next;
      wheel.dataset.mood = mood;
      $("wheel-hamster").innerHTML = mood === "running" ? art.running : art.idle;
    }
    target = s.running && !reducedMotion() ? Math.min(MAX_DRAWN_RPM, s.rpm) * 6 : 0;
    if (target > 0 && !spinning && !document.hidden) {
      spinning = true;
      lastFrame = performance.now();
      requestAnimationFrame(spin);
    }
    $("wheel-state").textContent = s.stale ? "Signal lost" : s.running ? `Running · ${fmt.num(s.rpm)} rpm` : "Wheel idle";
    $("wheel-km").textContent = s.todayKm === null || s.stale ? "" : `${fmt.num(s.todayKm)} km run this Squeek day`;
    const bar = $("wheel-bar");
    if (s.height === null) {
      $("wheel-block").textContent = "Block builder unavailable";
      $("wheel-pct").textContent = "";
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const pct = Math.floor((s.progress ?? 0) * 100);
    $("wheel-block").textContent = `Building block #${fmt.int(s.height + 1)}`;
    $("wheel-pct").textContent = `${pct}%`;
    bar.style.setProperty("--p", String(s.progress ?? 0));
    bar.setAttribute("aria-valuenow", String(pct));
    $("wheel-note").textContent = s.running
      ? "Each turn of the real wheel builds the block; each finished block pays the deposited Squeeks."
      : `Blocks only grow while the hamster runs, mostly at night (UTC).${s.settledAt ? ` Last settled ${clock(s.settledAt)} UTC.` : ""}`;
  }

  async function poll() {
    clearTimeout(timer);
    try {
      show(await fetchStatus());
    } catch {
      if (!mood) show({ stale: true, running: false, rpm: 0, todayKm: null, height: null, progress: null, settledAt: null });
    }
    if (!document.hidden) timer = setTimeout(poll, POLL_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else poll();
  });
  $("wheel-hamster").innerHTML = art.idle;
  poll();
}
