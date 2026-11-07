'use strict';
/* =====================================================================
   マギアハンター  game.js
   第1部：純粋計算＋戦闘エンジン（DOM非依存・Nodeから require 可能）
   第2部：描画・UI・音・セーブ（ブラウザ専用）
   ===================================================================== */

/* ---------- 定数 ---------- */
const SAVE_KEY = 'magia_hunter_save_v1';
const SLOTS = ['wand', 'robe', 'amulet', 'ring'];
const SLOT_NAME = { wand: '杖', robe: 'ローブ', amulet: 'アミュレット', ring: '指輪' };
const INV_CAP = 60;
const WAVE_LEN = 25, WAVE_GAP = 3, MAX_WAVE = 10;
const MAX_ENEMIES = 120;
const TARGET_RANGE = 380;
const CRIT_CHANCE = 0.06;
const PLAYER_R = 14;
const BASE_HP = 100;
const SPELL_POWER = 1.32;        // 全魔法の基礎威力係数（バランス調整用）
const REGEN = 1.0;               // 毎秒の自然回復
const MAX_SPELLS = 4, MAX_PASSIVES = 2;   // v1.1 所持枠（ミサイル込みで魔法4、パッシブ2）
const FREE_REROLLS = 2;                   // v1.1 1ランの無料リロール回数
const ENH_REFUND = 0.75;                  // v1.1 売却時に返す強化費の割合
const BOSS_PITY_STEP = 0.4, BOSS_PITY_MAX = 10;

const RARITIES = [
  { id: 'common', name: 'コモン', color: '#8c867a', mult: 1.0, affixes: 0, sell: 10, cost: 1.0 },
  { id: 'rare', name: 'レア', color: '#2f6fd6', mult: 1.3, affixes: 1, sell: 30, cost: 1.5 },
  { id: 'epic', name: 'エピック', color: '#8a3fc4', mult: 1.7, affixes: 2, sell: 90, cost: 2.2 },
  { id: 'legend', name: 'レジェンド', color: '#c8962a', mult: 2.3, affixes: 3, sell: 300, cost: 3.0 },
];

const SPELL_IDS = ['missile', 'lightning', 'meteor', 'frost', 'orb', 'laser'];
const SPELLS = {
  missile: {
    name: 'マジックミサイル', color: '#2d4a9c', cd: 0.7, icon: '矢',
    lv: [{ n: 1, dmg: 13 }, { n: 1, dmg: 16 }, { n: 2, dmg: 16 }, { n: 2, dmg: 20 }, { n: 3, dmg: 24 }],
    mile: { 3: '撃破時、最も近い別の敵へ再追尾', 5: '弾が1体貫通する' },
    desc: l => `最寄りの敵へ追尾弾 ${l.n}発（威力${l.dmg}）`,
  },
  lightning: {
    name: 'チェーンライトニング', color: '#1b8a6b', cd: 2.0, icon: '雷',
    lv: [{ dmg: 25, chain: 2 }, { dmg: 30, chain: 3 }, { dmg: 35, chain: 4 }, { dmg: 41, chain: 5 }, { dmg: 50, chain: 7 }],
    mile: { 3: '連鎖した敵の周囲に小爆発', 5: '連鎖回数+2・威力が減衰しない' },
    desc: l => `落雷が${l.chain}体に連鎖（威力${l.dmg}）`,
  },
  meteor: {
    name: 'メテオ', color: '#c8321e', cd: 3.4, icon: '隕',
    lv: [{ dmg: 56, r: 52, n: 1 }, { dmg: 69, r: 58, n: 1 }, { dmg: 82, r: 64, n: 1 }, { dmg: 120, r: 72, n: 1 }, { dmg: 140, r: 80, n: 2 }],
    mile: { 3: '着弾点が3秒間燃える（継続ダメージ）', 5: '2発同時に落下する' },
    desc: l => `密集地へ隕石${l.n}個（威力${l.dmg}・範囲${l.r}）`,
  },
  frost: {
    name: 'フロストノヴァ', color: '#3d78b8', cd: 3.2, icon: '氷',
    lv: [{ dmg: 17, r: 95, slow: 0.30 }, { dmg: 22, r: 110, slow: 0.36 }, { dmg: 27, r: 125, slow: 0.42 }, { dmg: 34, r: 140, slow: 0.48 }, { dmg: 41, r: 155, slow: 0.55 }],
    mile: { 3: '鈍足が確率で凍結に強化される', 5: '発動時に短い無敵バリアを張る' },
    desc: l => `周囲に氷の波（威力${l.dmg}・範囲${l.r}・鈍足${Math.round(l.slow * 100)}%）`,
  },
  orb: {
    name: 'アルカナオーブ', color: '#c98a00', cd: 0, icon: '珠',
    lv: [{ dmg: 11, n: 1 }, { dmg: 14, n: 2 }, { dmg: 16, n: 2 }, { dmg: 19, n: 3 }, { dmg: 24, n: 4 }],
    mile: { 3: 'オーブの通った跡に残像ダメージ', 5: 'オーブが定期的に衝撃波を放つ' },
    desc: l => `金の珠が${l.n}個周回（接触${l.dmg}）`,
  },
  laser: {
    name: 'フォーカスレーザー', color: '#7a2fb0', cd: 4.5, icon: '光',
    lv: [{ dmg: 7.5, w: 8 }, { dmg: 9.5, w: 10 }, { dmg: 12, w: 12 }, { dmg: 15, w: 15 }, { dmg: 19, w: 19 }],
    mile: { 3: '照射中の敵の周囲にも拡散ダメージ', 5: '2本同時に照射（上位2体）' },
    desc: l => `ボス＞エリート＞高HPの敵へ持続ビーム（毎0.15秒${l.dmg}・太さ${l.w}）`,
  },
};
const LASER_DUR = 1.6, LASER_TICK = 0.15;

const PASSIVE_IDS = ['power', 'cdr', 'area', 'wisdom'];
const PASSIVES = {
  power: { name: '魔力強化', icon: '魔', desc: l => `全魔法の威力 +${l * 12}%` },
  cdr: { name: '迅速詠唱', icon: '速', desc: l => `全クールダウン -${l * 8}%` },
  area: { name: '拡大術式', icon: '拡', desc: l => `全魔法の範囲 +${l * 10}%` },
  wisdom: { name: '賢者の瞑想', icon: '瞑', desc: l => `経験値 +${l * 10}%・最大HP +${l * 10}` },
};

const ENEMIES = {
  slimy: { name: 'スライミー', hp: 12, spd: 38, dmg: 6, r: 14, w: 10, unlock: 1, gold: 1.0 },
  dash: { name: 'ダッシュアイ', hp: 6, spd: 80, dmg: 5, r: 9, w: 6, unlock: 2, gold: 0.5 },
  splitter: { name: 'スプリッター', hp: 22, spd: 36, dmg: 6, r: 16, w: 4, unlock: 3, gold: 1.2 },
  ghost: { name: 'ゴースト', hp: 16, spd: 44, dmg: 8, r: 13, w: 3.5, unlock: 4, gold: 1.5 },
  golem: { name: 'タンクゴーレム', hp: 70, spd: 22, dmg: 16, r: 25, w: 2.5, unlock: 5, gold: 3.0 },
  bones: { name: 'ボーンズ', hp: 30, spd: 34, dmg: 5, r: 15, w: 2.5, unlock: 6, gold: 2.5 },
  splitlet: { name: 'ちびスプリッター', hp: 7, spd: 58, dmg: 5, r: 9, w: 0, unlock: 99, gold: 0.3 },
  imp: { name: '使い魔', hp: 5, spd: 70, dmg: 5, r: 8, w: 0, unlock: 99, gold: 0 },
  boss: { name: 'ボス', hp: 420, spd: 26, dmg: 18, r: 46, w: 0, unlock: 99, gold: 150 },
};
const GHOST_MISS = 0.65;          // 半透明中に外れる確率
const GHOST_CYCLE = 4.2, GHOST_FADE_FROM = 2.6;
const ELITE_CHANCE = 0.02;
const DROP_RATE = { normal: 0.006, elite: 0.40, bossExtra: 0.5 };

const CHAPTERS = [
  { name: '第一章　墨染の森', paper: '#f6f1e7', ink: '#1d1b19', accent: '#3d7a5a', wash: 'rgba(60,90,70,0.06)' },
  { name: '第二章　朱砂の廃都', paper: '#f4e7dc', ink: '#2a1a17', accent: '#b3402a', wash: 'rgba(150,60,40,0.06)' },
  { name: '第三章　月白の深淵', paper: '#e9ece9', ink: '#161e28', accent: '#3a6f93', wash: 'rgba(50,90,130,0.07)' },
];
const BOSS_NAMES = [
  '墨喰いの王スラゴ', '双眼のガロウ', '千手の古井戸', '苔むす巨像ゴーレム・ゲン', '森の主　九尾の影',
  '朱砂の門番アカガネ', '灯籠喰らいのヨミ', '崩れ塔の老骨ハクコツ', '紅蓮絵巻のオロチ', '廃都の女帝スザク',
  '月影のカゲロウ', '深淵の書守ノクス', '凍て星のリュウゲン', '夜叉墨のアビス', '終の筆　黒き魔導書ヴォイド',
];
function stageInfo(stage) {
  const ci = Math.min(2, Math.floor((stage - 1) / 5));
  return { stage, chapter: ci, ch: CHAPTERS[ci], inChapter: ((stage - 1) % 5) + 1, boss: BOSS_NAMES[stage - 1] };
}

/* ---------- 乱数 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rrange(rng, lo, hi) { return lo + (hi - lo) * rng(); }
function rpick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
function weightedIndex(rng, weights) {
  let sum = 0; for (const w of weights) sum += w;
  if (sum <= 0) return 0;
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
}

/* ---------- 経験値・倍率 ---------- */
function xpNeeded(level) { return Math.round(6 + (level - 1) * 5 + Math.pow(level - 1, 1.7)); }
function enemyHpMult(stage, wave) { return (1 + 0.45 * (stage - 1)) * (1 + 0.15 * (wave - 1)); }
function enemyDmgMult(stage, wave) { return 1 + 0.18 * (stage - 1) + 0.03 * (wave - 1); }
function goldMult(stage) { return 1 + 0.12 * (stage - 1); }
function spawnInterval(stage, wave, tn) {
  return Math.max(0.35, (2.2 - 0.07 * (wave - 1)) * (1 - 0.35 * Math.min(1, tn)) / (1 + 0.025 * (stage - 1)));
}
function unlockedTypes(stage, wave) {
  const shift = Math.floor((stage - 1) / 2);
  return ['slimy', 'dash', 'splitter', 'ghost', 'golem', 'bones'].filter(t => wave >= Math.max(1, ENEMIES[t].unlock - shift));
}

/* ---------- 戦闘計算 ---------- */
function newUq() { return { chain: 0, missile: 0, missileMult: 1, meteorArea: 0, orb: 0, novaCd: 0, laser: 0, otherPen: 0, gem: 0, boss: 0 }; }
function emptyStats() {
  return { power: 0, haste: 0, area: 0, maxHp: 0, xp: 0, gold: 0, defense: 0, elem: {}, uq: newUq() };
}
/** v1.1 ユニーク効果（エピック以上の装備）。m=1 通常、m=2 レジェンドの強力版 */
const UNIQUES = {
  chain: { desc: m => `連鎖雷の跳躍 +${m}`, apply(u, m) { u.chain += m; } },
  missile: { desc: m => `ミサイル +${m}発（威力-10%）`, apply(u, m) { u.missile += m; u.missileMult *= 0.9; } },
  meteor: { desc: m => `隕石の範囲 +${25 * m}%`, apply(u, m) { u.meteorArea += 0.25 * m; } },
  orb: { desc: m => `オーブ +${m}個`, apply(u, m) { u.orb += m; } },
  nova: { desc: m => `ノヴァのクールダウン -${m === 2 ? 40 : 25}%`, apply(u, m) { u.novaCd += m === 2 ? 0.40 : 0.25; } },
  laser: { desc: m => `レーザー威力 +${m === 2 ? 50 : 30}%（他魔法-10%）`, apply(u, m) { u.laser += m === 2 ? 0.5 : 0.3; u.otherPen = Math.min(0.3, u.otherPen + 0.1); } },
  gem: { desc: m => `ジェム取得範囲 +${50 * m}%`, apply(u, m) { u.gem += 0.5 * m; } },
  boss: { desc: m => `ボスへのダメージ +${m === 2 ? 35 : 20}%`, apply(u, m) { u.boss += m === 2 ? 0.35 : 0.2; } },
};
const UNIQUE_IDS = Object.keys(UNIQUES);
function uniqueTexts(item) { return ((item && item.uniques) || []).filter(u => UNIQUES[u.id]).map(u => UNIQUES[u.id].desc(u.m)); }
function calcDamage(base, stats, spellId, rng) {
  const u = stats.uq;
  const um = u ? (spellId === 'laser' ? 1 + u.laser : (u.otherPen > 0 ? 1 - u.otherPen : 1)) : 1;
  const mult = (1 + stats.power) * (1 + ((stats.elem && stats.elem[spellId]) || 0)) * um;
  const variance = rng ? 0.92 + rng() * 0.16 : 1;
  const crit = rng ? rng() < CRIT_CHANCE : false;
  return { dmg: Math.max(1, Math.round(base * mult * variance * (crit ? 1.5 : 1))), crit };
}
function hitChance(translucent) { return translucent ? 1 - GHOST_MISS : 1; }
function incomingDamage(base, defense) { return Math.max(1, Math.round(base * (1 - Math.min(0.6, defense || 0)))); }
function cdMult(st) { return Math.max(0.3, (1 - st.cdr) / (1 + st.haste)); }

/* ---------- 装備 ---------- */
const STAT_INFO = {
  power: { name: '魔力', unit: '%', w: 1.0 },
  haste: { name: '詠唱速度', unit: '%', w: 1.2 },
  area: { name: '効果範囲', unit: '%', w: 0.8 },
  maxHp: { name: '最大HP', unit: '', w: 0.2 },
  xp: { name: '経験値', unit: '%', w: 0.5 },
  gold: { name: 'ゴールド', unit: '%', w: 0.3 },
  defense: { name: '防御', unit: '%', w: 1.5 },
};
for (const s of SPELL_IDS) STAT_INFO['e_' + s] = { name: SPELLS[s].name.replace(/^(.{0,4}).*$/, '$1') + '威力', unit: '%', w: 0.7 };
STAT_INFO.e_missile.name = 'ミサイル威力'; STAT_INFO.e_lightning.name = '雷魔法威力';
STAT_INFO.e_meteor.name = '隕石魔法威力'; STAT_INFO.e_frost.name = '氷魔法威力';
STAT_INFO.e_orb.name = 'オーブ威力'; STAT_INFO.e_laser.name = 'レーザー威力';
const AFFIX_RANGE = {
  power: [4, 8], haste: [3, 6], area: [4, 8], maxHp: [10, 20], xp: [5, 10], gold: [5, 12], defense: [2, 4],
  e_missile: [8, 15], e_lightning: [8, 15], e_meteor: [8, 15], e_frost: [8, 15], e_orb: [8, 15], e_laser: [8, 15],
};
const BASE_STAT = { wand: ['power', 8], robe: ['maxHp', 25], amulet: ['area', 8], ring: ['haste', 5] };
const SLOT_BIAS = {
  wand: { power: 4, haste: 3, e_missile: 1.5, e_lightning: 2, e_meteor: 1.5, e_frost: 1.5, e_orb: 1.5, e_laser: 1.5 },
  robe: { maxHp: 4, defense: 4 },
  amulet: { area: 4, xp: 4 },
  ring: { haste: 4, gold: 4 },
};
const SLOT_WORDS = {
  wand: ['古杖', '霊杖', '錫杖', '魔杖', '長杖'],
  robe: ['ローブ', '法衣', '羽織', '外套'],
  amulet: ['護符', '勾玉', '数珠', '御守'],
  ring: ['指輪', '印環', '銀環', '指環'],
};
const GENERIC_PREFIX = ['月読の', '朱雀の', '玄武の', '白虎の', '青龍の', '暁の', '黄昏の', '幽玄の', '天狼の', '桜花の', '螢火の', '神楽の', '墨染の', '千年の', '蒼穹の', '夜叉の', '風花の', '残月の', '朧の', '常磐の'];
const ELEM_PREFIX = { e_lightning: '雷鳴の', e_meteor: '紅蓮の', e_frost: '霜降の', e_orb: '天球の', e_laser: '紫電の', e_missile: '流星の' };

