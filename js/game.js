// ===== ゲーム本体 =====
'use strict';

const SAVE_KEY = 'pixelAquarium.v1';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.floor(n).toLocaleString('ja-JP');
const now = () => Date.now();
const pick = a => a[Math.floor(Math.random() * a.length)];
const store = {
  get() { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(SAVE_KEY, v); } catch (e) { } },
  del() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } },
};

let S = null;

// ---------- 生成 ----------
function newFriendId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
  return 'AQ-' + s.slice(0, 4) + '-' + s.slice(4);
}
function uid() { return now().toString(36) + Math.random().toString(36).slice(2, 8); }
function growMs(spId) { return RARITY_GROW[SPECIES_MAP[spId].r] * 1000; }
function mkFish(spId, sex, shiny, adult) {
  const g = growMs(spId);
  return { u: uid(), s: spId, x: sex == null ? (Math.random() < 0.5 ? 0 : 1) : sex, h: shiny ? 1 : 0, b: adult ? now() - g : now(), g };
}
function makeTank(type, st, big) {
  st = st || S;
  const n = st.tanks.filter(t => t.type === type && !!t.big === !!big).length + 1;
  const base = big ? WATER[type].name + '大水槽' : WATER[type].full;
  const t = { id: uid(), type, name: base + (n > 1 ? ' ' + n : ''), cap: big ? BIG.cap : 12, lv: 1, fish: [], decos: [] };
  if (big) t.big = 1;
  st.tanks.push(t); return t;
}
function newState() {
  const s = {
    v: 1, id: newFriendId(), name: 'ピクセル水族館', coins: 500, exp: 0, rank: 1,
    tanks: [], box: [], inv: { plant: 1, shell: 1 }, dex: {}, shop: { items: [], next: 0 },
    visitors: [], visits: [], tradesIn: [], tradesOut: [], stamped: {},
    stats: { born: 0, shinyBorn: 0, visitorsTotal: 0, earned: 0 }, created: now(), last: now(), tutorial: 1, res: 2,
  };
  const t = makeTank('fresh', s);
  t.decos = [{ id: 'plant', x: 36, y: 144, s: 0 }, { id: 'rock', x: 184, y: 148, s: 1 }, { id: 'plant2', x: 324, y: 144, s: 2 }, { id: 'plant', x: 272, y: 148, s: 1 }];
  t.fish.push(mkFish('guppy_r', 0, 0, true), mkFish('guppy_r', 1, 0, true), mkFish('neon', 0, 0, true), mkFish('neon', 1, 0, true), mkFish('platy', 1, 0, true));
  t.fish.forEach(f => { s.dex[f.s] = { seen: 1, own: 1 }; });
  return s;
}

// ---------- 計算 ----------
function isAdult(f, t) { return (t || now()) - f.b >= f.g; }
function growth(f) { return Math.min(1, (now() - f.b) / f.g); }
function tankUsed(t) { return t.fish.reduce((a, f) => a + fishWeight(f.s), 0); }
function fishAppeal(f) { return RARITY_APPEAL[SPECIES_MAP[f.s].r] * (f.h ? 5 : 1) * (isAdult(f) ? 1 : 0.5); }
function tankAppeal(t) {
  const fishA = t.fish.reduce((a, f) => a + fishAppeal(f), 0);
  const decoA = t.decos.reduce((a, d) => a + (DECOR_MAP[d.id] ? DECOR_MAP[d.id].appeal : 0), 0);
  const kinds = new Set(t.fish.map(f => f.s)).size;
  return (fishA + Math.min(decoA, fishA * 1.5 + 10)) * (1 + 0.08 * Math.max(0, kinds - 1)) * (t.big ? 1.15 : 1);
}
function totalAppeal() {
  const dexOwn = Object.values(S.dex).filter(d => d.own).length;
  return S.tanks.reduce((a, t) => a + tankAppeal(t), 0) * (1 + dexOwn * 0.004);
}
function visitorsPerMin() { return Math.round(totalAppeal() * 0.8); }
function incomePerSec() { return totalAppeal() * 0.1; }
function tankCost(type, big) { return Math.round(WATER[type].base * (big ? BIG.costMult : 1) * Math.pow(1.45, Math.max(0, S.tanks.length - 1)) / 10) * 10; }
function capCost(t) { return Math.round(300 * Math.pow(t.lv, 1.6) * (1 + WATER_KEYS.indexOf(t.type) * 0.3) * (t.big ? 2 : 1) / 10) * 10; }
function capStep(t) { return t.big ? BIG.step : 6; }
function capMax(t) { return t.big ? BIG.max : 60; }
function fishPrice(spId, shiny) { const sp = SPECIES_MAP[spId]; return Math.round(RARITY_PRICE[sp.r] * (0.8 + 0.12 * fishWeight(spId)) * (shiny ? 8 : 1) / 10) * 10; }
function sellPrice(f) { return Math.round(fishPrice(f.s, f.h) * 0.4 * (isAdult(f) ? 1 : 0.5)); }
function breedBoost(t) { return t.decos.reduce((a, d) => a + ((DECOR_MAP[d.id] || {}).breed || 0), 0); }
function waterUnlocked(type) { return S.rank >= WATER[type].rank; }

function dexMark(spId, what) {
  const d = S.dex[spId] || (S.dex[spId] = {});
  if (what === 'own' && !d.own) {
    d.own = 1; d.seen = 1;
    const r = SPECIES_MAP[spId].r; gainExp(30 * r * r);
    toast(`<img class="px" src="${spriteURL(spId)}"> 図鑑に「${esc(SPECIES_MAP[spId].name)}」が登録された！`, 'good');
  }
  if (what === 'shiny' && !d.shiny) { d.shiny = 1; d.seen = 1; d.own = d.own || 1; }
  if (what === 'seen') d.seen = 1;
}
function gainExp(n) {
  S.exp += n;
  while (S.exp >= rankNeed(S.rank)) {
    S.exp -= rankNeed(S.rank); S.rank++;
    const opened = WATER_KEYS.filter(k => WATER[k].rank === S.rank).map(k => WATER[k].full);
    toast(`⭐ ランク${S.rank}「${rankTitle(S.rank)}」になった！` + (opened.length ? `<br>${opened.join('・')}が建てられるようになった！` : '') + (maxRarityForRank(S.rank) > maxRarityForRank(S.rank - 1) ? '<br>ショップにレアな魚が入荷するようになった！' : ''), 'good', 5000);
    refreshShop(true);
  }
}

// ---------- 魚の配置 ----------
function canEnter(t, spId) { const sp = SPECIES_MAP[spId]; return t.type === sp.w && (!sp.o.bigOnly || !!t.big); }
function findTankFor(spId, exceptId) {
  const w = fishWeight(spId);
  return S.tanks.find(t => canEnter(t, spId) && t.id !== exceptId && tankUsed(t) + w <= t.cap);
}
function placeFish(f, tank) {
  if (!tank) tank = findTankFor(f.s);
  if (tank && canEnter(tank, f.s) && tankUsed(tank) + fishWeight(f.s) <= tank.cap) { tank.fish.push(f); return tank; }
  S.box.push(f); return null;
}
function removeFish(u) {
  for (const t of S.tanks) { const i = t.fish.findIndex(f => f.u === u); if (i >= 0) return t.fish.splice(i, 1)[0]; }
  const i = S.box.findIndex(f => f.u === u); if (i >= 0) return S.box.splice(i, 1)[0];
  return null;
}
function findFish(u) { for (const t of S.tanks) { const f = t.fish.find(f => f.u === u); if (f) return { f, t }; } const f = S.box.find(f => f.u === u); return f ? { f, t: null } : null; }

// ---------- ショップ ----------
function refreshShop(force) {
  if (!force && now() < S.shop.next) return;
  const mr = maxRarityForRank(S.rank);
  const pool = SPECIES.filter(sp => waterUnlocked(sp.w) && sp.r <= mr);
  const items = []; const used = new Set();
  const slots = 8 + Math.min(4, Math.floor(S.rank / 2));
  // 序盤は持っている水槽の水質を優先
  for (let i = 0; i < slots && used.size < pool.length; i++) {
    const cand = pool.filter(sp => !used.has(sp.id));
    const tot = cand.reduce((a, sp) => a + RARITY_WEIGHT[sp.r] * (S.tanks.some(t => t.type === sp.w) ? 1.6 : 1), 0);
    let r = Math.random() * tot, sel = cand[0];
    for (const sp of cand) { r -= RARITY_WEIGHT[sp.r] * (S.tanks.some(t => t.type === sp.w) ? 1.6 : 1); if (r <= 0) { sel = sp; break; } }
    used.add(sel.id);
    const sh = Math.random() < SHINY_RATE.shop ? 1 : 0;
    items.push({ s: sel.id, h: sh });
    dexMark(sel.id, 'seen');
  }
  items.sort((a, b) => SPECIES_MAP[a.s].idx - SPECIES_MAP[b.s].idx);
  S.shop.items = items; S.shop.next = now() + 5 * 60 * 1000;
  if (currentView === 'shop') renderShop();
}
function buyFish(i, sex) {
  const it = S.shop.items[i]; if (!it) return;
  const price = fishPrice(it.s, it.h);
  if (S.coins < price) return toast('コインが足りません', 'bad');
  S.coins -= price;
  const f = mkFish(it.s, sex, it.h, true);
  const t = placeFish(f);
  dexMark(f.s, 'own'); if (f.h) dexMark(f.s, 'shiny');
  if (it.h) S.shop.items.splice(i, 1);
  toast(`<img class="px" src="${spriteURL(f.s, f.h)}"> ${esc(SPECIES_MAP[f.s].name)}${sex ? '♀' : '♂'}を購入！` + (t ? `→ ${esc(t.name)}` : '<br>入れられる水槽がないので<b>待機BOX</b>に入りました'), t ? '' : 'bad', 3500);
  save(); renderShop(); renderAquarium();
}
function buyDecor(id) {
  const d = DECOR_MAP[id]; if (S.coins < d.price) return toast('コインが足りません', 'bad');
  S.coins -= d.price; S.inv[id] = (S.inv[id] || 0) + 1;
  toast(`<img class="px" src="${decorURL(id)}"> ${esc(d.name)}を購入！水槽を開いて飾りつけしよう`);
  save(); renderShop();
}
function buyTank(type, big) {
  if (!waterUnlocked(type) || (big && S.rank < BIG.rank)) return;
  if (S.tanks.length >= 20) return toast('ブースはこれ以上建てられません', 'bad');
  const c = tankCost(type, big); if (S.coins < c) return toast('コインが足りません', 'bad');
  S.coins -= c; const t = makeTank(type, S, big);
  toast(`🏗️ ${esc(t.name)}を建てた！`, 'good');
  // 待機BOXから自動で入れる
  S.box.slice().forEach(f => { if (canEnter(t, f.s) && tankUsed(t) + fishWeight(f.s) <= t.cap) { S.box.splice(S.box.indexOf(f), 1); t.fish.push(f); } });
  save(); renderAquarium(); renderShop();
}

// ---------- 繁殖 ----------
function breedTick() {
  const t0 = now();
  for (const t of S.tanks) {
    const groups = {};
    t.fish.forEach(f => { if (!isAdult(f, t0)) return; const g = groups[f.s] || (groups[f.s] = { m: [], f: [] }); (f.x ? g.f : g.m).push(f); });
    const boost = 1 + Math.min(1, breedBoost(t));
    const keys = Object.keys(groups).sort(() => Math.random() - 0.5);
    for (const k of keys) {
      const g = groups[k]; if (!g.m.length || !g.f.length) continue;
      if (tankUsed(t) + fishWeight(k) > t.cap) continue;
      const pairs = Math.min(g.m.length, g.f.length, 3);
      if (Math.random() > RARITY_BREED[SPECIES_MAP[k].r] * boost * (1 + (pairs - 1) * 0.4)) continue;
      const pa = pick(g.m), pb = pick(g.f);
      const shinyRate = (pa.h && pb.h) ? SHINY_RATE.bothParents : (pa.h || pb.h) ? SHINY_RATE.oneParent : SHINY_RATE.base;
      const baby = mkFish(k, null, Math.random() < shinyRate, false);
      t.fish.push(baby); S.stats.born++;
      if (baby.h) { S.stats.shinyBorn++; dexMark(k, 'shiny'); }
      dexMark(k, 'own');
      toast(`<img class="px" src="${spriteURL(k, baby.h)}"> ${esc(t.name)}で${esc(SPECIES_MAP[k].name)}の赤ちゃんが生まれた！` + (baby.h ? '<br>✨<b>色違いだ！</b>✨' : ''), baby.h ? 'shiny' : 'good', baby.h ? 6000 : 3500);
      gainExp(10 * SPECIES_MAP[k].r);
      if (openTankId === t.id) renderTankModalLists();
      renderAquariumHeads();
      break; // 1水槽につき1回
    }
  }
}

