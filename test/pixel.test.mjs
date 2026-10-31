import test from "node:test";
import assert from "node:assert/strict";
import { COATS, coatFor, hamsterRows, hamsterSvg, iconSvg, rowsToRects } from "../src/pixel.js";
import { parseStatus } from "../src/live.js";

test("the hamster is 16 x 14 and symmetric apart from the eye glints", () => {
  for (const asleep of [false, true]) {
    const rows = hamsterRows(asleep);
    assert.equal(rows.length, 14);
    for (const [y, row] of rows.entries()) {
      assert.equal(row.length, 16);
      if (!row.includes("w")) assert.equal(row, [...row].reverse().join(""), `row ${y}`);
    }
  }
  assert.notDeepEqual(hamsterRows(false), hamsterRows(true));
});

test("rects merge runs and skip transparent pixels", () => {
  assert.equal(rowsToRects(["..oo", "o.o."], { o: "#000" }), '<rect x="2" y="0" width="2" height="1" fill="#000"/><rect x="0" y="1" width="1" height="1" fill="#000"/><rect x="2" y="1" width="1" height="1" fill="#000"/>');
  assert.match(hamsterSvg({ title: "A hamster" }), /role="img" aria-label="A hamster"/);
  assert.match(hamsterSvg(), /aria-hidden="true"/);
  assert.match(iconSvg("bolt"), /fill="currentColor"/);
  assert.equal(iconSvg("nope"), "");
});

test("an address always gets the same coat, whatever its case", () => {
  const a = "0x340c4cdb74ea6ccf98592b9e63ee80f814673ad7";
  assert.equal(coatFor(a), coatFor(a.toUpperCase().replace("0X", "0x")));
  assert.ok(COATS.includes(coatFor(a)));
  const seen = new Set(Array.from({ length: 64 }, (_, i) => coatFor(`0x${i.toString(16).padStart(40, "0")}`).name));
  assert.ok(seen.size >= 6, "addresses spread over the coats");
  assert.match(hamsterSvg({ coat: coatFor(a) }), new RegExp(coatFor(a).f));
});

// A trimmed real response of /v1/status (Sepolia, 2026-10-31, wheel idle).
const NOW = Date.parse("2026-10-31T05:12:30.000Z");
const status = (measurement = {}, builder = {}) => ({
  measurement: { freshness: "online", observedAt: "2026-10-31T05:11:52.581Z", staleAfterSeconds: 120, coreStatus: "IDLE", rpmMilli: 0, distanceMm: 10617654, ...measurement },
  builder: {
    status: "available",
    anchor: { blockHeight: "5163", blockProgress: "85514488", confirmedAt: "2026-10-31T05:00:36.000Z" },
    projected: { blockHeight: "5163", blockProgress: "85514488" },
    ...builder,
  },
});

test("parseStatus reads the wheel and the block being built", () => {
  assert.deepEqual(parseStatus(status(), NOW), { stale: false, running: false, rpm: 0, todayKm: 10.617654, height: 5163, progress: 0.085514488, settledAt: "2026-10-31T05:00:36.000Z" });
  const running = parseStatus(status({ rpmMilli: 42500 }, { projected: { blockHeight: "5170", blockProgress: "999000000" } }), NOW);
  assert.equal(running.running, true);
  assert.equal(running.rpm, 42.5);
  assert.equal(running.height, 5170);
  assert.equal(running.progress, 0.999);
});

test("an old or offline reading is stale and never counts as running", () => {
  assert.equal(parseStatus(status({ rpmMilli: 42500 }), NOW + 10 * 60_000).stale, true);
  assert.equal(parseStatus(status({ rpmMilli: 42500 }), NOW + 10 * 60_000).running, false);
  assert.equal(parseStatus(status({ freshness: "offline", rpmMilli: 42500 }), NOW).running, false);
  const empty = parseStatus({}, NOW);
  assert.equal(empty.stale, true);
  assert.equal(empty.height, null);
  assert.equal(parseStatus(status({}, { status: "unavailable" }), NOW).progress, null);
});
