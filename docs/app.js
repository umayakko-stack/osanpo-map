// ============================================================
// おさんぽマップ 🚶
// GPSで散歩ルートを記録し、歩数・距離を計測。
// 累計距離で「フランスまで」「南極まで」などの目標進捗を表示。
// データはすべて端末のlocalStorageに保存（サーバー不要）。
// ============================================================

"use strict";

// 予期しないJSエラーで無反応になったとき、原因をヘッダーに表示する
window.addEventListener("error", (e) => {
  const el = document.getElementById("gps-status");
  if (el) { el.textContent = "エラー: " + e.message; el.className = "gps-status err"; }
});

// ---------- 目標地点（出発地からの大圏距離で進捗計算） ----------
const DESTINATIONS = {
  seoul:     { name: "🇰🇷 ソウル（韓国）",        lat: 37.5665,  lng: 126.9780 },
  taipei:    { name: "🇹🇼 台北（台湾）",          lat: 25.0330,  lng: 121.5654 },
  honolulu:  { name: "🌺 ホノルル（ハワイ）",     lat: 21.3069,  lng: -157.8583 },
  everest:   { name: "🏔️ エベレスト",            lat: 27.9881,  lng: 86.9250 },
  sydney:    { name: "🇦🇺 シドニー（オーストラリア）", lat: -33.8688, lng: 151.2093 },
  paris:     { name: "🇫🇷 パリ（フランス）",      lat: 48.8566,  lng: 2.3522 },
  london:    { name: "🇬🇧 ロンドン（イギリス）",  lat: 51.5074,  lng: -0.1278 },
  newyork:   { name: "🗽 ニューヨーク（アメリカ）", lat: 40.7128, lng: -74.0060 },
  antarctica:{ name: "🐧 南極（昭和基地）",       lat: -69.0044, lng: 39.5817 },
};

// ---------- データ保存 ----------
const store = {
  loadWalks() {
    try { return JSON.parse(localStorage.getItem("osanpo_walks") || "[]"); }
    catch { return []; }
  },
  saveWalks(walks) {
    localStorage.setItem("osanpo_walks", JSON.stringify(walks));
  },
  loadConditions() {
    try { return JSON.parse(localStorage.getItem("osanpo_conditions") || "{}"); }
    catch { return {}; }
  },
  saveConditions(c) {
    localStorage.setItem("osanpo_conditions", JSON.stringify(c));
  },
  loadWeights() {
    try { return JSON.parse(localStorage.getItem("osanpo_weights") || "{}"); }
    catch { return {}; }
  },
  saveWeights(w) {
    localStorage.setItem("osanpo_weights", JSON.stringify(w));
  },
  loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem("osanpo_settings") || "{}"); }
    catch {}
    return Object.assign({
      strideCm: 70,                       // 歩幅
      goal: "paris",                      // 目標地点
      home: { lat: 35.6812, lng: 139.7671, label: "東京駅（初期値）" },
      plainMap: true,                     // 無地マップ（タイルの色を抜く）
      customDests: {},                    // カスタム目標地点 { "c<id>": {name, lat, lng} }
      dailyStepGoal: 0,                   // 1日の目標歩数（0 = オフ）
    }, s);
  },
  saveSettings(s) {
    localStorage.setItem("osanpo_settings", JSON.stringify(s));
  },
};

let settings = store.loadSettings();

// 目標地点（組み込み or カスタム）をキーから取得
function getDest(key) {
  return DESTINATIONS[key] || settings.customDests[key] || null;
}

// ---------- 体調（日付ごとに1つ記録） ----------
const CONDITIONS = {
  good:   { emoji: "😊", label: "良い" },
  normal: { emoji: "😐", label: "普通" },
  bad:    { emoji: "😞", label: "悪い" },
};

// ローカル日付キー "YYYY-MM-DD"
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayKey() { return dateKey(new Date()); }

function setCondition(key, cond) {
  const conds = store.loadConditions();
  if (conds[key] === cond) delete conds[key]; // 同じボタンをもう一度押すと取り消し
  else conds[key] = cond;
  store.saveConditions(conds);
}

// ---------- 距離計算（ハバーサイン） ----------
const EARTH_R = 6371000; // m
function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// 大圏コース上の中間点（f: 0〜1）— 目標マップの「いまここ」表示用
function greatCirclePoint(lat1, lng1, lat2, lng2, f) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), λ1 = toRad(lng1);
  const φ2 = toRad(lat2), λ2 = toRad(lng2);
  const δ = haversine(lat1, lng1, lat2, lng2) / EARTH_R;
  if (δ === 0) return [lat1, lng1];
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))];
}

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const gpsStatus = $("#gps-status");
const btnWalk = $("#btn-walk");
const liveStats = $("#live-stats");
const statTime = $("#stat-time");
const statDist = $("#stat-dist");
const statSteps = $("#stat-steps");

// ---------- 地図（さんぽ画面） ----------
const walkMap = L.map("walk-map", { zoomControl: false }).setView(
  [settings.home.lat, settings.home.lng], 15
);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(walkMap);
L.control.zoom({ position: "bottomright" }).addTo(walkMap);