// ---------- 経済ループ ----------
let lastTick = now(), breedAcc = 0;
function tick() {
  const t = now(); const dt = Math.min(5, (t - lastTick) / 1000); lastTick = t;
  const inc = incomePerSec() * dt;
  S.coins += inc; S.stats.earned += inc; S.stats.visitorsTotal += visitorsPerMin() / 60 * dt;
  gainExp(totalAppeal() * 0.15 * dt);
  breedAcc += dt; if (breedAcc >= 10) { breedAcc = 0; breedTick(); }
  refreshShop(false);
  S.last = t;
  renderHUD();
  if (currentView === 'shop') updateShopTimer();
  if (openTankId) updateTankModalStats();
}
// ---------- 保存（localStorage ＋ IndexedDB の二重保存） ----------
const IDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      try {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('pixelAquarium', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(this._db = r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  },
  async get(k) { try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async tx(fn) { try { const db = await this.open(); return await new Promise(res => { const t = db.transaction('kv', 'readwrite'); fn(t.objectStore('kv')); t.oncomplete = () => res(true); t.onerror = t.onabort = () => res(false); }); } catch (e) { return false; } },
  set(k, v) { return this.tx(st => st.put(v, k)); },
  del(k) { return this.tx(st => st.delete(k)); },
};
let storageOK = true, resetting = false, restoredFromIDB = false;
function save() {
  if (resetting || !S) return;
  S.last = now(); const json = JSON.stringify(S);
  try { localStorage.setItem(SAVE_KEY, json); storageOK = localStorage.getItem(SAVE_KEY) === json; } catch (e) { storageOK = false; }
  IDB.set('save', json);
  const day = new Date().toDateString();
  if (S._dailyDay !== day) { S._dailyDay = day; IDB.set('daily', json); }
}
function parseSave(raw) { if (!raw) return null; try { const d = JSON.parse(raw); return d && d.tanks ? d : null; } catch (e) { return null; } }
async function load() {
  const a = parseSave(store.get()), b = parseSave(await IDB.get('save')) || parseSave(await IDB.get('daily'));
  S = a && b ? ((b.last || 0) > (a.last || 0) + 2000 ? b : a) : (a || b);
  if (!a && b) restoredFromIDB = true;
  if (!S) { S = newState(); return; }
  // 互換
  S.box = S.box || []; S.inv = S.inv || {}; S.dex = S.dex || {}; S.visitors = S.visitors || []; S.visits = S.visits || [];
  S.tradesIn = S.tradesIn || []; S.tradesOut = S.tradesOut || []; S.stamped = S.stamped || {}; S.stats = S.stats || {};
  S.tanks.forEach(t => { t.fish = t.fish.filter(f => SPECIES_MAP[f.s]); t.decos = t.decos.filter(d => DECOR_MAP[d.id]); });
  if (S.res !== 2) { S.tanks.forEach(t => t.decos.forEach(d => { d.x *= 2; d.y *= 2; })); S.res = 2; } // 高精細化前のセーブを変換
  // オフライン収入
  const away = Math.min(8 * 3600, (now() - (S.last || now())) / 1000);
  if (away > 60) {
    const g = incomePerSec() * away * 0.5;
    S.coins += g; S.stats.earned = (S.stats.earned || 0) + g; gainExp(totalAppeal() * 0.15 * away * 0.5);
    setTimeout(() => toast(`🌙 おかえりなさい！留守のあいだに <b>${fmt(g)}</b> コインの収入がありました`, 'good', 5000), 600);
  }
}
async function wipeAll() { resetting = true; store.del(); await IDB.del('save'); await IDB.del('daily'); }
async function overwriteSave(data) { // バックアップ復元：両方の保存先を書き換えてから再読み込み
  resetting = true; data.last = now(); const json = JSON.stringify(data);
  try { localStorage.setItem(SAVE_KEY, json); } catch (e) { }
  await IDB.set('save', json); await IDB.set('daily', json);
  location.reload();
}
function requestPersist() {
  if (S.persistAsked || !navigator.storage || !navigator.storage.persist) return;
  S.persistAsked = 1;
  navigator.storage.persist().then(r => { S.persisted = r ? 1 : 0; save(); }).catch(() => { });
}

// ---------- 環境チェック ----------
const ENV = {
  iframe: (() => { try { return window.self !== window.top; } catch (e) { return true; } })(),
  inApp: /Line\/|FBAN|FBAV|Instagram|Twitter|Discord|KAKAOTALK|MicroMessenger/i.test(navigator.userAgent),
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  standalone: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
};
function daysSince(t) { return t ? (now() - t) / 86400000 : Infinity; }

// ---------- バックアップ ----------
async function backupCode() { save(); const code = await encodeCode('B', S); S.lastBackup = now(); save(); return code; }
async function backupToFile() {
  const code = await backupCode();
  const d = new Date(), name = `pixel-aquarium-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.txt`;
  const blob = new Blob([code], { type: 'text/plain' });
  try {
    const file = new File([blob], name, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'ピクセル水族館のバックアップ' }); toast('💾 バックアップを保存しました'); renderAquariumIfOpen(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('💾 バックアップファイルを保存しました（「ファイル」アプリやダウンロードに入ります）', 'good', 4000);
  renderAquariumIfOpen();
}
async function backupToClipboard() { const code = await backupCode(); await copyText(code); toast('📋 バックアップコードをコピーしました。メモアプリやLINEのKeepなどに貼っておこう', 'good', 4500); renderAquariumIfOpen(); }
async function restoreBackupText(text) {
  const r = await decodeCode(text, 'B'); if (!r.data || !r.data.tanks) throw new Error('データが不完全です');
  const fishN = r.data.tanks.reduce((a, t) => a + t.fish.length, 0) + (r.data.box || []).length;
  if (!await askConfirm(`「${r.data.name}」（Rank${r.data.rank}・魚${fishN}匹・${r.data.last ? new Date(r.data.last).toLocaleString('ja-JP') : '?'}保存）に戻します。\n今のデータは上書きされます。よろしいですか？`)) return;
  await overwriteSave(r.data);
}
function pickBackupFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,text/plain';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await restoreBackupText(await f.text()); } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); } };
  inp.click();
}
function renderAquariumIfOpen() { if (currentView === 'aquarium') renderAquarium(); if (currentView === 'settings') renderSettings(); }

// ---------- 注意バナー ----------
function storageBanners() {
  let h = '';
  if (ENV.iframe) h += `<div class="warn">⚠️ 埋め込み表示（プレビュー）で開いています。ここではデータが<b>ブラウザを閉じると消える</b>ことがあります。GitHub Pagesのページを直接開いて遊んでください。</div>`;
  if (ENV.inApp) h += `<div class="warn">⚠️ LINEなどの<b>アプリ内ブラウザ</b>で開いています。ここのデータはSafari・Chromeとは別の場所に保存され、消えやすいです。メニューの「ブラウザで開く」からSafariかChromeで開いてください。</div>`;
  if (!storageOK) h += `<div class="warn">⚠️ このブラウザではデータを保存できていません（プライベートモードかもしれません）。通常のタブで開いてください。</div>`;
  const played = daysSince(S.created) > 0.04; // 1時間ほど遊んだら
  if (played && daysSince(S.lastBackup) > 3 && daysSince(S.snoozeBackup) > 1) {
    h += `<div class="panel backup-nag"><h2>💾 データのバックアップ</h2><p>${S.lastBackup ? `最後のバックアップから<b>${Math.floor(daysSince(S.lastBackup))}日</b>たちました。` : 'まだバックアップがありません。'}データはこの端末のブラウザの中だけに保存されています。iPhoneではしばらく開かないと消えることがあるので、ときどき保存しておきましょう。</p>
      <div class="row"><button class="btn blue" id="nagFile">📁 ファイルに保存</button><button class="btn" id="nagCopy">📋 コードをコピー</button><span class="spacer"></span><button class="btn small" id="nagLater">あとで</button></div></div>`;
  }
  if (ENV.ios && !ENV.standalone && !ENV.inApp && !ENV.iframe && daysSince(S.snoozeHome) > 7) {
    h += `<div class="hint">📱 <b>ホーム画面に追加</b>してそこから遊ぶと、データが自動で消されにくくなります。 <button class="btn small" id="homeHow">やり方</button> <button class="btn small" id="homeLater">閉じる</button></div>`;
  }
  return h;
}
function bindStorageBanners(el) {
  const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
  on('nagFile', backupToFile); on('nagCopy', backupToClipboard);
  on('nagLater', () => { S.snoozeBackup = now(); save(); renderAquarium(); });
  on('homeLater', () => { S.snoozeHome = now(); save(); renderAquarium(); });
  on('homeHow', showHomeScreenHowTo);
}
function showHomeScreenHowTo() {
  openModal(`<h2>📱 ホーム画面に追加する</h2>
    <ol class="help"><li><b>Chrome</b>：アドレスバー右の共有ボタン（□に↑）→「ホーム画面に追加」</li>
    <li><b>Safari</b>：画面下の共有ボタン（□に↑）→「ホーム画面に追加」</li>
    <li>ホーム画面にできた「ピクセル水族館」のアイコンから遊びます。</li></ol>
    <div class="warn">⚠️ ホーム画面のアプリは、ブラウザとは<b>別の保存場所</b>になります。今のデータを持っていくには：<br>① ここで「ファイルに保存」か「コードをコピー」 → ② ホーム画面のアプリを開いて 設定 →「バックアップから復元」</div>
    <div class="row" style="margin-top:10px"><button class="btn blue" id="hwFile">📁 ファイルに保存</button><button class="btn" id="hwCopy">📋 コードをコピー</button></div>`, true);
  $('#hwFile').onclick = backupToFile; $('#hwCopy').onclick = backupToClipboard;
}

// ========== 描画（水槽） ==========
const BEHAVIOR = sp => {
  if (sp.o.stand) return 'amph';
  if (sp.shape === 'seaotter') return 'float';
  if (['crab', 'isopod', 'shrimp'].includes(sp.shape)) return 'bottom';
  if (sp.o.bottom || (PRE[sp.shape] && PRE[sp.shape].bottom)) return 'bottom';
  if (sp.id === 'chinanago') return 'garden';
  if (['jelly', 'dumbo'].includes(sp.shape)) return 'drift';
  if (sp.shape === 'seahorse') return 'hover';
  return 'swim';
};
const SPEED = sp => ({ slim: 16, tuna: 20, shark: 13, tiny: 13, guppy: 11, tall: 8, round: 6, ranchu: 5, puffer: 6, box: 6, angel: 7, betta: 6, eel: 8, long: 9, big: 9, ray: 9, turtle: 7, squid: 10,
  penguin: 18, otter: 14, dolphin: 22, porpoise: 16, whale: 12, orca: 18, seal: 13, manatee: 6 }[sp.shape] || 10);

class TankView {
  constructor(canvas, tank, opt) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.tank = tank; this.opt = opt || {}; this.ents = new Map(); this.bubbles = []; this.selected = null;
    this.placing = null; this.mouse = null; this.removeMode = false;
    this.d = tankDims(tank.type, tank.big);
    canvas.width = this.d.W; canvas.height = this.d.H; canvas.style.aspectRatio = this.d.W + ' / ' + this.d.H;
    if (this.opt.interactive) {
      canvas.classList.add('big-canvas');
      canvas.addEventListener('mousemove', e => this.mouse = this.toLocal(e));
      canvas.addEventListener('mouseleave', () => this.mouse = null);
      canvas.addEventListener('click', e => this.onClick(this.toLocal(e)));
    }
    VIEWS.add(this);
  }
  toLocal(e) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * this.d.W, y: (e.clientY - r.top) / r.height * this.d.H }; }
  decoY(y) { return Math.max(this.d.SY + 4 * D, Math.min(this.d.H - 1, y + 6 * D)); }
  onClick(p) {
    if (this.placing) { this.opt.onPlace && this.opt.onPlace(this.placing, Math.round(p.x), Math.round(this.decoY(p.y))); return; }
    if (this.removeMode) {
      let best = null, bd = 60;
      this.tank.decos.forEach((d, i) => { const s = getDecorSprite(d.id, 0, d.s); const cx = d.x, cy = d.y - s.height / 2; const dd = Math.hypot(cx - p.x, (cy - p.y) * 0.7); if (dd < bd + s.width / 3) { bd = dd; best = i; } });
      if (best != null) this.opt.onRemoveDecor && this.opt.onRemoveDecor(best);
      return;
    }
    let hit = null;
    for (const e of this.ents.values()) { if (p.x >= e.x - 4 && p.x <= e.x + e.w + 4 && p.y >= e.y - 4 && p.y <= e.y + e.h + 4) hit = e; }
    this.selected = hit ? hit.f.u : null;
    this.opt.onSelect && this.opt.onSelect(this.selected);
  }
  spriteOf(e, frame) {
    if (e.mode === 'land') return getStandSprite(e.f.s, e.f.h, frame, e.dir < 0);
    return e.dir > 0 ? getFishSprite(e.f.s, e.f.h, frame) : getFishFlip(e.f.s, e.f.h, frame);
  }
  makeEnt(f) {
    const sp = SPECIES_MAP[f.s];
    const e = { f, sp, beh: BEHAVIOR(sp), spd: SPEED(sp) * D * (0.8 + Math.random() * 0.4), ph: Math.random() * 10, dir: Math.random() < 0.5 ? 1 : -1, wait: 0, mode: 'swim', modeT: 4 + Math.random() * 10 };
    if (e.beh === 'amph' && this.d.WY && Math.random() < 0.45) e.mode = 'land';
    this.size(e);
    e.x = e.mode === 'land' ? 4 + Math.random() * Math.max(1, this.d.landW - e.w - 8) : 4 * D + Math.random() * Math.max(1, this.d.W - e.w - 8 * D);
    e.y = this.randY(e); this.newTarget(e); return e;
  }
  size(e) {
    const spr = e.mode === 'land' ? getStandSprite(e.f.s, e.f.h, 0) : getFishSprite(e.f.s, e.f.h, 0);
    const sc = isAdult(e.f) ? 1 : 0.55 + 0.45 * growth(e.f); e.sc = sc;
    e.w = Math.max(3, Math.round(spr.width * sc)); e.h = Math.max(3, Math.round(spr.height * sc));
  }
  topY() { return this.d.WY ? this.d.WY + 5 : 4 * D; }
  landY(e) { return this.d.landY - e.h + 3; }
  randY(e) {
    const d = this.d;
    if (e.mode === 'land') return this.landY(e);
    if (e.beh === 'float') return (d.WY || 4) - e.h * 0.5;
    if (e.beh === 'bottom' || e.beh === 'garden') return d.SY + 5 * D - e.h + Math.random() * 6 * D;
    if (e.beh === 'drift') return this.topY() + Math.random() * Math.max(1, d.SY - e.h - 14 * D - this.topY());
    return this.topY() + Math.random() * Math.max(1, d.SY - e.h - this.topY());
  }
  newTarget(e) {
    const maxX = Math.max(4, this.d.W - e.w - 4);
    if (e.mode === 'land') { e.tx = 2 + Math.random() * Math.max(1, this.d.landW - e.w - 6); e.ty = this.landY(e); e.wait = 1 + Math.random() * 4; return; }
    if (e.beh === 'garden') { e.tx = e.x; e.ty = e.y; e.wait = 3; return; }
    if (e.beh === 'float') { e.tx = Math.max(4, Math.min(maxX, e.x + (Math.random() - 0.5) * 120)); e.ty = this.randY(e); e.wait = 2 + Math.random() * 4; return; }
    if (e.beh === 'bottom') { e.tx = Math.max(4, Math.min(maxX, e.x + (Math.random() - 0.5) * 80 * D)); e.ty = this.d.SY + 5 * D - e.h + Math.random() * 6 * D; e.wait = 0.5 + Math.random() * 3; return; }
    if (e.beh === 'drift' || e.beh === 'hover') { e.tx = Math.max(4, Math.min(maxX, e.x + (Math.random() - 0.5) * 60 * D)); e.ty = this.randY(e); e.wait = Math.random() * 2; return; }
    e.tx = 4 + Math.random() * (maxX - 4); e.ty = this.randY(e); e.wait = Math.random() < 0.3 ? Math.random() * 1.5 : 0;
  }
  splash(x) { for (let i = 0; i < 8; i++) this.bubbles.push({ x: x + (Math.random() - 0.5) * 16, y: this.d.WY + 6 + Math.random() * 10, r: 1 + Math.floor(Math.random() * 2), v: 30 + Math.random() * 20, ph: Math.random() * 6, top: this.d.WY + 2 }); }
  switchMode(e) {
    const toLand = e.mode === 'swim';
    if (toLand) this.splash(Math.min(e.x + e.w / 2, this.d.landW));
    e.mode = toLand ? 'land' : 'swim'; this.size(e);
    if (toLand) { e.x = Math.max(2, Math.min(this.d.landW - e.w - 4, e.x)); e.y = this.landY(e); }
    else { e.x = Math.min(this.d.W - e.w - 4, this.d.landW + 4); e.y = this.topY() + 4; e.dir = 1; this.splash(e.x); }
    e.modeT = 6 + Math.random() * 12; this.newTarget(e);
  }
  sync() {
    const live = new Set(this.tank.fish.map(f => f.u));
    for (const u of this.ents.keys()) if (!live.has(u)) this.ents.delete(u);
    for (const f of this.tank.fish) if (!this.ents.has(f.u)) this.ents.set(f.u, this.makeEnt(f));
  }
  update(dt, time) {
    this.sync();
    for (const e of this.ents.values()) {
      if (Math.random() < 0.01) this.size(e);
      if (e.beh === 'amph' && this.d.WY) { e.modeT -= dt; if (e.modeT <= 0) { if (Math.random() < 0.6) this.switchMode(e); else e.modeT = 5 + Math.random() * 8; } }
      if (e.wait > 0) { e.wait -= dt; continue; }
      const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
      if (d < 1.5 * D) { this.newTarget(e); continue; }
      let sp = e.spd * (e.sc < 1 ? 0.8 : 1);
      if (e.mode === 'land') sp = 5 * D;
      else if (e.beh === 'float') sp = 2.5 * D;
      else if (e.beh === 'drift') sp = (2 + Math.max(0, Math.sin(time * 1.6 + e.ph)) * 6) * D;
      else if (e.beh === 'hover') sp = 3 * D;
      else if (e.beh === 'bottom') sp = Math.min(sp, (e.sp.shape === 'jelly' ? 1 : 6) * D);
      const step = Math.min(d, sp * dt);
      e.x += dx / d * step; e.y += dy / d * step * (e.beh === 'swim' || e.beh === 'amph' ? 0.6 : 1);
      if (Math.abs(dx) > 1 && e.beh !== 'drift' && e.sp.shape !== 'crab') e.dir = dx > 0 ? 1 : -1;
    }
    const W = this.d.W, SY = this.d.SY;
    this.tank.decos.filter(d => d.id === 'bubble').forEach(d => { if (Math.random() < dt * 3) this.bubbles.push({ x: d.x + (Math.random() * 8 - 4), y: d.y - 8, r: 1 + Math.floor(Math.random() * 3), v: (14 + Math.random() * 8) * D, ph: Math.random() * 6 }); });
    if (Math.random() < dt * 0.6 * W / 360) this.bubbles.push({ x: Math.random() * W, y: SY, r: 1, v: (10 + Math.random() * 6) * D, ph: Math.random() * 6 });
    for (const b of this.bubbles) b.y -= b.v * dt;
    const surf = this.d.WY + 4;
    this.bubbles = this.bubbles.filter(b => b.y > (b.top || surf)).slice(-90);
  }
  draw(time) {
    const c = this.ctx, d0 = this.d; c.imageSmoothingEnabled = false;
    c.drawImage(getTankBG(this.tank.type, this.tank.big), 0, 0);
    const fr = Math.floor(time * 1.2) % 2;
    for (const d of this.tank.decos.slice().sort((a, b) => a.y - b.y)) {
      const s = getDecorSprite(d.id, fr, d.s);
      if (d.id === 'lamp') { const g = c.createRadialGradient(d.x, d.y - s.height + 6, 2, d.x, d.y - s.height + 6, 44); g.addColorStop(0, 'rgba(255,240,150,.45)'); g.addColorStop(1, 'rgba(255,240,150,0)'); c.fillStyle = g; c.fillRect(d.x - 48, d.y - s.height - 44, 96, 96); }
      c.drawImage(s, Math.round(d.x - s.width / 2), Math.round(d.y - s.height));
    }
    const ents = Array.from(this.ents.values()).sort((a, b) => (a.y + a.h) - (b.y + b.h));
    for (const e of ents) {
      const fframe = e.mode === 'land' ? (e.wait > 0 ? 0 : Math.floor(time * 4 + e.ph) % 2) : Math.floor(time * (2 + e.spd / 5 / D) + e.ph) % 2;
      const spr = this.spriteOf(e, fframe);
      let y = e.y;
      if (e.beh === 'swim' || e.beh === 'hover' || (e.beh === 'amph' && e.mode === 'swim')) y += Math.sin(time * 2 + e.ph) * 0.8;
      if (e.beh === 'float') y += Math.sin(time * 1.4 + e.ph) * 1.5;
      if (e.beh === 'garden') y += Math.sin(time * 0.6 + e.ph) * 2 * D;
      if (e.beh === 'drift') y += Math.sin(time * 1.6 + e.ph) * D;
      if (e.mode === 'land' && fframe) y -= 1;
      const x = Math.round(e.x), yy = Math.round(y);
      if (e.sp.o.lure) { const lx = e.dir > 0 ? x + Math.round(e.w * 0.7) : x + Math.round(e.w * 0.3); const g = c.createRadialGradient(lx, yy + 4, 0, lx, yy + 4, 20); g.addColorStop(0, 'rgba(255,245,150,.6)'); g.addColorStop(1, 'rgba(255,245,150,0)'); c.fillStyle = g; c.fillRect(lx - 20, yy - 16, 40, 40); }
      c.drawImage(spr, x, yy, e.w, e.h);
      if (e.f.h && ((time * 1.5 + e.ph) % 2.2) < 0.35) {
        const sx = x + ((e.ph * 7) % e.w | 0), sy = yy + ((e.ph * 3) % e.h | 0);
        c.fillStyle = '#fffbe0'; c.fillRect(sx, sy - 2, 1, 5); c.fillRect(sx - 2, sy, 5, 1); c.fillRect(sx - 1, sy - 1, 3, 3);
      }
      if (this.selected === e.f.u) {
        const ax = x + (e.w >> 1), ay = yy - 10 + Math.round(Math.sin(time * 6) * 2);
        c.fillStyle = '#1d2340'; c.fillRect(ax - 5, ay - 1, 11, 1); c.fillStyle = '#ffe23a'; for (let i = 0; i < 5; i++) c.fillRect(ax - 4 + i, ay + i, 9 - i * 2, 1);
      }
    }
    c.fillStyle = 'rgba(235,250,255,.85)';
    for (const b of this.bubbles) {
      const bx = Math.round(b.x + Math.sin(b.y * 0.08 + b.ph) * 2.4), by = Math.round(b.y);
      for (const [dx, dy] of BUBBLE_RINGS[b.r]) c.fillRect(bx + dx, by + dy, 1, 1);
      c.fillRect(bx - b.r + 1, by - b.r + 1, 1, 1);
    }
    if (this.tank.type === 'deep') { c.fillStyle = 'rgba(0,0,20,.12)'; c.fillRect(0, 0, d0.W, d0.H); }
    if (this.placing && this.mouse) {
      const s = getDecorSprite(this.placing, 0, 0); const y = this.decoY(this.mouse.y);
      c.globalAlpha = 0.6; c.drawImage(s, Math.round(this.mouse.x - s.width / 2), Math.round(y - s.height)); c.globalAlpha = 1;
    }
    if (this.removeMode) { c.fillStyle = 'rgba(255,60,60,.12)'; c.fillRect(0, 0, d0.W, d0.H); }
  }
}
// 泡の輪（半径ごとのピクセル）
const BUBBLE_RINGS = [[], [], [], []].map((_, r) => { const pts = []; if (!r) return pts; for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) { const d = Math.hypot(x, y); if (d > r - 0.5 && d <= r + 0.5) pts.push([x, y]); } return pts; });
const VIEWS = new Set();
let lastFrame = performance.now();
function frameLoop(ts) {
  const dt = Math.min(0.1, (ts - lastFrame) / 1000); lastFrame = ts; const time = ts / 1000;
  for (const v of VIEWS) {
    if (!v.cv.isConnected) { VIEWS.delete(v); continue; }
    if (v.cv.offsetParent === null) continue;
    v.update(dt, time); v.draw(time);
  }
  requestAnimationFrame(frameLoop);
}

