'use strict';

// ============ ストレージ ============
const KEYS = {
  logs: 'anshin_logs',           // 不安の波の記録
  checkups: 'anshin_checkups',   // 検診の記録
  symptoms: 'anshin_symptoms',   // 先生に聞きたいことメモ
  omamori: 'anshin_omamori',     // おまもりことば
  thoughts: 'anshin_thoughts',   // こころの整理ノート
  settings: 'anshin_settings',
};

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}
function persist(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

let logs = load(KEYS.logs, []);
let checkups = load(KEYS.checkups, []);
let symptoms = load(KEYS.symptoms, []);
let omamori = load(KEYS.omamori, null);
let thoughts = load(KEYS.thoughts, []);
let settings = load(KEYS.settings, {});

// 初回: おまもりことばの種
if (!omamori) {
  omamori = [
    '不安になるのは、じぶんのからだを大切に思っている証拠。',
    '不安の波は、かならず引いていく。',
    '心配ごとの多くは、実際には起こらない。',
    '検診をつづけていること、それがいちばんの見守り。',
    'きょうのわたしは、きょうのことだけでいい。',
  ].map(text => ({ id: uid(), text, seed: true }));
  persist(KEYS.omamori, omamori);
}

// ============ ヘルパー ============
function $(id) { return document.getElementById(id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${fmtDate(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}
function levelClass(n) { return n >= 7 ? 'high' : n >= 4 ? 'mid' : 'low'; }

// ============ タブ切り替え ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-page').forEach(p =>
      p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    renderAll();
  });
});
function switchTab(name) {
  document.querySelector(`.tab-btn[data-tab="${name}"]`).click();
}

// ============ きょう画面 ============
const GREETINGS = [
  'きょうも、ここに来られましたね。それだけで十分です。',
  '不安があってもなくても、きょうはきょうの一日。ゆっくりいきましょう。',
  '波がきたら記録して、深呼吸。それだけでいいんです。',
  'からだの声を聞きながら、きょうもぼちぼちいきましょう。',
  '心配は未来のこと。いまのこの時間は、あなたのものです。',
  '不安と戦わなくて大丈夫。ながめて、通り過ぎるのを待ちましょう。',
  'きょうできる小さな楽しみを、ひとつだけ見つけてみませんか。',
  '検診と検診のあいだの日々は、ふつうに暮らしていい日々です。',
  'よく眠って、よく食べて。それもりっぱなセルフケアです。',
  '不安になった日も、ならなかった日も、おなじ大切な一日。',
];
function dayOfYear() {
  const d = new Date();
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

function renderHome() {
  $('greet-date').textContent = fmtDate(new Date());
  $('greet-msg').textContent = GREETINGS[dayOfYear() % GREETINGS.length];

  // つぎの検診カード
  const card = $('home-checkup-card');
  if (settings.nextDate) {
    const days = daysUntil(settings.nextDate);
    const d = new Date(settings.nextDate + 'T00:00:00');
    if (days > 0) {
      card.innerHTML = `<div class="card-title">🏥 つぎの検診</div>
        <div class="line">${fmtDate(d)}<span class="big">　あと${days}日</span></div>
        <div class="line">${esc(settings.hospital || '')}</div>`;
    } else if (days === 0) {
      card.innerHTML = `<div class="card-title">🏥 つぎの検診</div>
        <div class="line"><span class="big">きょうが検診日です</span></div>
        <div class="line">いってらっしゃい。おわったら結果を記録しましょう。</div>`;
    } else {
      card.innerHTML = `<div class="card-title">🏥 検診はおわりましたか？</div>
        <div class="line">${fmtDate(d)}の検診の結果を記録して、つぎの予定を入れておきましょう。</div>`;
    }
  } else {
    card.innerHTML = `<div class="card-title">🏥 つぎの検診</div>
      <div class="line">まだ登録されていません。<br>検診の予定を入れておくと、ここに表示されます。</div>`;
  }
  card.onclick = () => switchTab('checkup');

  // あゆみ
  $('st-waves').textContent = logs.length;
  $('st-calmed').textContent = logs.filter(l => l.after !== null && l.after !== undefined && l.after < l.level).length;
  $('st-ok').textContent = checkups.filter(c => c.result === 'ok').length;
}

// ============ 不安の波 フロー ============
let waveTags = [];
let currentWaveId = null;

$('btn-wave').addEventListener('click', () => {
  waveTags = [];
  currentWaveId = null;
  $('wave-level').value = 5;
  $('wave-level-num').textContent = '5';
  $('wave-memo').value = '';
  document.querySelectorAll('#wave-tags button').forEach(b => b.classList.remove('on'));
  showWaveStep(1);
  $('wave-overlay').classList.remove('hidden');
});
function showWaveStep(n) {
  [1, 2, 3, 4].forEach(i => $('wave-step-' + i).classList.toggle('hidden', i !== n));
}
$('wave-close').addEventListener('click', () => $('wave-overlay').classList.add('hidden'));

$('wave-level').addEventListener('input', e => { $('wave-level-num').textContent = e.target.value; });
$('wave-after').addEventListener('input', e => { $('wave-after-num').textContent = e.target.value; });

document.querySelectorAll('#wave-tags button').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('on');
    const t = btn.dataset.tag;
    waveTags = btn.classList.contains('on') ? [...waveTags, t] : waveTags.filter(x => x !== t);
  });
});

