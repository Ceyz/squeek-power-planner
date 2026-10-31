// Motion for the page: count-ups, value bumps and pixel confetti. Decoration only: with
// prefers-reduced-motion every effect lands on its final state at once.

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const shown = new WeakMap(); // element -> { value, frame, timer }
const COUNT_MS = 600;

/**
 * Show a number, rolling from the value the element showed last. The first value an element
 * gets is shown as is, unless `from` is given (e.g. 0 when an account first appears).
 * The final text is always exactly `format(value)`, even where frames never run.
 */
export function setNumber(node, value, format, { from } = {}) {
  const last = shown.get(node);
  const start = from ?? last?.value;
  cancelAnimationFrame(last?.frame ?? 0);
  clearTimeout(last?.timer);
  const entry = { value, frame: 0, timer: 0 };
  shown.set(node, entry);
  const land = () => {
    cancelAnimationFrame(entry.frame);
    node.textContent = format(value);
  };
  if (!Number.isFinite(value) || !Number.isFinite(start) || start === value || reducedMotion()) {
    land();
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / COUNT_MS);
    node.textContent = format(t === 1 ? value : start + (value - start) * (1 - (1 - t) ** 3));
    if (t < 1) entry.frame = requestAnimationFrame(step);
  };
  entry.frame = requestAnimationFrame(step);
  // A background tab can hold frames back; the right number must not wait for them.
  entry.timer = setTimeout(land, COUNT_MS + 80);
  if (last) bump(node, value > start ? "up" : "down");
}

/** A short pop on an element whose value just changed. */
export function bump(node, direction = "") {
  if (reducedMotion() || !node.animate) return;
  const flash = direction === "up" ? "var(--good)" : direction === "down" ? "var(--warn)" : "currentColor";
  node.animate(
    [
      { transform: "scale(1)", color: "currentColor" },
      { transform: "scale(1.08)", color: flash, offset: 0.3 },
      { transform: "scale(1)", color: "currentColor" },
    ],
    { duration: 420, easing: "cubic-bezier(.3,1.6,.5,1)" },
  );
}

/** Set text and pop it when it changes (not the first time). For values that aren't plain numbers. */
export function setText(node, text) {
  if (node.textContent === text) return;
  const first = !shown.has(node);
  shown.set(node, { value: NaN, frame: 0 });
  node.textContent = text;
  if (!first) bump(node);
}

const SEEDS = ["#f39a3b", "#ffc83d", "#4f6bff", "#19b36b", "#ff5d8f", "#fff1d6"];
let canvas = null;
let pieces = [];

function frame() {
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  pieces = pieces.filter((b) => (b.life += 1) < 110 && b.y < innerHeight + 20);
  for (const b of pieces) {
    b.vy += 0.34;
    b.vx *= 0.98;
    b.x += b.vx;
    b.y += b.vy;
    ctx.globalAlpha = Math.min(1, (110 - b.life) / 25);
    ctx.fillStyle = b.color;
    ctx.fillRect(Math.round(b.x), Math.round(b.y), b.size, b.size);
  }
  if (pieces.length) requestAnimationFrame(frame);
  else {
    canvas.remove();
    canvas = null;
  }
}

/** Square seed-shaped confetti from the middle of an element. */
export function confetti(from) {
  if (reducedMotion() || !from?.getBoundingClientRect) return;
  const box = from.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const start = !canvas;
  if (start) {
    canvas = Object.assign(document.createElement("canvas"), { className: "confetti" });
    canvas.setAttribute("aria-hidden", "true");
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    document.body.append(canvas);
  }
  const room = Math.max(0, 80 - pieces.length);
  for (let i = 0; i < room; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
    const speed = 5 + Math.random() * 8;
    pieces.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: [4, 6, 8][i % 3], color: SEEDS[i % SEEDS.length], life: 0 });
  }
  if (start) requestAnimationFrame(frame);
}