// ========== UI ==========
let currentView = 'aquarium';
function toast(html, cls, ms) {
  const el = document.createElement('div'); el.className = 'toast ' + (cls || ''); el.innerHTML = html;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = 0; setTimeout(() => el.remove(), 400); }, ms || 2800);
}
function openModal(html, narrow) {
  $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden');
  $('.modal-box').classList.toggle('narrow', !!narrow); $('#modal').scrollTop = 0;
  return $('#modalBody');
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; openTankId = null; tankModalView = null; }

// ---------- 確認ダイアログ（confirm/prompt の代わり） ----------
function askDialog(html, withInput, def) {
  return new Promise(res => {
    const d = $('#dlg'); d.classList.remove('hidden');
    $('#dlgBox').innerHTML = `<p style="margin:0 0 12px;line-height:1.6">${html}</p>` + (withInput ? `<input type="text" id="dlgIn" maxlength="20" value="${esc(def || '')}">` : '') +
      `<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" id="dlgNo">キャンセル</button><button class="btn blue" id="dlgYes">OK</button></div>`;
    const inp = $('#dlgIn'); if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') done(true); }; }
    const done = ok => { d.classList.add('hidden'); res(withInput ? (ok ? $('#dlgIn').value : null) : ok); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false);
  });
}
const askConfirm = msg => askDialog(esc(msg).replace(/\n/g, '<br>'));
const askText = (title, def) => askDialog(esc(title), true, def);
function stars(r) { return '<span class="stars">' + '★'.repeat(r) + '</span>'; }
function wbadge(w) { return `<span class="badge w-${w}">${WATER[w].icon} ${WATER[w].name}</span>`; }
function sexMark(x) { return x ? '<span class="female">♀</span>' : '<span class="male">♂</span>'; }
function fishImg(f, scale) { return `<img class="px" src="${spriteURL(f.s, f.h, false, scale > 2 ? 2 : 1)}" alt="">`; }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('📋 コピーしました'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('📋 コピーしました'); } catch (e2) { toast('コピーできませんでした。手動で選択してください', 'bad'); } ta.remove(); }
}
function baseURL() { return location.href.split('#')[0]; }