function round1(v) { return Math.round(v * 10) / 10; }
function baseValue(item) {
  const [, v0] = BASE_STAT[item.slot];
  const key = BASE_STAT[item.slot][0];
  const raw = v0 * (1 + 0.12 * (item.ilvl - 1)) * RARITIES[item.rarity].mult * (1 + 0.15 * item.enh);
  return key === 'maxHp' ? Math.round(raw) : round1(raw);
}
function itemStatList(item) {
  const list = [{ key: BASE_STAT[item.slot][0], v: baseValue(item), base: true }];
  for (const a of item.affixes) list.push({ key: a.key, v: a.v });
  return list;
}
function fmtStat(key, v) {
  const i = STAT_INFO[key];
  return `${i.name} +${v}${i.unit}`;
}
/** v1.1 出所別分布：通常=コモン中心／エリート=レア以上確定／ボス=エピック以上確定（レジェンドは連続ハズレで補正） */
function rollRarity(stage, rng, mode, pity) {
  const s = stage - 1;
  const base = [62 - 2.5 * s, 27 + 0.5 * s, 9 + 1.5 * s, 2 + 0.5 * s];
  let w;
  if (mode === 'boss') w = [0, 0, base[2] * 1.8, base[3] * 2.2 * (1 + BOSS_PITY_STEP * Math.min(BOSS_PITY_MAX, pity || 0))];
  else if (mode === 'elite') w = [0, base[1], base[2] * 1.6, base[3] * 1.8];
  else w = [80 - 2.5 * s, 16 + 0.5 * s, 3.5 + 1.2 * s, 0.5 + 0.3 * s];
  return weightedIndex(rng, w);
}
function genEquipment(stage, rng, opts) {
  opts = opts || {};
  const slot = opts.slot || rpick(rng, SLOTS);
  const rarity = opts.rarity != null ? opts.rarity : rollRarity(stage, rng, opts.mode, opts.pity);
  const item = { id: opts.id || ('x' + Math.floor(rng() * 1e9).toString(36)), slot, rarity, ilvl: stage, enh: 0, name: '', affixes: [], uniques: [] };
  const baseKey = BASE_STAT[slot][0];
  const used = new Set([baseKey]);
  const n = RARITIES[rarity].affixes;
  const keys = Object.keys(AFFIX_RANGE);
  for (let i = 0; i < n; i++) {
    const cand = keys.filter(k => !used.has(k));
    const ws = cand.map(k => (SLOT_BIAS[slot][k] || 1));
    const key = cand[weightedIndex(rng, ws)];
    used.add(key);
    const [lo, hi] = AFFIX_RANGE[key];
    const scale = 1 + 0.06 * (stage - 1);
    item.affixes.push({ key, v: key === 'maxHp' ? Math.round(rrange(rng, lo, hi) * scale) : Math.max(1, Math.round(rrange(rng, lo, hi) * scale)) });
  }
  if (rarity >= 2) {   // ユニーク効果：エピック=1つ／レジェンド=強力版1つ or 2つ
    const first = rpick(rng, UNIQUE_IDS);
    if (rarity === 2) item.uniques = [{ id: first, m: 1 }];
    else if (rng() < 0.5) item.uniques = [{ id: first, m: 2 }];
    else item.uniques = [{ id: first, m: 1 }, { id: rpick(rng, UNIQUE_IDS.filter(k => k !== first)), m: 1 }];
  }
  const elemAff = item.affixes.find(a => ELEM_PREFIX[a.key]);
  const prefix = elemAff ? ELEM_PREFIX[elemAff.key] : rpick(rng, GENERIC_PREFIX);
  item.name = prefix + rpick(rng, SLOT_WORDS[slot]);
  return item;
}
function rollDrop(kind, rng) {
  if (kind === 'boss') return 1 + (rng() < DROP_RATE.bossExtra ? 1 : 0);
  const p = kind === 'elite' ? DROP_RATE.elite : DROP_RATE.normal;
  return rng() < p ? 1 : 0;
}
function computeEquipStats(items) {
  const st = emptyStats();
  for (const it of items) {
    if (!it) continue;
    for (const s of itemStatList(it)) {
      if (s.key === 'maxHp') st.maxHp += s.v;
      else if (s.key.startsWith('e_')) { const sp = s.key.slice(2); st.elem[sp] = (st.elem[sp] || 0) + s.v / 100; }
      else st[s.key] += s.v / 100;
    }
    for (const u of (it.uniques || [])) if (UNIQUES[u.id]) UNIQUES[u.id].apply(st.uq, u.m);
  }
  return st;
}
function itemScore(item) {
  if (!item) return 0;
  let t = 0;
  for (const s of itemStatList(item)) t += s.v * STAT_INFO[s.key].w;
  t += 6 * (item.uniques ? item.uniques.length : 0);
  return Math.round(t * 10) / 10;
}
function enhanceCost(enh, rarity) {
  return Math.round(20 * Math.pow(1.55, enh) * RARITIES[rarity].cost / 5) * 5;
}
function totalEnhanceSpent(enh, rarity) {
  let t = 0; for (let k = 0; k < enh; k++) t += enhanceCost(k, rarity); return t;
}
function sellBase(item) { return Math.round(RARITIES[item.rarity].sell * (1 + 0.35 * (item.ilvl - 1))); }
/** v1.1 強化費の返還分（投入した強化費の75%） */
function enhanceRefund(item) { return Math.round(ENH_REFUND * totalEnhanceSpent(item.enh, item.rarity)); }
function sellPrice(item) { return sellBase(item) + enhanceRefund(item); }
/** 所持上限超過時、装備中でない最古の最低レアリティ（まずコモン）から自動売却 */
function addToInventory(inv, item, equippedIds, cap) {
  cap = cap || INV_CAP;
  inv.push(item);
  const sold = []; let gold = 0;
  while (inv.length > cap) {
    let idx = -1;
    for (let r = 0; r < RARITIES.length && idx < 0; r++) {
      idx = inv.findIndex(x => x !== item && x.rarity === r && !(equippedIds && equippedIds.has(x.id)));
    }
    if (idx < 0) break;
    const [s] = inv.splice(idx, 1);
    sold.push(s); gold += sellPrice(s);
  }
  return { sold, gold };
}

/* ---------- 戦闘エンジン ---------- */
function deriveStats(b) {
  const e = b.eq, p = b.passive;
  b.stats = {
    power: e.power + 0.12 * p.power,
    haste: e.haste,
    cdr: Math.min(0.5, 0.08 * p.cdr),
    area: e.area + 0.10 * p.area,
    maxHp: BASE_HP + e.maxHp + 10 * p.wisdom,
    xp: e.xp + 0.10 * p.wisdom,
    gold: e.gold,
    defense: Math.min(0.6, e.defense),
    elem: e.elem || {},
    uq: e.uq || newUq(),
  };
}
function createBattle(opts) {
  const rng = opts.rng || mulberry32(opts.seed || 1);
  const b = {
    stage: opts.stage || 1, rng, time: 0, wave: 1, waveT: 0, inGap: false, state: 'playing',
    eq: Object.assign(emptyStats(), opts.equipStats || {}), passive: { power: 0, cdr: 0, area: 0, wisdom: 0 },
    spells: { missile: { lv: 1, cd: 0.3 } },
    player: { r: PLAYER_R, hp: BASE_HP, maxHp: BASE_HP, level: 1, xp: 0 },
    enemies: [], projs: [], meteors: [], gems: [], events: [], eid: 1,
    orbAngle: 0, laser: null, spawnT: 1.2, kills: 0, goldF: 0, drops: [], pending: 0, choices: null,
    boss: null, bossSpawned: false, view: opts.view || { hx: 180, up: 450, down: 330 },
    vacuum: false, hurtFlash: 0, invuln: 0, elites: 0, maxWave: 1, retreat: false,
    rerolls: FREE_REROLLS, dmgBy: {}, reachBy: {}, burns: [], trail: [], trailAcc: 0, shockT: 0, barrierT: 0,
    bossPity: opts.bossPity || 0, ownedSlots: new Set(opts.ownedSlots || []), firstDropDone: false,
  };
  b.eq.elem = b.eq.elem || {}; b.eq.uq = b.eq.uq || newUq();
  deriveStats(b);
  b.player.maxHp = b.stats.maxHp; b.player.hp = b.player.maxHp;
  b.events.push({ type: 'wave', wave: 1 });
  return b;
}
function ev(b, e) { b.events.push(e); }

function makeEnemy(b, type, x, y, o) {
  o = o || {};
  const d = ENEMIES[type];
  const wv = type === 'boss' ? MAX_WAVE : b.wave;
  const elite = !!o.elite;
  const hp = d.hp * enemyHpMult(b.stage, wv) * (elite ? 4 : 1);
  const e = {
    id: b.eid++, type, x, y, hp, maxHp: hp, r: d.r * (elite ? 1.45 : 1), spd: d.spd * (type === 'boss' ? 1 : 1),
    dmg: d.dmg * enemyDmgMult(b.stage, wv) * (elite ? 2 : 1), elite, summoned: !!o.summoned,
    slowT: 0, slowAmt: 0, atk: 0.5, orbCd: 0, flash: 0, seed: b.rng(), age: 0,
    phaseT: b.rng() * GHOST_CYCLE, summonT: 1.5, translucent: false, stopped: false, frozenT: 0, trailCd: 0, reached: false,
  };
  b.enemies.push(e);
  return e;
}
function spawnEdgePoint(b, angle) {
  const v = b.view, c = Math.cos(angle), s = Math.sin(angle);
  const ext = s < 0 ? v.up : v.down;
  const t = Math.min(Math.abs(c) > 1e-4 ? v.hx / Math.abs(c) : 1e9, Math.abs(s) > 1e-4 ? ext / Math.abs(s) : 1e9) + 45;
  const d = Math.min(760, Math.max(230, t));
  return { x: c * d, y: s * d };
}
function randSpawnAngle(b) {
  const up = b.rng() < 0.8;
  const a = b.rng() * Math.PI;
  return up ? -a : a;
}
function spawnGroup(b) {
  const types = unlockedTypes(b.stage, b.wave);
  const ws = types.map(t => ENEMIES[t].w);
  const type = types[weightedIndex(b.rng, ws)];
  const baseAngle = randSpawnAngle(b);
  let n = 1 + Math.floor(b.wave / 5) + (b.rng() < 0.3 ? 1 : 0);
  if (type === 'dash') n = 4 + Math.floor(b.rng() * 3);
  if (type === 'golem') n = 1;
  for (let i = 0; i < n; i++) {
    if (b.enemies.length >= MAX_ENEMIES) break;
    const ang = baseAngle + (b.rng() - 0.5) * (type === 'dash' ? 0.25 : 0.5);
    const p = spawnEdgePoint(b, ang);
    const elite = b.wave >= 2 && type !== 'dash' && b.rng() < ELITE_CHANCE;
    if (elite) b.elites++;
    makeEnemy(b, type, p.x + (b.rng() - 0.5) * 20, p.y + (b.rng() - 0.5) * 20, { elite });
  }
}
function startWave(b) {
  ev(b, { type: 'wave', wave: b.wave });
  b.maxWave = b.wave;
  if (b.wave === MAX_WAVE && !b.bossSpawned) {
    b.bossSpawned = true;
    const p = spawnEdgePoint(b, -Math.PI / 2 + (b.rng() - 0.5) * 0.6);
    b.boss = makeEnemy(b, 'boss', p.x, p.y);
    b.boss.name = stageInfo(b.stage).boss;
    ev(b, { type: 'boss', name: b.boss.name });
  }
}
function nearestEnemy(b, x, y, exclude, maxD) {
  let best = null, bd = (maxD || TARGET_RANGE) ** 2;
  for (const e of b.enemies) {
    if (exclude && exclude.has(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function enemiesInRange(b) {
  const r2 = TARGET_RANGE * TARGET_RANGE;
  return b.enemies.filter(e => e.x * e.x + e.y * e.y <= r2);
}

function dealDamage(b, e, base, spellId, hitX, hitY) {
  if (e.hp <= 0) return false;
  if (e.type === 'ghost' && e.translucent && b.rng() > hitChance(true)) {
    ev(b, { type: 'miss', x: e.x, y: e.y - e.r });
    return false;
  }
  let { dmg, crit } = calcDamage(base * SPELL_POWER, b.stats, spellId, b.rng);
  if (e.type === 'boss' && b.stats.uq && b.stats.uq.boss) dmg = Math.max(1, Math.round(dmg * (1 + b.stats.uq.boss)));
  if (b.dmgBy) b.dmgBy[spellId] = (b.dmgBy[spellId] || 0) + dmg;
  e.hp -= dmg; e.flash = 0.12;
  ev(b, { type: 'hit', x: hitX == null ? e.x : hitX, y: hitY == null ? e.y : hitY, dmg, crit, spell: spellId, big: e.boss || e.type === 'boss' });
  if (e.hp <= 0) killEnemy(b, e);
  return true;
}
function addXp(b, v) {
  const p = b.player;
  p.xp += v * (1 + b.stats.xp);
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++; b.pending++;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15);
    ev(b, { type: 'levelup', level: p.level });
  }
}
function killEnemy(b, e) {
  const i = b.enemies.indexOf(e);
  if (i >= 0) b.enemies.splice(i, 1);
  b.kills++;
  const d = ENEMIES[e.type];
  let gold = d.gold * goldMult(b.stage) * (1 + b.stats.gold);
  if (e.elite) gold *= 6;
  b.goldF += gold;
  ev(b, { type: 'die', x: e.x, y: e.y, r: e.r, etype: e.type, elite: e.elite });
  if (!e.summoned && e.type !== 'imp' && e.type !== 'splitlet') {
    const v = e.type === 'boss' ? 25 : e.elite ? 5 : 1;
    b.gems.push({ x: e.x, y: e.y, v, age: 0, big: v >= 5 });
  }
  if (e.type === 'splitter') {
    for (let k = 0; k < 2; k++) {
      const s = makeEnemy(b, 'splitlet', e.x + (k ? 10 : -10), e.y + (b.rng() - 0.5) * 8);
      s.hp = s.maxHp = ENEMIES.splitlet.hp * enemyHpMult(b.stage, b.wave);
    }
  }
  const kind = e.type === 'boss' ? 'boss' : e.elite ? 'elite' : 'normal';
  if (!e.summoned && e.type !== 'splitlet' && e.type !== 'imp') {
    const n = rollDrop(kind, b.rng);
    for (let k = 0; k < n; k++) {
      const dopts = { mode: kind };
      if (!b.firstDropDone) {      // v1.1 そのランの最初のドロップは未所持の部位を優先
        const free = SLOTS.filter(sl => !b.ownedSlots.has(sl));
        if (free.length) dopts.slot = rpick(b.rng, free);
      }
      if (kind === 'boss') dopts.pity = b.bossPity;
      const item = genEquipment(b.stage, b.rng, dopts);
      b.firstDropDone = true;
      if (kind === 'boss') b.bossPity = item.rarity === 3 ? 0 : Math.min(BOSS_PITY_MAX, b.bossPity + 1);
      b.drops.push(item);
      ev(b, { type: 'loot', x: e.x, y: e.y, item });
    }
  }
  if (e.type === 'boss') {
    b.state = 'won'; b.vacuum = true;
    b.goldF += 100 + 20 * b.stage;
    for (const o of b.enemies) ev(b, { type: 'die', x: o.x, y: o.y, r: o.r, etype: o.type, elite: false, vanish: true });
    b.enemies.length = 0; b.projs.length = 0; b.meteors.length = 0; b.burns.length = 0; b.laser = null;
    ev(b, { type: 'won' });
  }
}
function hurtPlayer(b, dmg) {
  const p = b.player;
  if (b.invuln > 0) return;
  b.invuln = 0.4;
  const amount = incomingDamage(dmg, b.stats.defense);
  p.hp -= amount; b.hurtFlash = 0.25;
  ev(b, { type: 'hurt', dmg: amount });
  if (p.hp <= 0) { p.hp = 0; b.state = 'lost'; ev(b, { type: 'lost' }); }
}

function updateEnemies(b, dt) {
  const P = b.player;
  for (let i = b.enemies.length - 1; i >= 0; i--) {
    const e = b.enemies[i];
    if (e.hp <= 0) continue;
    e.age += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.orbCd > 0) e.orbCd -= dt;
    if (e.trailCd > 0) e.trailCd -= dt;
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowAmt = 0; }
    if (e.type === 'ghost') {
      e.phaseT = (e.phaseT + dt) % GHOST_CYCLE;
      e.translucent = e.phaseT > GHOST_FADE_FROM;
    }
    const dx = -e.x, dy = -e.y, d = Math.hypot(dx, dy) || 1;
    const contact = e.r + P.r;
    const sp = e.spd * (1 - e.slowAmt);
    if (!e.reached && (d <= contact || (e.type === 'bones' && d <= 165))) {   // v1.1 接近を許した敵種の集計
      e.reached = true; b.reachBy[e.type] = (b.reachBy[e.type] || 0) + 1;
    }
    if (e.frozenT > 0) { e.frozenT -= dt; continue; }
    if (e.type === 'bones' && d <= 165) {
      e.stopped = true;
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 4.0;
        for (let k = 0; k < 2 && b.enemies.length < MAX_ENEMIES; k++) {
          const s = makeEnemy(b, 'imp', e.x + (k ? 16 : -16), e.y + 4, { summoned: true });
          s.hp = s.maxHp = ENEMIES.imp.hp * enemyHpMult(b.stage, b.wave);
        }
        ev(b, { type: 'summon', x: e.x, y: e.y });
      }
    } else if (d > contact) {
      e.x += dx / d * sp * dt; e.y += dy / d * sp * dt;
    } else {
      e.atk += dt;
      if (e.atk >= 1) { e.atk -= 1; hurtPlayer(b, e.dmg); if (b.state === 'lost') return; }
    }
  }
  separate(b);
}
function separate(b) {
  const cell = 44, grid = new Map();
  const arr = b.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const k = Math.floor(e.x / cell) * 4096 + Math.floor(e.y / cell);
    let g = grid.get(k); if (!g) { g = []; grid.set(k, g); } g.push(e);
  }
  for (const e of arr) {
    const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const g = grid.get((cx + ox) * 4096 + (cy + oy)); if (!g) continue;
      for (const o of g) {
        if (o.id <= e.id) continue;
        const dx = o.x - e.x, dy = o.y - e.y, md = (e.r + o.r) * 0.8;
        const d2 = dx * dx + dy * dy;
        if (d2 < md * md && d2 > 0.0001) {
          const d = Math.sqrt(d2), push = (md - d) * 0.25;
          const wE = o.r / (e.r + o.r), wO = e.r / (e.r + o.r);
          e.x -= dx / d * push * wE * 2; e.y -= dy / d * push * wE * 2;
          o.x += dx / d * push * wO * 2; o.y += dy / d * push * wO * 2;
        }
      }
    }
    const pd = Math.hypot(e.x, e.y), minD = (e.r + b.player.r) * 0.95;
    if (pd < minD && pd > 0.001) { e.x *= minD / pd; e.y *= minD / pd; }
  }
}

