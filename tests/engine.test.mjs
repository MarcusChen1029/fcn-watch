// Same cases as demos/fcn-monitor/tests/test_engine.py, so the JS port is proven equal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, observationSchedule } from "../engine.js";

const DAYS = [];
for (let t = Date.UTC(2026, 0, 2); t <= Date.UTC(2026, 6, 31); t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() % 6) DAYS.push(d.toISOString().slice(0, 10));
}

const ts = (kw = {}) => ({
  name: "T", underlyings: ["A", "B"], currency: "USD", notional: 100000, couponPa: 0.12,
  tenorMonths: 6, obsPeriodMonths: 1, strikePct: 0.85, koPct: 1.0, koType: "period_end",
  kiPct: 0.6, kiType: "american", tradeDate: "2026-01-02", nonCallPeriods: 0,
  initialSpots: { A: 100, B: 100 }, ...kw,
});

// Flat paths at `def`, with overrides from each given date onward.
function path(a, b, def = 95, drop = null) {
  const series = (moves) => DAYS.map((d) => {
    let v = def;
    for (const [k, px] of Object.entries(moves).sort()) if (d >= k) v = px;
    return v;
  });
  let dates = DAYS, A = series(a), B = series(b);
  if (drop) {
    const keep = DAYS.map((d) => d !== drop);
    dates = DAYS.filter((_, i) => keep[i]); A = A.filter((_, i) => keep[i]); B = B.filter((_, i) => keep[i]);
  }
  return { dates, closes: { A, B } };
}
const END = "2026-07-31";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("schedule is monthly from trade date", () => {
  const s = observationSchedule(ts());
  assert.deepEqual(s.slice(0, 2), ["2026-02-02", "2026-03-02"]);
  assert.equal(s.length, 6);
});

test("no events pays all coupons and full principal", () => {
  const e = evaluate(ts(), path({}, {}), END);
  assert.equal(e.status, "matured");
  near(e.couponsPaid, 6000);
  assert.equal(e.redemption, 100000);
  assert.equal(e.kiHit, false);
});

test("period-end KO needs all underlyings on the same observation", () => {
  const e = evaluate(ts(), path({ "2026-02-02": 101 }, { "2026-03-02": 101 }), END);
  assert.equal(e.koDay, "2026-03-02");
  near(e.couponsPaid, 2000);
});

test("memory KO counts each underlying once", () => {
  const p = path({ "2026-02-02": 101, "2026-02-03": 95 }, { "2026-03-02": 101, "2026-03-03": 95 });
  assert.equal(evaluate(ts(), p, END).status, "matured");
  assert.equal(evaluate(ts({ koType: "period_end_memory" }), p, END).koDay, "2026-03-02");
});

test("daily KO between observations", () => {
  const e = evaluate(ts({ koType: "daily" }), path({ "2026-02-10": 102 }, { "2026-02-10": 102 }), END);
  assert.equal(e.koDay, "2026-02-10");
});

test("non-call period blocks early KO", () => {
  const e = evaluate(ts({ nonCallPeriods: 2 }), path({ "2026-02-02": 101 }, { "2026-02-02": 101 }), END);
  assert.equal(e.koDay, "2026-04-02");
});

test("American KI then below strike delivers worst performer", () => {
  const e = evaluate(ts(), path({ "2026-03-16": 55, "2026-04-01": 70 }, {}), END);
  assert.equal(e.kiDay, "2026-03-16");
  assert.equal(e.delivered.underlying, "A");
  near(e.redemption, (100000 / 85) * 70);
});

test("KI but recovered above strike returns principal", () => {
  const e = evaluate(ts(), path({ "2026-03-16": 55, "2026-05-01": 90 }, {}), END);
  assert.equal(e.kiHit, true);
  assert.equal(e.redemption, 100000);
  assert.equal(e.delivered, null);
});

test("European KI ignores intra-period dips", () => {
  const e = evaluate(ts({ kiType: "european" }), path({ "2026-03-16": 55, "2026-04-01": 90 }, {}), END);
  assert.equal(e.kiHit, false);
  assert.equal(e.redemption, 100000);
});

test("alive status reports next observation", () => {
  const e = evaluate(ts(), path({}, {}), "2026-03-10");
  assert.equal(e.status, "alive");
  assert.equal(e.nextObservation, "2026-04-02");
  near(e.couponsPaid, 2000);
});

test("holiday observation rolls to next trading day", () => {
  const e = evaluate(ts(), path({}, {}, 95, "2026-02-02"), "2026-02-28");
  assert.deepEqual(e.events.filter((x) => x.kind === "coupon").map((x) => x.day), ["2026-02-03"]);
});

test("validation", () => {
  assert.throws(() => evaluate(ts({ tenorMonths: 7, obsPeriodMonths: 3 }), path({}, {}), END));
  assert.throws(() => evaluate(ts({ underlyings: ["A"], koType: "daily_memory" }), path({}, {}), END));
});

test("nonCallPeriods missing means callable from the first observation", () => {
  const t = ts({ koType: "period_end" });
  delete t.nonCallPeriods;
  assert.equal(evaluate(t, path({ "2026-02-02": 101 }, { "2026-02-02": 101 }), END).koDay, "2026-02-02");
});