function setView(v) {
  currentView = v;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  ({ aquarium: renderAquarium, shop: renderShop, dex: renderDex, friend: renderFriend, settings: renderSettings })[v]();
  window.scrollTo(0, 0);
}

function renderHUD() {
  $('#coins').textContent = fmt(S.coins);
  $('#visitors').textContent = fmt(visitorsPerMin());
  $('#rank').textContent = S.rank;
  $('#rankBar').style.width = Math.min(100, S.exp / rankNeed(S.rank) * 100) + '%';
  $('#rankTitle').textContent = rankTitle(S.rank) + ' ・ 収入 ' + incomePerSec().toFixed(1) + '/秒';
  $('#aqName').textContent = S.name;
}

// ---------- 水族館 ----------
let reorderMode = false;
const boxSel = new Set();
function renderAquarium() {
  const el = $('#view-aquarium');
  let html = storageBanners();
  if (S.tutorial) html += `<div class="panel"><h2>🐟 ようこそ、館長！</h2><p>水槽をタップすると中の魚や飾りを管理できます。オスとメスがそろうと<b>繁殖</b>し、ごくまれに<b>色違い</b>が生まれます。<br>来館者からの入館料でコインを稼ぎ、<b>ショップ</b>で魚やブースを増やして、図鑑の完成を目指しましょう！</p><button class="btn small" id="tutOk">わかった！</button></div>`;
  for (const u of boxSel) if (!S.box.some(f => f.u === u)) boxSel.delete(u);
  if (S.box.length) {
    const selTotal = S.box.filter(f => boxSel.has(f.u)).reduce((a, f) => a + sellPrice(f), 0);
    html += `<div class="panel"><h2>📦 待機BOX <small class="muted">（${S.box.length}匹が水槽に入るのを待っています）</small></h2>
      <div class="row bulkbar"><button class="btn blue" id="boxAuto">📥 まとめて水槽へ入れる</button>
        <label class="ck"><input type="checkbox" id="boxAll" ${boxSel.size && boxSel.size === S.box.length ? 'checked' : ''}> すべて選択</label>
        <span class="spacer"></span><span class="muted">${boxSel.size ? `${boxSel.size}匹選択中・🪙${fmt(selTotal)}` : ''}</span>
        <button class="btn primary" id="boxSell" ${boxSel.size ? '' : 'disabled'}>選んだ魚を売る</button></div>
      <div class="box-panel">` +
      S.box.map(f => `<label class="box-item"><input type="checkbox" data-bsel="${f.u}" ${boxSel.has(f.u) ? 'checked' : ''}>${fishImg(f, 2)} ${esc(SPECIES_MAP[f.s].name)}${sexMark(f.x)}${f.h ? '<span class="shiny-mark">✨</span>' : ''} ${wbadge(SPECIES_MAP[f.s].w)}${SPECIES_MAP[f.s].o.bigOnly ? '<span class="badge">大水槽専用</span>' : ''} <button class="btn small blue" data-place="${f.u}">水槽へ</button><button class="btn small" data-sellbox="${f.u}">売る</button></label>`).join('') + `</div></div>`;
  }
  html += `<div class="row" style="margin-bottom:10px"><span class="spacer"></span><button class="btn small ${reorderMode ? 'gold' : ''}" id="reorder">${reorderMode ? '✅ 並べ替えを終わる' : '↕ ブースを並べ替え'}</button></div>`;
  html += `<div class="tanks">` + S.tanks.map((t, i) => `
    <div class="tank-card ${t.big ? 'big' : ''} ${reorderMode ? 'reordering' : ''}" data-tank="${t.id}">
      <div class="tank-head">${wbadge(t.type)}${t.big ? '<span class="badge" style="background:#ffe23a">大水槽</span>' : ''} <b>${esc(t.name)}</b> <span class="muted" data-cap="${t.id}"></span>
        ${reorderMode ? `<span class="mv"><button class="btn small" data-mvt="${i}" data-dir="-1" ${i ? '' : 'disabled'}>▲ 前へ</button><button class="btn small" data-mvt="${i}" data-dir="1" ${i < S.tanks.length - 1 ? '' : 'disabled'}>▼ 後へ</button></span>` : ''}</div>
      <div class="tank-frame"><canvas></canvas></div>
    </div>`).join('') +
    `<div class="add-tank" id="addTank">＋ 新しいブースを建てる<br><small>ショップ ＞ ブース</small></div></div>`;
  el.innerHTML = html;
  $$('.tank-card', el).forEach(card => {
    const t = S.tanks.find(t => t.id === card.dataset.tank);
    new TankView($('canvas', card), t);
    card.addEventListener('click', e => { if (reorderMode || e.target.closest('button')) return; openTank(t.id); });
  });
  $$('[data-mvt]', el).forEach(b => b.onclick = e => { e.stopPropagation(); moveTank(+b.dataset.mvt, +b.dataset.dir); });
  $('#reorder', el).onclick = () => { reorderMode = !reorderMode; renderAquarium(); };
  $('#addTank', el).onclick = () => { setView('shop'); shopTab = 'tank'; renderShop(); };
  const tut = $('#tutOk', el); if (tut) tut.onclick = () => { S.tutorial = 0; save(); renderAquarium(); };
  $$('[data-place]', el).forEach(b => b.onclick = e => { e.preventDefault(); choosePlacement(b.dataset.place); });
  $$('[data-sellbox]', el).forEach(b => b.onclick = e => { e.preventDefault(); sellFish(b.dataset.sellbox); });
  $$('[data-bsel]', el).forEach(c => c.onchange = () => { c.checked ? boxSel.add(c.dataset.bsel) : boxSel.delete(c.dataset.bsel); renderAquarium(); });
  const ba = $('#boxAll', el); if (ba) ba.onchange = () => { if (ba.checked) S.box.forEach(f => boxSel.add(f.u)); else boxSel.clear(); renderAquarium(); };
  const bs = $('#boxSell', el); if (bs) bs.onclick = () => bulkSell([...boxSel]);
  const bau = $('#boxAuto', el); if (bau) bau.onclick = autoPlaceBox;
  bindStorageBanners(el);
  renderAquariumHeads();
}
function moveTank(i, dir) {
  const j = i + dir; if (j < 0 || j >= S.tanks.length) return;
  const [t] = S.tanks.splice(i, 1); S.tanks.splice(j, 0, t); save(); renderAquarium();
}
function autoPlaceBox() {
  let moved = 0;
  // 大きい魚から入れると収まりやすい
  const list = S.box.slice().sort((a, b) => fishWeight(b.s) - fishWeight(a.s));
  for (const f of list) { const t = findTankFor(f.s); if (t) { S.box.splice(S.box.indexOf(f), 1); t.fish.push(f); moved++; } }
  const left = S.box.length;
  if (!moved) toast('入れられる水槽がありませんでした（水質が合うブースを建てるか、水槽を広げよう）', 'bad', 4000);
  else toast(`📥 ${moved}匹を水槽へ入れました` + (left ? `<br>残り${left}匹は入る水槽がありません` : ''), left ? '' : 'good', 4000);
  save(); renderAquarium();
}
async function bulkSell(us) {
  const list = us.map(u => findFish(u)).filter(Boolean).map(x => x.f);
  if (!list.length) return;
  const total = list.reduce((a, f) => a + sellPrice(f), 0), shiny = list.filter(f => f.h).length, rare = list.filter(f => SPECIES_MAP[f.s].r >= 4).length;
  if (!await askConfirm(`${list.length}匹をまとめて ${fmt(total)} コインで売りますか？` + (shiny ? `\n⚠️ 色違いが${shiny}匹ふくまれています！` : '') + (rare ? `\n⚠️ ★4以上のレアな魚が${rare}匹ふくまれています` : ''))) return;
  list.forEach(f => removeFish(f.u)); S.coins += total;
  us.forEach(u => { boxSel.delete(u); tankSel.delete(u); });
  toast(`🪙 ${list.length}匹を${fmt(total)}コインで売った`);
  save(); if (openTankId) { renderTankModalLists(); updateTankModalStats(); } renderAquarium();
}
function renderAquariumHeads() {
  S.tanks.forEach(t => { const e = $(`[data-cap="${t.id}"]`); if (e) e.textContent = `🐟${tankUsed(t)}/${t.cap}  ✨${Math.round(tankAppeal(t))}`; });
}
function choosePlacement(u, fromTankId) {
  const ff = findFish(u); if (!ff) return; const f = ff.f; const sp = SPECIES_MAP[f.s], w = fishWeight(f.s);
  const list = S.tanks.filter(t => canEnter(t, f.s) && t.id !== fromTankId);
  const body = openModal(`<h2>${fishImg(f, 2)} ${esc(sp.name)} をどこに入れる？</h2>
    <p class="muted">この魚は${wbadge(sp.w)}の${sp.o.bigOnly ? '<b>大水槽</b>' : '水槽'}にしか入れられません（大きさ ${w}）</p>
    <div class="fish-list">${list.length ? list.map(t => { const ok = tankUsed(t) + w <= t.cap; return `<div class="fish-row" data-to="${t.id}" style="${ok ? '' : 'opacity:.5'}"><div class="nm">${esc(t.name)}<small>🐟${tankUsed(t)}/${t.cap}${ok ? '' : '（満員）'}</small></div><button class="btn small blue" ${ok ? '' : 'disabled'}>ここに入れる</button></div>`; }).join('') : '<p>入れられる水槽がありません。ショップでブースを建てましょう。</p>'}
    ${fromTankId ? `<div class="fish-row" data-to="box"><div class="nm">📦 待機BOXへ</div><button class="btn small">移す</button></div>` : ''}</div>`, true);
  $$('[data-to]', body).forEach(r => r.onclick = () => {
    const to = r.dataset.to;
    if (to === 'box') { const fish = removeFish(u); S.box.push(fish); }
    else { const t = S.tanks.find(t => t.id === to); if (tankUsed(t) + w > t.cap) return; const fish = removeFish(u); t.fish.push(fish); toast(`${esc(sp.name)}を${esc(t.name)}に入れた`); }
    save(); closeModal(); renderAquarium();
  });
}
async function sellFish(u) {
  const ff = findFish(u); if (!ff) return; const f = ff.f; const p = sellPrice(f);
  if ((f.h || SPECIES_MAP[f.s].r >= 4) && !await askConfirm(`${SPECIES_MAP[f.s].name}${f.h ? '（色違い）' : ''}を ${fmt(p)} コインで売りますか？`)) return;
  removeFish(u); S.coins += p; toast(`🪙 ${esc(SPECIES_MAP[f.s].name)}を${fmt(p)}コインで売った`);
  save(); if (openTankId) renderTankModalLists(); renderAquarium();
}