$('wave-record').addEventListener('click', () => {
  const entry = {
    id: uid(),
    t: new Date().toISOString(),
    level: Number($('wave-level').value),
    after: null,
    tags: waveTags,
    memo: $('wave-memo').value.trim(),
  };
  logs.unshift(entry);
  persist(KEYS.logs, logs);
  currentWaveId = entry.id;
  showWaveStep(2);
});

$('wave-to-breath').addEventListener('click', () => {
  $('wave-overlay').classList.add('hidden');
  openBreath(true);
});
$('wave-skip-breath').addEventListener('click', () => {
  $('wave-overlay').classList.add('hidden');
  renderAll();
});

// 呼吸のあと、いまの不安をもう一度きく
function askWaveAfter() {
  const entry = logs.find(l => l.id === currentWaveId);
  if (!entry) return;
  $('wave-after').value = entry.level;
  $('wave-after-num').textContent = entry.level;
  showWaveStep(3);
  $('wave-overlay').classList.remove('hidden');
}

$('wave-after-save').addEventListener('click', () => {
  const entry = logs.find(l => l.id === currentWaveId);
  if (entry) {
    entry.after = Number($('wave-after').value);
    persist(KEYS.logs, logs);
    if (entry.after < entry.level) {
      $('wave-done-title').textContent = '🌊 波が引いてきました';
      $('wave-done-text').textContent =
        `さっきは ${entry.level}、いまは ${entry.after}。不安の波は、こうしてちゃんと引いていきます。よくがんばりました。`;
    } else {
      $('wave-done-title').textContent = '🍀 それでも大丈夫';
      $('wave-done-text').textContent =
        'すぐに引かない波もあります。気づいて、記録して、呼吸できた。それだけで今日は十分です。';
    }
  }
  showWaveStep(4);
});
$('wave-done-close').addEventListener('click', () => {
  $('wave-overlay').classList.add('hidden');
  currentWaveId = null;
  renderAll();
});

// ============ 呼吸エクササイズ ============
const BREATH_PHASES = [
  { label: 'すって…', cls: 'in', sec: 4 },
  { label: 'とめて', cls: 'hold', sec: 2 },
  { label: 'はいて…', cls: 'out', sec: 6 },
];
let breathTimer = null;
let breathFromWave = false;

$('btn-open-breath').addEventListener('click', () => openBreath(false));
function openBreath(fromWave) {
  breathFromWave = fromWave;
  $('breath-setup').classList.remove('hidden');
  $('breath-run').classList.add('hidden');
  $('breath-done').classList.add('hidden');
  $('breath-overlay').classList.remove('hidden');
}
document.querySelectorAll('#breath-setup .btn-primary').forEach(btn => {
  btn.addEventListener('click', () => startBreath(Number(btn.dataset.cycles)));
});