function areaMult(b) { return 1 + b.stats.area; }
function spellLv(b, id) { const s = b.spells[id]; return s ? s.lv : 1; }
function castSpells(b, dt) {
  const cm = cdMult(b.stats);
  for (const id of SPELL_IDS) {
    const s = b.spells[id]; if (!s) continue;
    const L = SPELLS[id].lv[s.lv - 1];
    if (id === 'orb') continue;
    if (id === 'laser') { if (b.laser) continue; }
    s.cd -= dt;
    if (s.cd > 0) continue;
    let cast = false;
    if (id === 'missile') cast = castMissile(b, L);
    else if (id === 'lightning') cast = castLightning(b, L);
    else if (id === 'meteor') cast = castMeteor(b, L);
    else if (id === 'frost') cast = castFrost(b, L);
    else if (id === 'laser') cast = castLaser(b, L);
    const cdk = id === 'frost' ? 1 - Math.min(0.6, b.stats.uq.novaCd) : 1;
    if (cast && id !== 'laser') s.cd = Math.max(s.cd, -dt) + SPELLS[id].cd * cm * cdk;
    else if (!cast) s.cd = 0;
  }
}
function castMissile(b, L) {
  const used = new Set();
  const lv = spellLv(b, 'missile'), uq = b.stats.uq;
  const n = L.n + uq.missile;
  let any = false;
  for (let i = 0; i < n; i++) {
    let t = nearestEnemy(b, 0, 0, used);
    if (!t) t = nearestEnemy(b, 0, 0);
    if (!t) break;
    used.add(t.id); any = true;
    const ang = Math.atan2(t.y, t.x) + (i - (n - 1) / 2) * 0.35;
    b.projs.push({ x: 0, y: 0, vx: Math.cos(ang) * 340, vy: Math.sin(ang) * 340, target: t.id, dmg: L.dmg * uq.missileMult, life: 2.6, trail: [],
      lv, pierce: lv >= 5 ? 1 : 0, rt: false, hit: new Set() });
  }
  if (any) ev(b, { type: 'cast', spell: 'missile' });
  return any;
}
function castLightning(b, L) {
  const first = nearestEnemy(b, 0, 0);
  if (!first) return false;
  const lv = spellLv(b, 'lightning');
  const chain = L.chain + b.stats.uq.chain;
  const decay = lv >= 5 ? 1 : 0.88;            // Lv5：減衰なし
  const hit = new Set([first.id]);
  const pts = [{ x: first.x, y: first.y }];
  let cur = first;
  const targets = [first];
  const chainR = 130 * areaMult(b);
  for (let i = 1; i < chain; i++) {
    const nx = nearestEnemy(b, cur.x, cur.y, hit, chainR);
    if (!nx) break;
    hit.add(nx.id); targets.push(nx); pts.push({ x: nx.x, y: nx.y }); cur = nx;
  }
  targets.forEach((t, i) => dealDamage(b, t, L.dmg * Math.pow(decay, i), 'lightning'));
  if (lv >= 3) {                               // Lv3：連鎖した敵の周囲に小爆発
    const R = 46 * areaMult(b), splashed = new Set(hit);
    for (const p of pts) {
      for (const o of b.enemies.slice()) {
        if (splashed.has(o.id)) continue;
        if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < (R + o.r * 0.5) ** 2) { splashed.add(o.id); dealDamage(b, o, L.dmg * 0.35, 'lightning'); }
      }
      ev(b, { type: 'spark', x: p.x, y: p.y, r: R });
    }
  }
  ev(b, { type: 'bolt', pts });
  return true;
}
function castMeteor(b, L) {
  const cand = enemiesInRange(b);
  if (!cand.length) return false;
  const lv = spellLv(b, 'meteor');
  const r = L.r * areaMult(b) * (1 + b.stats.uq.meteorArea);
  const chosen = [];
  for (let k = 0; k < L.n; k++) {
    let best = null, bs = -1;
    for (const e of cand) {
      if (chosen.some(c => Math.hypot(c.x - e.x, c.y - e.y) < r * 0.8)) continue;
      let sc = 0;
      for (const o of cand) if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 < r * r) sc += 1 + (o.elite ? 3 : 0) + (o.type === 'boss' ? 5 : 0);
      if (sc > bs) { bs = sc; best = e; }
    }
    if (!best) best = cand[Math.floor(b.rng() * cand.length)];
    chosen.push({ x: best.x, y: best.y });
  }
  chosen.forEach((c, i) => b.meteors.push({ x: c.x, y: c.y, t: -i * 0.05, delay: 0.75, r, dmg: L.dmg, burn: lv >= 3 }));
  return true;
}
function castFrost(b, L) {
  const r = L.r * areaMult(b);
  const lv = spellLv(b, 'frost');
  let near = false;
  for (const e of b.enemies) if (Math.hypot(e.x, e.y) < r + e.r) { near = true; break; }
  if (!near) return false;
  for (const e of b.enemies.slice()) {
    if (Math.hypot(e.x, e.y) < r + e.r * 0.5) {
      if (dealDamage(b, e, L.dmg, 'frost') && e.hp > 0) {
        e.slowAmt = Math.max(e.slowAmt, L.slow); e.slowT = 2.2;
        if (lv >= 3 && e.type !== 'boss' && b.rng() < 0.25) { e.frozenT = 1.2; ev(b, { type: 'freeze', x: e.x, y: e.y }); }   // Lv3：凍結
      }
    }
  }
  if (lv >= 5) { b.invuln = Math.max(b.invuln, 0.9); b.barrierT = 0.9; ev(b, { type: 'barrier' }); }   // Lv5：短い無敵バリア
  ev(b, { type: 'nova', r });
  return true;
}
/** v1.1 レーザーの優先順位：ボス＞エリート＞HPの高い敵 */
function laserTargets(b, n, exclude) {
  const pr = e => (e.type === 'boss' ? 2 : e.elite ? 1 : 0);
  const cand = enemiesInRange(b).filter(e => !exclude || !exclude.has(e.id));
  cand.sort((a, c) => pr(c) - pr(a) || c.hp - a.hp);
  return cand.slice(0, n);
}
function castLaser(b, L) {
  const lv = spellLv(b, 'laser');
  const ts = laserTargets(b, lv >= 5 ? 2 : 1);
  if (!ts.length) return false;
  b.laser = { t: 0, tick: 0, beams: ts.map(t => ({ target: t.id, ang: Math.atan2(t.y, t.x) })), w: L.w * areaMult(b), L, lv };
  ev(b, { type: 'cast', spell: 'laser' });
  return true;
}
function updateLaser(b, dt) {
  const l = b.laser; if (!l) return;
  l.t += dt; l.tick += dt;
  let alive = 0;
  l.beams.forEach((bm, bi) => {
    let tgt = b.enemies.find(e => e.id === bm.target);
    if (!tgt) {
      const taken = new Set(l.beams.map(x => x.target));
      const nt = laserTargets(b, 1, taken)[0];
      if (nt) { tgt = nt; bm.target = nt.id; }
    }
    bm.has = !!tgt;
    if (tgt) {
      alive++;
      const want = Math.atan2(tgt.y, tgt.x);
      let da = want - bm.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      bm.ang += da * Math.min(1, dt * 10);
    }
  });
  l.ang = l.beams[0].ang;
  while (l.tick >= LASER_TICK) {
    l.tick -= LASER_TICK;
    const done = new Set();
    for (const bm of l.beams) {
      const cx = Math.cos(bm.ang), cy = Math.sin(bm.ang);
      for (const e of b.enemies.slice()) {
        if (done.has(e.id)) continue;
        const along = e.x * cx + e.y * cy;
        if (along < 0 || along > 700) continue;
        const perp = Math.abs(e.x * -cy + e.y * cx);
        if (perp < l.w / 2 + e.r * 0.7) { done.add(e.id); dealDamage(b, e, l.L.dmg, 'laser'); }
      }
    }
    if (l.lv >= 3) {                           // Lv3：照射中の敵の周囲にも拡散ダメージ
      const R = 70 * areaMult(b);
      for (const bm of l.beams) {
        const t = b.enemies.find(e => e.id === bm.target); if (!t) continue;
        for (const o of b.enemies.slice()) {
          if (done.has(o.id)) continue;
          if ((o.x - t.x) ** 2 + (o.y - t.y) ** 2 < (R + o.r * 0.5) ** 2) { done.add(o.id); dealDamage(b, o, l.L.dmg * 0.4, 'laser'); }
        }
      }
    }
  }
  if (l.t >= LASER_DUR || (!alive && l.t > 0.3)) {
    b.laser = null;
    b.spells.laser.cd = SPELLS.laser.cd * cdMult(b.stats);
  }
}
function updateOrbs(b, dt) {
  const s = b.spells.orb; if (!s) return;
  const L = SPELLS.orb.lv[s.lv - 1];
  const n = L.n + b.stats.uq.orb;
  b.orbAngle += 2.6 * dt;
  const rad = 68 * areaMult(b);
  b.orbPos = [];
  const lay = s.lv >= 3;
  if (lay) {                                   // Lv3：残像（軌跡）
    b.trailAcc += dt;
    for (let k = b.trail.length - 1; k >= 0; k--) { b.trail[k].t -= dt; if (b.trail[k].t <= 0) b.trail.splice(k, 1); }
  }
  const drop = lay && b.trailAcc >= 0.07; if (drop) b.trailAcc = 0;
  for (let i = 0; i < n; i++) {
    const a = b.orbAngle + i * (Math.PI * 2 / n);
    const ox = Math.cos(a) * rad, oy = Math.sin(a) * rad;
    b.orbPos.push({ x: ox, y: oy });
    if (drop) b.trail.push({ x: ox, y: oy, t: 0.6 });
    for (const e of b.enemies.slice()) {
      if (e.orbCd > 0 || e.hp <= 0) continue;
      if ((e.x - ox) ** 2 + (e.y - oy) ** 2 < (e.r + 9) ** 2) {
        e.orbCd = 0.5;
        dealDamage(b, e, L.dmg, 'orb', ox, oy);
      }
    }
  }
  if (lay && b.trail.length) {
    for (const e of b.enemies.slice()) {
      if (e.trailCd > 0 || e.hp <= 0) continue;
      const rr = (e.r + 8) ** 2;
      for (const p of b.trail) {
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr) { e.trailCd = 0.4; dealDamage(b, e, L.dmg * 0.45, 'orb', p.x, p.y); break; }
      }
    }
  }
  if (s.lv >= 5) {                             // Lv5：定期的な衝撃波
    b.shockT += dt;
    if (b.shockT >= 3) {
      b.shockT = 0;
      const R = 115 * areaMult(b);
      for (const e of b.enemies.slice()) if (Math.hypot(e.x, e.y) < R + e.r * 0.5) dealDamage(b, e, L.dmg * 1.6, 'orb');
      ev(b, { type: 'shock', r: R });
    }
  }
}
function updateProjs(b, dt) {
  for (let i = b.projs.length - 1; i >= 0; i--) {
    const p = b.projs[i];
    if (!p) continue;
    p.life -= dt;
    let t = b.enemies.find(e => e.id === p.target);
    if (!t) { t = nearestEnemy(b, p.x, p.y, p.hit); if (t) p.target = t.id; }
    if (t) {
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
      const sp = Math.hypot(p.vx, p.vy);
      const k = Math.min(1, dt * 9);
      p.vx += (dx / d * sp - p.vx) * k; p.vy += (dy / d * sp - p.vy) * k;
      const nsp = Math.hypot(p.vx, p.vy) || 1; p.vx *= sp / nsp; p.vy *= sp / nsp;
      if (d < t.r + 6) {
        dealDamage(b, t, p.dmg, 'missile', p.x, p.y);
        if (b.state !== 'playing') return;
        p.hit.add(t.id);
        let keep = false;
        if (p.lv >= 3 && t.hp <= 0 && !p.rt) { p.rt = true; keep = true; }      // Lv3：撃破時に再追尾
        else if (p.pierce > 0) { p.pierce--; keep = true; }                    // Lv5：1体貫通
        if (keep) {
          const nt = nearestEnemy(b, p.x, p.y, p.hit);
          if (nt) { p.target = nt.id; p.life = Math.max(p.life, 1.2); continue; }
        }
        const k2 = b.projs.indexOf(p); if (k2 >= 0) b.projs.splice(k2, 1);
        continue;
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.trail) { p.trail.push(p.x, p.y); if (p.trail.length > 12) p.trail.splice(0, 2); }
    if (p.life <= 0) b.projs.splice(i, 1);
  }
}
function updateMeteors(b, dt) {
  for (let i = b.meteors.length - 1; i >= 0; i--) {
    const m = b.meteors[i];
    if (!m) continue;
    m.t += dt;
    if (m.t >= m.delay) {
      b.meteors.splice(i, 1);
      if (b.state !== 'playing') return;
      for (const e of b.enemies.slice()) {
        if (Math.hypot(e.x - m.x, e.y - m.y) < m.r + e.r * 0.5) dealDamage(b, e, m.dmg, 'meteor');
      }
      if (m.burn && b.state === 'playing') b.burns.push({ x: m.x, y: m.y, r: m.r * 0.85, t: 3, tick: 0, dmg: m.dmg * 0.1 });   // Lv3：燃える地面
      ev(b, { type: 'meteor', x: m.x, y: m.y, r: m.r });
    }
  }
}
function updateBurns(b, dt) {
  for (let i = b.burns.length - 1; i >= 0; i--) {
    const f = b.burns[i];
    if (!f) continue;                          // ボス撃破で配列が空になった場合
    f.t -= dt; f.tick += dt;
    while (f.tick >= 0.5 && b.state === 'playing') {
      f.tick -= 0.5;
      for (const e of b.enemies.slice()) if (Math.hypot(e.x - f.x, e.y - f.y) < f.r + e.r * 0.5) dealDamage(b, e, f.dmg, 'meteor');
    }
    if (f.t <= 0 && b.burns[i] === f) b.burns.splice(i, 1);
  }
}
function updateGems(b, dt) {
  const P = b.player;
  for (let i = b.gems.length - 1; i >= 0; i--) {
    const g = b.gems[i];
    g.age += dt;
    const d = Math.hypot(g.x, g.y);
    if (d < 70 * (1 + b.stats.uq.gem) || g.age > 4.5 || b.vacuum) {
      g.fly = true;
    }
    if (g.fly) {
      const sp = 260 + g.age * 60;
      const nd = Math.max(0.001, d);
      g.x -= g.x / nd * sp * dt; g.y -= g.y / nd * sp * dt;
    }
    if (Math.hypot(g.x, g.y) < 14) {
      b.gems.splice(i, 1);
      addXp(b, g.v);
      ev(b, { type: 'gem', big: g.big });
    }
  }
}
function updateWaves(b, dt) {
  if (b.wave < MAX_WAVE) {
    b.waveT += dt;
    if (!b.inGap && b.waveT >= WAVE_LEN) { b.inGap = true; b.waveT = 0; ev(b, { type: 'waveend', wave: b.wave }); }
    else if (b.inGap && b.waveT >= WAVE_GAP) { b.inGap = false; b.waveT = 0; b.wave++; startWave(b); }
  } else b.waveT += dt;
  if (!b.inGap) {
    b.spawnT -= dt;
    if (b.spawnT <= 0) {
      if (b.wave === MAX_WAVE && !b.boss) { b.spawnT = 1; return; }
      spawnGroup(b);
      let iv = spawnInterval(b.stage, b.wave, Math.min(1, b.waveT / WAVE_LEN));
      if (b.wave === MAX_WAVE) iv *= 1.7;
      b.spawnT = iv;
    }
  }
}
function stepBattle(b, dt) {
  if (b.state === 'levelup' || b.state !== 'playing') return;
  b.time += dt;
  if (b.hurtFlash > 0) b.hurtFlash -= dt;
  if (b.invuln > 0) b.invuln -= dt;
  b.player.hp = Math.min(b.player.maxHp, b.player.hp + REGEN * dt);
  updateWaves(b, dt);
  updateEnemies(b, dt);
  if (b.state !== 'playing') return;
  castSpells(b, dt);
  updateLaser(b, dt);
  updateOrbs(b, dt);
  updateProjs(b, dt);
  updateMeteors(b, dt);
  updateBurns(b, dt);
  if (b.barrierT > 0) b.barrierT -= dt;
  if (b.state !== 'playing') return;
  updateGems(b, dt);
  if (b.state === 'playing' && b.pending > 0) {
    b.state = 'levelup'; b.choices = makeChoices(b);
  }
}

/* ---------- レベルアップ3択 ---------- */
function makeChoices(b) {
  const opts = [];
  const owned = Object.keys(b.spells).length;
  const spellFull = owned >= MAX_SPELLS;
  const passFull = PASSIVE_IDS.filter(id => b.passive[id] > 0).length >= MAX_PASSIVES;
  for (const id of SPELL_IDS) {
    const s = b.spells[id];
    if (!s) { if (!spellFull) opts.push({ kind: 'spell-new', id, w: owned < 3 ? 4 : 3 }); }   // 枠が空いている時のみ新規
    else if (s.lv < 5) opts.push({ kind: 'spell-up', id, w: 2.2 });
  }
  for (const id of PASSIVE_IDS) if (b.passive[id] < 5 && (b.passive[id] > 0 || !passFull)) opts.push({ kind: 'passive', id, w: 1.4 });
  const out = [];
  while (out.length < 3 && opts.length) {
    const i = weightedIndex(b.rng, opts.map(o => o.w));
    out.push(opts.splice(i, 1)[0]);
  }
  const fillers = [{ kind: 'heal' }, { kind: 'gold' }];
  while (out.length < 3) out.push(fillers[out.length % 2]);
  return out;
}
/** v1.1 無料リロール（1ラン2回）。直前と同じ3択になりにくいよう数回引き直す */
function rerollChoices(b) {
  if (b.state !== 'levelup' || b.rerolls <= 0) return false;
  b.rerolls--;
  const key = cs => cs.map(c => c.kind + (c.id || '')).sort().join('|');
  const old = key(b.choices);
  let nc = makeChoices(b);
  for (let k = 0; k < 6 && key(nc) === old; k++) nc = makeChoices(b);
  b.choices = nc;
  return true;
}
function applyCard(b, c) {
  if (b.state !== 'levelup') return;
  if (c.kind === 'spell-new') b.spells[c.id] = { lv: 1, cd: 0.2 };
  else if (c.kind === 'spell-up') b.spells[c.id].lv++;
  else if (c.kind === 'passive') {
    b.passive[c.id]++;
    const old = b.player.maxHp;
    deriveStats(b);
    b.player.maxHp = b.stats.maxHp;
    b.player.hp += b.player.maxHp - old;
  } else if (c.kind === 'heal') b.player.hp = Math.min(b.player.maxHp, b.player.hp + b.player.maxHp * 0.4);
  else if (c.kind === 'gold') b.goldF += 50 * b.stage;
  b.pending--;
  if (b.pending > 0) b.choices = makeChoices(b);
  else { b.choices = null; b.state = 'playing'; }
}

/* ---------- ヘッドレス・シミュレーション ---------- */
function simulateBattle(o) {
  const seed = o.seed || 1;
  const rng = mulberry32(seed);
  const prng = mulberry32((seed * 2654435761) >>> 0);
  const b = createBattle({ stage: o.stage || 1, equipStats: o.equipStats, rng });
  const dt = o.dt || 1 / 30, maxT = o.maxTime || 420;
  const prefer = ['lightning', 'meteor', 'frost', 'orb', 'laser'];
  let guard = 0;
  while ((b.state === 'playing' || b.state === 'levelup') && b.time < maxT && guard++ < 200000) {
    if (b.state === 'levelup') {
      let c;
      if (o.build) {                       // 固定ビルド：優先リスト順に取る。無ければリロール→回復
        const pri = o.build.priority;
        for (const key of pri) {
          c = b.choices.find(x => ((x.kind === 'spell-new' || x.kind === 'spell-up') && 'spell:' + x.id === key) || (x.kind === 'passive' && 'passive:' + x.id === key));
          if (c) break;
        }
        if (!c && o.build.reroll && rerollChoices(b)) continue;
        if (!c) c = b.choices.find(x => x.kind === 'heal') || b.choices.find(x => x.kind === 'gold') || b.choices[0];
      } else if (o.policy === 'spells') {
        c = b.choices.find(x => x.kind === 'spell-new') || b.choices.find(x => x.kind === 'spell-up') || b.choices[0];
      } else c = b.choices[Math.floor(prng() * b.choices.length)];
      applyCard(b, c);
      continue;
    }
    stepBattle(b, dt);
    b.events.length = 0;
  }
  return {
    won: b.state === 'won', lost: b.state === 'lost', time: b.time, level: b.player.level, kills: b.kills,
    gold: Math.floor(b.goldF), drops: b.drops.length, wave: b.maxWave, hpLeft: b.player.hp, elites: b.elites,
    spells: Object.keys(b.spells).length, spellIds: Object.keys(b.spells), passives: Object.assign({}, b.passive), bossReached: b.bossSpawned, dmgBy: b.dmgBy, reachBy: b.reachBy, rerollsLeft: b.rerolls,
  };
}

/* ---------- セーブ（純粋部分） ---------- */
const DEFAULT_SETTINGS = { mute: false, fps30: false };
function defaultSave() {
  return { v: 1, gold: 0, cleared: 0, inv: [], equipped: { wand: null, robe: null, amulet: null, ring: null }, nextId: 1, settings: Object.assign({}, DEFAULT_SETTINGS), bestWave: {}, bossPity: 0 };
}
function sanitizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const s = Object.assign(d, raw);
  s.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
  s.equipped = Object.assign({ wand: null, robe: null, amulet: null, ring: null }, raw.equipped || {});
  s.inv = Array.isArray(raw.inv) ? raw.inv.filter(it => it && SLOTS.includes(it.slot) && RARITIES[it.rarity] && Array.isArray(it.affixes)) : [];
  for (const it of s.inv) it.uniques = Array.isArray(it.uniques) ? it.uniques.filter(u => u && UNIQUES[u.id] && (u.m === 1 || u.m === 2)) : [];
  const ids = new Set(s.inv.map(i => i.id));
  for (const k of SLOTS) if (!ids.has(s.equipped[k])) s.equipped[k] = null;
  s.gold = Math.max(0, Math.floor(+s.gold || 0));
  s.cleared = Math.max(0, Math.min(15, Math.floor(+s.cleared || 0)));
  s.bossPity = Math.max(0, Math.min(BOSS_PITY_MAX, Math.floor(+s.bossPity || 0)));
  s.bestWave = (raw.bestWave && typeof raw.bestWave === 'object') ? raw.bestWave : {};
  return s;
}

