// Pixel art drawn for this page: a hamster, awake or asleep, in a coat picked from an address.
// Pure string builders, so the same art serves the page, the favicon and the tests.

const BASE = {
  o: "#2a1d14", // outline
  c: "#fff1d6", // cream
  k: "#ffb3a7", // blush
  p: "#ff8fa3", // pink: ears, nose, paws
  e: "#1a1310", // eye
  w: "#ffffff", // eye glint
};

/** Coats real hamsters come in, plus a lilac one; `f` is the fur, `d` its shade. */
export const COATS = [
  { name: "Golden", f: "#f39a3b", d: "#d9792a" },
  { name: "Cinnamon", f: "#d9824a", d: "#b5602e" },
  { name: "Cream", f: "#f2d3a2", d: "#d8b07a" },
  { name: "Dove", f: "#bdb3bf", d: "#958a98" },
  { name: "Chocolate", f: "#8f5d3d", d: "#6d4329" },
  { name: "Sable", f: "#5a4e57", d: "#3e353c" },
  { name: "Ginger", f: "#ea7440", d: "#c4542a" },
  { name: "Lilac", f: "#c7a6d8", d: "#a382b6" },
];

// 16 x 14. Eight-character rows are left halves, mirrored; full rows (the eyes, whose glints
// both face the same way) are kept as written. ASLEEP swaps the eyes for closed lids.
const HALF = [
  "..ooo...",
  ".oppfo..",
  ".offfooo",
  ".offffff",
  "offfweffffwefffo",
  "offfeeffffeefffo",
  "ofkkfccp",
  "offfcccc",
  ".odfcccc",
  "odffcccc",
  "odffcccc",
  ".odfcccc",
  "..odffff",
  "...oppoo",
];
const ASLEEP = { 4: "offfffff", 5: "offeeeff" };

const mirror = (half) => (half.length === 16 ? half : half + [...half].reverse().join(""));

/** The hamster as rows of palette keys, 16 wide. */
export function hamsterRows(asleep = false) {
  return HALF.map((row, i) => mirror(asleep && ASLEEP[i] ? ASLEEP[i] : row));
}

/** Rows of palette keys to SVG rects, merging runs of the same colour on a row. */
export function rowsToRects(rows, palette) {
  const rects = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      if (palette[key]) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${palette[key]}"/>`);
      x = end;
    }
  });
  return rects.join("");
}

/** FNV-1a: a stable 32-bit number from text, case-insensitive. */
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of text.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The coat a wallet's hamster wears: the same address always gets the same one. */
export const coatFor = (address) => COATS[hash(address) % COATS.length];

export function hamsterSvg({ asleep = false, size = 64, title = "", coat = COATS[0] } = {}) {
  const rows = hamsterRows(asleep);
  const label = title ? ` role="img" aria-label="${title}"` : ` aria-hidden="true"`;
  const height = Math.round((size * rows.length) / rows[0].length);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" width="${size}" height="${height}" shape-rendering="crispEdges"${label}>${rowsToRects(rows, { ...BASE, f: coat.f, d: coat.d })}</svg>`;
}

// 8 x 8 icons in the same pixel grid; `x` takes the text colour.
const ICONS = {
  bolt: ["....xx..", "...xx...", "..xx....", ".xxxxxx.", "....xx..", "...xx...", "..xx....", ".x......"],
  coin: ["..xxxx..", ".x....x.", "x..xx..x", "x..xx..x", "x..xx..x", "x..xx..x", ".x....x.", "..xxxx.."],
  check: ["........", ".......x", "......xx", "x....xx.", "xx..xx..", ".xxxx...", "..xx....", "........"],
  lock: ["..xxxx..", ".x....x.", ".x....x.", "xxxxxxxx", "xxx..xxx", "xxx..xxx", "xxxxxxxx", "xxxxxxxx"],
  star: ["...xx...", "...xx...", "..xxxx..", "xxxxxxxx", ".xxxxxx.", "..xxxx..", ".xx..xx.", "xx....xx"],
  swap: [".....x..", "xxxxxxx.", ".....x..", "........", "..x.....", ".xxxxxxx", "..x.....", "........"],
  arrow: ["....x...", "....xx..", "xxxxxxx.", "xxxxxxxx", "xxxxxxx.", "....xx..", "....x...", "........"],
  zzz: ["xxxx....", "..x.....", ".x......", "xxxx.xxx", "......x.", ".....x..", ".....xxx", "........"],
  flame: ["...x....", "...xx...", "..xxx.x.", ".xxxxxx.", ".xx.xxx.", "xx...xxx", "xx...xx.", ".xxxxx.."],
};

export function iconSvg(name, size = 16) {
  const rows = ICONS[name];
  if (!rows) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" class="icon">${rowsToRects(rows, { x: "currentColor" })}</svg>`;
}
