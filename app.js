import { evaluate, validate } from "./engine.js";

const STORE = "fcn-watch:v1";
const WAITLIST_URL = ""; // set when the alert backend exists
const STATUS = { alive: "存續中", knocked_out: "已提前出場 (KO)", matured: "已到期" };
const KO_LABEL = { period_end: "期末", period_end_memory: "期末記憶", daily: "每日", daily_memory: "每日記憶" };
const KI_LABEL = { american: "美式", european: "歐式", none: "無" };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, sign = true) => (x == null || !isFinite(x) ? "-" : `${sign && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const num = (x, d = 2) => (x == null || !isFinite(x) ? "-" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (ccy, x) => `${ccy} ${num(x, 0)}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const safe = (t) => t.replace("^", "_").replace(/\./g, "_");

let universe = [];
let meta = { splits: {} };
const pxCache = new Map();
let editingId = null;

const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
const save = (notes) => localStorage.setItem(STORE, JSON.stringify(notes));

async function getSeries(t) {
  if (!pxCache.has(t)) {
    pxCache.set(t, fetch(`data/px/${safe(t)}.json`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`沒有 ${t} 的價格資料`);
      return r.json();
    }));
  }
  return pxCache.get(t);
}

async function pricesFor(unders) {
  const series = await Promise.all(unders.map(getSeries));
  const dates = [...new Set(series.flatMap((s) => s.dates))].sort();
  const closes = {};
  series.forEach((s, i) => {
    const m = new Map(s.dates.map((d, j) => [d, s.closes[j]]));
    closes[unders[i]] = dates.map((d) => m.get(d) ?? null);
  });
  return { dates, closes };
}

// Termsheet fixings are pre-split; our closes are split-adjusted. Divide by later splits.
function adjustSpots(note) {
  if (!note.initialSpots) return null;
  const out = {};
  for (const u of note.underlyings) {
    let v = note.initialSpots[u];
    for (const [d, ratio] of Object.entries(meta.splits?.[u] || {})) if (d > note.tradeDate) v /= ratio;
    out[u] = v;
  }
  return out;
}