/* ---------- v1.1 セーブの書き出し・読み込み（テキスト） ---------- */
const EXPORT_PREFIX = 'MHSAVE1:';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64enc(bin) {
  let o = '';
  for (let i = 0; i < bin.length; i += 3) {
    const a = bin.charCodeAt(i), c2 = bin.charCodeAt(i + 1) || 0, c3 = bin.charCodeAt(i + 2) || 0, n = (a << 16) | (c2 << 8) | c3;
    o += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bin.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bin.length ? B64[n & 63] : '=');
  }
  return o;
}
function b64dec(str) {
  str = str.replace(/=+$/, '');
  let o = '', buf = 0, bits = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch); if (v < 0) throw new Error('b64');
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; o += String.fromCharCode((buf >> bits) & 255); buf &= (1 << bits) - 1; }
  }
  return o;
}
function saveChecksum(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
function exportSave(sv) {
  const json = JSON.stringify(sv);
  return EXPORT_PREFIX + saveChecksum(json) + ':' + b64enc(unescape(encodeURIComponent(json)));
}
function importSave(text) {
  try {
    const t = String(text || '').replace(/\s+/g, '');
    if (!t.startsWith(EXPORT_PREFIX)) return { ok: false, error: '書き出したセーブコードではありません' };
    const rest = t.slice(EXPORT_PREFIX.length), i = rest.indexOf(':');
    if (i < 0) return { ok: false, error: 'セーブコードが途中で切れています' };
    const json = decodeURIComponent(escape(b64dec(rest.slice(i + 1))));
    if (saveChecksum(json) !== rest.slice(0, i)) return { ok: false, error: 'コードが欠けているか、書き換えられています' };
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'セーブの中身が不正です' };
    return { ok: true, save: sanitizeSave(raw) };
  } catch (e) { return { ok: false, error: '読み込めませんでした' }; }
}

const Core = {
  SAVE_KEY, SLOTS, SLOT_NAME, INV_CAP, RARITIES, SPELL_IDS, SPELLS, PASSIVE_IDS, PASSIVES, ENEMIES, CHAPTERS, BOSS_NAMES,
  WAVE_LEN, WAVE_GAP, MAX_WAVE, MAX_ENEMIES, STAT_INFO, AFFIX_RANGE, BASE_STAT, DROP_RATE, ELITE_CHANCE, LASER_DUR, GHOST_MISS,
  stageInfo, mulberry32, weightedIndex, xpNeeded, enemyHpMult, enemyDmgMult, goldMult, spawnInterval, unlockedTypes,
  emptyStats, calcDamage, hitChance, incomingDamage, cdMult,
  baseValue, itemStatList, fmtStat, rollRarity, genEquipment, rollDrop, computeEquipStats, itemScore, enhanceCost,
  totalEnhanceSpent, sellPrice, sellBase, enhanceRefund, addToInventory,
  MAX_SPELLS, MAX_PASSIVES, FREE_REROLLS, ENH_REFUND, UNIQUES, UNIQUE_IDS, uniqueTexts, rerollChoices, laserTargets, exportSave, importSave,
  createBattle, stepBattle, applyCard, dealDamage, makeChoices, deriveStats, simulateBattle, defaultSave, sanitizeSave,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Core;

/* ===== ここから先はブラウザ専用 ===== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
'use strict';

/* ---------- 小物 ---------- */
const $ = id => document.getElementById(id);
const cv = $('cv'), cx = cv.getContext('2d');
const TAU = Math.PI * 2;
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const fmt = n => Math.floor(n).toLocaleString('ja-JP');
const SLOT_ICON = { wand: '杖', robe: '衣', amulet: '護', ring: '環' };

/* ---------- セーブ ---------- */
let save = defaultSave();
let hasSave = false;
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { save = sanitizeSave(JSON.parse(raw)); hasSave = true; return; }
  } catch (e) { /* 破損時は初期化 */ }
  save = defaultSave(); hasSave = false;
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); hasSave = true; } catch (e) { /* 保存不可環境ではメモリのみ */ }
}
const getItem = id => save.inv.find(i => i.id === id) || null;
const equippedItems = () => SLOTS.map(s => getItem(save.equipped[s]));
const equippedSet = () => new Set(SLOTS.map(s => save.equipped[s]).filter(Boolean));

/* ---------- 効果音（WebAudio合成） ---------- */
const Sfx = {
  ctx: null, master: null, noiseBuf: null, last: {},
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.45; this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 0.6, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch (e) { this.ctx = null; }
  },
  tone(type, f0, f1, dur, vol, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, type, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  },
  play(name) {
    if (!this.ctx || save.settings.mute) return;
    const now = performance.now(), gap = { hit: 55, gem: 50, shot: 110, pop: 45, zap: 80 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'zap': this.tone('sawtooth', 1400, 120, 0.14, 0.16); this.noise(0.1, 0.18, 4000, 'highpass'); break;
      case 'boom': this.noise(0.5, 0.5, 380, 'lowpass'); this.tone('sine', 140, 38, 0.4, 0.5); break;
      case 'hit': this.tone('triangle', 420, 170, 0.06, 0.1); break;
      case 'pop': this.noise(0.12, 0.2, 900, 'bandpass'); this.tone('sine', 320, 90, 0.1, 0.12); break;
      case 'shot': this.tone('sine', 620, 980, 0.07, 0.07); break;
      case 'ice': this.noise(0.4, 0.2, 5200, 'highpass'); this.tone('sine', 1500, 600, 0.3, 0.07); break;
      case 'laser': this.tone('sawtooth', 220, 460, 0.5, 0.07); this.tone('square', 110, 220, 0.5, 0.04); break;
      case 'gem': this.tone('sine', 880 + Math.random() * 160, 1500, 0.05, 0.05); break;
      case 'hurt': this.tone('square', 190, 70, 0.18, 0.17); this.noise(0.12, 0.15, 700, 'lowpass'); break;
      case 'lvl': [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.28, 0.16, i * 0.07)); break;
      case 'warn': for (let i = 0; i < 3; i++) { this.tone('square', 520, 480, 0.18, 0.11, i * 0.3); this.tone('square', 390, 360, 0.18, 0.11, i * 0.3 + 0.15); } break;
      case 'loot': [880, 1175, 1568].forEach((f, i) => this.tone('sine', f, f, 0.35, 0.1, i * 0.08)); break;
      case 'ui': this.tone('triangle', 660, 520, 0.06, 0.09); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.15, i * 0.12)); break;
      case 'lose': [330, 262, 196, 147].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, 0.5, 0.1, i * 0.2)); break;
      case 'wave': this.tone('sine', 300, 300, 0.4, 0.07); this.tone('sine', 450, 450, 0.4, 0.05, 0.05); break;
    }
  },
};

/* ---------- 画面管理 ---------- */
const screens = { title: $('s-title'), home: $('s-home'), equip: $('s-equip'), result: $('s-result') };
const G = { mode: 'title', b: null, paused: false, selStage: 1, tab: 'all', endTimer: 0, pendingConfirm: null, lastResult: null, shake: 0, acc: 0 };
function show(name) {
  for (const k in screens) screens[k].classList.toggle('active', k === name);
  $('hud').classList.toggle('hidden', name !== 'battle');
  G.mode = name;
  if (name === 'title') $('btn-continue').classList.toggle('hidden', !hasSave);
}
function overlay(id, on) { $(id).classList.toggle('hidden', !on); }
function toast(msg, color) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  if (color) t.style.setProperty('--rc', color);
  const box = $('toasts'); box.appendChild(t);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => t.remove(), 2700);
}
function confirmBox(msg, yes, cb, yesLabel) {
  $('confirm-msg').textContent = msg; $('confirm-yes').textContent = yesLabel || 'はい';
  G.pendingConfirm = cb; overlay('ov-confirm', true);
}
function muteLabel() { return '効果音：' + (save.settings.mute ? 'OFF' : 'ON'); }

/* ---------- ホーム ---------- */
function renderHome() {
  $('home-gold').textContent = fmt(save.gold);
  let html = '';
  for (let ci = 0; ci < 3; ci++) {
    html += `<div class="chapter"><h3>${esc(CHAPTERS[ci].name)}</h3><div class="stages">`;
    for (let k = 1; k <= 5; k++) {
      const n = ci * 5 + k, locked = n > save.cleared + 1, done = n <= save.cleared;
      html += `<button class="stage-btn${locked ? ' locked' : ''}${done ? ' done' : ''}${n === G.selStage ? ' sel' : ''}" data-act="pickStage" data-arg="${n}"${locked ? ' disabled' : ''}>${ci + 1}-${k}<small>${locked ? '封' : 'STAGE'}</small></button>`;
    }
    html += '</div></div>';
  }
  $('stage-list').innerHTML = html;
  const si = stageInfo(G.selStage), best = save.bestWave[G.selStage] || 0;
  $('stage-detail').innerHTML = `<h4>${esc(si.ch.name.replace('　', ' '))} ${si.inChapter}</h4>
    <div class="row"><span>ボス</span><b>${esc(si.boss)}</b></div>
    <div class="row"><span>敵の強さ</span><b>HP ×${enemyHpMult(G.selStage, 1).toFixed(2)}（第10波 ×${enemyHpMult(G.selStage, 10).toFixed(2)}）</b></div>
    <div class="row"><span>最高到達</span><b>${best ? '第' + best + '波' : '未挑戦'}${G.selStage <= save.cleared ? '　討伐済' : ''}</b></div>`;
}
function fpsLabel() { return '30fpsモード：' + (save.settings.fps30 ? 'ON' : 'OFF'); }
function renderTitleBtns() { $('btn-continue').classList.toggle('hidden', !hasSave); $('pause-mute').textContent = muteLabel(); $('set-mute').textContent = muteLabel(); $('set-fps').textContent = fpsLabel(); }