// ---------- 水槽の詳細 ----------
let openTankId = null, tankModalView = null, tankTab = 'fish', selectedFish = null;
const tankSel = new Set();
function openTank(id) {
  const t = S.tanks.find(t => t.id === id); if (!t) return;
  openTankId = id; selectedFish = null; tankSel.clear();
  const body = openModal(`
    <h2>${wbadge(t.type)} <span id="tmName">${esc(t.name)}</span> <button class="btn small" id="tmRename">✏️</button></h2>
    <div class="row muted" id="tmStats"></div>
    <div class="tank-frame" style="margin:10px 0"><canvas></canvas></div>
    <div id="tmHint"></div>
    <div class="tabs"><button data-tt="fish">🐟 魚</button><button data-tt="deco">🪸 飾りつけ</button><button data-tt="info">📋 ブース</button></div>
    <div id="tmList"></div>`);
  tankModalView = new TankView($('canvas', body), t, {
    interactive: true,
    onSelect: u => { selectedFish = u; if (tankTab !== 'fish') { tankTab = 'fish'; } renderTankModalLists(); const r = $(`.fish-row[data-u="${u}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); },
    onPlace: (id, x, y) => {
      if (!S.inv[id]) { tankModalView.placing = null; renderTankModalLists(); return; }
      S.inv[id]--; t.decos.push({ id, x, y, s: Math.floor(Math.random() * 3) });
      if (!S.inv[id]) { tankModalView.placing = null; delete S.inv[id]; }
      save(); renderTankModalLists(); renderAquariumHeads();
    },
    onRemoveDecor: i => { const d = t.decos.splice(i, 1)[0]; S.inv[d.id] = (S.inv[d.id] || 0) + 1; save(); renderTankModalLists(); },
  });
  $('#tmRename', body).onclick = async () => { const n = await askText('ブースの名前', t.name); if (n && n.trim()) { t.name = n.trim().slice(0, 20); $('#tmName').textContent = t.name; save(); renderAquarium(); } };
  $$('[data-tt]', body).forEach(b => b.onclick = () => { tankTab = b.dataset.tt; tankModalView.placing = null; tankModalView.removeMode = false; renderTankModalLists(); });
  if (tankTab === 'info') tankTab = 'fish';
  renderTankModalLists(); updateTankModalStats();
}
function updateTankModalStats() {
  const t = S.tanks.find(t => t.id === openTankId); const el = $('#tmStats'); if (!t || !el) return;
  el.innerHTML = `<span>🐟 ${tankUsed(t)} / ${t.cap}</span><span>✨ 魅力 ${Math.round(tankAppeal(t))}</span><span>🪙 ${(tankAppeal(t) * 0.1).toFixed(1)}/秒</span><span>${breedBoost(t) ? '💞 繁殖率UP' : ''}</span>`;
  $$('.fish-row[data-u]').forEach(r => { const f = t.fish.find(f => f.u === r.dataset.u); const g = r.querySelector('.grow i'); if (f && g) g.style.width = (growth(f) * 100) + '%'; });
}
function renderTankModalLists() {
  const t = S.tanks.find(t => t.id === openTankId); const el = $('#tmList'); if (!t || !el) return;
  $$('[data-tt]').forEach(b => b.classList.toggle('active', b.dataset.tt === tankTab));
  const hint = $('#tmHint'); hint.innerHTML = '';
  if (tankModalView) tankModalView.selected = selectedFish;
  if (tankTab === 'fish') {
    // 繁殖ペア
    const groups = {}; t.fish.forEach(f => { if (!isAdult(f)) return; const g = groups[f.s] || (groups[f.s] = [0, 0]); g[f.x]++; });
    const pairs = Object.entries(groups).filter(([k, g]) => g[0] && g[1]).map(([k, g]) => `${esc(SPECIES_MAP[k].name)}×${Math.min(g[0], g[1])}組`);
    hint.innerHTML = `<div class="hint">💞 繁殖できるペア：${pairs.length ? pairs.join('、') : 'なし（同じ種類の大人のオス♂とメス♀を入れよう）'}${tankUsed(t) >= t.cap ? '<br>⚠️ 満員なので赤ちゃんが生まれません' : ''}</div>`;
    for (const u of tankSel) if (!t.fish.some(f => f.u === u)) tankSel.delete(u);
    const sorted = t.fish.slice().sort((a, b) => SPECIES_MAP[a.s].idx - SPECIES_MAP[b.s].idx || a.x - b.x);
    const kinds = [...new Set(sorted.map(f => f.s))];
    const selList = sorted.filter(f => tankSel.has(f.u)), selTotal = selList.reduce((a, f) => a + sellPrice(f), 0);
    el.innerHTML = (sorted.length ? `<div class="row bulkbar">
        <label class="ck"><input type="checkbox" id="tkAll" ${selList.length && selList.length === sorted.length ? 'checked' : ''}> すべて</label>
        <select id="tkPick"><option value="">まとめて選ぶ…</option><option value="@baby">子どもだけ</option><option value="@m">オス♂だけ</option><option value="@f">メス♀だけ</option><option value="@normal">色違い以外</option><option value="@dup">ペア分を残して余りを選ぶ</option>${kinds.map(k => `<option value="${k}">${esc(SPECIES_MAP[k].name)}（${sorted.filter(f => f.s === k).length}匹）</option>`).join('')}</select>
        <span class="spacer"></span><span class="muted">${selList.length ? `${selList.length}匹選択中・🪙${fmt(selTotal)}` : ''}</span>
        <button class="btn small" id="tkBox" ${selList.length ? '' : 'disabled'}>📦 BOXへ</button>
        <button class="btn small primary" id="tkSell" ${selList.length ? '' : 'disabled'}>まとめて売る</button></div>` : '') +
      `<div class="fish-list">` + (sorted.length ? sorted.map(f => {
      const sp = SPECIES_MAP[f.s], ad = isAdult(f);
      return `<div class="fish-row ${selectedFish === f.u ? 'sel' : ''} ${tankSel.has(f.u) ? 'picked' : ''}" data-u="${f.u}">
        <input type="checkbox" class="rowck" data-ck="${f.u}" ${tankSel.has(f.u) ? 'checked' : ''}>
        <div class="ic">${fishImg(f, 2)}</div>
        <div class="nm">${esc(sp.name)} ${sexMark(f.x)} ${f.h ? '<span class="shiny-mark">✨色違い</span>' : ''} ${stars(sp.r)}
          <small>${ad ? '大人' : '成長中'} ・ 魅力 ${Math.round(fishAppeal(f))}</small>${ad ? '' : `<div class="grow"><i style="width:${growth(f) * 100}%"></i></div>`}</div>
        <button class="btn small" data-mv="${f.u}">移動</button>
        <button class="btn small" data-tr="${f.u}">トレード</button>
        <button class="btn small primary" data-sell="${f.u}">売る ${fmt(sellPrice(f))}</button>
      </div>`;
    }).join('') : '<p class="muted">まだ魚がいません。ショップで買うか、待機BOXから入れましょう。</p>') + `</div>`;
    $$('.fish-row[data-u]', el).forEach(r => r.addEventListener('click', e => { if (e.target.closest('button') || e.target.closest('input')) return; selectedFish = r.dataset.u; renderTankModalLists(); }));
    $$('[data-ck]', el).forEach(c => c.onchange = () => { c.checked ? tankSel.add(c.dataset.ck) : tankSel.delete(c.dataset.ck); renderTankModalLists(); });
    const all = $('#tkAll', el); if (all) all.onchange = () => { if (all.checked) sorted.forEach(f => tankSel.add(f.u)); else tankSel.clear(); renderTankModalLists(); };
    const pk = $('#tkPick', el); if (pk) pk.onchange = () => {
      const v = pk.value; if (!v) return;
      let pickList;
      if (v === '@baby') pickList = sorted.filter(f => !isAdult(f));
      else if (v === '@m') pickList = sorted.filter(f => !f.x);
      else if (v === '@f') pickList = sorted.filter(f => f.x);
      else if (v === '@normal') pickList = sorted.filter(f => !f.h);
      else if (v === '@dup') { // 種類ごとに色違いと大人のオス・メス1匹ずつを残して、それ以外を選ぶ
        pickList = [];
        kinds.forEach(k => { const g = sorted.filter(f => f.s === k); const keep = new Set(g.filter(f => f.h).map(f => f.u)); const m = g.find(f => !f.x && !f.h && isAdult(f)), w = g.find(f => f.x && !f.h && isAdult(f)); if (m) keep.add(m.u); if (w) keep.add(w.u); g.forEach(f => { if (!keep.has(f.u)) pickList.push(f); }); });
      } else pickList = sorted.filter(f => f.s === v);
      pickList.forEach(f => tankSel.add(f.u)); renderTankModalLists();
    };
    const tb = $('#tkBox', el); if (tb) tb.onclick = () => { const n = tankSel.size; [...tankSel].forEach(u => { const f = removeFish(u); if (f) S.box.push(f); }); tankSel.clear(); save(); toast(`📦 ${n}匹を待機BOXへ移した`); renderTankModalLists(); updateTankModalStats(); renderAquarium(); };
    const ts = $('#tkSell', el); if (ts) ts.onclick = () => bulkSell([...tankSel]);
    $$('[data-sell]', el).forEach(b => b.onclick = () => sellFish(b.dataset.sell));
    $$('[data-mv]', el).forEach(b => b.onclick = () => { const id = openTankId; choosePlacement(b.dataset.mv, id); });
    $$('[data-tr]', el).forEach(b => b.onclick = () => openTradeOut(b.dataset.tr));
  } else if (tankTab === 'deco') {
    const inv = Object.entries(S.inv).filter(([k, n]) => n > 0 && DECOR_MAP[k]);
    const pl = tankModalView && tankModalView.placing;
    hint.innerHTML = pl ? `<div class="hint">👆 水槽の中をクリックして「${esc(DECOR_MAP[pl].name)}」を置こう（続けて置けます） <button class="btn small" id="stopPlace">やめる</button></div>`
      : (tankModalView && tankModalView.removeMode) ? `<div class="hint">👆 片付けたい飾りをクリック <button class="btn small" id="stopPlace">やめる</button></div>` : '';
    el.innerHTML = `<h3>持っている飾り</h3><div class="cards">` + (inv.length ? inv.map(([k, n]) => `<div class="card"><div class="pic"><img class="px" src="${decorURL(k)}"></div><div class="nm">${esc(DECOR_MAP[k].name)}</div><div class="meta">×${n} ・ 魅力+${DECOR_MAP[k].appeal}</div><div class="btns"><button class="btn small blue" data-put="${k}">置く</button></div></div>`).join('') : '<p class="muted">飾りを持っていません。ショップ ＞ 装飾で買えます。</p>') + `</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="rmMode">🧹 飾りを片付ける（${t.decos.length}個）</button></div>`;
    $$('[data-put]', el).forEach(b => b.onclick = () => { tankModalView.placing = b.dataset.put; tankModalView.removeMode = false; renderTankModalLists(); });
    $('#rmMode', el).onclick = () => { tankModalView.removeMode = !tankModalView.removeMode; tankModalView.placing = null; renderTankModalLists(); };
    const sp = $('#stopPlace'); if (sp) sp.onclick = () => { tankModalView.placing = null; tankModalView.removeMode = false; renderTankModalLists(); };
  } else {
    const cc = capCost(t);
    const ti = S.tanks.indexOf(t);
    el.innerHTML = `<dl class="kv"><dt>水質</dt><dd>${wbadge(t.type)}${t.big ? ' <span class="badge" style="background:#ffe23a">大水槽</span>' : ''}</dd><dt>容量</dt><dd>${t.cap} / 最大${capMax(t)}（レベル${t.lv}）</dd><dt>並び順</dt><dd>${ti + 1}番目 <button class="btn small" id="tmUp" ${ti ? '' : 'disabled'}>▲ 前へ</button> <button class="btn small" id="tmDown" ${ti < S.tanks.length - 1 ? '' : 'disabled'}>▼ 後へ</button></dd><dt>種類数</dt><dd>${new Set(t.fish.map(f => f.s)).size}種（種類が多いほど魅力ボーナス）</dd></dl>
      <div class="row" style="margin-top:12px">
        <button class="btn gold" id="capUp" ${t.cap >= capMax(t) ? 'disabled' : ''}>🔧 水槽を広げる +${capStep(t)}（🪙${fmt(cc)}）</button>
        <button class="btn" id="tankDel">🗑️ ブースを取り壊す</button>
      </div><p class="muted">取り壊せるのは魚がいないブースだけです（建設費の30%が戻ります。飾りは倉庫に戻ります）。</p>`;
    $('#capUp', el).onclick = () => { if (S.coins < cc) return toast('コインが足りません', 'bad'); if (t.cap >= capMax(t)) return; S.coins -= cc; t.cap = Math.min(capMax(t), t.cap + capStep(t)); t.lv++; save(); toast('🔧 水槽が広くなった！'); renderTankModalLists(); updateTankModalStats(); renderAquariumHeads(); };
    $('#tmUp', el).onclick = () => { moveTank(ti, -1); renderTankModalLists(); };
    $('#tmDown', el).onclick = () => { moveTank(ti, 1); renderTankModalLists(); };
    $('#tankDel', el).onclick = async () => {
      if (t.fish.length) return toast('魚を移動・売却してから取り壊してください', 'bad');
      if (S.tanks.length <= 1) return toast('最後のブースは取り壊せません', 'bad');
      if (!await askConfirm(`${t.name}を取り壊しますか？`)) return;
      t.decos.forEach(d => S.inv[d.id] = (S.inv[d.id] || 0) + 1);
      S.tanks.splice(S.tanks.indexOf(t), 1); const refund = Math.round(WATER[t.type].base * (t.big ? BIG.costMult : 1) * 0.3); S.coins += refund;
      save(); closeModal(); renderAquarium(); toast(`🪙 ${fmt(refund)}コインが戻った`);
    };
  }
}

// ---------- ショップ ----------
let shopTab = 'fish';
function renderShop() {
  const el = $('#view-shop');
  let html = `<div class="tabs"><button data-st="fish">🐟 魚</button><button data-st="deco">🪸 装飾</button><button data-st="tank">🏗️ ブース</button></div>`;
  if (shopTab === 'fish') {
    html += `<div class="panel"><div class="row"><h2 style="margin:0">🐟 本日の入荷</h2><span class="spacer"></span><span class="muted" id="shopTimer"></span><button class="btn small gold" id="reroll">🔄 今すぐ入荷（🪙${fmt(rerollCost())}）</button></div>
      <p class="muted">入荷はランクが上がるとレアな魚が増えます。ときどき✨色違いも入荷！オス♂・メス♀を選んで買えます。</p>
      <div class="cards">` + S.shop.items.map((it, i) => {
      const sp = SPECIES_MAP[it.s], price = fishPrice(it.s, it.h), has = S.tanks.some(t => canEnter(t, it.s));
      return `<div class="card ${it.h ? 'shiny' : ''}"><div class="pic"><img class="px" src="${spriteURL(it.s, it.h, false, 2)}"></div>
        <div class="nm">${esc(sp.name)}</div><div class="meta">${wbadge(sp.w)} ${stars(sp.r)} ${S.dex[it.s] && S.dex[it.s].own ? '' : '<span class="badge" style="background:#ffe23a">NEW</span>'}${sp.o.bigOnly ? '<span class="badge">大水槽専用</span>' : ''}</div>
        <div class="meta">大きさ ${fishWeight(it.s)} ・ 魅力 ${RARITY_APPEAL[sp.r] * (it.h ? 5 : 1)}${has ? '' : ' ・ <span style="color:#c33">水槽なし</span>'}</div>
        <div class="price">🪙 ${fmt(price)}</div>
        <div class="btns"><button class="btn blue" data-buy="${i}" data-sex="0" ${S.coins < price ? 'disabled' : ''}>♂ 買う</button><button class="btn primary" data-buy="${i}" data-sex="1" ${S.coins < price ? 'disabled' : ''}>♀ 買う</button></div></div>`;
    }).join('') + `</div></div>`;
  } else if (shopTab === 'deco') {
    html += `<div class="panel"><h2>🪸 装飾</h2><p class="muted">飾りは水槽の魅力を上げます（魚の魅力に応じて上限あり）。「産卵床」は繁殖しやすくなります。</p><div class="cards">` +
      DECOR.map(d => `<div class="card"><div class="pic"><img class="px" src="${decorURL(d.id)}"></div><div class="nm">${esc(d.name)}</div>
        <div class="meta">魅力+${d.appeal}${d.breed ? ' ・ 💞繁殖UP' : ''} ・ 所持 ${S.inv[d.id] || 0}</div><div class="price">🪙 ${fmt(d.price)}</div>
        <div class="btns"><button class="btn green" data-bd="${d.id}" ${S.coins < d.price ? 'disabled' : ''}>買う</button></div></div>`).join('') + `</div></div>`;
  } else {
    const bigOk = S.rank >= BIG.rank;
    html += `<div class="panel"><h2>🏗️ ブースを建てる</h2><p class="muted">水質ごとに入れられる魚が違います。ブースが増えるほど建設費が上がります（現在 ${S.tanks.length}/20）。<br>🐋 <b>大水槽</b>は横に2倍広く、容量が大きく（最大${BIG.max}）、魅力+15%。ジンベエザメやシャチは大水槽でしか飼えません${bigOk ? '' : `（ランク${BIG.rank}で解放）`}。</p><div class="cards">` +
      WATER_KEYS.map(k => {
        const w = WATER[k], ok = waterUnlocked(k), c = tankCost(k), cb = tankCost(k, true), n = SPECIES.filter(s => s.w === k).length;
        return `<div class="card ${ok ? '' : 'locked'}"><div class="pic" style="background:linear-gradient(${w.top},${w.bot})"><span style="font-size:34px">${w.icon}</span></div>
          <div class="nm">${esc(w.full)}</div><div class="meta">${n}種類が入る</div>
          ${ok ? `<div class="btns"><button class="btn green" data-bt="${k}" ${S.coins >= c ? '' : 'disabled'}>建てる<br>🪙${fmt(c)}</button></div>
          <div class="btns"><button class="btn gold" data-btb="${k}" ${bigOk && S.coins >= cb ? '' : 'disabled'}>🐋 大水槽<br>${bigOk ? '🪙' + fmt(cb) : '🔒ランク' + BIG.rank}</button></div>` : `<div class="price">🔒 ランク${w.rank}で解放</div>`}</div>`;
      }).join('') + `</div></div>`;
  }
  el.innerHTML = html;
  $$('[data-st]', el).forEach(b => { b.classList.toggle('active', b.dataset.st === shopTab); b.onclick = () => { shopTab = b.dataset.st; renderShop(); }; });
  $$('[data-buy]', el).forEach(b => b.onclick = () => buyFish(+b.dataset.buy, +b.dataset.sex));
  $$('[data-bd]', el).forEach(b => b.onclick = () => buyDecor(b.dataset.bd));
  $$('[data-bt]', el).forEach(b => b.onclick = () => buyTank(b.dataset.bt));
  $$('[data-btb]', el).forEach(b => b.onclick = () => buyTank(b.dataset.btb, true));
  const rr = $('#reroll', el); if (rr) rr.onclick = () => { const c = rerollCost(); if (S.coins < c) return toast('コインが足りません', 'bad'); S.coins -= c; refreshShop(true); save(); };
  updateShopTimer();
}
function rerollCost() { return 40 * S.rank; }
function updateShopTimer() { const e = $('#shopTimer'); if (!e) return; const s = Math.max(0, Math.ceil((S.shop.next - now()) / 1000)); e.textContent = `次の入荷まで ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------- 図鑑 ----------
let dexFilter = 'all';
function renderDex() {
  const el = $('#view-dex');
  const all = SPECIES.length, seen = SPECIES.filter(s => S.dex[s.id] && S.dex[s.id].seen).length, own = SPECIES.filter(s => S.dex[s.id] && S.dex[s.id].own).length, sh = SPECIES.filter(s => S.dex[s.id] && S.dex[s.id].shiny).length;
  const list = SPECIES.filter(s => dexFilter === 'all' || s.w === dexFilter);
  el.innerHTML = `<div class="panel"><h2>📖 さかな図鑑</h2>
    <div class="progress"><div class="stat">👀 発見 <b>${seen}</b>/${all}</div><div class="stat">🐟 飼育 <b>${own}</b>/${all}</div><div class="stat">✨ 色違い <b>${sh}</b>/${all}</div><div class="stat">🎁 図鑑ボーナス 魅力+${(own * 0.4).toFixed(1)}%</div></div>
    <div class="tabs" style="margin-top:12px"><button data-df="all">すべて</button>${WATER_KEYS.map(k => `<button data-df="${k}">${WATER[k].icon} ${WATER[k].name}</button>`).join('')}</div>
    <div class="dex-grid">` + list.map(s => {
    const d = S.dex[s.id] || {};
    return `<div class="dex-card ${d.seen ? '' : 'unseen'}" data-sp="${s.id}"><span class="no">No.${String(s.idx + 1).padStart(3, '0')}</span>${d.shiny ? '<span class="sh">✨</span>' : ''}
      <div class="pic"><img class="px" src="${spriteURL(s.id, false, !d.seen, 1)}"></div>
      <div>${d.seen ? esc(s.name) : '？？？'}</div><div>${stars(s.r)}${d.own ? '' : ' <small class="muted">未飼育</small>'}</div></div>`;
  }).join('') + `</div></div>`;
  $$('[data-df]', el).forEach(b => { b.classList.toggle('active', b.dataset.df === dexFilter); b.onclick = () => { dexFilter = b.dataset.df; renderDex(); }; });
  $$('[data-sp]', el).forEach(c => c.onclick = () => openDexEntry(c.dataset.sp));
}
function openDexEntry(id, shiny) {
  const s = SPECIES_MAP[id], d = S.dex[id] || {};
  const count = S.tanks.reduce((a, t) => a + t.fish.filter(f => f.s === id).length, 0) + S.box.filter(f => f.s === id).length;
  const showShiny = shiny && d.shiny;
  const body = openModal(`<h2>No.${String(s.idx + 1).padStart(3, '0')} ${d.seen ? esc(s.name) : '？？？'}</h2>
    <div class="dex-big"><img class="px" src="${spriteURL(id, showShiny, !d.seen, 3)}"></div>
    <div class="row" style="margin-bottom:10px"><button class="btn small ${showShiny ? '' : 'blue'}" id="dxN">ふつう</button><button class="btn small ${showShiny ? 'primary' : ''}" id="dxS" ${d.shiny ? '' : 'disabled'}>✨ 色違い${d.shiny ? '' : '（未発見）'}</button></div>
    <dl class="kv"><dt>すみか</dt><dd>${wbadge(s.w)}</dd><dt>レア度</dt><dd>${stars(s.r)}</dd><dt>大きさ</dt><dd>${fishWeight(id)}${s.o.bigOnly ? '（大水槽専用）' : ''}</dd><dt>飼育数</dt><dd>${count}匹</dd>
    <dt>せつめい</dt><dd>${d.seen ? esc(s.desc) : 'ショップや友達の水族館で見つけよう'}</dd></dl>`, true);
  $('#dxN', body).onclick = () => openDexEntry(id, false);
  $('#dxS', body).onclick = () => openDexEntry(id, true);
}

// ---------- フレンド（見学・来訪・トレード） ----------
function snapshot() {
  return {
    res: 2, id: S.id, name: S.name, rank: S.rank, dex: Object.values(S.dex).filter(d => d.own).length, t: now(),
    tanks: S.tanks.map(t => [t.type, t.name, t.fish.map(f => [SPECIES_MAP[f.s].idx, f.h, f.x, isAdult(f) ? 1 : 0]), t.decos.map(d => [d.id, d.x, d.y, d.s]), t.big ? 1 : 0]),
  };
}
function snapToTanks(snap) {
  return snap.tanks.map(([type, name, fish, decos, big], i) => ({
    id: 'v' + i, type: WATER[type] ? type : 'sea', name, cap: 999, big: big ? 1 : 0,
    fish: fish.filter(a => SPECIES[a[0]]).map((a, j) => { const s = SPECIES[a[0]].id; const g = growMs(s); return { u: 'v' + i + '-' + j, s, h: a[1] ? 1 : 0, x: a[2], b: a[3] ? 0 : now(), g }; }),
    decos: decos.filter(d => DECOR_MAP[d[0]]).map(d => ({ id: d[0], x: d[1] * (snap.res ? 1 : 2), y: d[2] * (snap.res ? 1 : 2), s: d[3] })),
  }));
}
function renderFriend() {
  const el = $('#view-friend');
  el.innerHTML = `
  <div class="panel"><h2>🪪 わたしの水族館</h2>
    <div class="idcard"><div><div class="muted">フレンドコード</div><div class="fcode">${esc(S.id)}</div></div>
      <div><div class="muted">館名</div><div class="row"><b style="font-size:18px">${esc(S.name)}</b><button class="btn small" id="rename">✏️</button></div><div class="muted">Rank ${S.rank} ・ 図鑑 ${Object.values(S.dex).filter(d => d.own).length}種 ・ 来訪者 ${S.visitors.length}人</div></div></div>
    <p class="muted">このゲームはサーバーを使わないので、<b>見学コード（またはリンク）</b>をLINEやDiscordで送り合って遊びます。フレンドコードはあなたの水族館の名札です。</p>
    <div class="row"><button class="btn primary" id="mkVisit">🎫 見学リンクを作る</button></div>
    <div id="visitOut"></div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>🚶 友達の水族館を見に行く</h2><p class="muted">友達からもらった見学コードかリンクを貼り付けてください。</p>
      <textarea id="visitIn" placeholder="AQV… または https://…#v=AQV…"></textarea><div class="row" style="margin-top:6px"><button class="btn blue" id="goVisit">見に行く</button></div></div>
    <div class="panel"><h2>💌 来訪スタンプを受け取る</h2><p class="muted">あなたの水族館に来てくれた友達から届いたスタンプを貼ると、来訪者ノートに記録されます（1人1日1回ボーナス）。</p>
      <textarea id="stampIn" placeholder="AQS…"></textarea><div class="row" style="margin-top:6px"><button class="btn green" id="getStamp">受け取る</button></div></div>
    <div class="panel"><h2>🔁 トレードで魚を受け取る</h2><p class="muted">水槽の魚リストの「トレード」で作ったコードを交換して、魚を送り合えます。1つのコードは1回だけ使えます。</p>
      <textarea id="tradeIn" placeholder="AQT…"></textarea><div class="row" style="margin-top:6px"><button class="btn gold" id="getTrade">受け取る</button></div></div>
    <div class="panel"><h2>📒 来訪者ノート</h2><div class="log">${S.visitors.length ? S.visitors.slice().reverse().map(v => `<div class="log-item"><span class="when">${new Date(v.t).toLocaleString('ja-JP')}</span><b>${esc(v.name)}</b> <small class="muted">${esc(v.id)}${v.rank ? ' / Rank' + v.rank : ''}</small><br>${v.msg ? '💬 ' + esc(v.msg) : '<span class="muted">（メッセージなし）</span>'}</div>`).join('') : '<p class="muted">まだ記録がありません。</p>'}</div></div>
    <div class="panel"><h2>🗺️ 訪れた水族館</h2><div class="log">${S.visits.length ? S.visits.slice().reverse().map((v, i) => `<div class="log-item"><span class="when">${new Date(v.t).toLocaleString('ja-JP')}</span><b>${esc(v.name)}</b> <small class="muted">${esc(v.id)}</small> <button class="btn small" data-revisit="${S.visits.length - 1 - i}">もう一度見る</button></div>`).join('') : '<p class="muted">まだありません。</p>'}</div></div>
    <div class="panel"><h2>📤 送ったトレード</h2><div class="log">${S.tradesOut.length ? S.tradesOut.slice().reverse().map((v, i) => `<div class="log-item"><span class="when">${new Date(v.t).toLocaleString('ja-JP')}</span><img class="px" style="height:20px;vertical-align:middle" src="${spriteURL(v.s, v.h, false, 1)}"> ${esc(SPECIES_MAP[v.s] ? SPECIES_MAP[v.s].name : '?')}${v.h ? '✨' : ''} → ${esc(v.to || '誰でも')} <button class="btn small" data-recopy="${S.tradesOut.length - 1 - i}">コードをコピー</button></div>`).join('') : '<p class="muted">まだありません。</p>'}</div></div>
  </div>`;
  $('#rename', el).onclick = renameAquarium;
  $('#mkVisit', el).onclick = async () => {
    const code = await encodeCode('V', snapshot()); const link = baseURL() + '#v=' + code;
    $('#visitOut').innerHTML = `<div class="hint">この内容は<b>今の水族館</b>のスナップショットです。水族館が変わったら作り直してください。</div>
      <textarea readonly>${esc(link)}</textarea><div class="row" style="margin-top:6px"><button class="btn blue" id="cpLink">🔗 リンクをコピー</button><button class="btn" id="cpCode">コードだけコピー</button><span class="muted">${code.length}文字</span></div>`;
    $('#cpLink').onclick = () => copyText(link); $('#cpCode').onclick = () => copyText(code);
  };
  $('#goVisit', el).onclick = async () => { try { const r = await decodeCode($('#visitIn').value, 'V'); startVisit(r.data, true); } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); } };
  $('#getStamp', el).onclick = async () => { try { const r = await decodeCode($('#stampIn').value, 'S'); receiveStamp(r.data); } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); } };
  $('#getTrade', el).onclick = async () => { try { const r = await decodeCode($('#tradeIn').value, 'T'); receiveTrade(r.data); } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); } };
  $$('[data-revisit]', el).forEach(b => b.onclick = () => startVisit(S.visits[+b.dataset.revisit].snap, false));
  $$('[data-recopy]', el).forEach(b => b.onclick = () => { const v = S.tradesOut[+b.dataset.recopy]; copyText(baseURL() + '#t=' + v.code); });
}
async function renameAquarium() { const n = await askText('水族館の名前', S.name); if (n && n.trim()) { S.name = n.trim().slice(0, 20); save(); renderHUD(); if (currentView === 'friend') renderFriend(); if (currentView === 'settings') renderSettings(); } }

