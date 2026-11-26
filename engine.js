// FCN (Fixed Coupon Note) KO / KI engine. Pure functions, no DOM, no network.
// Mirrors demos/fcn-monitor/fcn/engine.py; tests/engine.test.mjs runs the same cases.
//
// prices: { dates: ["2026-01-02", ...] ascending, closes: { TICKER: [number|null, ...] } }
// dates are "YYYY-MM-DD" strings, compared as strings.

export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const yy = y + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function observationSchedule(ts) {
  if (ts.observationDates?.length) return [...ts.observationDates].sort();
  const n = ts.tenorMonths / ts.obsPeriodMonths;
  return Array.from({ length: n }, (_, k) => addMonths(ts.tradeDate, ts.obsPeriodMonths * (k + 1)));
}

export function validate(ts) {
  const errs = [];
  if (!(ts.underlyings?.length >= 1 && ts.underlyings.length <= 4)) errs.push("連結標的需 1 到 4 檔");
  if (ts.tenorMonths % ts.obsPeriodMonths) errs.push("天期必須能被觀察頻率整除");
  if (ts.koType?.endsWith("memory") && ts.underlyings.length < 2) errs.push("記憶型 KO 需要 2 檔以上標的");
  if (ts.kiType !== "none" && !(ts.kiPct > 0)) errs.push("請填 KI 比例");
  if (!(ts.strikePct > 0 && ts.koPct > 0)) errs.push("請填履約價與 KO 比例");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ts.tradeDate || "")) errs.push("請填交易日");
  return errs;
}

// Rows where every underlying has a close.
function alignedRows(prices, unders) {
  const rows = [];
  prices.dates.forEach((d, i) => {
    const px = unders.map((u) => prices.closes[u]?.[i]);
    if (px.every((v) => typeof v === "number" && isFinite(v))) rows.push({ d, px });
  });
  return rows;
}

export function evaluate(ts, prices, asOf) {
  const errs = validate(ts);
  if (errs.length) throw new Error(errs.join("；"));
  const U = ts.underlyings;
  const rows = alignedRows(prices, U);
  if (!rows.length) throw new Error("找不到這些標的的共同收盤價");

  let s0;
  if (ts.initialSpots && U.every((u) => ts.initialSpots[u] > 0)) {
    s0 = U.map((u) => +ts.initialSpots[u]);
  } else {
    const fix = rows.find((r) => r.d >= ts.tradeDate);
    if (!fix) throw new Error(`交易日 ${ts.tradeDate} 之後沒有價格資料`);
    s0 = fix.px;
  }
  const strike = s0.map((v) => v * ts.strikePct);
  const ko = s0.map((v) => v * ts.koPct);
  const ki = ts.kiType === "none" ? null : s0.map((v) => v * ts.kiPct);

  const obs = observationSchedule(ts);
  const obsNo = new Map(); // trading date -> observation number (holiday rolls forward)
  obs.forEach((d, i) => {
    const r = rows.find((x) => x.d >= d);
    if (r && r.d <= asOf) obsNo.set(r.d, i + 1);
  });
  const nonCall = ts.nonCallPeriods || 0;
  const firstCallable = nonCall < obs.length ? obs[nonCall] : null;
  const dailyKo = ts.koType.startsWith("daily");
  const memoryKo = ts.koType.endsWith("memory");
  const periodCoupon = (ts.notional * ts.couponPa * ts.obsPeriodMonths) / 12;

  const events = [];
  const memorised = new Set();
  let kiDay = null, koDay = null, coupons = 0, redemption = null, delivered = null;

  for (const { d, px } of rows) {
    if (d <= ts.tradeDate || d > asOf) continue;
    if (ts.kiType === "american" && !kiDay && px.some((v, i) => v <= ki[i])) {
      kiDay = d;
      events.push({ day: d, kind: "ki", detail: `觸及 KI：${U.filter((_, i) => px[i] <= ki[i]).join(", ")}` });
    }
    const no = obsNo.get(d);
    const callable = firstCallable !== null && d >= firstCallable;
    let knocked = false;
    if (callable && (dailyKo || no !== undefined)) {
      const above = U.filter((_, i) => px[i] >= ko[i]);
      if (memoryKo) {
        const fresh = above.filter((u) => !memorised.has(u));
        if (fresh.length) {
          fresh.forEach((u) => memorised.add(u));
          events.push({ day: d, kind: "memory", detail: `記憶 KO：${[...fresh].sort().join(", ")}` });
        }
        knocked = memorised.size === U.length;
      } else {
        knocked = above.length === U.length;
      }
    }
    if (no !== undefined) {
      coupons += periodCoupon;
      events.push({ day: d, kind: "coupon", detail: `第 ${no} 期配息`, amount: periodCoupon });
    }
    if (knocked) {
      koDay = d;
      redemption = ts.notional;
      events.push({ day: d, kind: "ko", detail: "提前出場 (KO)，返還本金", amount: ts.notional });
      break;
    }
    if (no === obs.length) {
      if (ts.kiType === "european" && px.some((v, i) => v <= ki[i])) {
        kiDay = d;
        events.push({ day: d, kind: "ki", detail: "到期觀察觸及 KI (歐式)" });
      }
      const perf = px.map((v, i) => v / strike[i]);
      const w = perf.indexOf(Math.min(...perf));
      if (kiDay && perf[w] < 1) {
        const shares = ts.notional / strike[w];
        redemption = shares * px[w];
        delivered = { underlying: U[w], shares, strikePrice: strike[w], value: redemption };
        events.push({ day: d, kind: "maturity", detail: `到期：曾觸 KI 且 ${U[w]} 低於履約價，交割 ${shares.toFixed(2)} 股`, amount: redemption });
      } else {
        redemption = ts.notional;
        events.push({ day: d, kind: "maturity", detail: "到期：返還 100% 本金", amount: ts.notional });
      }
      break;
    }
  }

  const status = koDay ? "knocked_out" : redemption !== null ? "matured" : "alive";
  const lastRow = [...rows].reverse().find((r) => r.d <= asOf) || { d: null, px: s0 };
  const levels = U.map((u, i) => {
    const last = lastRow.px[i];
    return {
      underlying: u, initial: s0[i], strike: strike[i], ko: ko[i], ki: ki ? ki[i] : null, last,
      perf: last / s0[i] - 1, toKo: last / ko[i] - 1, toKi: ki ? last / ki[i] - 1 : null,
      memorised: memorised.has(u),
    };
  });
  const nextObservation = status === "alive" ? obs.find((d) => d > asOf) ?? null : null;
  return {
    status, asOf, priceDate: lastRow.d, kiHit: !!kiDay, kiDay, koDay,
    memorised: [...memorised].sort(), couponsPaid: coupons, redemption, delivered,
    nextObservation, schedule: obs, levels, events,
  };
}