let routeLine = null;      // 記録中のルート
let hereMarker = null;     // 現在地マーカー
let historyLine = null;    // 履歴表示用ルート

const hereIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">🚶</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 22],
});

// ---------- 散歩の記録 ----------
const DEMO_MODE = new URLSearchParams(location.search).has("demo");

// Capacitorネイティブ環境（Androidアプリ版）か。
// アプリ版はバックグラウンド位置情報プラグインで画面オフでも記録が続く。
// __CapCore / __BgGeo は capacitor-bundle.js（esbuildで@capacitor/coreをバンドル）が定義する
const IS_NATIVE = !!(window.__CapCore && window.__CapCore.isNativePlatform());
const BgGeo = IS_NATIVE ? window.__BgGeo : null;
let bgWatcherId = null;

let walking = false;
let watchId = null;
let demoTimer = null;
let timerInterval = null;
let wakeLock = null;

let walk = null; // { startTime, points: [[lat,lng],...], distance(m) }

// 加速度センサーによる歩数カウント
const pedometer = {
  enabled: false,
  steps: 0,
  lastStepAt: 0,
  avg: 9.8,
  handler(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;
    const mag = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    // 移動平均との差でピーク検出
    pedometer.avg = pedometer.avg * 0.9 + mag * 0.1;
    const now = Date.now();
    if (mag - pedometer.avg > 1.0 && now - pedometer.lastStepAt > 280) {
      pedometer.steps++;
      pedometer.lastStepAt = now;
    }
  },
  async start() {
    this.steps = 0;
    this.enabled = false;
    try {
      if (typeof DeviceMotionEvent !== "undefined" &&
          typeof DeviceMotionEvent.requestPermission === "function") {
        // iOSは許可が必要（ボタンタップ内で呼ぶこと）
        const p = await DeviceMotionEvent.requestPermission();
        if (p !== "granted") return;
      } else if (!("ondevicemotion" in window)) {
        return;
      }
      window.addEventListener("devicemotion", this.handler);
      this.enabled = true;
    } catch { /* センサーなし → 歩幅から推定 */ }
  },
  stop() {
    window.removeEventListener("devicemotion", this.handler);
  },
};

function setGpsStatus(text, cls) {
  gpsStatus.textContent = text;
  gpsStatus.className = "gps-status" + (cls ? " " + cls : "");
}

function currentSteps() {
  if (!walk) return 0;
  const estimate = Math.round(walk.distance / (settings.strideCm / 100));
  // センサー値と距離からの推定の大きい方を採用。
  // 画面オフ中はセンサーが止まるので、その間の分は推定値が補う
  return pedometer.enabled ? Math.max(pedometer.steps, estimate) : estimate;
}

function updateLiveStats() {
  if (!walk) return;
  const sec = Math.floor((Date.now() - walk.startTime) / 1000);
  const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const dist = (walk.distance / 1000).toFixed(2);
  const steps = currentSteps().toLocaleString();
  statTime.textContent = time;
  statDist.textContent = dist;
  statSteps.textContent = steps;
  $("#dim-time").textContent = time;
  $("#dim-dist").textContent = dist;
  $("#dim-steps").textContent = steps;
  renderStepGoal(); // 記録中の歩数も進捗バーに反映
}

function onPosition(lat, lng, accuracy) {
  setGpsStatus("GPS受信中", "ok");

  // 現在地マーカーは常に更新
  if (!hereMarker) {
    hereMarker = L.marker([lat, lng], { icon: hereIcon }).addTo(walkMap);
    walkMap.setView([lat, lng], 16);
  } else {
    hereMarker.setLatLng([lat, lng]);
  }

  if (!walking || !walk) return;
  if (accuracy != null && accuracy > 50) return; // 精度が悪い点は捨てる

  const now = Date.now();
  const pts = walk.points;
  if (pts.length > 0) {
    const [plat, plng] = pts[pts.length - 1];
    const d = haversine(plat, plng, lat, lng);
    if (d < 3) return; // 3m未満はGPSの揺れとみなす
    const dt = Math.max((now - walk.lastFixAt) / 1000, 1);
    const speed = d / dt; // m/s
    if (speed <= 4) {
      // 徒歩〜小走り相当（時速14km以下）なら計上。
      // 画面オフ等で間が空いた区間も、再表示時に直線距離で補完される
      walk.distance += d;
    } else if (dt <= 60) {
      return; // 短時間で大きく飛ぶのはGPSノイズ → 無視
    }
    // 長い空白の後に徒歩ではありえない移動（乗り物など）
    // → 距離には入れず、現在地から記録を再開する
  }
  pts.push([lat, lng]);
  walk.lastFixAt = now;
  routeLine.addLatLng([lat, lng]);
  walkMap.panTo([lat, lng]);
  updateLiveStats();
}