function startVisit(snap, record) {
  if (!snap || !snap.tanks) return toast('見学データが読めませんでした', 'bad');
  const isMe = snap.id === S.id;
  if (record && !isMe) {
    S.visits = S.visits.filter(v => v.id !== snap.id); S.visits.push({ id: snap.id, name: snap.name, t: now(), snap });
    if (S.visits.length > 30) S.visits.shift();
  }
  const tanks = snapToTanks(snap);
  let newSeen = 0;
  tanks.forEach(t => t.fish.forEach(f => { if (!S.dex[f.s] || !S.dex[f.s].seen) { dexMark(f.s, 'seen'); newSeen++; } }));
  save();
  const el = $('#visit'); el.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  const fishN = tanks.reduce((a, t) => a + t.fish.length, 0), shN = tanks.reduce((a, t) => a + t.fish.filter(f => f.h).length, 0);
  el.innerHTML = `<div class="visit-head"><span style="font-size:24px">🎫</span><div><div class="t">${esc(snap.name)}</div><div class="muted">${esc(snap.id)} ・ Rank ${snap.rank} ${esc(rankTitle(snap.rank))} ・ 図鑑${snap.dex}種 ・ 魚${fishN}匹${shN ? ` ・ ✨色違い${shN}匹` : ''}</div></div><span class="spacer"></span>${isMe ? '' : '<button class="btn small" id="restoreVisit" title="データが消えたときの救済用">🛟 これは自分の水族館（復元する）</button>'}<button class="btn primary" id="leaveVisit">🏠 自分の水族館に帰る</button></div>
    <main>
      ${isMe ? '<div class="hint">これはあなた自身の水族館の見学コードです（プレビュー）。</div>' : ''}
      ${newSeen ? `<div class="hint">👀 図鑑に新しい魚が${newSeen}種「発見」として記録されました！</div>` : ''}
      <div class="tanks">${tanks.map((t, i) => `<div class="${t.big ? 'tank-card big' : ''}"><div class="tank-head">${wbadge(t.type)} <b>${esc(t.name)}</b> <span class="muted">🐟${t.fish.length}</span></div><div class="tank-frame"><canvas data-vt="${i}"></canvas></div></div>`).join('')}</div>
      ${isMe ? '' : `<div class="panel" style="margin-top:16px"><h2>💌 来訪スタンプを残す</h2><p class="muted">スタンプを作って ${esc(snap.name)} の館長に送ると、相手の来訪者ノートにあなたの名前が残ります。</p>
        <input type="text" id="stampMsg" maxlength="60" placeholder="ひとことメッセージ（例：ジンベエザメすごい！）">
        <div class="row" style="margin-top:8px"><button class="btn green" id="mkStamp">スタンプを作る</button></div><div id="stampOut"></div></div>`}
    </main>`;
  $$('[data-vt]', el).forEach(cv => new TankView(cv, tanks[+cv.dataset.vt]));
  const rv = $('#restoreVisit', el);
  if (rv) rv.onclick = async () => {
    if (!await askConfirm(`データが消えてしまった場合の救済機能です。\n「${snap.name}」があなた自身の水族館なら、この内容で復元できます（コイン残高・来訪者ノートなどは戻りません）。\n今のデータは上書きされます。復元しますか？`)) return;
    const res = restoreFromSnapshot(snap);
    el.classList.add('hidden'); el.innerHTML = ''; document.body.style.overflow = '';
    toast(`🛟 「${esc(S.name)}」を復元しました！ブース${res.tanks}つ・魚${res.fish}匹`, 'good', 6000);
    setView('aquarium');
  };
  $('#leaveVisit', el).onclick = () => { el.classList.add('hidden'); el.innerHTML = ''; document.body.style.overflow = ''; if (currentView === 'friend') renderFriend(); };
  const ms = $('#mkStamp', el);
  if (ms) ms.onclick = async () => {
    const code = await encodeCode('S', { from: S.id, name: S.name, rank: S.rank, to: snap.id, msg: $('#stampMsg').value.slice(0, 60), t: now() });
    const link = baseURL() + '#s=' + code;
    $('#stampOut').innerHTML = `<textarea readonly style="margin-top:8px">${esc(link)}</textarea><div class="row" style="margin-top:6px"><button class="btn blue" id="cpS">🔗 リンクをコピー</button><button class="btn" id="cpS2">コードだけコピー</button></div>`;
    $('#cpS').onclick = () => copyText(link); $('#cpS2').onclick = () => copyText(code);
  };
}
function receiveStamp(d) {
  if (d.to !== S.id) return toast(`これは別の水族館（${esc(d.to)}）あてのスタンプです`, 'bad', 4000);
  if (d.from === S.id) return toast('自分のスタンプは受け取れません', 'bad');
  if (S.visitors.some(v => v.id === d.from && v.t === d.t)) return toast('このスタンプはもう受け取っています', 'bad');
  const day = new Date().toDateString(); const key = d.from;
  S.visitors.push({ id: d.from, name: (d.name || '').slice(0, 20), msg: (d.msg || '').slice(0, 60), rank: d.rank, t: d.t });
  if (S.visitors.length > 200) S.visitors.shift();
  if (S.stamped[key] !== day) {
    S.stamped[key] = day; const bonus = 100 + 25 * S.rank; S.coins += bonus; gainExp(50 * S.rank);
    toast(`💌 ${esc(d.name)}さんの来訪を記録！ボーナス🪙${fmt(bonus)}`, 'good', 4000);
  } else toast(`💌 ${esc(d.name)}さんの来訪を記録しました（今日のボーナスは受け取り済み）`);
  save(); if (currentView === 'friend') renderFriend();
}
function openTradeOut(u) {
  const ff = findFish(u); if (!ff) return; const f = ff.f, sp = SPECIES_MAP[f.s];
  const body = openModal(`<h2>🔁 トレードに出す</h2><div class="row">${fishImg(f, 3)}<div><b>${esc(sp.name)}</b> ${sexMark(f.x)} ${f.h ? '<span class="shiny-mark">✨色違い</span>' : ''}<br>${stars(sp.r)} ${wbadge(sp.w)}</div></div>
    <p>トレードコードを作ると、この魚は<b>あなたの水族館からいなくなります</b>。コードを受け取った人の水族館に引っ越します。</p>
    <p class="muted">相手のフレンドコードを入れると、その人しか受け取れなくなります（空欄なら誰でも受け取れます）。</p>
    <input type="text" id="trTo" placeholder="AQ-XXXX-XXXX（任意）" maxlength="12">
    <div class="row" style="margin-top:10px"><button class="btn gold" id="trGo">トレードコードを作る</button></div><div id="trOut"></div>`, true);
  $('#trGo', body).onclick = async () => {
    const to = $('#trTo').value.trim().toUpperCase();
    if (to && !/^AQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(to)) return toast('フレンドコードの形式が違います（AQ-XXXX-XXXX）', 'bad');
    if (to === S.id) return toast('自分あてにはトレードできません', 'bad');
    if (!findFish(u)) return;
    const code = await encodeCode('T', { u: f.u, s: f.s, h: f.h, x: f.x, from: S.id, name: S.name, rank: S.rank, to, t: now() });
    removeFish(u); S.tradesOut.push({ u: f.u, s: f.s, h: f.h, to, t: now(), code }); if (S.tradesOut.length > 50) S.tradesOut.shift();
    save(); renderAquarium(); if (openTankId) { }
    const link = baseURL() + '#t=' + code;
    $('#trGo').disabled = true;
    $('#trOut').innerHTML = `<div class="hint">✅ コードができました！相手に送ってください（フレンド画面の「送ったトレード」からもコピーできます）。</div><textarea readonly>${esc(link)}</textarea><div class="row" style="margin-top:6px"><button class="btn blue" id="cpT">🔗 リンクをコピー</button><button class="btn" id="cpT2">コードだけコピー</button></div>`;
    $('#cpT').onclick = () => copyText(link); $('#cpT2').onclick = () => copyText(code);
  };
}
async function receiveTrade(d) {
  if (!SPECIES_MAP[d.s]) return toast('知らない魚のデータです', 'bad');
  if (d.to && d.to !== S.id) return toast(`このトレードは ${esc(d.to)} さんあてです`, 'bad', 4000);
  if (S.tradesIn.includes(d.u) || findFish(d.u)) return toast('このトレードコードはもう使われています', 'bad');
  const sp = SPECIES_MAP[d.s];
  if (!await askConfirm(`${d.name || '誰か'}さんから ${sp.name}${d.h ? '（色違い）' : ''} を受け取りますか？`)) return;
  const f = { u: d.u, s: d.s, h: d.h ? 1 : 0, x: d.x ? 1 : 0, b: now() - growMs(d.s), g: growMs(d.s), from: d.name };
  S.tradesIn.push(d.u); if (S.tradesIn.length > 2000) S.tradesIn.shift();
  const t = placeFish(f); dexMark(f.s, 'own'); if (f.h) dexMark(f.s, 'shiny');
  // 送り主にもスタンプ的な記録
  if (d.from !== S.id) S.visitors.push({ id: d.from, name: (d.name || '').slice(0, 20), msg: `🔁 ${sp.name}${f.h ? '✨' : ''}をトレードで送ってくれた`, rank: d.rank, t: now() });
  toast(`<img class="px" src="${spriteURL(f.s, f.h)}"> ${esc(sp.name)}がやってきた！` + (t ? `→ ${esc(t.name)}` : '（待機BOXに入りました）'), f.h ? 'shiny' : 'good', 4500);
  save(); renderAquarium(); if (currentView === 'friend') renderFriend();
}