function parseForm(form) {
  const f = Object.fromEntries(new FormData(form));
  const unders = f.underlyings.split(/[,，\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const known = new Set(universe.map((u) => u.t));
  const unknown = unders.filter((u) => !known.has(u));
  const spots = f.initialSpots.trim() ? f.initialSpots.split(/[,，\s]+/).filter(Boolean).map(Number) : [];
  const note = {
    name: f.name.trim(), underlyings: unders, currency: f.currency, notional: +f.notional,
    couponPa: +f.couponPa / 100, tenorMonths: +f.tenorMonths, obsPeriodMonths: +f.obsPeriodMonths,
    strikePct: +f.strikePct / 100, koPct: +f.koPct / 100, koType: f.koType,
    kiPct: f.kiType === "none" ? null : +f.kiPct / 100, kiType: f.kiType, tradeDate: f.tradeDate,
    nonCallPeriods: +f.nonCallPeriods || 0,
    initialSpots: spots.length ? Object.fromEntries(unders.map((u, i) => [u, spots[i]])) : null,
  };
  const errs = validate(note);
  if (unknown.length) errs.push(`目前不支援：${unknown.join(", ")}（請看下方支援清單）`);
  if (spots.length && (spots.length !== unders.length || spots.some((v) => !(v > 0)))) errs.push("期初價數量要和標的一樣多");
  return { note, errs };
}

function fillForm(n) {
  const form = $("#note-form");
  const set = (k, v) => { form.elements[k].value = v ?? ""; };
  set("name", n.name); set("underlyings", n.underlyings.join(", ")); set("tradeDate", n.tradeDate);
  set("currency", n.currency); set("notional", n.notional); set("couponPa", +(n.couponPa * 100).toFixed(4));
  set("tenorMonths", n.tenorMonths); set("obsPeriodMonths", n.obsPeriodMonths);
  set("strikePct", +(n.strikePct * 100).toFixed(4)); set("koPct", +(n.koPct * 100).toFixed(4));
  set("koType", n.koType); set("nonCallPeriods", n.nonCallPeriods);
  set("kiPct", n.kiPct ? +(n.kiPct * 100).toFixed(4) : ""); set("kiType", n.kiType);
  set("initialSpots", n.initialSpots ? n.underlyings.map((u) => n.initialSpots[u]).join(", ") : "");
}

function bar(l, ts) {
  // position of today's price between KI (left) and KO (right), in % of initial
  const lo = Math.min(ts.kiPct ?? ts.strikePct, ts.strikePct) - 0.15;
  const hi = ts.koPct + 0.15;
  const pos = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  const now = l.last / l.initial;
  const kiW = ts.kiPct ? pos(ts.kiPct) : 0;
  return `<div class="bar" title="紅：KI 以下　綠：KO 以上　黑線：目前">
    <span class="ki" style="width:${kiW}%"></span><span class="ko" style="width:${100 - pos(ts.koPct)}%"></span>
    <i style="left:calc(${pos(now)}% - 1px)"></i></div>`;
}

function card(n, ev) {
  const worst = [...ev.levels].sort((a, b) => a.perf - b.perf)[0];
  let alert = "";
  if (ev.status === "alive") {
    if (ev.kiHit && worst.last < worst.strike) {
      const shares = n.notional / worst.strike;
      alert = `已觸發 KI，且 ${esc(worst.underlying)} 目前低於履約價。若到期維持此價位，將以履約價接 ${num(shares, 2)} 股，市值約 ${money(n.currency, shares * worst.last)}。`;
    } else if (ev.kiHit) {
      alert = `已觸發 KI；到期時若最差標的仍高於履約價，可拿回全部本金。`;
    } else if (worst.toKi != null && worst.toKi < 0.1) {
      alert = `${esc(worst.underlying)} 距離 KI 只剩 ${pct(worst.toKi, false)}。`;
    }
  }
  const rows = ev.levels.map((l) => `<tr>
    <td>${esc(l.underlying)}</td><td class="${l.toKi != null && l.toKi < 0.1 ? "warn" : ""}">${pct(l.toKi)}</td>
    <td>${pct(l.toKo)}</td><td class="${l.perf < 0 ? "neg" : "pos"}">${pct(l.perf)}</td>
    <td>${num(l.last)}</td><td>${num(l.initial)}</td>
    <td>${bar(l, n)}</td><td>${l.memorised ? "✓" : ""}</td></tr>`).join("");
  const events = ev.events.map((e) => `<li><b>${e.day}</b> ${esc(e.detail)}${e.amount ? `：${money(n.currency, e.amount)}` : ""}</li>`).join("");
  return `<article class="note" data-id="${n.id}">
  <header><h3>${esc(n.name)}</h3>
    <div class="tools"><span class="badge ${ev.status}">${STATUS[ev.status]}</span>
    <button data-act="edit">編輯</button><button data-act="del">刪除</button></div></header>
  <p class="meta">${esc(n.underlyings.join(" / "))} · ${money(n.currency, n.notional)} · 年化 ${pct(n.couponPa, false)} ·
    每 ${n.obsPeriodMonths} 個月觀察 · 履約 ${pct(n.strikePct, false)} · KO ${pct(n.koPct, false)}（${KO_LABEL[n.koType]}）·
    KI ${n.kiPct ? pct(n.kiPct, false) : "-"}（${KI_LABEL[n.kiType]}）· 交易日 ${n.tradeDate}</p>
  ${alert ? `<p class="alert">${alert}</p>` : ""}
  <div class="kpis">
    <span>${ev.kiHit ? `<span class="ki-hit">已觸 KI（${ev.kiDay}）</span>` : "未觸 KI"}</span>
    <span>已領配息 <b>${money(n.currency, ev.couponsPaid)}</b></span>
    ${ev.nextObservation ? `<span>下次觀察 <b>${ev.nextObservation}</b></span>` : ""}
    ${ev.redemption != null ? `<span>返還 <b>${money(n.currency, ev.redemption)}</b></span>` : ""}
    <span class="hint">價格日 ${ev.priceDate}</span>
  </div>
  <div class="tbl"><table><tr><th>標的</th><th>距 KI</th><th>距 KO</th><th>漲跌</th><th>最新收盤</th><th>期初價</th><th>KI ←→ KO</th><th>記憶</th></tr>${rows}</table></div>
  <details><summary>事件紀錄與觀察日（${ev.events.length}）</summary><ul>${events || "<li>尚無事件</li>"}</ul>
  <p class="hint">觀察日：${ev.schedule.join("、")}</p></details>
</article>`;
}

async function render() {
  const notes = load();
  const box = $("#notes");
  if (!notes.length) {
    box.innerHTML = `<p class="empty">還沒有 FCN。在下面填條件加入，或按「放一檔範例看看」。</p>`;
    return;
  }
  box.innerHTML = notes.map((n) => `<article class="note" data-id="${n.id}"><p class="hint">計算中：${esc(n.name)}…</p></article>`).join("");
  for (const n of notes) {
    const el = box.querySelector(`[data-id="${n.id}"]`);
    try {
      const prices = await pricesFor(n.underlyings);
      const ev = evaluate({ ...n, initialSpots: adjustSpots(n) }, prices, today());
      el.outerHTML = card(n, ev);
    } catch (e) {
      el.innerHTML = `<header><h3>${esc(n.name)}</h3><div class="tools"><button data-act="edit">編輯</button><button data-act="del">刪除</button></div></header><p class="err">${esc(e.message)}</p>`;
    }
  }
}

function resetForm() {
  editingId = null;
  $("#note-form").reset();
  $("#form-title").textContent = "新增一檔 FCN";
  $("#submit-btn").textContent = "加入監控";
  $("#cancel-edit").hidden = true;
  $("#form-err").textContent = "";
}

async function init() {
  [universe, meta] = await Promise.all([
    fetch("data/universe.json").then((r) => r.json()),
    fetch("data/meta.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ splits: {} })),
  ]);
  $("#universe").innerHTML = universe.map((u) => `<option value="${esc(u.t)}">${esc(u.n)}</option>`).join("");
  $("#universe-text").textContent = universe.map((u) => `${u.n}（${u.t}）`).join("、");
  if (meta.updated) $("#data-updated").textContent = ` 價格資料更新時間：${meta.updated.replace("T", " ")} UTC。`;

  $("#note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const { note, errs } = parseForm(e.target);
    if (errs.length) { $("#form-err").textContent = errs.join("；"); return; }
    const notes = load();
    if (editingId) {
      const i = notes.findIndex((n) => n.id === editingId);
      notes[i] = { ...note, id: editingId };
    } else {
      notes.push({ ...note, id: crypto.randomUUID() });
    }
    save(notes);
    resetForm();
    render();
    $("#notes").scrollIntoView({ behavior: "smooth" });
  });
  $("#cancel-edit").addEventListener("click", resetForm);
  $("#load-example").addEventListener("click", () => {
    fillForm({ name: "範例：NVDA / AMD / AVGO 12M", underlyings: ["NVDA", "AMD", "AVGO"], currency: "USD",
      notional: 100000, couponPa: 0.16, tenorMonths: 12, obsPeriodMonths: 1, strikePct: 0.8, koPct: 1.02,
      koType: "daily_memory", nonCallPeriods: 2, kiPct: 0.6, kiType: "american",
      tradeDate: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10), initialSpots: null });
    $("#form-err").textContent = "範例已填好，按「加入監控」看看結果。";
  });
  $("#notes").addEventListener("click", (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const id = e.target.closest("[data-id]").dataset.id;
    const notes = load();
    if (act === "del") {
      if (!confirm("確定刪除這檔？")) return;
      save(notes.filter((n) => n.id !== id));
      render();
    } else if (act === "edit") {
      editingId = id;
      fillForm(notes.find((n) => n.id === id));
      $("#form-title").textContent = "編輯 FCN";
      $("#submit-btn").textContent = "儲存修改";
      $("#cancel-edit").hidden = false;
      $("#form-panel").scrollIntoView({ behavior: "smooth" });
    }
  });
  $("#waitlist").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#waitlist-msg");
    if (!WAITLIST_URL) { msg.textContent = "提醒名單尚未開放，請稍後再試。"; return; }
    try {
      const r = await fetch(WAITLIST_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e.target.email.value, notes: load().length }) });
      msg.textContent = r.ok ? "收到了，上線時會通知你。" : "送出失敗，請稍後再試。";
      if (r.ok) e.target.reset();
    } catch { msg.textContent = "送出失敗，請稍後再試。"; }
  });
  render();
}

init();