function startBreath(totalCycles) {
  $('breath-setup').classList.add('hidden');
  $('breath-run').classList.remove('hidden');
  let cycle = 0, phaseIdx = 0, secLeft = 0;
  const circle = $('breath-circle');

  function nextPhase() {
    if (phaseIdx === 0) {
      cycle++;
      if (cycle > totalCycles) { finishBreath(); return; }
      $('breath-count').textContent = `${cycle} / ${totalCycles} 回`;
    }
    const p = BREATH_PHASES[phaseIdx];
    $('breath-phase').textContent = p.label;
    circle.className = 'breath-circle ' + p.cls;
    secLeft = p.sec;
    phaseIdx = (phaseIdx + 1) % BREATH_PHASES.length;
  }
  nextPhase();
  breathTimer = setInterval(() => {
    secLeft--;
    if (secLeft <= 0) nextPhase();
  }, 1000);
}
function stopBreathTimer() {
  if (breathTimer) { clearInterval(breathTimer); breathTimer = null; }
  $('breath-circle').className = 'breath-circle';
}
function finishBreath() {
  stopBreathTimer();
  $('breath-run').classList.add('hidden');
  $('breath-done').classList.remove('hidden');
}
$('breath-stop').addEventListener('click', finishBreath);
function closeBreath() {
  stopBreathTimer();
  $('breath-overlay').classList.add('hidden');
  if (breathFromWave) { breathFromWave = false; askWaveAfter(); }
}
$('breath-close').addEventListener('click', closeBreath);
$('breath-finish').addEventListener('click', closeBreath);

// ============ グラウンディング ============
const GROUND_STEPS = [
  { num: '🖐️', text: 'これから1分ほどで、考えごとから「いま、ここ」に戻ってきます。\nいすに座って、足の裏を床につけましょう。' },
  { num: '5', text: 'まわりを見わたして、目に見えるものを5つ、心の中でゆっくり数えてください。' },
  { num: '4', text: '手でさわれるものを4つ。服のはだざわり、いすの感触もOKです。' },
  { num: '3', text: '聞こえる音を3つ。エアコンの音、外の音、じぶんの呼吸でも。' },
  { num: '2', text: 'においを2つ。なければ、好きなにおいを2つ思い出してみて。' },
  { num: '1', text: 'さいごに、ゆっくり深呼吸をひとつ。' },
  { num: '🍀', text: 'おかえりなさい。\nあなたはいま、ここにいます。だいじょうぶ。' },
];
let groundIdx = 0;

$('btn-open-ground').addEventListener('click', () => {
  groundIdx = 0;
  renderGround();
  $('ground-overlay').classList.remove('hidden');
});
function renderGround() {
  const s = GROUND_STEPS[groundIdx];
  $('ground-card').innerHTML =
    `<div class="ground-num">${esc(s.num)}</div><div>${esc(s.text).replace(/\n/g, '<br>')}</div>`;
  $('ground-dots').innerHTML = GROUND_STEPS.map((_, i) =>
    `<span class="${i <= groundIdx ? 'on' : ''}"></span>`).join('');
  $('ground-next').textContent = groundIdx === GROUND_STEPS.length - 1 ? 'おわる' : 'つぎへ';
}
$('ground-next').addEventListener('click', () => {
  if (groundIdx >= GROUND_STEPS.length - 1) {
    $('ground-overlay').classList.add('hidden');
  } else {
    groundIdx++;
    renderGround();
  }
});
$('ground-close').addEventListener('click', () => $('ground-overlay').classList.add('hidden'));

// ============ こころの整理ノート ============
let thoughtKind = '';

$('btn-open-thought').addEventListener('click', () => {
  thoughtKind = '';
  $('t-worry').value = '';
  $('t-friend').value = '';
  document.querySelectorAll('#t-kind button').forEach(b => b.classList.remove('on'));
  $('thought-overlay').classList.remove('hidden');
});
$('thought-close').addEventListener('click', () => $('thought-overlay').classList.add('hidden'));