// ---------- 設定 ----------
function renderSettings() {
  const el = $('#view-settings');
  el.innerHTML = `
  <div class="panel"><h2>⚙️ 設定</h2>
    <div class="row"><span>水族館の名前：<b>${esc(S.name)}</b></span><button class="btn small" id="sRename">変更</button></div>
    <h3>💾 データの保存状況</h3>
    <dl class="kv"><dt>保存先</dt><dd>この端末のブラウザの中（${esc(location.host || 'ローカルファイル')}）${ENV.standalone ? '・ホーム画面アプリ' : ''}</dd>
    <dt>二重保存</dt><dd>${storageOK ? '✅ localStorage と IndexedDB に保存中' : '⚠️ 保存できていません'}</dd>
    <dt>消えにくさ</dt><dd>${S.persisted ? '✅ 長期保存を許可済み' : 'ふつう（ブラウザの判断で消えることがあります）'}</dd>
    <dt>最後のバックアップ</dt><dd>${S.lastBackup ? new Date(S.lastBackup).toLocaleString('ja-JP') : '<b style="color:#c33">まだありません</b>'}</dd></dl>
    ${ENV.ios && !ENV.standalone ? '<p class="muted">iPhoneはSafariでもChromeでも、しばらく開かないサイトのデータを自動で消すことがあります。<a href="#" id="homeHow2">ホーム画面に追加</a>すると消されにくくなります。</p>' : ''}
    <div class="row"><button class="btn blue" id="bkFile">📁 ファイルに保存</button><button class="btn" id="bkCopy">📋 コードをコピー</button><button class="btn" id="bkPick">📂 ファイルから復元</button></div>
    <h3>💾 セーブデータのバックアップ</h3><p class="muted">データはこのブラウザに自動保存されます。別の端末に引っ越すときや念のための保存に使ってください。</p>
    <div class="row"><button class="btn blue" id="bkOut">バックアップコードを作る</button></div><div id="bkBox"></div>
    <textarea id="bkIn" placeholder="AQB…（バックアップコードを貼り付けて復元）" style="margin-top:8px"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn" id="bkLoad">復元する</button><span class="spacer"></span><button class="btn primary" id="reset">🗑️ 最初からやり直す</button></div>
    <h3>🛟 見学リンクから復元</h3><p class="muted">データが消えてしまったときの救済用です。以前に作った<b>自分の水族館の見学リンク（またはコード）</b>を貼ると、ブース・魚（色違い・オスメス）・飾り・館名・フレンドコード・ランクが戻ります。<br>コインの残高・図鑑の「発見」記録・来訪者ノートなどは戻りません。</p>
    <textarea id="vrIn" placeholder="https://…#v=AQV… または AQV…"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn gold" id="vrLoad">この見学リンクから復元する</button></div>
  </div>
  <div class="panel"><h2>📊 記録</h2><dl class="kv">
    <dt>開館日</dt><dd>${new Date(S.created).toLocaleDateString('ja-JP')}</dd>
    <dt>延べ来館者</dt><dd>${fmt(S.stats.visitorsTotal || 0)}人</dd>
    <dt>入館料の合計</dt><dd>🪙${fmt(S.stats.earned || 0)}</dd>
    <dt>生まれた赤ちゃん</dt><dd>${S.stats.born || 0}匹（うち色違い ${S.stats.shinyBorn || 0}匹）</dd>
    <dt>魚の数</dt><dd>${S.tanks.reduce((a, t) => a + t.fish.length, 0) + S.box.length}匹</dd></dl></div>
  <div class="panel help"><h2>❓ あそびかた</h2><ul>
    <li>🐟 来館者は魚と飾りの<b>魅力</b>に応じて入館料を払います。レアな魚・色違い・いろいろな種類を集めるほど魅力アップ。</li>
    <li>💞 同じ種類の<b>大人のオスとメス</b>が同じ水槽にいて、空きがあると赤ちゃんが生まれます。「産卵床」で繁殖しやすくなります。</li>
    <li>✨ 赤ちゃんはごくまれに<b>色違い</b>（約1/512）。親が色違いだと1/128、両親とも色違いなら1/32になります。ショップにも、ごくまれに入荷します。</li>
    <li>🐋 <b>大水槽</b>は横に広く、たくさん入って魅力も上がります。ジンベエザメとシャチは大水槽専用です。</li>
    <li>🐧 <b>海獣プール</b>のペンギンやカワウソは、ときどき陸に上がってよちよち歩きます。</li>
    <li>🏗️ 魚は水質（淡水・川・海水・クラゲ・海獣・汽水・深海）が合うブースにしか入れられません。ランクが上がると新しいブースが解放されます。</li>
    <li>🤝 フレンド画面で見学リンクを作って友達に送ると、水族館を見てもらえます。来訪スタンプで来訪者ノートに名前が残り、トレードで魚を送り合えます。</li>
    <li>🌙 ゲームを閉じている間も、最大8時間ぶん（半分の額）の入館料が入ります。</li>
  </ul><p class="muted">全${SPECIES.length}種・装飾${DECOR.length}種。ドット絵はすべてプログラムで自動生成しています。</p></div>`;
  $('#sRename', el).onclick = renameAquarium;
  $('#bkFile', el).onclick = backupToFile; $('#bkCopy', el).onclick = backupToClipboard; $('#bkPick', el).onclick = pickBackupFile;
  const hh = $('#homeHow2', el); if (hh) hh.onclick = e => { e.preventDefault(); showHomeScreenHowTo(); };
  $('#bkOut', el).onclick = async () => { const code = await backupCode(); $('#bkBox').innerHTML = `<textarea readonly style="margin-top:8px">${esc(code)}</textarea><div class="row" style="margin-top:6px"><button class="btn small" id="cpB">コピー</button></div>`; $('#cpB').onclick = () => copyText(code); };
  $('#bkLoad', el).onclick = async () => { try { await restoreBackupText($('#bkIn').value); } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); } };
  $('#vrLoad', el).onclick = async () => {
    try {
      const r = await decodeCode($('#vrIn').value, 'V');
      const snap = r.data; if (!snap || !snap.tanks || !snap.tanks.length) throw new Error('見学データにブースが入っていません');
      const fishN = snap.tanks.reduce((a, t) => a + t[2].length, 0);
      const when = snap.t ? new Date(snap.t).toLocaleString('ja-JP') : '不明';
      if (!await askConfirm(`「${snap.name}」（${snap.id}・Rank${snap.rank}）を復元します。\nブース${snap.tanks.length}つ・魚${fishN}匹（${when}時点）\n今のデータは上書きされます。よろしいですか？`)) return;
      const res = restoreFromSnapshot(snap);
      toast(`🛟 「${esc(S.name)}」を復元しました！ブース${res.tanks}つ・魚${res.fish}匹` + (res.box ? `<br>（水質が合わない${res.box}匹は待機BOXへ）` : ''), 'good', 6000);
      setView('aquarium');
    } catch (e) { toast('😢 ' + esc(e.message), 'bad', 4000); }
  };
  $('#reset', el).onclick = async () => { if (!await askConfirm('本当に最初からやり直しますか？（元に戻せません）')) return; await wipeAll(); location.hash = ''; location.reload(); };
}


