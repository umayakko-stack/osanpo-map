'use strict';

// ============ ストレージ ============
const KEYS = {
  records: 'tsukin_records', // 完了した通勤の記録
  active: 'tsukin_active',   // 計測中データの退避（リロード・プロセス終了対策）
};

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}
function persist(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function remove(key) { localStorage.removeItem(key); }

let records = load(KEYS.records, []);

// ============ ヘルパー ============
function $(id) { return document.getElementById(id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtRecDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 2点間の距離（メートル）
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ============ 日付と時刻（一番上） ============
function tickClock() {
  const d = new Date();
  $('now-date').textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
  $('now-time').textContent =
    `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
tickClock();
setInterval(tickClock, 250);

// ============ 計測状態 ============
let active = null;      // { id, startedAt(ms), dist(m), path:[{lat,lng,t}] }
let watchId = null;
let lastPoint = null;   // 距離計算用の直前の位置（保存はしない生データ）
let wakeLock = null;
let timerInterval = null;
let lastSavedId = null; // ゴール直後のハイライト用

// 位置情報フィルタ（車用）: 精度100m超は捨てる、200km/h超のジャンプはノイズ
const MAX_ACCURACY = 100;
const MAX_SPEED = 55; // m/s
// 保存パスの間引き: 15秒 or 100m ごと
const PATH_MIN_MS = 15000, PATH_MIN_DIST = 100;

function setGpsStatus(text, ok) {
  const el = $('gps-status');
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
}

function onPosition(pos) {
  if (!active) return;
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  if (accuracy > MAX_ACCURACY) { setGpsStatus(`GPS精度わるい(${Math.round(accuracy)}m)`, false); return; }
  setGpsStatus(`GPS OK(±${Math.round(accuracy)}m)`, true);

  const t = Date.now();
  if (lastPoint) {
    const d = haversine(lastPoint.lat, lastPoint.lng, lat, lng);
    const dt = (t - lastPoint.t) / 1000;
    if (dt > 0 && d / dt > MAX_SPEED) return; // ありえない速度はノイズ
    active.dist += d;
  }
  lastPoint = { lat, lng, t };

  // ルートは間引いて保存（localStorageの肥大防止）
  const last = active.path[active.path.length - 1];
  if (!last || t - last.t >= PATH_MIN_MS ||
      haversine(last.lat, last.lng, lat, lng) >= PATH_MIN_DIST) {
    active.path.push({ lat: +lat.toFixed(5), lng: +lng.toFixed(5), t });
  }
  persist(KEYS.active, active);
  $('run-dist').textContent = `${(active.dist / 1000).toFixed(1)} km`;
}

function onPositionError(err) {
  setGpsStatus(err.code === 1 ? 'GPS許可なし（タイムのみ計測）' : 'GPSエラー（タイムのみ計測）', false);
}

function startWatch() {
  if (!navigator.geolocation) { setGpsStatus('GPS非対応（タイムのみ計測）', false); return; }
  setGpsStatus('GPS取得中…', false);
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

function stopWatch() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  lastPoint = null;
  setGpsStatus('GPS待機中', false);
}

// 計測中は画面をスリープさせない（車載ホルダー想定）
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* 非対応・省電力モードでは黙って諦める */ }
}
document.addEventListener('visibilitychange', () => {
  if (active && document.visibilityState === 'visible') acquireWakeLock();
});

// ============ タイマー表示 ============
function tickTimer() {
  if (!active) return;
  const text = fmtElapsed((Date.now() - active.startedAt) / 1000);
  const el = $('timer');
  el.textContent = text;
  el.classList.toggle('long', text.length > 5); // 1時間超は文字を小さく
}

function setRunningUI(running) {
  $('btn-start').disabled = running;
  $('btn-goal').disabled = !running;
  $('run-info').classList.toggle('hidden', !running);
  $('timer').classList.toggle('running', running);
}

// ============ スタート / ゴール ============
function startRun(resume) {
  if (!resume) {
    active = { id: uid(), startedAt: Date.now(), dist: 0, path: [] };
    persist(KEYS.active, active);
  }
  $('result-banner').classList.add('hidden');
  $('run-dist').textContent = `${(active.dist / 1000).toFixed(1)} km`;
  setRunningUI(true);
  tickTimer();
  timerInterval = setInterval(tickTimer, 250);
  startWatch();
  acquireWakeLock();
}

function finishRun(save) {
  clearInterval(timerInterval);
  timerInterval = null;
  stopWatch();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }

  if (save && active) {
    const rec = {
      id: active.id,
      at: new Date(active.startedAt).toISOString(),
      dur: Math.round((Date.now() - active.startedAt) / 1000),
      dist: Math.round(active.dist),
      path: active.path,
    };
    records.push(rec);
    persist(KEYS.records, records);
    lastSavedId = rec.id;
    showResult(rec);
  }
  remove(KEYS.active);
  active = null;
  setRunningUI(false);
  $('timer').textContent = '0:00';
  $('timer').classList.remove('long');
  renderRanking();
}

function showResult(rec) {
  const rank = rankOf(rec);
  const medal = rank === 1 ? '🥇 新記録！' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`;
  const banner = $('result-banner');
  banner.innerHTML = `🏁 ゴール！ タイム <b>${fmtElapsed(rec.dur)}</b> ・ ${(rec.dist / 1000).toFixed(1)} km<br>` +
    `全${records.length}回中 <b>${medal}</b>`;
  banner.classList.remove('hidden');
}

function rankOf(rec) {
  return [...records].sort((a, b) => a.dur - b.dur).findIndex(r => r.id === rec.id) + 1;
}

$('btn-start').addEventListener('click', () => startRun(false));

$('btn-goal').addEventListener('click', () => finishRun(true));

$('btn-cancel').addEventListener('click', () => {
  if (confirm('この計測を記録せずにやめますか？')) finishRun(false);
});

// ============ ランキング ============
function renderRanking() {
  const list = $('rank-list');
  const sorted = [...records].sort((a, b) => a.dur - b.dur);
  $('rank-empty').classList.toggle('hidden', sorted.length > 0);

  list.innerHTML = sorted.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}位`;
    const km = r.dist / 1000;
    const kmh = r.dur > 0 ? km / (r.dur / 3600) : 0;
    const sub = km >= 0.1
      ? `${fmtRecDate(r.at)} ・ ${km.toFixed(1)} km ・ 平均${Math.round(kmh)} km/h`
      : fmtRecDate(r.at);
    return `<li class="rank-item${i < 3 ? ' top3' : ''}${r.id === lastSavedId ? ' new' : ''}">
      <span class="rank-pos">${medal}</span>
      <span class="rank-body">
        <span class="rank-time">${fmtElapsed(r.dur)}${r.id === lastSavedId ? ' <span class="new-tag">NEW</span>' : ''}</span>
        <span class="rank-sub">${sub}</span>
      </span>
      <button class="rank-del" data-id="${r.id}" title="この記録を削除">✕</button>
    </li>`;
  }).join('');

  list.querySelectorAll('.rank-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = records.find(r => r.id === btn.dataset.id);
      if (!rec) return;
      if (!confirm(`${fmtRecDate(rec.at)} のタイム ${fmtElapsed(rec.dur)} を削除しますか？`)) return;
      records = records.filter(r => r.id !== rec.id);
      persist(KEYS.records, records);
      renderRanking();
    });
  });
}

// ============ 起動 ============
// 計測中にリロード・プロセス終了しても再開する
const saved = load(KEYS.active, null);
if (saved && typeof saved.startedAt === 'number') {
  active = saved;
  startRun(true);
}
renderRanking();