document.querySelectorAll('#t-kind button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#t-kind button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    thoughtKind = btn.dataset.kind;
  });
});

$('thought-save').addEventListener('click', () => {
  const worry = $('t-worry').value.trim();
  if (!worry) { alert('①の心配ごとを書いてみてください'); return; }
  thoughts.unshift({
    id: uid(),
    t: new Date().toISOString(),
    worry,
    kind: thoughtKind,
    friend: $('t-friend').value.trim(),
  });
  persist(KEYS.thoughts, thoughts);
  $('thought-overlay').classList.add('hidden');
  renderAll();
});

function renderThoughts() {
  $('thought-list-wrap').classList.toggle('hidden', thoughts.length === 0);
  $('thought-list').innerHTML = thoughts.map(t => `
    <li>
      <div class="item-date">${fmtDateTime(t.t)}${t.kind ? '　<span class="log-tags">' + esc(t.kind) + '</span>' : ''}</div>
      <div><span class="thought-q">心配:</span> ${esc(t.worry)}</div>
      ${t.friend ? `<div><span class="thought-q">友だちへの声かけ:</span> ${esc(t.friend)}</div>` : ''}
      <button class="item-del" data-id="${t.id}">🗑</button>
    </li>`).join('');
  $('thought-list').querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このノートを削除しますか？')) return;
      thoughts = thoughts.filter(t => t.id !== btn.dataset.id);
      persist(KEYS.thoughts, thoughts);
      renderThoughts();
    });
  });
}

// ============ きろく画面 ============
function renderLogs() {
  $('log-empty').classList.toggle('hidden', logs.length > 0);
  $('chart-card').classList.toggle('hidden', logs.length === 0);

  $('log-list').innerHTML = logs.map(l => {
    const after = (l.after !== null && l.after !== undefined)
      ? `<span class="level-arrow">→</span><span class="level-badge ${levelClass(l.after)}">${l.after}</span>` : '';
    return `<li>
      <div class="item-date">${fmtDateTime(l.t)}</div>
      <div><span class="level-badge ${levelClass(l.level)}">${l.level}</span>${after}
        　<span class="log-tags">${esc((l.tags || []).join(' / '))}</span></div>
      ${l.memo ? `<div>${esc(l.memo)}</div>` : ''}
      <button class="item-del" data-id="${l.id}">🗑</button>
    </li>`;
  }).join('');
  $('log-list').querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この記録を削除しますか？')) return;
      logs = logs.filter(l => l.id !== btn.dataset.id);
      persist(KEYS.logs, logs);
      renderAll();
    });
  });
  renderChart();
}