function startGeolocation() {
  if (DEMO_MODE) {
    // デモ: 東京駅周辺をランダムウォーク（PCでの動作確認用 → index.html?demo）
    let lat = settings.home.lat, lng = settings.home.lng, heading = Math.random() * Math.PI * 2;
    demoTimer = setInterval(() => {
      heading += (Math.random() - 0.5) * 0.8;
      lat += Math.cos(heading) * 0.00003; // 秒速約3.3m（徒歩〜小走り相当）
      lng += Math.sin(heading) * 0.00003;
      onPosition(lat, lng, 10);
    }, 1000);
    return;
  }
  if (IS_NATIVE) {
    // アプリ版: フォアグラウンドサービス＋通知で画面オフでも記録継続
    BgGeo.addWatcher(
      {
        backgroundMessage: "さんぽを記録しています",
        backgroundTitle: "おさんぽマップ 🚶",
        requestPermissions: true,
        stale: false,
        distanceFilter: 2,
      },
      (location, error) => {
        if (error) {
          setGpsStatus("GPSエラー", "err");
          if (error.code === "NOT_AUTHORIZED" &&
              confirm("位置情報が許可されていません。\n設定画面を開きますか？")) {
            BgGeo.openSettings();
          }
          return;
        }
        onPosition(location.latitude, location.longitude, location.accuracy);
      }
    ).then((id) => { bgWatcherId = id; })
     .catch((e) => {
        setGpsStatus("GPSエラー", "err");
        alert("位置情報の開始に失敗しました:\n" + (e && e.message ? e.message : e));
      });
    return;
  }
  if (!navigator.geolocation) {
    setGpsStatus("GPS非対応", "err");
    alert("この端末はGPSに対応していません");
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    (err) => {
      setGpsStatus("GPSエラー", "err");
      if (walking && err.code === err.PERMISSION_DENIED) {
        alert("位置情報の利用を許可してください。\n（ブラウザの設定から位置情報をオンにしてください）");
      }
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

function stopGeolocation() {
  if (bgWatcherId) { BgGeo.removeWatcher({ id: bgWatcherId }).catch(() => {}); bgWatcherId = null; }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
}

async function acquireWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  return !!wakeLock;
}
document.addEventListener("visibilitychange", () => {
  if (!IS_NATIVE && walking && document.visibilityState === "visible") acquireWakeLock();
});

async function startWalk() {
  walking = true;
  walk = { startTime: Date.now(), points: [], distance: 0, lastFixAt: Date.now() };

  if (routeLine) walkMap.removeLayer(routeLine);
  if (historyLine) { walkMap.removeLayer(historyLine); historyLine = null; }
  routeLine = L.polyline([], { color: "#2e8b57", weight: 5, opacity: 0.85 }).addTo(walkMap);

  btnWalk.textContent = "おわる";
  btnWalk.classList.add("walking");
  liveStats.classList.remove("hidden");
  updateLiveStats();
  timerInterval = setInterval(updateLiveStats, 1000);

  await pedometer.start();   // iOSの許可ダイアログはここで出る
  startGeolocation();
  // アプリ版は画面オフでも記録が続くのでスリープ防止は不要
  const wlOk = IS_NATIVE ? true : await acquireWakeLock();

  // 記録の継続条件を通知（10秒で消える）
  const hint = $("#walk-hint");
  hint.innerHTML = IS_NATIVE
    ? "📱 アプリ版: 画面を消してポケットに入れてもOK！<br>記録はバックグラウンドで続きます 🚶"
    : wlOk
    ? "📱 画面を消すと記録が止まります（画面は自動で消えません）<br>🔋ボタンで省電力画面にできます"
    : "📱 画面を消すと記録が止まります。<br>スリープしないよう画面をつけたままにしてください";
  hint.classList.remove("hidden");
  clearTimeout(startWalk._hintTimer);
  startWalk._hintTimer = setTimeout(() => hint.classList.add("hidden"), 10000);
}

function stopWalk() {
  walking = false;
  stopGeolocation();
  pedometer.stop();
  clearInterval(timerInterval);
  wakeLock?.release().catch(() => {});
  wakeLock = null;

  btnWalk.innerHTML = "さんぽ<br>スタート";
  btnWalk.classList.remove("walking");
  liveStats.classList.add("hidden");
  $("#walk-hint").classList.add("hidden");
  $("#dim-overlay").classList.add("hidden");

  const durationSec = Math.floor((Date.now() - walk.startTime) / 1000);
  const record = {
    id: walk.startTime,
    date: new Date(walk.startTime).toISOString(),
    durationSec,
    distanceM: Math.round(walk.distance),
    steps: currentSteps(),
    points: walk.points,
  };
  walk = null;

  if (record.distanceM < 10) {
    alert("ほとんど移動していないため、記録しませんでした");
    return;
  }

  const walks = store.loadWalks();
  walks.unshift(record);
  store.saveWalks(walks);
  renderHistory();
  renderGoal();
  showDoneDialog(record);
}

function showDoneDialog(rec) {
  const min = Math.floor(rec.durationSec / 60);
  const totalKm = totalDistanceKm();
  const dest = getDest(settings.goal) || DESTINATIONS.paris;
  const goalKm = goalDistanceKm();
  const pct = Math.min(100, (totalKm / goalKm) * 100);

  const overlay = document.createElement("div");
  overlay.className = "walk-done-overlay";
  overlay.innerHTML = `
    <div class="walk-done-card">
      <h3>🎉 おつかれさまでした！</h3>
      <div class="done-stats">
        きょりは <b>${(rec.distanceM / 1000).toFixed(2)} km</b><br>
        歩数は <b>${rec.steps.toLocaleString()} 歩</b>（${min}分）<br><br>
        ${dest.name} まで<br>あと <b>${(goalKm - totalKm).toFixed(1)} km</b>（${pct.toFixed(1)}%）
      </div>
      <div class="cond-q">きょうの体調は？</div>
      <div class="cond-btns">
        ${Object.entries(CONDITIONS).map(([k, c]) =>
          `<button type="button" data-cond="${k}"><span class="face face-${k}">${c.emoji}</span><span>${c.label}</span></button>`).join("")}
      </div>
      <button class="btn-close">とじる</button>
    </div>`;

  const conds = store.loadConditions();
  const walkDay = dateKey(new Date(rec.date));
  overlay.querySelectorAll(".cond-btns button").forEach((b) => {
    b.classList.toggle("selected", conds[walkDay] === b.dataset.cond);
    b.addEventListener("click", () => {
      setCondition(walkDay, b.dataset.cond);
      const now = store.loadConditions();
      overlay.querySelectorAll(".cond-btns button").forEach((x) =>
        x.classList.toggle("selected", now[walkDay] === x.dataset.cond));
      renderHistory();
    });
  });
  overlay.querySelector(".btn-close").onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

btnWalk.addEventListener("click", () => (walking ? stopWalk() : startWalk()));

// 省電力画面（黒画面）: 🔋で表示、タップで戻る
$("#btn-dim").addEventListener("click", () => $("#dim-overlay").classList.remove("hidden"));
$("#dim-overlay").addEventListener("click", () => $("#dim-overlay").classList.add("hidden"));

// ---------- きろく画面 ----------
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function totalDistanceKm() {
  return store.loadWalks().reduce((s, w) => s + w.distanceM, 0) / 1000;
}

// 日別集計: dateKey → { km, steps, count }
function dailyTotals() {
  const days = {};
  store.loadWalks().forEach((w) => {
    const k = dateKey(new Date(w.date));
    days[k] = days[k] || { km: 0, steps: 0, count: 0 };
    days[k].km += w.distanceM / 1000;
    days[k].steps += w.steps;
    days[k].count++;
  });
  return days;
}

// 選択中の日付（カレンダーで選択 → 体調編集とリスト絞り込みの対象）
let selectedDate = todayKey();
let historyFilterDate = null; // null = 全件表示

// 表示中のカレンダー年月
const _now = new Date();
let calYear = _now.getFullYear();
let calMonth = _now.getMonth();

function renderCondCard() {
  const conds = store.loadConditions();
  const isToday = selectedDate === todayKey();
  const [, m, d] = selectedDate.split("-");
  $("#cond-title").textContent = isToday
    ? "きょうの体調・体重"
    : `${Number(m)}/${Number(d)} の体調・体重`;
  document.querySelectorAll("#cond-btns button").forEach((b) => {
    b.classList.toggle("selected", conds[selectedDate] === b.dataset.cond);
  });
  const w = store.loadWeights()[selectedDate];
  $("#weight-input").value = w != null ? w : "";
}

function renderCalendar() {
  const conds = store.loadConditions();
  const days = dailyTotals();
  const today = todayKey();

  $("#cal-title").textContent = `${calYear}年 ${calMonth + 1}月`;

  const grid = $("#cal-grid");
  grid.innerHTML = "";
  ["日", "月", "火", "水", "木", "金", "土"].forEach((d) => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const numDays = new Date(calYear, calMonth + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement("div");
    el.className = "cal-cell empty";
    grid.appendChild(el);
  }
  for (let day = 1; day <= numDays; day++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const info = days[key];
    const cond = conds[key];
    const el = document.createElement("div");
    el.className = "cal-cell"
      + (info ? " has-walk" : "")
      + (key === today ? " today" : "")
      + (key === selectedDate ? " selected" : "");
    el.innerHTML =
      `<span class="d">${day}</span>` +
      `<span class="e ${cond ? "face-" + cond : ""}">${cond ? CONDITIONS[cond].emoji : ""}</span>` +
      `<span class="km">${info ? info.km.toFixed(1) + "km" : ""}</span>`;
    el.addEventListener("click", () => selectDay(key));
    grid.appendChild(el);
  }
}

function selectDay(key) {
  selectedDate = key;
  historyFilterDate = key;
  renderHistory();
}

function clearDayFilter() {
  selectedDate = todayKey();
  historyFilterDate = null;
  renderHistory();
}

function renderFilterBar() {
  const bar = $("#list-filter-bar");
  if (!historyFilterDate) {
    bar.classList.add("hidden");
    return;
  }
  const [, m, d] = historyFilterDate.split("-");
  const days = dailyTotals();
  const info = days[historyFilterDate];
  const w = store.loadWeights()[historyFilterDate];
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <span>📅 ${Number(m)}/${Number(d)} のきろく${info ? `（${info.km.toFixed(2)} km・${info.steps.toLocaleString()} 歩）` : "（さんぽなし）"}${w != null ? `・⚖️${w}kg` : ""}</span>
    <button>すべて表示</button>`;
  bar.querySelector("button").addEventListener("click", clearDayFilter);
}

// 体重グラフ（直近30件をSVG折れ線で描画、2件未満なら非表示）
function renderWeightChart() {
  const card = $("#weight-card");
  const entries = Object.entries(store.loadWeights())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-30);
  if (entries.length < 2) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");

  const vals = entries.map((e) => e[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.15 || 0.5;
  const lo = min - pad, hi = max + pad;
  const W = 300, H = 110, L = 34, R = 10, T = 12, B = 18;
  const x = (i) => L + ((W - L - R) * i) / (entries.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const fmtD = (k) => { const [, m, d] = k.split("-"); return `${Number(m)}/${Number(d)}`; };

  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e[1]).toFixed(1)}`).join(" ");
  const dots = entries.map((e, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(e[1]).toFixed(1)}" r="2.5" fill="#2e8b57"/>`).join("");
  const last = entries[entries.length - 1];

  $("#weight-chart").innerHTML = `
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#e3ece6" stroke-width="1"/>
    <text x="2" y="${(y(max) + 4).toFixed(1)}" font-size="9" fill="#7a8a80">${max.toFixed(1)}</text>
    <text x="2" y="${(y(min) + 4).toFixed(1)}" font-size="9" fill="#7a8a80">${min.toFixed(1)}</text>
    <polyline points="${pts}" fill="none" stroke="#2e8b57" stroke-width="2"/>
    ${dots}
    <text x="${L}" y="${H - 4}" font-size="9" fill="#7a8a80">${fmtD(entries[0][0])}</text>
    <text x="${W - R}" y="${H - 4}" font-size="9" fill="#7a8a80" text-anchor="end">${fmtD(last[0])}</text>
    <text x="${W - R}" y="${(y(last[1]) - 6).toFixed(1)}" font-size="10" font-weight="bold" fill="#1f6b41" text-anchor="end">${last[1].toFixed(1)}kg</text>`;
}

function renderHistory() {
  const walks = store.loadWalks();
  const totalKm = totalDistanceKm();
  const totalSteps = walks.reduce((s, w) => s + w.steps, 0);

  $("#history-summary").innerHTML = `
    <div class="summary-card"><div class="num">${walks.length}</div><div class="lbl">さんぽ回数</div></div>
    <div class="summary-card"><div class="num">${totalKm.toFixed(1)}</div><div class="lbl">累計 km</div></div>
    <div class="summary-card"><div class="num">${totalSteps.toLocaleString()}</div><div class="lbl">累計 歩</div></div>`;

  renderCondCard();
  renderCalendar();
  renderWeightChart();
  renderFilterBar();
  renderBackupInfo();
  invalidateTodaySteps();
  renderStepGoal();

  const list = $("#history-list");
  const shown = historyFilterDate
    ? walks.filter((w) => dateKey(new Date(w.date)) === historyFilterDate)
    : walks;
  if (shown.length === 0) {
    list.innerHTML = historyFilterDate
      ? '<li class="history-empty">この日はさんぽしていません</li>'
      : '<li class="history-empty">まだ記録がありません。<br>さんぽに出かけましょう！ 🚶</li>';
    return;
  }
  list.innerHTML = "";
  shown.forEach((w) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
      <div>
        <div class="history-date">${fmtDate(w.date)}</div>
        <div class="history-sub">${(w.distanceM / 1000).toFixed(2)} km ・ ${w.steps.toLocaleString()} 歩 ・ ${Math.floor(w.durationSec / 60)}分</div>
      </div>
      <div>
        <button class="btn-del" title="削除">🗑</button>
        <span class="history-arrow">›</span>
      </div>`;
    li.querySelector(".btn-del").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("この記録を削除しますか？")) return;
      store.saveWalks(store.loadWalks().filter((x) => x.id !== w.id));
      renderHistory();
      renderGoal();
    });
    li.addEventListener("click", () => showWalkOnMap(w));
    list.appendChild(li);
  });
}

function showWalkOnMap(w) {
  switchTab("walk");
  if (historyLine) walkMap.removeLayer(historyLine);
  if (w.points.length === 0) return;
  historyLine = L.polyline(w.points, { color: "#ff8c42", weight: 5, opacity: 0.85 }).addTo(walkMap);
  walkMap.fitBounds(historyLine.getBounds(), { padding: [40, 40] });
}

// 体調ボタン（きろく画面）
document.querySelectorAll("#cond-btns button").forEach((b) =>
  b.addEventListener("click", () => {
    setCondition(selectedDate, b.dataset.cond);
    renderCondCard();
    renderCalendar();
  })
);

// 体重の記録
$("#btn-weight-save").addEventListener("click", () => {
  const raw = $("#weight-input").value.trim();
  const weights = store.loadWeights();
  if (raw === "") {
    delete weights[selectedDate]; // 空欄で記録 → 削除
  } else {
    const v = parseFloat(raw);
    if (isNaN(v) || v < 20 || v > 200) {
      alert("体重は20〜200kgの範囲で入力してください");
      return;
    }
    weights[selectedDate] = Math.round(v * 10) / 10;
  }
  store.saveWeights(weights);
  renderHistory();
  const b = $("#btn-weight-save");
  b.textContent = "✓ 記録した";
  setTimeout(() => { b.textContent = "記録"; }, 1200);
});

// カレンダーの月送り
$("#cal-prev").addEventListener("click", () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
$("#cal-next").addEventListener("click", () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// ---------- もくひょう画面 ----------
let goalMap = null;
let goalLayers = [];

function goalDistanceKm() {
  const d = getDest(settings.goal) || DESTINATIONS.paris;
  return Math.max(0.1, haversine(settings.home.lat, settings.home.lng, d.lat, d.lng) / 1000);
}

function initGoalMap() {
  if (goalMap) return;
  goalMap = L.map("goal-map", { zoomControl: false, attributionControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 10 }).addTo(goalMap);
}

function renderGoal() {
  const dest = getDest(settings.goal) || DESTINATIONS.paris;
  const goalKm = goalDistanceKm();
  const totalKm = totalDistanceKm();
  const pct = Math.min(100, (totalKm / goalKm) * 100);
  const remain = Math.max(0, goalKm - totalKm);

  $("#goal-title").textContent = `${dest.name} まで`;
  $("#progress-fill").style.width = pct + "%";
  $("#goal-text").innerHTML =
    pct >= 100
      ? `🎉🎉 <span class="big">とうちゃく！</span> 🎉🎉<br>累計 ${totalKm.toFixed(1)} km 歩きました！次の目標を選びましょう`
      : `いま <span class="big">${pct.toFixed(1)}%</span><br>
         歩いたきょり: ${totalKm.toFixed(1)} km ／ 全体: ${Math.round(goalKm).toLocaleString()} km<br>
         あと ${remain.toFixed(1)} km！`;

  if (!goalMap) return;

  goalLayers.forEach((l) => goalMap.removeLayer(l));
  goalLayers = [];

  const home = settings.home;
  const f = Math.min(1, totalKm / goalKm);

  // 大圏コースを折れ線で描画
  const path = [];
  for (let i = 0; i <= 100; i++) {
    path.push(greatCirclePoint(home.lat, home.lng, dest.lat, dest.lng, i / 100));
  }
  const line = L.polyline(path, { color: "#9ab8a5", weight: 3, dashArray: "6 8" }).addTo(goalMap);

  // 歩いた分は実線で
  const walked = path.slice(0, Math.max(1, Math.round(f * 100) + 1));
  const walkedLine = L.polyline(walked, { color: "#2e8b57", weight: 4 }).addTo(goalMap);

  const homeMk = L.marker([home.lat, home.lng], {
    icon: L.divIcon({ className: "", html: '<div style="font-size:22px">🏠</div>', iconSize: [22, 22], iconAnchor: [11, 20] }),
  }).addTo(goalMap);
  const destMk = L.marker([dest.lat, dest.lng], {
    icon: L.divIcon({ className: "", html: '<div style="font-size:22px">🚩</div>', iconSize: [22, 22], iconAnchor: [4, 22] }),
  }).addTo(goalMap);

  const [vLat, vLng] = greatCirclePoint(home.lat, home.lng, dest.lat, dest.lng, f);
  const meMk = L.marker([vLat, vLng], { icon: hereIcon })
    .addTo(goalMap)
    .bindPopup(`いまここ！（${totalKm.toFixed(1)} km地点）`);

  goalLayers.push(line, walkedLine, homeMk, destMk, meMk);
  goalMap.fitBounds(line.getBounds(), { padding: [30, 30] });
}

// 目標選択セレクトボックス（組み込み＋カスタムを合わせて構築）
const goalSelect = $("#goal-select");
function renderGoalSelect() {
  goalSelect.innerHTML = "";
  const all = Object.assign({}, DESTINATIONS, settings.customDests);
  Object.entries(all).forEach(([key, d]) => {
    const opt = document.createElement("option");
    opt.value = key;
    const km = Math.round(haversine(settings.home.lat, settings.home.lng, d.lat, d.lng) / 1000);
    opt.textContent = `${d.name}（約${km.toLocaleString()}km）`;
    goalSelect.appendChild(opt);
  });
  // 選択中の目標が消えていたら（カスタム削除など）パリに戻す
  if (!getDest(settings.goal)) {
    settings.goal = "paris";
    store.saveSettings(settings);
  }
  goalSelect.value = settings.goal;
  $("#btn-del-goal").classList.toggle("hidden", !settings.customDests[settings.goal]);
}
renderGoalSelect();
goalSelect.addEventListener("change", () => {
  settings.goal = goalSelect.value;
  store.saveSettings(settings);
  $("#btn-del-goal").classList.toggle("hidden", !settings.customDests[settings.goal]);
  renderGoal();
});

// ---------- カスタム目標地点 ----------
// 地名をOpenStreetMapの検索API（Nominatim）で探して座標を取得する
$("#btn-add-goal").addEventListener("click", () => {
  const box = $("#custom-goal-box");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) $("#goal-search-input").focus();
});

async function searchPlace() {
  const q = $("#goal-search-input").value.trim();
  if (!q) { alert("地名を入力してください"); return; }
  const list = $("#goal-search-results");
  list.innerHTML = '<li class="searching">🔍 さがしています…</li>';
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ja&q=" +
      encodeURIComponent(q)
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const results = await res.json();
    list.innerHTML = "";
    if (results.length === 0) {
      list.innerHTML = '<li class="searching">見つかりませんでした。別の書き方で試してください</li>';
      return;
    }
    results.forEach((r) => {
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      const name = r.name || q;
      const km = Math.round(haversine(settings.home.lat, settings.home.lng, lat, lng) / 1000);
      const li = document.createElement("li");
      const title = document.createElement("b");
      title.textContent = `📍 ${name}（約${km.toLocaleString()}km）`;
      const sub = document.createElement("small");
      sub.textContent = r.display_name;
      li.append(title, document.createElement("br"), sub);
      li.addEventListener("click", () => addCustomDest(name, lat, lng));
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = '<li class="searching">検索できませんでした。通信状態を確認してもう一度お試しください</li>';
  }
}
$("#btn-goal-search").addEventListener("click", searchPlace);
$("#goal-search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); searchPlace(); }
});

function addCustomDest(name, lat, lng) {
  const key = "c" + Date.now();
  settings.customDests[key] = { name: "📍 " + name, lat, lng };
  settings.goal = key;
  store.saveSettings(settings);
  renderGoalSelect();
  renderGoal();
  $("#custom-goal-box").classList.add("hidden");
  $("#goal-search-results").innerHTML = "";
  $("#goal-search-input").value = "";
}

$("#btn-del-goal").addEventListener("click", () => {
  const d = settings.customDests[settings.goal];
  if (!d) return;
  if (!confirm(`「${d.name}」を目標から削除しますか？`)) return;
  delete settings.customDests[settings.goal];
  settings.goal = "paris";
  store.saveSettings(settings);
  renderGoalSelect();
  renderGoal();
});

// ---------- 1日の目標歩数（さんぽ画面の進捗バー） ----------
// 保存済み散歩の当日歩数はキャッシュ（記録中は毎秒呼ばれるため全件集計を避ける）
let _todaySteps = { key: null, steps: 0 };
function invalidateTodaySteps() { _todaySteps.key = null; }
function todaySavedSteps() {
  const k = todayKey();
  if (_todaySteps.key !== k) {
    const info = dailyTotals()[k];
    _todaySteps = { key: k, steps: info ? info.steps : 0 };
  }
  return _todaySteps.steps;
}

function renderStepGoal() {
  const bar = $("#step-goal-bar");
  const goal = settings.dailyStepGoal;
  if (!goal || goal <= 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const steps = todaySavedSteps() + (walking && walk ? currentSteps() : 0);
  const done = steps >= goal;
  $("#step-goal-fill").style.width = Math.min(100, (steps / goal) * 100) + "%";
  $("#step-goal-fill").classList.toggle("done", done);
  $("#step-goal-text").textContent = done
    ? `🎉 きょうの目標たっせい！ ${steps.toLocaleString()} / ${goal.toLocaleString()} 歩`
    : `きょうの歩数 ${steps.toLocaleString()} / ${goal.toLocaleString()} 歩`;
}

// せってい
const stepGoalInput = $("#step-goal-input");
stepGoalInput.value = settings.dailyStepGoal || "";
stepGoalInput.addEventListener("change", () => {
  const v = parseInt(stepGoalInput.value, 10);
  settings.dailyStepGoal = isNaN(v) || v <= 0 ? 0 : Math.min(v, 100000);
  store.saveSettings(settings);
  renderStepGoal();
});

const strideInput = $("#stride-input");
strideInput.value = settings.strideCm;
strideInput.addEventListener("change", () => {
  const v = parseInt(strideInput.value, 10);
  if (v >= 30 && v <= 120) {
    settings.strideCm = v;
    store.saveSettings(settings);
  }
});

function renderHomeText() {
  $("#home-text").textContent = `現在: ${settings.home.label}`;
}

// 無地マップの適用（さんぽ・もくひょう両方の地図タイルに効く）
function applyPlainMap() {
  document.body.classList.toggle("plain-map", !!settings.plainMap);
  $("#plain-map-toggle").checked = !!settings.plainMap;
}
$("#plain-map-toggle").addEventListener("change", (e) => {
  settings.plainMap = e.target.checked;
  store.saveSettings(settings);
  applyPlainMap();
});
$("#btn-set-home").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("GPS非対応です");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      settings.home = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: `現在地 (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)})`,
      };
      store.saveSettings(settings);
      renderHomeText();
      renderGoalSelect(); // 各目標までの距離表示を更新
      renderGoal();
      alert("出発地点を現在地に設定しました");
    },
    () => alert("現在地を取得できませんでした")
  );
});

// ---------- バックアップ・復元 ----------
// 全データ（散歩・体調・体重・設定）を1つのJSONにまとめて書き出し/読み込み。
// 復元は上書きではなくマージ（散歩はIDで重複排除、体調・体重は日付ごとにバックアップ優先）
function buildBackup() {
  return {
    app: "osanpo-map",
    version: 1,
    exportedAt: new Date().toISOString(),
    walks: store.loadWalks(),
    conditions: store.loadConditions(),
    weights: store.loadWeights(),
    settings: store.loadSettings(),
  };
}

function renderBackupInfo() {
  const nWalks = store.loadWalks().length;
  const nConds = Object.keys(store.loadConditions()).length;
  const nWeights = Object.keys(store.loadWeights()).length;
  $("#backup-info").textContent =
    `いまのデータ: さんぽ${nWalks}件・体調${nConds}件・体重${nWeights}件`;
}

function restoreBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || data.app !== "osanpo-map" || !Array.isArray(data.walks)) {
    alert("おさんぽマップのバックアップではないようです。\n内容を確認してください");
    return;
  }
  const when = data.exportedAt ? fmtDate(data.exportedAt) : "日時不明";
  const nConds = Object.keys(data.conditions || {}).length;
  const nWeights = Object.keys(data.weights || {}).length;
  if (!confirm(
    `バックアップ（${when} 保存）を読み込みます。\n` +
    `さんぽ${data.walks.length}件・体調${nConds}件・体重${nWeights}件\n\n` +
    `いまの記録と合体します（同じ記録は増えません）。よろしいですか？`
  )) return;

  // 散歩: IDで重複排除して追加 → 新しい順に並べ直し
  const walks = store.loadWalks();
  const ids = new Set(walks.map((w) => w.id));
  const added = data.walks.filter(
    (w) => w && typeof w.id === "number" && Array.isArray(w.points) && !ids.has(w.id)
  );
  if (added.length > 0) {
    walks.push(...added);
    walks.sort((a, b) => b.id - a.id);
    store.saveWalks(walks);
  }

  // 体調・体重: バックアップの値を優先してマージ
  store.saveConditions(Object.assign(store.loadConditions(), data.conditions || {}));
  store.saveWeights(Object.assign(store.loadWeights(), data.weights || {}));

  // 設定: バックアップの値を反映
  if (data.settings && typeof data.settings === "object") {
    settings = Object.assign(store.loadSettings(), data.settings);
    store.saveSettings(settings);
    renderGoalSelect();
    strideInput.value = settings.strideCm;
    stepGoalInput.value = settings.dailyStepGoal || "";
    renderHomeText();
    applyPlainMap();
  }

  renderHistory();
  renderGoal();
  renderBackupInfo();
  $("#restore-paste-box").classList.add("hidden");
  alert(`復元しました！\nさんぽを${added.length}件 追加しました`);
}

// ファイルに保存（Web版のみ。アプリ版のWebViewはダウンロード不可なのでコピーを使う）
$("#btn-backup-save").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(buildBackup())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `osanpo-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
if (IS_NATIVE) $("#btn-backup-save").classList.add("hidden");

$("#btn-backup-copy").addEventListener("click", async () => {
  const text = JSON.stringify(buildBackup());
  try {
    await navigator.clipboard.writeText(text);
    alert("コピーしました！\nメモアプリなどに貼り付けて保存してください");
  } catch {
    // クリップボードが使えない場合は貼り付け欄に表示して手動コピーしてもらう
    const box = $("#restore-paste-box");
    box.classList.remove("hidden");
    $("#restore-textarea").value = text;
    alert("自動コピーできませんでした。\n下の欄の文字を長押しして全部コピーしてください");
  }
});

$("#btn-restore-file").addEventListener("click", () => $("#restore-file-input").click());
$("#restore-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 同じファイルをもう一度選べるように
  if (!file) return;
  file.text().then(restoreBackup).catch(() => alert("ファイルを読み込めませんでした"));
});

$("#btn-restore-paste").addEventListener("click", () => {
  const box = $("#restore-paste-box");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    $("#restore-textarea").value = "";
    $("#restore-textarea").focus();
  }
});
$("#btn-restore-run").addEventListener("click", () => {
  const text = $("#restore-textarea").value.trim();
  if (!text) { alert("バックアップの文字を貼り付けてください"); return; }
  restoreBackup(text);
});

// ---------- タブ切り替え ----------
function switchTab(name) {
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  $(`#tab-${name}`).classList.add("active");
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add("active");

  // 非表示中に生成された地図はサイズ再計算が必要
  if (name === "walk") setTimeout(() => walkMap.invalidateSize(), 50);
  if (name === "goal") {
    initGoalMap();
    setTimeout(() => { goalMap.invalidateSize(); renderGoal(); }, 50);
  }
}
document.querySelectorAll(".tab-btn").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);

// ---------- 初期化 ----------
renderHistory();
renderHomeText();
applyPlainMap();
if (!DEMO_MODE && navigator.geolocation) {
  // 起動時に現在地へ移動（記録はしない）
  navigator.geolocation.getCurrentPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    () => setGpsStatus("GPS未許可", "err"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
} else if (DEMO_MODE) {
  setGpsStatus("デモモード", "ok");
}