/* ---------- 装備画面 ---------- */
function statLines(item) {
  return itemStatList(item).map(s => `<div class="${s.base ? 'base' : ''}"><span>${esc(STAT_INFO[s.key].name)}</span><span>+${s.v}${STAT_INFO[s.key].unit}</span></div>`).join('');
}
function renderEquip() {
  $('eq-gold').textContent = fmt(save.gold);
  $('slot-row').innerHTML = SLOTS.map(sl => {
    const it = getItem(save.equipped[sl]);
    if (!it) return `<div class="slot empty"><span class="sl">${SLOT_NAME[sl]}</span><span class="nm" style="color:var(--ink-soft)">― 未装備 ―</span></div>`;
    const bs = itemStatList(it)[0];
    return `<button class="slot" style="--rc:${RARITIES[it.rarity].color}" data-act="openItem" data-arg="${it.id}"><span class="sl">${SLOT_NAME[sl]}</span><span class="nm">${esc(it.name)}${it.enh ? ' +' + it.enh : ''}</span><span class="st">${esc(fmtStat(bs.key, bs.v))}</span></button>`;
  }).join('');
  const tabs = [['all', '全て'], ...SLOTS.map(s => [s, SLOT_NAME[s].slice(0, 3)])];
  $('inv-tabs').innerHTML = tabs.map(([k, n]) => `<button class="tab${G.tab === k ? ' on' : ''}" data-act="tab" data-arg="${k}">${n}</button>`).join('');
  const full = save.inv.length >= INV_CAP;
  $('inv-note').innerHTML = `所持 <b style="color:${full ? 'var(--vermilion)' : 'inherit'}">${save.inv.length} / ${INV_CAP}</b>　上限を超えると<b>装備していない最古のコモンから自動売却</b>されます。`;
  const rank = it => (save.equipped[it.slot] === it.id ? 100 : 0) + it.rarity * 10;
  const list = save.inv.filter(i => G.tab === 'all' || i.slot === G.tab).sort((a, b) => rank(b) - rank(a) || itemScore(b) - itemScore(a));
  $('inv-grid').innerHTML = list.length ? list.map(it => {
    const bs = itemStatList(it)[0];
    return `<button class="item r${it.rarity}" style="--rc:${RARITIES[it.rarity].color}" data-act="openItem" data-arg="${it.id}">${save.equipped[it.slot] === it.id ? '<span class="eqm">装</span>' : ''}<span class="nm">${esc(it.name)}${it.enh ? ' +' + it.enh : ''}${(it.uniques || []).length ? '<span class="uq-mark">印</span>' : ''}</span><span class="meta">${SLOT_NAME[it.slot]} ・ ${RARITIES[it.rarity].name}</span><span class="meta">${esc(fmtStat(bs.key, bs.v))}</span></button>`;
  }).join('') : '<div class="empty-msg">装備がありません。<br>敵を倒して戦利品を集めよう。</div>';
}
function uniqueLines(it) {
  const t = uniqueTexts(it);
  return t.length ? `<div class="uniq">${t.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : '';
}
function openItem(id) {
  const it = getItem(id); if (!it) return;
  const R = RARITIES[it.rarity], isEq = save.equipped[it.slot] === id;
  const cur = getItem(save.equipped[it.slot]);
  let cmp = '';
  if (!isEq) {
    const m = {}; const add = (item, sg) => { if (item) for (const s of itemStatList(item)) m[s.key] = (m[s.key] || 0) + sg * s.v; };
    add(it, 1); add(cur, -1);
    const rows = Object.keys(m).filter(k => Math.abs(m[k]) > 1e-9).map(k => {
      const v = Math.round(m[k] * 10) / 10;
      return `<div class="${v > 0 ? 'up' : 'down'}"><span>${esc(STAT_INFO[k].name)}</span><span>${v > 0 ? '▲ +' : '▼ '}${v}${STAT_INFO[k].unit}</span></div>`;
    }).join('');
    cmp = `<div class="cmp"><h5>${cur ? '装備中「' + esc(cur.name) + '」との比較' : '未装備からの変化'}</h5>${rows || '<div><span>変化なし</span></div>'}</div>`;
  }
  const canEnh = it.enh < 10, cost = canEnh ? enhanceCost(it.enh, it.rarity) : 0;
  $('item-body').style.setProperty('--rc', R.color);
  $('item-body').innerHTML = `<h3>${esc(it.name)}${it.enh ? ' +' + it.enh : ''}</h3>
    <div class="sub">${SLOT_NAME[it.slot]} ・ ${R.name} ・ 第${it.ilvl}ステージ産${isEq ? ' ・ 装備中' : ''}</div>
    <div class="stat-list">${statLines(it)}</div>${uniqueLines(it)}${cmp}
    <div class="item-actions">
      ${isEq ? `<button class="btn" data-act="unequip" data-arg="${id}">外す</button>` : `<button class="btn primary" data-act="equip" data-arg="${id}">装備する</button>`}
      <button class="btn" data-act="enhance" data-arg="${id}"${!canEnh || save.gold < cost ? ' disabled' : ''}>${canEnh ? '強化 +' + (it.enh + 1) + '（' + fmt(cost) + '金）' : '強化 上限'}</button>
      <button class="btn danger" data-act="sell" data-arg="${id}"${isEq ? ' disabled' : ''}>売却 ${fmt(sellPrice(it))}金${it.enh ? '（強化費の' + Math.round(ENH_REFUND * 100) + '%返還込み）' : ''}</button>
      <button class="btn ghost" data-act="closeItem">閉じる</button>
    </div>
    <p class="note" style="font-size:11px;color:var(--ink-soft);margin:10px 0 0">強化は基本ステータス（◆）のみ伸びます。失敗はありません（上限+10）。売却すると、投入した強化費の${Math.round(ENH_REFUND * 100)}%が戻ります。${isEq ? '装備中の品は売却できません。' : ''}</p>`;
  overlay('ov-item', true);
}

/* ---------- 戦闘開始・終了 ---------- */
function calcView() {
  const w = innerWidth, h = innerHeight;
  const scale = Math.max(Math.min(w / 360, h / 620), w / 920);
  const px = w / 2, py = h * 0.56;
  return { w, h, scale, px, py, view: { hx: w / 2 / scale, up: py / scale, down: (h - py) / scale } };
}
let VP = calcView();
function startBattle(stage) {
  const eq = computeEquipStats(equippedItems());
  VP = calcView();
  const ownedSlots = SLOTS.filter(sl => save.inv.some(i => i.slot === sl));
  G.b = createBattle({ stage, equipStats: eq, seed: (Math.random() * 4294967296) >>> 0, view: VP.view, ownedSlots, bossPity: save.bossPity || 0 });
  G.canFast = stage <= save.cleared; G.speed = 1; updateSpeedBtn();
  G.paused = false; G.endTimer = 0; G.acc = 0; G.stage = stage; G.shake = 0; G.shownBoss = false;
  fxList.length = 0; parts.length = 0; nums.length = 0;
  overlay('ov-levelup', false); overlay('ov-pause', false);
  $('boss-bar').classList.add('hidden'); $('banner').classList.add('hidden');
  show('battle');
}
function updateSpeedBtn() {
  const el = $('speed-btn');
  el.classList.toggle('hidden', !G.canFast); el.classList.toggle('on', G.speed === 2); el.textContent = '×' + (G.speed || 1);
}
function finishBattle(kind) {
  const b = G.b; if (!b) return;
  const stage = G.stage, gold = Math.floor(b.goldF);
  save.gold += gold;
  const newItems = [], eqSet = equippedSet(); let soldGold = 0, soldN = 0, autoEquipped = [];
  for (const it of b.drops) {
    it.id = 'i' + (save.nextId++);
    const cur = getItem(save.equipped[it.slot]);
    const upgrade = !!cur && itemScore(it) > itemScore(cur);
    const r = addToInventory(save.inv, it, eqSet);
    soldGold += r.gold; soldN += r.sold.length; save.gold += r.gold;
    for (const s of r.sold) { const si = newItems.findIndex(n => n.item === s); if (si >= 0) newItems[si].gone = true; }
    newItems.push({ item: it, upgrade, gone: false });
    if (!cur && !save.equipped[it.slot]) { save.equipped[it.slot] = it.id; eqSet.add(it.id); autoEquipped.push(it); }
  }
  save.bestWave[stage] = Math.max(save.bestWave[stage] || 0, b.maxWave);
  save.bossPity = b.bossPity || 0;
  let firstClear = false;
  if (kind === 'won' && stage > save.cleared) { save.cleared = stage; firstClear = true; }
  writeSave();
  G.lastResult = { kind, stage, gold, b, newItems, soldGold, soldN, firstClear, autoEquipped };
  renderResult(); show('result');
  Sfx.play(kind === 'won' ? 'win' : 'lose');
  G.b = null;
}
function statsHtml(b) {
  const by = b.dmgBy || {}, ids = SPELL_IDS.filter(id => by[id] > 0).sort((x, y) => by[y] - by[x]);
  const mx = ids.length ? by[ids[0]] : 1;
  const rows = ids.map(id => `<div class="dr"><span class="nm">${esc(SPELLS[id].name)}</span><span class="bar-d"><i style="width:${Math.max(2, Math.round(by[id] / mx * 100))}%;--c:${SPELLS[id].color}"></i></span><span class="v">${fmt(by[id])}</span></div>`).join('');
  const rb = b.reachBy || {}, rk = Object.keys(rb).sort((x, y) => rb[y] - rb[x]);
  const reach = rk.length ? `最も接近を許した敵：<b>${esc(ENEMIES[rk[0]].name)}</b>（${rb[rk[0]]}体）` : '接近を許した敵：なし';
  return `<div class="loot-h">魔法別の与ダメージ</div><div class="dmg-rows">${rows || '<div class="dr">記録なし</div>'}<div class="dr" style="margin-top:4px">${reach}</div></div>`;
}
function renderResult() {
  const r = G.lastResult, b = r.b, si = stageInfo(r.stage);
  const head = r.kind === 'won' ? ['討伐成功', 'win', `${si.boss} を討ち取った`] : r.kind === 'retreat' ? ['撤退', 'lose', '戦利品は持ち帰った'] : ['力尽きる', 'lose', '倒れても、集めたものは残る'];
  const loot = r.newItems.map(n => {
    const it = n.item, R = RARITIES[it.rarity], bs = itemStatList(it)[0];
    return `<div class="loot" style="--rc:${R.color}"><div><span class="nm">${esc(it.name)}</span><span class="badge">NEW</span>${n.upgrade ? '<span class="badge up">強化候補</span>' : ''}${n.gone ? '<span class="badge" style="background:#777">自動売却</span>' : ''}<div class="sc">${SLOT_NAME[it.slot]} ・ ${R.name} ・ ${esc(fmtStat(bs.key, bs.v))}</div></div><span class="sc">★${itemScore(it)}</span></div>`;
  }).join('');
  $('result-body').innerHTML = `<h2 class="${head[1]}">${head[0]}</h2><div class="sub">${esc(si.ch.name.replace('　', ' '))} ${si.inChapter}　${esc(head[2])}</div>
    <div class="res-rows">
      <div><span>到達ウェーブ</span><b>第${b.maxWave}波 / ${MAX_WAVE}</b></div>
      <div><span>撃破数</span><b>${fmt(b.kills)}</b></div>
      <div><span>到達レベル</span><b>Lv ${b.player.level}</b></div>
      <div><span>獲得ゴールド</span><b style="color:var(--gold)">+${fmt(r.gold)}${r.soldGold ? '（自動売却 +' + fmt(r.soldGold) + '）' : ''}</b></div>
      <div><span>所持ゴールド</span><b>${fmt(save.gold)}</b></div>
    </div>
    ${statsHtml(b)}
    ${r.firstClear ? `<p class="sold-note" style="color:var(--gold)">★ ${r.stage < 15 ? '次のステージが解放された。' : '全ステージを制覇した！'}</p>` : ''}
    <div class="loot-h">獲得した装備 ${r.newItems.length}個</div>
    <div class="loot-list">${loot || '<div class="sc" style="color:var(--ink-soft);font-size:12px">今回は戦利品なし。エリート（金の輪の敵）とボスは高確率で落とす。</div>'}</div>
    ${r.autoEquipped.length ? `<p class="sold-note" style="color:#2c7a4b">空いていた部位に自動で装備した：${r.autoEquipped.map(i => esc(i.name)).join('、')}</p>` : ''}
    ${r.soldN ? `<p class="sold-note">所持上限(${INV_CAP})を超えたため、古いコモンを ${r.soldN}個 自動売却しました。</p>` : ''}
    <div class="res-btns">
      <div class="row"><button class="btn" data-act="goEquip">装備を整える</button><button class="btn" data-act="retry">もう一度</button></div>
      <button class="btn primary" data-act="goHome">${r.kind === 'won' && r.stage < 15 ? '次へ進む（ホーム）' : 'ホームへ'}</button>
    </div>`;
  if (r.kind === 'won' && r.stage < 15) G.selStage = Math.min(15, r.stage + 1);
}

/* ---------- アクション（イベント委譲） ---------- */
const ACT = {
  start() {
    Sfx.init();
    if (hasSave && (save.cleared > 0 || save.inv.length > 0 || save.gold > 0)) {
      confirmBox('これまでのセーブを消して\n最初からはじめますか？', 'はじめる', () => { save = defaultSave(); writeSave(); G.selStage = 1; renderHome(); show('home'); });
    } else { writeSave(); renderHome(); show('home'); }
  },
  continue() { Sfx.init(); G.selStage = Math.min(15, save.cleared + 1); renderHome(); show('home'); },
  goHome() { Sfx.play('ui'); overlay('ov-item', false); renderHome(); show('home'); },
  goEquip() { Sfx.play('ui'); overlay('ov-item', false); renderEquip(); show('equip'); },
  pickStage(n) { n = +n; if (n > save.cleared + 1) return; Sfx.play('ui'); G.selStage = n; renderHome(); },
  sortie() { Sfx.init(); Sfx.play('ui'); startBattle(G.selStage); },
  retry() { Sfx.play('ui'); const s = G.lastResult ? G.lastResult.stage : G.selStage; G.selStage = s; startBattle(s); },
  tab(k) { G.tab = k; renderEquip(); },
  openItem(id) { Sfx.play('ui'); openItem(id); },
  closeItem() { overlay('ov-item', false); },
  equip(id) {
    const it = getItem(id); if (!it) return;
    save.equipped[it.slot] = id; writeSave(); Sfx.play('ui'); overlay('ov-item', false); renderEquip(); toast(`${it.name} を装備した`, RARITIES[it.rarity].color);
  },
  unequip(id) { const it = getItem(id); if (!it) return; save.equipped[it.slot] = null; writeSave(); overlay('ov-item', false); renderEquip(); },
  enhance(id) {
    const it = getItem(id); if (!it || it.enh >= 10) return;
    const cost = enhanceCost(it.enh, it.rarity); if (save.gold < cost) return;
    save.gold -= cost; it.enh++; writeSave(); Sfx.play('loot'); renderEquip(); openItem(id);
  },
  sell(id) {
    const it = getItem(id); if (!it || save.equipped[it.slot] === id) return;
    const p = sellPrice(it);
    confirmBox(`「${it.name}${it.enh ? ' +' + it.enh : ''}」を ${fmt(p)} 金で売却しますか？`, '売却する', () => {
      save.inv = save.inv.filter(i => i.id !== id); save.gold += p; writeSave(); overlay('ov-item', false); renderEquip(); toast(`${fmt(p)} 金で売却した`);
    });
  },
  sellCommons() {
    const eq = equippedSet(); const list = save.inv.filter(i => i.rarity === 0 && !eq.has(i.id));
    if (!list.length) { toast('売却できるコモンがありません'); return; }
    const total = list.reduce((s, i) => s + sellPrice(i), 0);
    confirmBox(`装備していないコモン ${list.length}個を\nまとめて ${fmt(total)} 金で売却しますか？`, '売却する', () => {
      const ids = new Set(list.map(i => i.id)); save.inv = save.inv.filter(i => !ids.has(i.id)); save.gold += total; writeSave(); renderEquip(); toast(`${list.length}個を売却（+${fmt(total)}金）`);
    });
  },
  settings() { renderTitleBtns(); overlay('ov-settings', true); },
  closeSettings() { overlay('ov-settings', false); },
  toggleMute() { save.settings.mute = !save.settings.mute; writeSave(); renderTitleBtns(); },
  toggleFps() { save.settings.fps30 = !save.settings.fps30; writeSave(); renderTitleBtns(); },
  speed() {
    if (!G.b || !G.canFast) return;
    G.speed = G.speed === 2 ? 1 : 2; Sfx.play('ui'); updateSpeedBtn();
  },
  reroll() {
    const b = G.b; if (!b || !rerollChoices(b)) return;
    Sfx.play('ui'); showCards();
  },
  exportSave() {
    const code = exportSave(save), ta = $('save-text');
    ta.value = code;
    try { if (ta.select) { ta.select(); } if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).catch(() => {}); } catch (e) { /* 手動コピー */ }
    toast('セーブコードを書き出した（コピーして控えてください）');
  },
  importSave() {
    const r = importSave($('save-text').value);
    if (!r.ok) { toast(r.error); return; }
    confirmBox(`このコードのセーブで、現在のデータを上書きします。\n（ゴールド ${fmt(r.save.gold)}・装備 ${r.save.inv.length}個・クリア ${r.save.cleared}面）\nよろしいですか？`, '読み込む', () => {
      save = r.save; hasSave = true; writeSave(); G.selStage = Math.min(15, save.cleared + 1);
      renderTitleBtns(); renderHome(); overlay('ov-settings', false); toast('セーブを読み込んだ');
    }, '読み込む');
  },
  resetData() {
    confirmBox('すべてのセーブデータ（装備・ゴールド・クリア状況）を\n消去します。元には戻せません。\n本当によろしいですか？', '消去する', () => {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無視 */ }
      save = defaultSave(); hasSave = false; G.selStage = 1; overlay('ov-settings', false); overlay('ov-pause', false); G.b = null;
      renderTitleBtns(); show('title'); toast('データを初期化した');
    }, '消去する');
  },
  confirmYes() { const cb = G.pendingConfirm; G.pendingConfirm = null; overlay('ov-confirm', false); if (cb) cb(); },
  confirmNo() { G.pendingConfirm = null; overlay('ov-confirm', false); },
  pause() { if (G.mode !== 'battle' || !G.b || G.b.state !== 'playing') return; G.paused = true; renderTitleBtns(); overlay('ov-pause', true); },
  resume() { G.paused = false; overlay('ov-pause', false); },
  retreat() { confirmBox('撤退しますか？\nここまでのゴールドと装備は持ち帰れます。', '撤退する', () => { overlay('ov-pause', false); G.paused = false; if (G.b) finishBattle('retreat'); }); },
  card(i) {
    const b = G.b; if (!b || b.state !== 'levelup') return;
    applyCard(b, b.choices[+i]); Sfx.play('ui');
    if (b.state === 'levelup') showCards(); else overlay('ov-levelup', false);
  },
};
document.addEventListener('click', e => {
  const t = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!t || t.disabled) return;
  Sfx.init();
  const f = ACT[t.dataset.act]; if (f) f(t.dataset.arg);
});
document.addEventListener('pointerdown', () => Sfx.init(), { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'battle' && G.b && G.b.state === 'playing' && !G.paused) ACT.pause(); });

function showCards() {
  const b = G.b; $('lu-level').textContent = 'Lv ' + b.player.level;
  const ns = Object.keys(b.spells).length, np = PASSIVE_IDS.filter(id => b.passive[id] > 0).length;
  $('lu-slots').innerHTML = `魔法 <b class="${ns >= MAX_SPELLS ? 'full' : ''}">${ns}/${MAX_SPELLS}</b>　術式 <b class="${np >= MAX_PASSIVES ? 'full' : ''}">${np}/${MAX_PASSIVES}</b>${ns >= MAX_SPELLS ? '　（魔法枠が満杯：新規は出ません）' : ''}`;
  const rr = $('lu-reroll'); rr.textContent = `引き直す（無料 残り${b.rerolls}回）`; rr.disabled = b.rerolls <= 0;
  $('lu-cards').innerHTML = b.choices.map((c, i) => {
    let icon = '?', name = '', tag = '', lv = '', desc = '', col = '#1d1b19', mile = '';
    if (c.kind === 'spell-new' || c.kind === 'spell-up') {
      const S = SPELLS[c.id], cur = b.spells[c.id] ? b.spells[c.id].lv : 0;
      icon = S.icon; name = S.name; col = S.color; tag = c.kind === 'spell-new' ? '新規魔法' : '魔法強化';
      lv = c.kind === 'spell-new' ? 'Lv 1' : `Lv ${cur} → ${cur + 1}`; desc = S.desc(S.lv[cur]);
      if (c.kind === 'spell-up' && S.mile[cur + 1]) mile = '★ ' + S.mile[cur + 1];
    } else if (c.kind === 'passive') {
      const P = PASSIVES[c.id], cur = b.passive[c.id]; icon = P.icon; name = P.name; tag = '術式（パッシブ）'; col = '#6b5a2e';
      lv = `Lv ${cur} → ${cur + 1}`; desc = P.desc(cur + 1);
    } else if (c.kind === 'heal') { icon = '癒'; name = '傷を癒やす'; tag = '頁の余白'; desc = '最大HPの40%を回復する'; col = '#2c7a4b'; }
    else { icon = '金'; name = '金貨の包み'; tag = '頁の余白'; desc = `ゴールド +${50 * b.stage}`; col = '#b8860b'; }
    return `<button class="card" style="--cc:${col}" data-act="card" data-arg="${i}"><div class="card-icon">${icon}</div><div><div class="card-tag">${tag}</div><div class="card-name">${esc(name)}</div><div class="card-lv">${lv}</div><div class="card-desc">${esc(desc)}</div>${mile ? `<div class="card-mile">${esc(mile)}</div>` : ''}</div></button>`;
  }).join('');
  overlay('ov-levelup', true);
}

/* =====================================================================
   描画：紙・墨・魔法
   ===================================================================== */
const INK = '#1d1b19', PAPER_FILL = '#fffdf6', GOLD = '#b8860b';
const paperPat = {}; let vignette = null, vigKey = '';
function makePaper(ci) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = CHAPTERS[ci].paper; g.fillRect(0, 0, S, S);
  const rnd = mulberry32(900 + ci * 77);
  for (let i = 0; i < 9; i++) {      // しみ・むら
    const x = rnd() * S, y = rnd() * S, r = 60 + rnd() * 120, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, i % 2 ? CHAPTERS[ci].wash : 'rgba(120,90,50,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 4200; i++) {   // 粒
    g.fillStyle = `rgba(${90 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},${40 + rnd() * 30 | 0},${0.025 + rnd() * 0.09})`;
    g.fillRect(rnd() * S, rnd() * S, 0.6 + rnd() * 1.4, 0.6 + rnd() * 1.4);
  }
  g.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {    // 繊維
    const x = rnd() * S, y = rnd() * S, a = rnd() * TAU, l = 6 + rnd() * 20;
    g.strokeStyle = `rgba(110,85,55,${0.04 + rnd() * 0.07})`; g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 1) * l * 0.6, y + Math.sin(a + 1) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return cx.createPattern(c, 'repeat');
}
function drawPaper(w, h, ci) {
  if (!paperPat[ci]) paperPat[ci] = makePaper(ci);
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = paperPat[ci]; cx.fillRect(0, 0, cv.width, cv.height);
  const key = w + 'x' + h;
  if (vigKey !== key) {
    vigKey = key; const r = Math.hypot(w, h) / 2 * cv.width / w;
    vignette = cx.createRadialGradient(cv.width / 2, cv.height / 2, r * 0.45, cv.width / 2, cv.height / 2, r);
    vignette.addColorStop(0, 'rgba(120,85,40,0)'); vignette.addColorStop(1, 'rgba(120,85,40,0.22)');
  }
  cx.fillStyle = vignette; cx.fillRect(0, 0, cv.width, cv.height);
}
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr); cv.dpr = dpr;
  vigKey = '';
  VP = calcView();
  if (G.b) G.b.view = VP.view;
}
window.addEventListener('resize', resize);

function blob(c, x, y, rx, ry, seed, jit, n, p) {
  n = n || 12; p = p || 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const k = p === 2 ? 1 : Math.pow(Math.pow(Math.abs(ca), p) + Math.pow(Math.abs(sa), p), -1 / p);
    const j = 1 + (hash(seed + i * 7.13) - 0.5) * 2 * jit;
    pts.push(x + ca * rx * k * j, y + sa * ry * k * j);
  }
  c.beginPath();
  c.moveTo((pts[2 * n - 2] + pts[0]) / 2, (pts[2 * n - 1] + pts[1]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    c.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], (pts[2 * i] + pts[2 * j]) / 2, (pts[2 * i + 1] + pts[2 * j + 1]) / 2);
  }
  c.closePath();
}
function inkLine(c, w, col, a) { const prev = c.globalAlpha; c.lineWidth = w; c.strokeStyle = col || INK; c.globalAlpha = prev * (a == null ? 1 : a); c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); c.globalAlpha = prev; }
/** 塗り→輪郭（二重線のかすれ付き） */
function inked(c, fill, w, seedFn) {
  c.fillStyle = fill; c.fill(); inkLine(c, w || 2);
}
function eye(c, x, y, r, dx, dy, sock) {
  c.beginPath(); c.arc(x, y, r, 0, TAU);
  if (sock) { c.fillStyle = INK; c.fill(); return; }
  c.fillStyle = '#fff'; c.fill(); inkLine(c, 1.3);
  c.beginPath(); c.arc(x + dx * r * 0.35, y + dy * r * 0.35, r * 0.5, 0, TAU); c.fillStyle = INK; c.fill();
  c.beginPath(); c.arc(x + dx * r * 0.35 - r * 0.15, y + dy * r * 0.35 - r * 0.2, r * 0.14, 0, TAU); c.fillStyle = '#fff'; c.fill();
}
function drawEnemy(c, e, t, ci) {
  const R = e.r, s = e.seed * 100, tb = Math.floor(t * 7), sd = s + tb * 1.7;
  const ch = CHAPTERS[ci || 0], acc = ch.accent;
  const d = Math.hypot(e.x, e.y) || 1, dx = -e.x / d, dy = -e.y / d;
  const fill = e.flash > 0 ? '#ffd9c4' : e.frozenT > 0 ? '#bcd6ec' : e.slowAmt > 0 ? '#dcecf8' : PAPER_FILL;
  c.save(); c.translate(e.x, e.y);
  if (e.elite) {         // 墨の二重輪＋頭上の朱印（朱はこの印だけの例外色）
    c.save(); c.translate(0, R * 0.55); c.scale(1, 0.38); c.rotate(t * 0.8);
    c.beginPath(); c.arc(0, 0, R * 1.45, 0, TAU); c.setLineDash([R * 0.5, R * 0.18]); inkLine(c, 2.6, INK); c.beginPath(); c.arc(0, 0, R * 1.25, 0, TAU); c.setLineDash([]); inkLine(c, 1.2, INK, 0.6); c.restore();
  } else {               // 接地影
    c.save(); c.translate(0, R * 0.7); c.scale(1, 0.3); c.beginPath(); c.arc(0, 0, R * 0.95, 0, TAU); c.fillStyle = 'rgba(29,27,25,0.12)'; c.fill(); c.restore();
  }
  if (e.type === 'ghost' && e.translucent) c.globalAlpha = 0.38;
  const bob = Math.sin(t * 4 + s) * R * 0.06;
  switch (e.type) {
    case 'slimy': case 'splitlet': {
      const sq = 1 + Math.sin(t * 6 + s) * 0.07;
      blob(c, 0, bob, R * 1.05 / sq, R * 0.92 * sq, sd, 0.06, 12); inked(c, fill, 2);
      blob(c, 0, bob, R * 1.05 / sq, R * 0.92 * sq, sd + 50, 0.07, 12); inkLine(c, 0.8, INK, 0.35);
      const ne = e.type === 'splitlet' ? 1 : 1 + Math.floor(e.seed * 3);
      for (let i = 0; i < ne; i++) { const ex = (i - (ne - 1) / 2) * R * 0.62; eye(c, ex, -R * 0.12 + bob, R * (ne === 3 ? 0.24 : 0.3), dx, dy); }
      c.beginPath(); c.arc(0, R * 0.32 + bob, R * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); inkLine(c, 1.5);
      c.fillStyle = acc; c.globalAlpha = (c.globalAlpha || 1) * 0.35; c.beginPath(); c.arc(-R * 0.62, R * 0.2 + bob, R * 0.14, 0, TAU); c.arc(R * 0.62, R * 0.2 + bob, R * 0.14, 0, TAU); c.fill(); c.globalAlpha = 1;
      c.beginPath(); c.moveTo(-R * 0.3, R * 0.85); c.quadraticCurveTo(-R * 0.25, R * 1.15, -R * 0.15, R * 0.9); inkLine(c, 1.4);
      break;
    }
    case 'dash': case 'imp': {
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-dx * R * 1.4, -dy * R * 1.4 + (i - 1) * R * 0.45); c.lineTo(-dx * R * 2.4, -dy * R * 2.4 + (i - 1) * R * 0.45); inkLine(c, 1.1, INK, 0.45); }
      blob(c, 0, bob, R * 1.2, R * 0.85, sd, 0.07, 10); inked(c, fill, 1.8);
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * R * 0.35, -R * 0.75 + bob); c.lineTo(i * R * 0.5, -R * 1.3 + bob); c.lineTo(i * R * 0.1, -R * 0.8 + bob); inkLine(c, 1.4); }
      eye(c, 0, -R * 0.05 + bob, R * 0.52, dx, dy);
      if (e.type === 'imp') { c.beginPath(); c.arc(0, R * 0.5 + bob, R * 0.2, 0, Math.PI); inkLine(c, 1.1); }
      break;
    }
    case 'golem': {
      for (const sx of [-1, 1]) { blob(c, sx * R * 1.1, R * 0.15, R * 0.34, R * 0.46, sd + sx * 9, 0.1, 8, 3); inked(c, fill, 2); }
      blob(c, 0, 0, R, R * 0.95, sd, 0.05, 14, 4); inked(c, fill, 2.6);
      blob(c, 0, 0, R, R * 0.95, sd + 40, 0.06, 14, 4); inkLine(c, 0.9, INK, 0.3);
      c.beginPath(); c.moveTo(-R * 0.15, -R * 0.95); c.lineTo(R * 0.05, -R * 0.55); c.lineTo(-R * 0.12, -R * 0.35); c.lineTo(R * 0.1, -R * 0.1); inkLine(c, 1.3);
      for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(R * 0.25 + i * R * 0.13, R * 0.7); c.lineTo(R * 0.05 + i * R * 0.13, R * 0.9); inkLine(c, 0.9, INK, 0.5); }
      for (const sx of [-1, 1]) { eye(c, sx * R * 0.38, -R * 0.1, R * 0.17, dx, dy); c.beginPath(); c.moveTo(sx * R * 0.6, -R * 0.4); c.lineTo(sx * R * 0.15, -R * 0.26); inkLine(c, 2.2); }
      c.beginPath(); c.moveTo(-R * 0.3, R * 0.38); c.lineTo(R * 0.3, R * 0.38); inkLine(c, 1.8);
      break;
    }
    case 'splitter': {
      const sp = Math.sin(t * 5 + s) * R * 0.05;
      for (const sx of [-1, 1]) {
        blob(c, sx * (R * 0.5 + sp), bob, R * 0.72, R * 0.8, sd + sx * 5, 0.06, 10); inked(c, fill, 2);
        eye(c, sx * (R * 0.5 + sp) + sx * R * 0.1, -R * 0.1 + bob, R * 0.26, dx, dy);
      }
      c.beginPath(); c.moveTo(0, -R * 0.7); c.lineTo(R * 0.06, -R * 0.2); c.lineTo(-R * 0.06, R * 0.2); c.lineTo(0, R * 0.7); inkLine(c, 1.5, acc);
      c.beginPath(); c.arc(0, R * 0.42, R * 0.2, 0.1 * Math.PI, 0.9 * Math.PI); inkLine(c, 1.3);
      break;
    }
    case 'bones': {
      const summoning = e.summonT < 0.6 && e.stopped;
      const cl = bob; c.beginPath(); c.moveTo(-R * 0.9, R * 0.95); c.quadraticCurveTo(-R * 1.1, R * 0.2, -R * 0.55, -R * 0.1 + cl); c.lineTo(R * 0.55, -R * 0.1 + cl); c.quadraticCurveTo(R * 1.1, R * 0.2, R * 0.9, R * 0.95);
      for (let i = 0; i < 4; i++) c.lineTo(R * (0.9 - (i + 0.5) * 0.45), R * (i % 2 ? 0.95 : 1.15)); c.closePath(); inked(c, '#e9e3d6', 2);
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-R * 0.6 + i * R * 0.55, R * 0.3); c.lineTo(-R * 0.7 + i * R * 0.55, R * 0.8); inkLine(c, 0.9, INK, 0.5); }
      blob(c, 0, -R * 0.45 + cl, R * 0.78, R * 0.7, sd, 0.03, 12, 3); inked(c, fill, 2);
      eye(c, -R * 0.3, -R * 0.5 + cl, R * 0.2, 0, 0, true); eye(c, R * 0.3, -R * 0.5 + cl, R * 0.2, 0, 0, true);
      c.fillStyle = summoning ? '#9a3fd0' : acc; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * R * 0.3, -R * 0.5 + cl, R * (summoning ? 0.12 : 0.06), 0, TAU); c.fill(); }
      c.beginPath(); c.moveTo(0, -R * 0.35 + cl); c.lineTo(-R * 0.08, -R * 0.2 + cl); c.lineTo(R * 0.08, -R * 0.2 + cl); c.closePath(); inkLine(c, 1.2);
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * R * 0.13, -R * 0.12 + cl); c.lineTo(i * R * 0.13, R * 0.02 + cl); inkLine(c, 1); }
      for (let k = 0; k < 2; k++) { const a = t * 1.6 + k * Math.PI; const bx = Math.cos(a) * R * 1.35, by = Math.sin(a) * R * 0.5 - R * 0.3; c.save(); c.translate(bx, by); c.rotate(a); c.beginPath(); c.moveTo(-R * 0.22, 0); c.lineTo(R * 0.22, 0); inkLine(c, 2.4); c.restore(); }
      if (summoning) { c.beginPath(); c.arc(0, -R * 0.2, R * (1.2 + (0.6 - e.summonT)), 0, TAU); inkLine(c, 1.5, '#9a3fd0', 0.7); }
      break;
    }
    case 'ghost': {
      const w = Math.sin(t * 3 + s) * R * 0.12;
      c.beginPath(); c.moveTo(-R * 0.95, R * 0.8 + bob); c.bezierCurveTo(-R * 1.1, -R * 1.25 + bob, R * 1.1, -R * 1.25 + bob, R * 0.95, R * 0.8 + bob);
      for (let i = 0; i < 4; i++) c.quadraticCurveTo(R * (0.95 - (i + 0.5) * 0.475), R * (i % 2 ? 0.7 : 1.15) + w * (i % 2 ? -1 : 1) + bob, R * (0.95 - (i + 1) * 0.475), R * 0.8 + bob);
      c.closePath();
      if (e.translucent) c.setLineDash([4, 3]);
      inked(c, fill, 2); c.setLineDash([]);
      c.beginPath(); c.ellipse(-R * 0.34, -R * 0.15 + bob, R * 0.17, R * 0.26, 0, 0, TAU); c.ellipse(R * 0.34, -R * 0.15 + bob, R * 0.17, R * 0.26, 0, 0, TAU); c.fillStyle = INK; c.fill();
      c.beginPath(); c.ellipse(0, R * 0.38 + bob, R * 0.13, R * 0.18, 0, 0, TAU); c.fillStyle = '#5a5047'; c.fill();
      c.beginPath(); c.moveTo(-R * 0.55, -R * 0.55 + bob); c.lineTo(-R * 0.15, -R * 0.45 + bob); c.moveTo(R * 0.55, -R * 0.55 + bob); c.lineTo(R * 0.15, -R * 0.45 + bob); inkLine(c, 1.2, INK, 0.5);
      break;
    }
    case 'boss': drawBoss(c, e, t, ci || 0, sd, fill, dx, dy); break;
  }
  c.globalAlpha = 1;
  if (e.elite) {         // 朱の小さな印
    const sy = -R - 11, ss = 7;
    c.save(); c.translate(0, sy); c.rotate(-0.08);
    c.fillStyle = VERMILION; c.fillRect(-ss, -ss, ss * 2, ss * 2); c.lineWidth = 1.6; c.strokeStyle = INK; c.strokeRect(-ss, -ss, ss * 2, ss * 2);
    c.strokeStyle = '#fffdf6'; c.lineWidth = 1.7; c.beginPath(); c.moveTo(-3.5, -3); c.lineTo(3.5, -3); c.moveTo(-3.5, 1); c.lineTo(3.5, 1); c.moveTo(0, -4.5); c.lineTo(0, 4.5); c.stroke();
    c.restore();
  }
  if (e.frozenT > 0) { c.beginPath(); c.arc(0, 0, R * 1.1, 0, TAU); c.fillStyle = 'rgba(61,120,184,0.28)'; c.fill(); inkLine(c, 2, '#3d78b8'); }
  if (e.slowAmt > 0 && e.type !== 'boss') { c.fillStyle = 'rgba(111,182,232,0.22)'; c.beginPath(); c.arc(0, 0, R * 1.05, 0, TAU); c.fill(); }
  c.restore();
}
function drawBoss(c, e, t, ci, sd, fill, dx, dy) {
  const R = e.r, ch = CHAPTERS[ci], acc = ch.accent, br = Math.sin(t * 2) * R * 0.03;
  const eyes = 3 + (e.seed > 0.5 ? 2 : 0);
  if (ci === 2) {                       // 触手
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.1 + i / 6 * 0.8), bx = Math.cos(a) * R * 0.8, by = Math.sin(a) * R * 0.7;
      c.beginPath(); c.moveTo(bx, by);
      for (let k = 1; k <= 4; k++) c.lineTo(bx * (1 + k * 0.28) + Math.sin(t * 2.4 + i + k) * R * 0.1, by + k * R * 0.22);
      inkLine(c, 3.2);
    }
  }
  if (ci === 1) {                       // 角
    for (const sx of [-1, 1]) {
      c.beginPath(); c.moveTo(sx * R * 0.45, -R * 0.75); c.quadraticCurveTo(sx * R * 1.15, -R * 0.9, sx * R * 0.95, -R * 1.6); c.quadraticCurveTo(sx * R * 0.7, -R * 1.0, sx * R * 0.2, -R * 0.85); c.closePath(); inked(c, '#efe6d6', 2.4);
    }
  }
  blob(c, 0, br, R, R * 0.92, sd, 0.045, 16); inked(c, fill, 3.2);
  const g = c.createLinearGradient(0, -R * 0.3, 0, R); g.addColorStop(0, 'rgba(29,27,25,0)'); g.addColorStop(1, 'rgba(29,27,25,0.22)');
  blob(c, 0, br, R, R * 0.92, sd, 0.045, 16); c.fillStyle = g; c.fill();
  blob(c, 0, br, R, R * 0.92, sd + 33, 0.06, 16); inkLine(c, 1.1, INK, 0.35);
  for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(-R * 0.7 + i * R * 0.18, R * 0.55); c.lineTo(-R * 0.82 + i * R * 0.18, R * 0.85); inkLine(c, 1, INK, 0.35); }
  for (let i = 0; i < eyes; i++) {
    const ex = (i - (eyes - 1) / 2) * R * (eyes === 5 ? 0.3 : 0.42), ey = -R * 0.2 + Math.abs(i - (eyes - 1) / 2) * R * 0.12;
    eye(c, ex, ey + br, R * (eyes === 5 ? 0.14 : 0.18), dx, dy);
  }
  if (ci === 2) { c.beginPath(); c.arc(0, -R * 0.2 + br, R * 0.33, 0, TAU); c.fillStyle = '#fff'; c.fill(); inkLine(c, 2); c.beginPath(); c.arc(dx * R * 0.1, -R * 0.2 + dy * R * 0.1 + br, R * 0.2, 0, TAU); c.fillStyle = acc; c.fill(); c.beginPath(); c.arc(dx * R * 0.1, -R * 0.2 + dy * R * 0.1 + br, R * 0.09, 0, TAU); c.fillStyle = INK; c.fill(); }
  c.beginPath(); c.moveTo(-R * 0.55, R * 0.28);
  for (let i = 0; i <= 8; i++) c.lineTo(-R * 0.55 + i * R * 0.1375, R * 0.28 + (i % 2 ? R * 0.16 : 0) + Math.sin(t * 3) * 1.5);
  inkLine(c, 2.4);
  if (ci === 0) {                       // 王冠
    c.beginPath(); c.moveTo(-R * 0.5, -R * 0.82); c.lineTo(-R * 0.55, -R * 1.3); c.lineTo(-R * 0.25, -R * 1.05); c.lineTo(0, -R * 1.45); c.lineTo(R * 0.25, -R * 1.05); c.lineTo(R * 0.55, -R * 1.3); c.lineTo(R * 0.5, -R * 0.82); c.closePath();
    c.fillStyle = '#e3c06a'; c.fill(); inkLine(c, 2.4);
    c.beginPath(); c.arc(0, -R * 1.0, R * 0.07, 0, TAU); c.fillStyle = '#b3402a'; c.fill();
  }
  if (e.hp < e.maxHp * 0.4) { c.beginPath(); c.moveTo(-R * 0.2, -R * 0.9); c.lineTo(R * 0.05, -R * 0.5); c.lineTo(-R * 0.1, -R * 0.4); inkLine(c, 2, acc); }
}
function drawBrushRing(c, r, t, seed) {
  c.save(); c.scale(1, 0.42);
  for (let i = 0; i < 28; i++) {
    const a0 = i / 28 * TAU, a1 = (i + 1.15) / 28 * TAU;
    c.beginPath(); c.arc(0, 0, r + (hash(seed + i) - 0.5) * 1.6, a0, a1); c.lineWidth = 1.2 + hash(seed + i * 3) * 3.4; c.strokeStyle = INK; c.globalAlpha = 0.28 + hash(seed + i * 5) * 0.4; c.lineCap = 'round'; c.stroke();
  }
  c.globalAlpha = 1; c.restore();
}
function drawPlayer(c, t, hurt, b) {
  c.save();
  c.save(); c.translate(0, 14); c.scale(1, 0.32); c.beginPath(); c.arc(0, 0, 21, 0, TAU); c.fillStyle = 'rgba(29,27,25,0.13)'; c.fill(); c.restore();
  c.save(); c.translate(0, 14); drawBrushRing(c, 25, t, 3); c.restore();
  const bob = Math.sin(t * 2.2) * 1.2;
  c.translate(0, bob);
  const fill = hurt > 0 ? '#ffd0c0' : PAPER_FILL;
  // 杖
  c.beginPath(); c.moveTo(13, 15); c.lineTo(14, -20); inkLine(c, 2.4);
  const pulse = 1 + Math.sin(t * 5) * 0.12;
  const gg = c.createRadialGradient(14, -24, 0, 14, -24, 12 * pulse); gg.addColorStop(0, 'rgba(255,230,140,0.95)'); gg.addColorStop(1, 'rgba(217,180,90,0)');
  c.fillStyle = gg; c.beginPath(); c.arc(14, -24, 12 * pulse, 0, TAU); c.fill();
  c.beginPath(); c.arc(14, -24, 3.6, 0, TAU); c.fillStyle = '#e3b84a'; c.fill(); inkLine(c, 1.4);
  // ローブ
  c.beginPath(); c.moveTo(-6, -4); c.quadraticCurveTo(-13, 6, -11, 16); c.quadraticCurveTo(-4, 19, 0, 17); c.quadraticCurveTo(4, 19, 11, 16); c.quadraticCurveTo(13, 6, 6, -4); c.closePath(); inked(c, fill, 2);
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-8 + i * 3.4, 6); c.lineTo(-9 + i * 3.4, 14); inkLine(c, 0.9, INK, 0.45); }
  c.beginPath(); c.moveTo(-8, 3); c.quadraticCurveTo(0, 6, 8, 3); inkLine(c, 2, GOLD);
  c.beginPath(); c.moveTo(6, 0); c.lineTo(13, -3); inkLine(c, 2);
  // 頭と帽子
  c.beginPath(); c.arc(0, -9, 5.2, 0, TAU); inked(c, '#fff4e4', 1.8);
  c.beginPath(); c.arc(-1.8, -9, 0.8, 0, TAU); c.arc(1.8, -9, 0.8, 0, TAU); c.fillStyle = INK; c.fill();
  c.beginPath(); c.moveTo(-10, -11); c.quadraticCurveTo(0, -14, 10, -11); c.quadraticCurveTo(2, -16, 4, -31 + Math.sin(t * 2) * 1.2); c.quadraticCurveTo(-6, -20, -10, -11); c.closePath(); inked(c, '#2b2a33', 1.8);
  c.beginPath(); c.moveTo(-8, -12.2); c.quadraticCurveTo(0, -15, 8.5, -12.4); inkLine(c, 2, GOLD);
  c.beginPath(); c.arc(1, -20, 1.4, 0, TAU); c.fillStyle = '#e3b84a'; c.fill();
  c.restore();
}

/* ---------- 演出管理 ---------- */
const fxList = [], parts = [], nums = [];
const MAX_PARTS = 420, MAX_NUMS = 48;
const SPELL_COL = { missile: '#2d4a9c', lightning: '#1b8a6b', meteor: '#c8321e', frost: '#3d78b8', orb: '#c98a00', laser: '#7a2fb0' };   // 群青・翡翠・朱・山吹（加算発光は使わない）
const VERMILION = '#c8321e';
function addPart(x, y, vx, vy, life, size, col, g) {
  if (parts.length >= MAX_PARTS) parts.splice(0, 60);
  parts.push({ x, y, vx, vy, life, max: life, size, col, g: g || 0 });
}
function splat(x, y, n, col, speed, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = (0.3 + Math.random()) * speed;
    addPart(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.35 + Math.random() * 0.45, (size || 2) * (0.6 + Math.random() * 0.9), Math.random() < 0.7 ? INK : col, 60);
  }
}
function addNum(x, y, txt, col, big) {
  if (nums.length >= MAX_NUMS) nums.shift();
  nums.push({ x: x + (Math.random() - 0.5) * 10, y: y - 8, txt, col, big, t: 0, life: big ? 0.9 : 0.65 });
}
function jagged(x0, y0, x1, y1, seg, amp) {
  const pts = [x0, y0];
  for (let i = 1; i < seg; i++) { const k = i / seg; pts.push(x0 + (x1 - x0) * k + (Math.random() - 0.5) * amp, y0 + (y1 - y0) * k + (Math.random() - 0.5) * amp); }
  pts.push(x1, y1); return pts;
}
function handleEvents(b) {
  const evs = b.events; b.events = [];
  for (const e of evs) {
    switch (e.type) {
      case 'hit': {
        const col = SPELL_COL[e.spell] || INK;
        splat(e.x, e.y, e.big ? 3 : 4, col, 70, 2);
        addNum(e.x, e.y, String(e.dmg), col, false);
        if (e.crit) addNum(e.x, e.y - 6, '会心!', GOLD, true);
        Sfx.play('hit'); break;
      }
      case 'miss': addNum(e.x, e.y, 'すか', '#8c867a', false); break;
      case 'die': {
        splat(e.x, e.y, e.elite ? 22 : e.vanish ? 8 : 12, '#1d1b19', e.elite ? 150 : 110, e.elite ? 3.4 : 2.6);
        if (fxList.length > 160) fxList.shift();
        fxList.push({ k: 'blot', x: e.x, y: e.y, r: e.r * (e.elite ? 2.1 : 1.5), t: 0, life: 1.7, seed: Math.random() * 99 });
        if (e.etype === 'boss') { G.shake = 6; for (let i = 0; i < 40; i++) splat(e.x, e.y, 1, '#b8860b', 240, 4); Sfx.play('boom'); }
        else if (!e.vanish) Sfx.play('pop');
        break;
      }
      case 'bolt': {
        const segs = [], pts = e.pts;
        segs.push(jagged(pts[0].x + (Math.random() - 0.5) * 30, pts[0].y - 360, pts[0].x, pts[0].y, 7, 34));
        for (let i = 1; i < pts.length; i++) segs.push(jagged(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, 5, 16));
        fxList.push({ k: 'bolt', segs, t: 0, life: 0.32 });
        for (const p of pts) splat(p.x, p.y, 3, '#00a9c9', 90, 2);
        Sfx.play('zap'); break;
      }
      case 'spark': fxList.push({ k: 'spark', x: e.x, y: e.y, r: e.r, t: 0, life: 0.35 }); splat(e.x, e.y, 4, SPELL_COL.lightning, 110, 2.4); break;
      case 'shock': fxList.push({ k: 'shock', r: e.r, t: 0, life: 0.5 }); G.shake = Math.max(G.shake, 2); Sfx.play('boom'); break;
      case 'freeze': splat(e.x, e.y, 5, SPELL_COL.frost, 80, 2.2); break;
      case 'barrier': fxList.push({ k: 'lvring', t: 0, life: 0.6 }); break;
      case 'meteor': fxList.push({ k: 'boom', x: e.x, y: e.y, r: e.r, t: 0, life: 0.5 }); splat(e.x, e.y, 14, '#d6402a', 190, 3); G.shake = Math.max(G.shake, 3); Sfx.play('boom'); break;
      case 'nova': fxList.push({ k: 'nova', r: e.r, t: 0, life: 0.5 }); Sfx.play('ice'); break;
      case 'cast': Sfx.play(e.spell === 'laser' ? 'laser' : 'shot'); break;
      case 'levelup': fxList.push({ k: 'lvring', t: 0, life: 0.9 }); Sfx.play('lvl'); break;
      case 'gem': Sfx.play('gem'); break;
      case 'hurt': Sfx.play('hurt'); break;
      case 'summon': fxList.push({ k: 'summon', x: e.x, y: e.y, t: 0, life: 0.5 }); break;
      case 'wave': showBanner('wave', e.wave); break;
      case 'boss': showBanner('boss', e.name); G.shake = 4; Sfx.play('warn'); break;
      case 'loot': {
        const R = RARITIES[e.item.rarity];
        fxList.push({ k: 'loot', x: e.x, y: e.y, col: R.color, t: 0, life: 0.9 });
        toast(`戦利品：${e.item.name}（${R.name}）`, R.color); Sfx.play('loot'); break;
      }
      case 'won': G.endTimer = 2.2; break;
      case 'lost': G.endTimer = 1.6; fxList.push({ k: 'lvring', t: 0, life: 1.2, dark: true }); break;
    }
  }
}
let bannerTimer = null;
function showBanner(kind, v) {
  const el = $('banner'); el.className = 'banner ' + kind;
  if (kind === 'wave') {
    el.innerHTML = `<div class="small">WAVE</div><div class="big">第${v}波</div>`; if (v > 1) Sfx.play('wave');
  } else el.innerHTML = `<div class="band"></div><div class="body"><div class="big">警告</div><div class="small">${esc(v)}　現る</div></div><div class="band"></div>`;
  void el.offsetWidth; el.classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.add('hidden'), kind === 'boss' ? 3200 : 1900);
}
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) { const f = fxList[i]; f.t += dt; if (f.t >= f.life) fxList.splice(i, 1); }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy = p.vy * 0.94 + p.g * dt;
  }
  for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; n.t += dt; n.y -= 26 * dt; if (n.t >= n.life) nums.splice(i, 1); }
  G.shake *= Math.pow(0.02, dt);
}
const AIR_FX = { bolt: 1, lvring: 1, summon: 1, loot: 1, boom: 1, spark: 1, shock: 1 };
function drawFx(c, b, t, air) {
  for (const f of fxList) {
    if (!!AIR_FX[f.k] !== air) continue;
    const k = f.t / f.life;
    switch (f.k) {
      case 'bolt': {
        const a = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
        for (const pass of [[8, 0.9, INK], [4.6, 1, '#1b8a6b'], [1.5, 1, '#e9f3d8']]) {
          c.lineWidth = pass[0]; c.globalAlpha = pass[1] * a * (Math.random() < 0.15 ? 0.5 : 1); c.strokeStyle = pass[2]; c.lineJoin = 'round'; c.lineCap = 'round';
          for (const s of f.segs) { c.beginPath(); c.moveTo(s[0], s[1]); for (let i = 2; i < s.length; i += 2) c.lineTo(s[i], s[i + 1]); c.stroke(); }
        }
        c.globalAlpha = 1; break;
      }
      case 'boom': {
        const r = f.r * (0.4 + 0.75 * Math.sqrt(k));
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, `rgba(224,150,40,${0.8 * (1 - k)})`); g.addColorStop(0.55, `rgba(200,50,30,${0.6 * (1 - k)})`); g.addColorStop(1, 'rgba(200,50,30,0)');
        c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, r, 0, TAU); c.fill();
        c.beginPath(); c.arc(f.x, f.y, r * 0.95, 0, TAU); inkLine(c, 3 * (1 - k) + 0.5, INK, 0.7 * (1 - k)); break;
      }
      case 'nova': {
        const r = f.r * Math.sqrt(k);
        const g = c.createRadialGradient(0, 0, r * 0.5, 0, 0, r); g.addColorStop(0, 'rgba(180,225,250,0)'); g.addColorStop(1, `rgba(150,210,245,${0.5 * (1 - k)})`);
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
        c.beginPath(); c.arc(0, 0, r, 0, TAU); inkLine(c, 4 * (1 - k) + 1, '#6fb6e8', 0.9 * (1 - k));
        c.beginPath(); c.arc(0, 0, r * 0.93, 0, TAU); inkLine(c, 1, INK, 0.5 * (1 - k));
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + 0.3; c.beginPath(); c.moveTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86); c.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02); inkLine(c, 1.6, '#4f9fd6', 0.8 * (1 - k)); }
        break;
      }
      case 'blot': {
        const r = f.r * (0.55 + Math.min(1, k * 4) * 0.45);   // 染みはすぐ広がり、残って薄く消える
        blob(c, f.x, f.y, r, r * 0.8, f.seed, 0.25, 9); c.fillStyle = INK; c.globalAlpha = 0.3 * Math.pow(1 - k, 1.6); c.fill();
        blob(c, f.x + r * 0.5, f.y + r * 0.2, r * 0.3, r * 0.25, f.seed + 5, 0.3, 7); c.globalAlpha = 0.22 * Math.pow(1 - k, 1.6); c.fill(); c.globalAlpha = 1; break;
      }
      case 'lvring': {
        const r = 20 + k * 150, col = f.dark ? '#b3402a' : '#d9a02a';
        c.save(); c.translate(0, 8); c.scale(1, 0.55);
        c.beginPath(); c.arc(0, 0, r, 0, TAU); inkLine(c, 5 * (1 - k) + 1, col, 0.9 * (1 - k));
        c.beginPath(); c.arc(0, 0, r * 0.82, 0, TAU); c.setLineDash([6, 8]); inkLine(c, 2, INK, 0.6 * (1 - k)); c.setLineDash([]);
        c.restore();
        if (!f.dark) for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + k * 2; addPart(Math.cos(a) * 20, -k * 40 + Math.sin(a) * 10, 0, -30, 0.2, 2, '#d9a02a', 0); }
        break;
      }
      case 'spark': { c.beginPath(); c.arc(f.x, f.y, f.r * (0.5 + k * 0.6), 0, TAU); c.fillStyle = `rgba(27,138,107,${0.3 * (1 - k)})`; c.fill(); inkLine(c, 2.4 * (1 - k) + 0.6, INK, 0.8 * (1 - k)); break; }
      case 'shock': {
        const r = f.r * Math.sqrt(k);
        c.beginPath(); c.arc(0, 0, r, 0, TAU); inkLine(c, 6 * (1 - k) + 1, INK, 0.85 * (1 - k)); c.beginPath(); c.arc(0, 0, r, 0, TAU); inkLine(c, 3 * (1 - k) + 0.6, '#c98a00', 1 - k);
        break;
      }
      case 'summon': c.beginPath(); c.arc(f.x, f.y, 10 + k * 34, 0, TAU); inkLine(c, 2, '#9a3fd0', 0.8 * (1 - k)); break;
      case 'loot': {
        const px = f.x * (1 - Math.min(1, k * 1.6)), py = f.y * (1 - Math.min(1, k * 1.6)) - Math.sin(k * Math.PI) * 30;
        c.save(); c.translate(px, py); c.rotate(k * 6);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, 16); g.addColorStop(0, f.col); g.addColorStop(1, 'rgba(255,255,255,0)'); c.globalAlpha = 0.5 * (1 - k * 0.5); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 0); c.lineTo(0, 8); c.lineTo(-6, 0); c.closePath(); c.fillStyle = f.col; c.fill(); inkLine(c, 1.5); c.restore();
        break;
      }
    }
  }
}
function drawNums(c) {
  c.textAlign = 'center'; c.lineJoin = 'round';
  for (const n of nums) {
    const k = n.t / n.life, a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    c.globalAlpha = a; c.font = `${n.big ? 900 : 700} ${n.big ? 15 : 12}px "Hiragino Mincho ProN","Yu Mincho",serif`;
    c.lineWidth = 3.4; c.strokeStyle = 'rgba(251,248,240,0.95)'; c.strokeText(n.txt, n.x, n.y);
    c.fillStyle = n.col; c.fillText(n.txt, n.x, n.y);
  }
  c.globalAlpha = 1;
}
function drawParts(c) {
  for (const p of parts) {
    const a = p.life / p.max; c.globalAlpha = Math.min(1, a * 1.5);
    c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a * 0.6), 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
}
function drawOverlayFrame(c, w, h) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  const d = cv.dpr;
  c.lineWidth = 1.2 * d; c.strokeStyle = 'rgba(29,27,25,0.7)'; c.strokeRect(8 * d, 8 * d, cv.width - 16 * d, cv.height - 16 * d);
  c.lineWidth = 1 * d; c.strokeStyle = 'rgba(184,134,11,0.85)'; c.strokeRect(12 * d, 12 * d, cv.width - 24 * d, cv.height - 24 * d);
  c.fillStyle = GOLD;
  for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) { c.beginPath(); c.moveTo(x * d, (y - 6) * d); c.lineTo((x + 6) * d, y * d); c.lineTo(x * d, (y + 6) * d); c.lineTo((x - 6) * d, y * d); c.closePath(); c.fill(); }
}

/* ---------- 戦闘描画 ---------- */
function drawBattle(t) {
  const b = G.b, { w, h, scale, px, py } = VP, d = cv.dpr, ci = stageInfo(G.stage).chapter;
  drawPaper(w, h, ci);
  const sh = G.shake > 0.3 ? G.shake : 0, ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
  cx.setTransform(d * scale, 0, 0, d * scale, (px + ox) * d, (py + oy) * d);
  // 地面：魔法陣
  cx.save(); cx.rotate(t * 0.05);
  for (const [r, ww, a] of [[150, 1.2, 0.2], [108, 1, 0.18], [64, 1.2, 0.2]]) { cx.beginPath(); cx.arc(0, 0, r, 0, TAU); inkLine(cx, ww, INK, a); }
  for (let i = 0; i < 12; i++) { const an = i / 12 * TAU; cx.beginPath(); cx.moveTo(Math.cos(an) * 108, Math.sin(an) * 108); cx.lineTo(Math.cos(an) * 150, Math.sin(an) * 150); inkLine(cx, 0.9, INK, 0.16); cx.beginPath(); cx.arc(Math.cos(an) * 128, Math.sin(an) * 128, 2, 0, TAU); cx.fillStyle = GOLD; cx.globalAlpha = 0.5; cx.fill(); cx.globalAlpha = 1; }
  cx.restore();
  // 墨のにじみ（背景のしみ）
  for (let i = 0; i < 7; i++) { const x = (hash(i * 3.3 + ci) - 0.5) * 900, y = (hash(i * 7.7 + ci) - 0.5) * 1100, r = 70 + hash(i) * 90; const g = cx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(29,27,25,0.05)'); g.addColorStop(1, 'rgba(29,27,25,0)'); cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2); }
  // メテオ警告
  for (const m of b.meteors) {
    if (m.t < 0) continue;
    const k = m.t / m.delay;
    cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, TAU); cx.fillStyle = `rgba(214,64,42,${0.05 + 0.12 * k})`; cx.fill(); cx.setLineDash([6, 5]); inkLine(cx, 1.8, '#d6402a', 0.8); cx.setLineDash([]);
    cx.beginPath(); cx.arc(m.x, m.y, m.r * k, 0, TAU); inkLine(cx, 1.2, '#d6402a', 0.6);
    const fy = m.y - (1 - k) * 420, fx = m.x - (1 - k) * 160;
    cx.beginPath(); cx.moveTo(fx + 40, fy - 90); cx.lineTo(fx, fy); inkLine(cx, 9, 'rgba(214,64,42,0.35)'); cx.beginPath(); cx.moveTo(fx + 40, fy - 90); cx.lineTo(fx, fy); inkLine(cx, 3, '#e8803a', 0.8);
    blob(cx, fx, fy, 13, 12, 7 + Math.floor(t * 10), 0.18, 9); cx.fillStyle = '#3b2b25'; cx.fill(); inkLine(cx, 2);
  }
  for (const f of b.burns) {      // 燃える地面（朱の墨）
    const a = Math.min(1, f.t / 0.6);
    cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, TAU); cx.fillStyle = `rgba(200,50,30,${0.16 * a})`; cx.fill(); cx.setLineDash([5, 5]); inkLine(cx, 1.6, VERMILION, 0.8 * a); cx.setLineDash([]);
    for (let i = 0; i < 5; i++) { const an = i * 1.9 + f.x, rr = f.r * 0.6 * hash(f.y + i), fx = f.x + Math.cos(an) * rr, fy = f.y + Math.sin(an) * rr * 0.7, fh = 6 + 5 * Math.abs(Math.sin(t * 6 + i)); cx.beginPath(); cx.moveTo(fx - 4, fy); cx.quadraticCurveTo(fx, fy - fh * 1.4, fx + 4, fy); cx.closePath(); cx.fillStyle = '#d98a1f'; cx.globalAlpha = a; cx.fill(); inkLine(cx, 1.3); cx.globalAlpha = 1; }
  }
  for (const p of b.trail) {      // アルカナオーブの残像
    const a = p.t / 0.6; cx.beginPath(); cx.arc(p.x, p.y, 3 + 4 * a, 0, TAU); cx.fillStyle = `rgba(201,138,0,${0.45 * a})`; cx.fill(); inkLine(cx, 1, INK, 0.4 * a);
  }
  drawFx(cx, b, t, false);       // 地面系（ノヴァ・染み）
  // ジェム
  for (const g of b.gems) {
    const bob = Math.sin(t * 5 + g.x) * 1.5, s = g.big ? 7 : 4.2;
    cx.save(); cx.translate(g.x, g.y + bob); cx.rotate(Math.PI / 4);
    if (g.big) { cx.beginPath(); cx.arc(0, 0, s * 1.8, 0, TAU); cx.fillStyle = 'rgba(217,180,90,0.35)'; cx.fill(); }
    cx.fillStyle = g.big ? '#e3b84a' : '#3aa57a'; cx.fillRect(-s / 2, -s / 2, s, s); cx.lineWidth = 1.2; cx.strokeStyle = INK; cx.strokeRect(-s / 2, -s / 2, s, s); cx.restore();
  }
  // 敵＋プレイヤー（y順）
  const list = b.enemies.slice().sort((a, bb) => a.y - bb.y);
  let pDone = false;
  for (const e of list) { if (!pDone && e.y > 0) { drawPlayer(cx, t, b.hurtFlash, b); pDone = true; } drawEnemy(cx, e, t, ci); }
  if (!pDone) drawPlayer(cx, t, b.hurtFlash, b);
  // オーブ
  if (b.orbPos) for (const o of b.orbPos) {
    cx.beginPath(); cx.arc(o.x, o.y, 11, 0, TAU); cx.fillStyle = 'rgba(201,138,0,0.28)'; cx.fill();
    cx.beginPath(); cx.arc(o.x, o.y, 6.5, 0, TAU); cx.fillStyle = '#d99a00'; cx.fill(); inkLine(cx, 2);
    cx.beginPath(); cx.arc(o.x - 1.8, o.y - 2, 1.6, 0, TAU); cx.fillStyle = '#fff'; cx.fill();
  }
  // ミサイル
  for (const p of b.projs) {
    if (p.trail && p.trail.length > 3) { cx.beginPath(); cx.moveTo(p.trail[0], p.trail[1]); for (let i = 2; i < p.trail.length; i += 2) cx.lineTo(p.trail[i], p.trail[i + 1]); inkLine(cx, 3, '#2d4a9c', 0.5); }
    cx.beginPath(); cx.arc(p.x, p.y, 5, 0, TAU); cx.fillStyle = '#3d5fc4'; cx.fill(); inkLine(cx, 1.8);
    cx.beginPath(); cx.arc(p.x - 1, p.y - 1, 1.6, 0, TAU); cx.fillStyle = '#fff'; cx.fill();
  }
  // レーザー
  if (b.laser) {
    const l = b.laser, fl = 0.85 + Math.random() * 0.15;
    const fadeIn = Math.min(1, l.t / 0.12), fadeOut = Math.min(1, (LASER_DUR - l.t) / 0.2), a = Math.max(0, Math.min(fadeIn, fadeOut));
    for (const bm of l.beams) {
      const ex = Math.cos(bm.ang) * 720, ey = Math.sin(bm.ang) * 720;
      for (const [wm, al, col] of [[1.9, 0.95, INK], [1.2, 1, '#7a2fb0'], [0.35, 1, '#f1e6fa']]) {   // 濃い縁取り＋中暗色＋芯
        cx.beginPath(); cx.moveTo(14, -24); cx.lineTo(ex, ey); cx.lineWidth = l.w * wm * fl; cx.globalAlpha = al * a; cx.strokeStyle = col; cx.lineCap = 'round'; cx.stroke();
      }
    }
    cx.globalAlpha = 1;
  }
  if (b.barrierT > 0) {            // フロストLv5のバリア
    const a = Math.min(1, b.barrierT / 0.3); cx.beginPath(); cx.arc(0, 0, 30, 0, TAU); cx.fillStyle = `rgba(61,120,184,${0.16 * a})`; cx.fill(); inkLine(cx, 3, INK, 0.8 * a); cx.beginPath(); cx.arc(0, 0, 30, 0, TAU); inkLine(cx, 1.6, '#3d78b8', a);
  }
  drawFx(cx, b, t, true);        // 空中系（雷・爆発・光の輪）
  drawParts(cx);
  drawNums(cx);
  drawOverlayFrame(cx, w, h);
  if (b.hurtFlash > 0) {
    cx.setTransform(1, 0, 0, 1, 0, 0);
    const g = cx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.25, cv.width / 2, cv.height / 2, cv.height * 0.75);
    g.addColorStop(0, 'rgba(179,64,42,0)'); g.addColorStop(1, `rgba(179,64,42,${Math.min(0.5, b.hurtFlash * 2)})`); cx.fillStyle = g; cx.fillRect(0, 0, cv.width, cv.height);
  }
}
const hudEl = { hp: $('hp-fill'), hpt: $('hp-text'), lv: $('lv-text'), xp: $('xp-fill'), wave: $('wave-text'), time: $('time-text'), gold: $('gold-text'), loot: $('loot-text'), boss: $('boss-bar'), bn: $('boss-name'), bf: $('boss-fill') };
function updateHud(b) {
  const p = b.player;
  hudEl.hp.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1).toFixed(3)})`;
  setText(hudEl.hpt, `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`);
  setText(hudEl.lv, 'Lv ' + p.level);
  hudEl.xp.style.transform = `scaleX(${clamp(p.xp / xpNeeded(p.level), 0, 1).toFixed(3)})`;
  setText(hudEl.wave, b.wave >= MAX_WAVE ? '最終波 ボス' : `第${b.wave}波` + (b.inGap ? ' 終了' : ` ・ 残${Math.max(0, Math.ceil(WAVE_LEN - b.waveT))}秒`));
  const s = Math.floor(b.time); setText(hudEl.time, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  setText(hudEl.gold, '金 ' + fmt(b.goldF));
  setText(hudEl.loot, '戦利品 ' + b.drops.length);
  if (b.boss && b.state !== 'won') { hudEl.boss.classList.remove('hidden'); setText(hudEl.bn, b.boss.name); hudEl.bf.style.transform = `scaleX(${clamp(b.boss.hp / b.boss.maxHp, 0, 1).toFixed(3)})`; }
  else hudEl.boss.classList.add('hidden');
}

/* ---------- タイトル／ホーム背景（墨絵ドゥードル） ---------- */
const doodles = [];
function initDoodles() {
  const types = ['slimy', 'dash', 'golem', 'splitter', 'bones', 'ghost', 'slimy', 'dash'];
  const rnd = mulberry32(42);
  types.forEach((ty, i) => doodles.push({ type: ty, x: rnd() * innerWidth, y: innerHeight * (0.18 + 0.7 * rnd()), vx: (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 14), r: ENEMIES[ty].r * (1.3 + rnd() * 0.5), seed: rnd(), ph: rnd() * 6 }));
}
function drawTitleBg(t, dt) {
  const w = innerWidth, h = innerHeight, d = cv.dpr, ci = G.mode === 'home' || G.mode === 'equip' ? Math.min(2, Math.floor((G.selStage - 1) / 5)) : 0;
  drawPaper(w, h, ci);
  cx.setTransform(d, 0, 0, d, 0, 0);
  const faint = G.mode === 'title' ? 1 : 0.28;
  cx.globalAlpha = faint;
  for (const o of doodles) {
    o.x += o.vx * dt; if (o.x < -60) o.x = w + 60; if (o.x > w + 60) o.x = -60;
    const e = { x: 0, y: 0, r: o.r, type: o.type, seed: o.seed, flash: 0, slowAmt: 0, translucent: Math.sin(t + o.ph) > 0.4, summonT: 9, stopped: false, elite: false, hp: 1, maxHp: 1 };
    cx.save(); cx.translate(o.x, o.y + Math.sin(t * 1.3 + o.ph) * 6); cx.scale(o.vx < 0 ? 1 : -1, 1);
    drawEnemy(cx, e, t, 0);
    cx.restore();
  }
  cx.globalAlpha = 1;
  if (G.mode === 'title') { // 魔法の火花
    for (let i = 0; i < 6; i++) { const a = t * 0.4 + i * 1.05; const x = w / 2 + Math.cos(a * 1.3) * w * 0.38, y = h * 0.5 + Math.sin(a) * h * 0.3; cx.beginPath(); cx.arc(x, y, 2.2, 0, TAU); cx.fillStyle = Object.values(SPELL_COL)[i]; cx.globalAlpha = 0.55; cx.fill(); }
    cx.globalAlpha = 1;
  }
  drawOverlayFrame(cx, w, h);
}

/* ---------- メインループ ---------- */
let lastTs = 0, timeAcc = 0, lastDraw = 0, skipDt = 0;
/** 30fpsモード：描画を約33msに1回へ間引く（戦闘計算は毎フレーム） */
function drawDue(ts) {
  if (!save.settings.fps30) { lastDraw = ts; return true; }
  if (ts - lastDraw < 30) return false;
  lastDraw = ts; return true;
}
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016); lastTs = ts; timeAcc += dt;
  if (G.mode === 'battle' && G.b) {
    const b = G.b;
    if (!G.paused) {
      const spd = G.canFast && G.speed === 2 ? 2 : 1;
      G.acc += dt * spd; let n = 0;
      while (G.acc >= 1 / 60 && n < 4 * spd) { stepBattle(b, 1 / 60); G.acc -= 1 / 60; n++; if (b.state !== 'playing') break; }
      if (n === 4 * spd) G.acc = 0;
      handleEvents(b);
      updateFx(dt);
      if (b.state === 'levelup' && $('ov-levelup').classList.contains('hidden')) showCards();
      if (b.state === 'won' || b.state === 'lost') {
        G.endTimer -= dt;
        if (G.endTimer <= 0) finishBattle(b.state);
      }
    }
    if (G.b && drawDue(ts)) { drawBattle(timeAcc); updateHud(G.b); }
  } else if (drawDue(ts)) {
    drawTitleBg(timeAcc, dt + skipDt); skipDt = 0;
  } else skipDt += dt;
}

/* ---------- 起動 ---------- */
loadSave();
resize(); initDoodles();
renderTitleBtns();
show('title');
requestAnimationFrame(frame);
// デバッグ／テスト用フック
window.__MH = { ACT, G, get save() { return save; }, startBattle, finishBattle, renderHome, renderEquip, openItem, handleEvents, drawBattle, frame };
})();