function renderChart() {
  const svg = $('wave-chart');
  const data = logs.slice(0, 20).reverse(); // 古い→新しい
  if (data.length === 0) { svg.innerHTML = ''; return; }
  const W = 300, H = 120, padX = 10, padY = 12;
  const innerW = W - padX * 2, innerH = H - padY * 2;
  const x = i => data.length === 1 ? W / 2 : padX + (i / (data.length - 1)) * innerW;
  const y = v => padY + (1 - v / 10) * innerH;

  let out = '';
  // 目盛り線
  [0, 5, 10].forEach(v => {
    out += `<line x1="${padX}" y1="${y(v)}" x2="${W - padX}" y2="${y(v)}" stroke="#f0e4e0" stroke-width="1"/>`;
  });
  // 波の線（記録時の強さ）
  if (data.length > 1) {
    const pts = data.map((l, i) => `${x(i)},${y(l.level)}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="#6aa0a0" stroke-width="2" stroke-linejoin="round"/>`;
  }
  // 点: ●=記録時 / ○=おちついた後
  data.forEach((l, i) => {
    out += `<circle cx="${x(i)}" cy="${y(l.level)}" r="4" fill="#6aa0a0"/>`;
    if (l.after !== null && l.after !== undefined) {
      out += `<line x1="${x(i)}" y1="${y(l.level)}" x2="${x(i)}" y2="${y(l.after)}" stroke="#c7dede" stroke-width="1.5"/>`;
      out += `<circle cx="${x(i)}" cy="${y(l.after)}" r="4" fill="#fff" stroke="#6aa0a0" stroke-width="2"/>`;
    }
  });
  svg.innerHTML = out;
}

// ============ けんしん画面 ============
$('btn-next-save').addEventListener('click', () => {
  const d = $('next-date-input').value;
  if (!d) { alert('日付を選んでください'); return; }
  settings.nextDate = d;
  settings.hospital = $('hospital-input').value.trim();
  persist(KEYS.settings, settings);
  renderAll();
});
$('hospital-input').addEventListener('change', () => {
  settings.hospital = $('hospital-input').value.trim();
  persist(KEYS.settings, settings);
});

function addCheckup(result) {
  const date = $('checkup-date-input').value || todayStr();
  checkups.unshift({ id: uid(), date, result, memo: $('checkup-memo-input').value.trim() });
  persist(KEYS.checkups, checkups);
  $('checkup-memo-input').value = '';
  // 記録した検診がいまの「つぎの検診」以降なら、予定をクリアして次を入れてもらう
  if (settings.nextDate && date >= settings.nextDate) {
    delete settings.nextDate;
    persist(KEYS.settings, settings);
  }
  renderAll();
  if (result === 'ok') alert('🎉 「異常なし」を記録しました。おつかれさまでした！\nつぎの検診の予定も入れておきましょう。');
  else alert('記録しました。おつかれさまでした。\nつぎの検診の予定も入れておきましょう。');
}
$('btn-result-ok').addEventListener('click', () => addCheckup('ok'));
$('btn-result-follow').addEventListener('click', () => addCheckup('follow'));

function renderCheckup() {
  // つぎの検診
  const info = $('next-checkup-info');
  if (settings.nextDate) {
    const days = daysUntil(settings.nextDate);
    const d = new Date(settings.nextDate + 'T00:00:00');
    if (days > 0) info.innerHTML = `${fmtDate(d)}　<span class="big">あと${days}日</span>`;
    else if (days === 0) info.innerHTML = `<span class="big">きょうが検診日です</span>`;
    else info.innerHTML = `${fmtDate(d)}（すぎています）<br>下で結果を記録して、つぎの予定を入れましょう`;
    $('next-date-input').value = settings.nextDate;
  } else {
    info.textContent = 'まだ登録されていません';
    $('next-date-input').value = '';
  }
  $('hospital-input').value = settings.hospital || '';
  if (!$('checkup-date-input').value) $('checkup-date-input').value = todayStr();

  // これまでの検診
  $('checkup-history-card').classList.toggle('hidden', checkups.length === 0);
  const okCount = checkups.filter(c => c.result === 'ok').length;
  $('checkup-history-title').textContent =
    `これまでの検診 ${checkups.length}回` + (okCount ? `（異常なし ${okCount}回）` : '');
  const sorted = [...checkups].sort((a, b) => b.date.localeCompare(a.date));
  $('checkup-list').innerHTML = sorted.map(c => `
    <li>
      <div class="item-date">${fmtDate(new Date(c.date + 'T00:00:00'))}</div>
      <div>${c.result === 'ok' ? '😊 異常なし' : '📋 経過観察・その他'}${c.memo ? '　' + esc(c.memo) : ''}</div>
      <button class="item-del" data-id="${c.id}">🗑</button>
    </li>`).join('');
  $('checkup-list').querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この検診記録を削除しますか？')) return;
      checkups = checkups.filter(c => c.id !== btn.dataset.id);
      persist(KEYS.checkups, checkups);
      renderAll();
    });
  });
}

// 先生に聞きたいことメモ
$('btn-symptom-add').addEventListener('click', () => {
  const text = $('symptom-input').value.trim();
  if (!text) return;
  symptoms.unshift({ id: uid(), t: new Date().toISOString(), text, done: false });
  persist(KEYS.symptoms, symptoms);
  $('symptom-input').value = '';
  renderSymptoms();
});