// ---------- 見学スナップショットからの復元 ----------
function restoreFromSnapshot(snap) {
  const st = newState();
  st.id = /^AQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(snap.id) ? snap.id : st.id;
  st.name = String(snap.name || st.name).slice(0, 20);
  st.rank = Math.max(1, Math.min(99, snap.rank | 0)); st.exp = 0;
  st.coins = 500 + 300 * st.rank; st.tutorial = 0; st.tanks = []; st.dex = {}; st.inv = {}; st.box = [];
  const k = snap.res ? 1 : 2; // 高精細化前のコードは座標を2倍に
  let fishCount = 0;
  snap.tanks.forEach(([type, name, fish, decos, big]) => {
    if (!WATER[type]) type = 'sea';
    const t = { id: uid(), type, name: String(name || WATER[type].full).slice(0, 20), cap: big ? BIG.cap : 12, lv: 1, fish: [], decos: [] };
    if (big) t.big = 1;
    const dm = tankDims(type, big);
    (decos || []).forEach(d => { if (DECOR_MAP[d[0]]) t.decos.push({ id: d[0], x: Math.max(0, Math.min(dm.W, d[1] * k)), y: Math.max(dm.SY, Math.min(dm.H - 1, d[2] * k)), s: (d[3] | 0) % 3 }); });
    (fish || []).forEach(a => {
      const sp = SPECIES[a[0]]; if (!sp) return;
      const f = mkFish(sp.id, a[2] ? 1 : 0, a[1], !!a[3]);
      const dx = st.dex[sp.id] || (st.dex[sp.id] = {}); dx.seen = 1; dx.own = 1; if (f.h) dx.shiny = 1;
      fishCount++;
      if (sp.w === type && (!sp.o.bigOnly || t.big)) t.fish.push(f); else st.box.push(f);
    });
    // 入っていた魚が収まるように容量を合わせる
    const used = t.fish.reduce((a, f) => a + fishWeight(f.s), 0);
    while (t.cap < used) { t.cap += t.big ? BIG.step : 6; t.lv++; }
    st.tanks.push(t);
  });
  // 待機BOXの魚を、入るブースがあれば入れる
  st.box = st.box.filter(f => { const sp = SPECIES_MAP[f.s]; const t = st.tanks.find(t => t.type === sp.w && (!sp.o.bigOnly || t.big) && t.fish.reduce((a, g) => a + fishWeight(g.s), 0) + fishWeight(f.s) <= t.cap); if (t) { t.fish.push(f); return false; } return true; });
  S = st; S.last = now(); save();
  refreshShop(true); renderHUD();
  return { tanks: S.tanks.length, fish: fishCount, box: S.box.length };
}

// ---------- URLのハッシュ（リンクで開いた時） ----------
async function handleHash() {
  const h = location.hash; if (!h || h.length < 5) return;
  const m = h.match(/^#(v|s|t)=(.+)$/); if (!m) return;
  history.replaceState(null, '', baseURL());
  try {
    const kind = { v: 'V', s: 'S', t: 'T' }[m[1]];
    const r = await decodeCode(decodeURIComponent(m[2]), kind);
    if (kind === 'V') startVisit(r.data, true);
    else if (kind === 'S') receiveStamp(r.data);
    else receiveTrade(r.data);
  } catch (e) { toast('😢 リンクを読み込めませんでした：' + esc(e.message), 'bad', 5000); }
}

// ---------- 起動 ----------
async function init() {
  await load();
  if (restoredFromIDB) setTimeout(() => toast('🛟 予備の保存データ（IndexedDB）から復元しました', 'good', 5000), 800);
  document.addEventListener('pointerdown', requestPersist, { once: true });
  if (!S.shop.items.length) refreshShop(true);
  $$('#nav button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('.modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  renderHUD(); renderAquarium();
  setInterval(tick, 1000);
  setInterval(save, 10000);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('hashchange', handleHash);
  requestAnimationFrame(frameLoop);
  handleHash();
}
init();