function renderSymptoms() {
  $('symptom-list').innerHTML = symptoms.map(s => `
    <li>
      <label>
        <input type="checkbox" class="symptom-check" data-id="${s.id}" ${s.done ? 'checked' : ''}>
        <span class="${s.done ? 'symptom-done' : ''}">${esc(s.text)}</span>
      </label>
      <div class="item-date">${fmtDateTime(s.t)}${s.done ? '　✅ 聞けた・解決した' : ''}</div>
      <button class="item-del" data-id="${s.id}">🗑</button>
    </li>`).join('');
  $('symptom-list').querySelectorAll('.symptom-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const s = symptoms.find(x => x.id === cb.dataset.id);
      if (s) { s.done = cb.checked; persist(KEYS.symptoms, symptoms); renderSymptoms(); }
    });
  });
  $('symptom-list').querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このメモを削除しますか？')) return;
      symptoms = symptoms.filter(s => s.id !== btn.dataset.id);
      persist(KEYS.symptoms, symptoms);
      renderSymptoms();
    });
  });
}

// ============ おまもり画面 ============
let omamoriIdx = 0;

function renderOmamori() {
  if (omamori.length === 0) {
    $('omamori-display').textContent = 'まだことばがありません。下から追加してみましょう。';
  } else {
    if (omamoriIdx >= omamori.length) omamoriIdx = 0;
    $('omamori-display').textContent = omamori[omamoriIdx].text;
  }
  $('omamori-list').innerHTML = omamori.map(o => `
    <li>${esc(o.text)}<button class="item-del" data-id="${o.id}">🗑</button></li>`).join('');
  $('omamori-list').querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このことばを削除しますか？')) return;
      omamori = omamori.filter(o => o.id !== btn.dataset.id);
      persist(KEYS.omamori, omamori);
      renderOmamori();
    });
  });
}
$('btn-omamori-next').addEventListener('click', () => {
  if (omamori.length > 1) {
    let next;
    do { next = Math.floor(Math.random() * omamori.length); } while (next === omamoriIdx);
    omamoriIdx = next;
  }
  renderOmamori();
});
$('btn-omamori-add').addEventListener('click', () => {
  const text = $('omamori-input').value.trim();
  if (!text) return;
  omamori.unshift({ id: uid(), text });
  persist(KEYS.omamori, omamori);
  $('omamori-input').value = '';
  omamoriIdx = 0;
  renderOmamori();
});

// ============ バックアップ ============
$('btn-backup-save').addEventListener('click', () => {
  const payload = {
    app: 'anshin-note',
    version: 1,
    savedAt: new Date().toISOString(),
    data: { logs, checkups, symptoms, omamori, thoughts, settings },
  };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `anshin-note-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('btn-restore-file').addEventListener('click', () => $('restore-file-input').click());
$('restore-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = JSON.parse(reader.result);
      if (p.app !== 'anshin-note' || !p.data) throw new Error('形式ちがい');
      if (!confirm('いまの記録をバックアップの内容で置きかえます。よろしいですか？')) return;
      Object.entries({
        [KEYS.logs]: p.data.logs, [KEYS.checkups]: p.data.checkups,
        [KEYS.symptoms]: p.data.symptoms, [KEYS.omamori]: p.data.omamori,
        [KEYS.thoughts]: p.data.thoughts, [KEYS.settings]: p.data.settings,
      }).forEach(([k, v]) => { if (v !== undefined) persist(k, v); });
      location.reload();
    } catch (err) {
      alert('復元できませんでした。あんしんノートのバックアップファイルか確認してください。');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ============ 初回ようこそ ============
if (!settings.welcomed) {
  $('welcome-overlay').classList.remove('hidden');
}
$('welcome-start').addEventListener('click', () => {
  settings.welcomed = true;
  persist(KEYS.settings, settings);
  $('welcome-overlay').classList.add('hidden');
});

// ============ 全体描画 ============
function renderAll() {
  renderHome();
  renderLogs();
  renderThoughts();
  renderCheckup();
  renderSymptoms();
  renderOmamori();
}
renderAll();
