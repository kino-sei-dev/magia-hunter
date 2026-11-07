'use strict';
/* =====================================================================
   マギアハンター v2.0  game.js
   第1部：純粋計算＋戦闘エンジン（DOM非依存・Nodeから require 可能）
   第2部：描画・UI・音・セーブ（ブラウザ専用）
   骨格：画面下部の城壁＋その後ろの魔法使い。敵は上から進行。城壁HP0で敗北。
   ===================================================================== */

/* ---------- 定数 ---------- */
const SAVE_KEY = 'magia_hunter_save_v2';
const SLOTS = ['hood', 'robe', 'boots', 'wand', 'ring', 'neck'];
const SLOT_NAME = { hood: 'フード', robe: 'ローブ', boots: 'ブーツ', wand: 'スティック', ring: 'リング', neck: 'ネックレス' };
const INV_CAP = 60, GEM_CAP = 300;
const WAVE_LEN = 15, WAVE_GAP = 3, MAX_WAVE = 20, MID_WAVE = 10;
const FIELD_W = 360, FIELD_H = 640, WALL_Y = 520, MAGE_X = 180, MAGE_Y = 586;   // 戦場の論理座標
const MAX_ENEMIES = 110;
const CRIT_BASE = 0.06;
const BASE_WALL = 380;            // 城壁の基本HP
const SPELL_POWER = 1.0;          // 全魔法の基礎威力係数（バランス調整用）
const MAX_SPELLS = 5;             // 同時所持できる魔法
const FREE_REROLLS = 2;
const ENH_REFUND = 0.75;
const BOSS_PITY_STEP = 0.4, BOSS_PITY_MAX = 10;
const WEAK_MULT = 1.5;            // 弱点：+50%
function resistMult(stage) { return Math.max(0.4, 0.6 - 0.005 * (stage - 1)); }   // 耐性：-40%（ステージが進むとわずかに厳しく）
const BOOK_MAX = 10, BOOK_STEP = 0.04;

const RARITIES = [
  { id: 'common', name: 'コモン', color: '#8c867a', mult: 1.0, affixes: 0, sell: 10, cost: 1.0, sockets: 1 },
  { id: 'rare', name: 'レア', color: '#2f6fd6', mult: 1.3, affixes: 1, sell: 30, cost: 1.5, sockets: 2 },
  { id: 'epic', name: 'エピック', color: '#8a3fc4', mult: 1.7, affixes: 2, sell: 90, cost: 2.2, sockets: 3 },
  { id: 'legend', name: 'レジェンド', color: '#c8962a', mult: 2.3, affixes: 3, sell: 300, cost: 3.0, sockets: 5 },
];

/* ---------- 属性 ---------- */
const ELEM_IDS = ['magic', 'fire', 'ice', 'thunder', 'wind', 'phys'];
const ELEMS = {
  magic: { name: '魔', color: '#2d4a9c' }, fire: { name: '炎', color: '#c8321e' }, ice: { name: '氷', color: '#3d78b8' },
  thunder: { name: '雷', color: '#1b8a6b' }, wind: { name: '風', color: '#5a8f3a' }, phys: { name: '物理', color: '#7a6a52' },
};

/* ---------- 魔法13種 ---------- */
const SPELL_IDS = ['missile', 'fireball', 'icicle', 'thunder', 'log', 'chain', 'fstar', 'beam', 'web', 'wave', 'whirl', 'meteor', 'storm'];
const SPELL_UNLOCK = { missile: 0, fireball: 1, icicle: 2, thunder: 3, log: 4, chain: 5, fstar: 6, beam: 7, web: 8, wave: 9, whirl: 10, meteor: 11, storm: 12 };   // 必要なクリア済みステージ数
const SPELLS = {
  missile: {
    name: '魔導ミサイル', elem: 'magic', color: '#2d4a9c', cd: 0.8, icon: '矢', book5: '弾が+1発',
    lv: [{ n: 1, dmg: 12 }, { n: 1, dmg: 15 }, { n: 2, dmg: 15 }, { n: 2, dmg: 19 }, { n: 3, dmg: 23 }],
    desc: l => `城壁に近い敵へ追尾弾${l.n}発（威力${l.dmg}）`,
    opts: [
      { id: 'rapid', name: '連射', desc: 'クールダウン -20%', max: 3 },
      { id: 'volley', name: '斉射', desc: '弾 +1・威力 -15%', max: 2, trade: true },
      { id: 'homing', name: '追尾強化', desc: '命中後に再追尾 +1回', max: 2 },
    ],
  },
  fireball: {
    name: '火玉', elem: 'fire', color: '#c8321e', cd: 2.2, icon: '炎', book5: '爆発範囲 +15%',
    lv: [{ dmg: 30, r: 48 }, { dmg: 38, r: 52 }, { dmg: 46, r: 56 }, { dmg: 56, r: 60 }, { dmg: 68, r: 66 }],
    desc: l => `密集地へ放物線、着弾で爆発（威力${l.dmg}・範囲${l.r}）`,
    opts: [
      { id: 'wide', name: '爆炎', desc: '爆発範囲 +20%', max: 2 },
      { id: 'twin', name: '連弾', desc: '火玉 +1個・威力 -30%', max: 2, trade: true },
      { id: 'burn', name: '延焼', desc: '着弾点が2秒燃える', max: 1 },
    ],
  },
  icicle: {
    name: '氷柱', elem: 'ice', color: '#3d78b8', cd: 3.0, icon: '氷', book5: '氷柱 +1本',
    lv: [{ dmg: 14, n: 3 }, { dmg: 18, n: 3 }, { dmg: 22, n: 4 }, { dmg: 27, n: 5 }, { dmg: 33, n: 5 }],
    desc: l => `上方へ貫通する氷柱${l.n}本・鈍足（威力${l.dmg}）`,
    opts: [
      { id: 'cols', name: '氷柱増', desc: '氷柱 +2本・威力 -20%', max: 2, trade: true },
      { id: 'deep', name: '深凍', desc: '鈍足 +15%・持続 +1秒', max: 2 },
      { id: 'fast', name: '速凍', desc: 'クールダウン -15%', max: 3 },
    ],
  },
  thunder: {
    name: '雷撃', elem: 'thunder', color: '#1b8a6b', cd: 1.8, icon: '雷', book5: '落雷範囲 +30%',
    lv: [{ dmg: 28, r: 34 }, { dmg: 34, r: 36 }, { dmg: 40, r: 38 }, { dmg: 48, r: 40 }, { dmg: 58, r: 44 }],
    desc: l => `城壁に近い敵へ即時落雷（威力${l.dmg}・範囲${l.r}）`,
    opts: [
      { id: 'double', name: '二連', desc: '追加の落雷 +1・各威力 -20%', max: 2, trade: true },
      { id: 'area', name: '雷域', desc: '落雷範囲 +30%', max: 2 },
      { id: 'fast', name: '迅雷', desc: 'クールダウン -20%', max: 2 },
    ],
  },
  log: {
    name: '轢丸太', elem: 'phys', color: '#7a6a52', cd: 4.0, icon: '丸', book5: 'ノックバック +50%',
    lv: [{ dmg: 22, w: 36 }, { dmg: 28, w: 38 }, { dmg: 34, w: 40 }, { dmg: 42, w: 44 }, { dmg: 52, w: 48 }],
    desc: l => `レーンを転がり上がる丸太（貫通・押し戻し・威力${l.dmg}）`,
    opts: [
      { id: 'twin', name: '双丸太', desc: '丸太 +1本・威力 -25%', max: 2, trade: true },
      { id: 'heavy', name: '重量', desc: '威力 +25%・クールダウン +15%', max: 2, trade: true },
      { id: 'wide', name: '太丸太', desc: '幅 +40%', max: 2 },
    ],
  },
  chain: {
    name: '雷鎖', elem: 'thunder', color: '#1b8a6b', cd: 2.4, icon: '鎖', book5: '連鎖 +1',
    lv: [{ dmg: 20, n: 3 }, { dmg: 24, n: 4 }, { dmg: 28, n: 5 }, { dmg: 34, n: 6 }, { dmg: 42, n: 8 }],
    desc: l => `雷が${l.n}体に連鎖（威力${l.dmg}・跳躍ごとに-10%）`,
    opts: [
      { id: 'jump', name: '連鎖', desc: '連鎖回数 +2', max: 2 },
      { id: 'focus', name: '集中', desc: '威力 +30%・連鎖 -1（最小1）', max: 2, trade: true },
      { id: 'fast', name: '迅速', desc: 'クールダウン -20%', max: 2 },
    ],
  },
  fstar: {
    name: '霧氷星', elem: 'ice', color: '#6fb6e8', cd: 1.4, icon: '星', book5: '凍結確率 +10pt',
    lv: [{ dmg: 8, n: 4 }, { dmg: 10, n: 5 }, { dmg: 12, n: 6 }, { dmg: 14, n: 7 }, { dmg: 17, n: 8 }],
    desc: l => `扇状に氷片${l.n}発（威力${l.dmg}・凍結確率あり）`,
    opts: [
      { id: 'dense', name: '密集', desc: '氷片 +2発・威力 -20%', max: 2, trade: true },
      { id: 'freeze', name: '凍結', desc: '凍結確率 +10pt', max: 3 },
      { id: 'fast', name: '連射', desc: 'クールダウン -20%', max: 2 },
    ],
  },
  beam: {
    name: '集束光', elem: 'magic', color: '#7a2fb0', cd: 6.0, icon: '光', book5: '照射時間 +0.5秒',
    lv: [{ dmg: 9, w: 10 }, { dmg: 11, w: 11 }, { dmg: 14, w: 12 }, { dmg: 17, w: 13 }, { dmg: 21, w: 14 }],
    desc: l => `ボス＞エリート＞高HPへ持続ビーム（毎0.2秒${l.dmg}・太さ${l.w}）`,
    opts: [
      { id: 'long', name: '持続', desc: '照射時間 +1秒', max: 2 },
      { id: 'focus', name: '集束', desc: '威力 +35%・クールダウン +20%', max: 2, trade: true },
      { id: 'thick', name: '太線', desc: '太さ +60%', max: 2 },
    ],
  },
  web: {
    name: '電磁網', elem: 'thunder', color: '#2a9d8f', cd: 7.0, icon: '網', book5: '範囲 +20%',
    lv: [{ dmg: 8, r: 70 }, { dmg: 10, r: 80 }, { dmg: 13, r: 90 }, { dmg: 16, r: 100 }, { dmg: 20, r: 110 }],
    desc: l => `前線に網を展開、範囲内へ持続ダメージ（毎0.5秒${l.dmg}・範囲${l.r}）`,
    opts: [
      { id: 'dur', name: '長網', desc: '持続 +2秒', max: 2 },
      { id: 'wide', name: '広網', desc: '範囲 +30%・威力 -15%', max: 2, trade: true },
      { id: 'dense', name: '高圧', desc: '威力 +35%・持続 -1秒（最小2秒）', max: 2, trade: true },
    ],
  },
  wave: {
    name: '波動光', elem: 'magic', color: '#9a4fd0', cd: 6.5, icon: '波', book5: 'クールダウン -10%',
    lv: [{ dmg: 24 }, { dmg: 30 }, { dmg: 37 }, { dmg: 45 }, { dmg: 55 }],
    desc: l => `前方全域を薙ぐ波動（威力${l.dmg}）`,
    opts: [
      { id: 'fast', name: '高速詠唱', desc: 'クールダウン -15%', max: 3 },
      { id: 'pow', name: '増幅', desc: '威力 +30%・クールダウン +15%', max: 2, trade: true },
      { id: 'echo', name: '余波', desc: '0.6秒遅れで2発目（威力60%）', max: 1 },
    ],
  },
  whirl: {
    name: '旋風', elem: 'wind', color: '#5a8f3a', cd: 5.0, icon: '渦', book5: '持続 +1秒',
    lv: [{ dmg: 7, r: 34 }, { dmg: 9, r: 38 }, { dmg: 11, r: 42 }, { dmg: 13, r: 46 }, { dmg: 16, r: 52 }],
    desc: l => `ゆっくり上昇する竜巻（毎0.4秒${l.dmg}・半径${l.r}・弱い引き寄せ）`,
    opts: [
      { id: 'dur', name: '長風', desc: '持続 +2秒', max: 2 },
      { id: 'big', name: '大旋風', desc: '半径 +25%', max: 2 },
      { id: 'twin', name: '双旋風', desc: '竜巻 +1・威力 -20%', max: 2, trade: true },
    ],
  },
  meteor: {
    name: '隕石', elem: 'fire', color: '#d6402a', cd: 5.5, icon: '隕', book5: '範囲 +15%',
    lv: [{ dmg: 70, r: 64 }, { dmg: 90, r: 70 }, { dmg: 110, r: 76 }, { dmg: 135, r: 84 }, { dmg: 165, r: 92 }],
    desc: l => `予告つき大爆発（威力${l.dmg}・範囲${l.r}）`,
    opts: [
      { id: 'big', name: '巨大化', desc: '範囲 +20%', max: 2 },
      { id: 'heavy', name: '重質量', desc: '威力 +40%・クールダウン +25%', max: 2, trade: true },
      { id: 'twin', name: '連落', desc: '隕石 +1・威力 -25%', max: 2, trade: true },
    ],
  },
  storm: {
    name: '嵐', elem: 'wind', color: '#4f8a6a', cd: 8.0, icon: '嵐', book5: 'ノックバック +50%',
    lv: [{ dmg: 14 }, { dmg: 18 }, { dmg: 22 }, { dmg: 27 }, { dmg: 33 }],
    desc: l => `定期的に全体へ風ダメージ＋押し戻し（威力${l.dmg}）`,
    opts: [
      { id: 'fast', name: '疾風', desc: 'クールダウン -15%', max: 3 },
      { id: 'pow', name: '暴風', desc: '威力 +30%・クールダウン +15%', max: 2, trade: true },
      { id: 'push', name: '押戻', desc: '押し戻し +60%', max: 2 },
    ],
  },
};

/* ---------- シナジー（複合魔法）8種 ---------- */
const SYN_IDS = ['blast', 'pierce', 'iceburst', 'twinlight', 'shock', 'burnmeteor', 'eye', 'barrage'];
const SYNERGIES = {
  blast: { name: '爆破ミサイル', a: 'missile', b: 'fireball', desc: 'ミサイル命中時に小爆発（周囲へ範囲ダメージ）' },
  pierce: { name: '突通ミサイル', a: 'missile', b: 'icicle', desc: 'ミサイルが1体貫通し、威力 +30%' },
  iceburst: { name: '氷晶破裂', a: 'icicle', b: 'fstar', desc: '鈍足・凍結中の敵を倒すと破裂し、周囲へ氷ダメージ' },
  twinlight: { name: '双光増幅', a: 'beam', b: 'wave', desc: '集束光・波動光の威力 +60%' },
  shock: { name: '電流持続', a: 'chain', b: 'web', desc: '雷鎖に当たった敵へ感電（3秒の持続ダメージ）' },
  burnmeteor: { name: '燃焼隕石', a: 'fireball', b: 'meteor', desc: '隕石の着弾点に燃える地面（3秒）' },
  eye: { name: '嵐の眼', a: 'whirl', b: 'storm', desc: '旋風に強い引き寄せ・嵐の威力 +50%' },
  barrage: { name: '誘導弾幕', a: 'beam', b: 'missile', desc: '集束光の照射中、ミサイルが追加で自動発射（間隔は半分）' },
};
function synAvailable(b) { return SYN_IDS.filter(id => !b.syn.has(id) && b.spells[SYNERGIES[id].a] && b.spells[SYNERGIES[id].b]); }
function unlockedSpells(cleared) { return SPELL_IDS.filter(id => cleared >= SPELL_UNLOCK[id]); }

/* ---------- 敵 ---------- */
const ENEMIES = {
  slimy: { name: 'スライミー', hp: 14, spd: 38, dmg: 6, r: 14, w: 10, intro: 1, wave: 1, gold: 1.0, xp: 1, weak: ['fire'], resist: ['wind'] },
  dash: { name: 'ダッシュアイ', hp: 7, spd: 82, dmg: 5, r: 9, w: 6, intro: 1, wave: 2, gold: 0.5, xp: 0.6, weak: ['wind'], resist: ['thunder'] },
  splitter: { name: 'スプリッター', hp: 24, spd: 36, dmg: 6, r: 16, w: 4, intro: 1, wave: 5, gold: 1.2, xp: 1.2, weak: ['thunder'], resist: ['magic'] },
  golem: { name: 'タンクゴーレム', hp: 80, spd: 22, dmg: 16, r: 25, w: 2.5, intro: 2, wave: 8, gold: 3.0, xp: 3, weak: ['ice'], resist: ['fire'] },
  ghost: { name: 'ゴースト', hp: 18, spd: 44, dmg: 8, r: 13, w: 3.5, intro: 2, wave: 9, gold: 1.5, xp: 1.4, weak: ['fire'], resist: ['ice'] },
  bones: { name: 'ボーンズ', hp: 32, spd: 34, dmg: 5, r: 15, w: 2.5, intro: 3, wave: 10, gold: 2.5, xp: 2, weak: ['phys'], resist: ['ice'] },
  shield: { name: 'シールドベアラー', hp: 62, spd: 30, dmg: 10, r: 19, w: 2, intro: 4, wave: 8, gold: 2.8, xp: 2.5, weak: ['thunder'], resist: ['phys', 'magic'] },
  splitlet: { name: 'ちびスプリッター', hp: 7, spd: 58, dmg: 5, r: 9, w: 0, intro: 99, wave: 99, gold: 0.3, xp: 0.4, weak: ['thunder'], resist: [] },
  imp: { name: '使い魔', hp: 5, spd: 70, dmg: 5, r: 8, w: 0, intro: 99, wave: 99, gold: 0, xp: 0, weak: [], resist: [] },
  boss: { name: 'ボス', hp: 900, spd: 24, dmg: 26, r: 44, w: 0, intro: 99, wave: 99, gold: 150, xp: 25, weak: [], resist: [] },
};
const SPAWN_TYPES = ['slimy', 'dash', 'splitter', 'golem', 'ghost', 'bones', 'shield'];
const GHOST_MISS = 0.65, GHOST_CYCLE = 4.2, GHOST_FADE_FROM = 2.6;
const ELITE_CHANCE = 0.02;
const DROP_RATE = { normal: 0.006, elite: 0.40, bossExtra: 0.5 };
const GEM_DROP = { normal: 0.02, elite: 0.25, boss: 2 };
const BONES_STOP_Y = 250;
const BOSS_WEAK = ['fire', 'ice', 'thunder', 'wind', 'phys'], BOSS_RESIST = ['ice', 'thunder', 'wind', 'phys', 'fire'];

/** 敵の属性：弱点・耐性（ボスはステージごとに回す） */
function enemyAffinity(type, stage) {
  if (type === 'boss') { const i = ((stage || 1) - 1) % 5; return { weak: [BOSS_WEAK[i]], resist: [BOSS_RESIST[i]] }; }
  const d = ENEMIES[type]; return { weak: d.weak, resist: d.resist };
}
function elemMult(type, elem, stage) {
  const a = enemyAffinity(type, stage);
  if (a.weak.includes(elem)) return WEAK_MULT;
  if (a.resist.includes(elem)) return resistMult(stage);
  return 1;
}
function spawnWeight(type, stage) {
  const d = ENEMIES[type];
  if (stage < d.intro) return 0;
  let w = d.w;
  if (type === 'golem') w += 0.25 * (stage - 2);
  if (type === 'shield') w += 0.55 * (stage - 4);     // 後半ほど盾持ちが増え、雷の弱点が重要になる
  return Math.max(0, w);
}
function waveThreshold(type, stage) { const d = ENEMIES[type]; return Math.max(1, d.wave - Math.max(0, stage - d.intro)); }
function unlockedTypes(stage, wave) { return SPAWN_TYPES.filter(t => spawnWeight(t, stage) > 0 && wave >= waveThreshold(t, stage)); }
/** ステージ情報画面用：主な敵と弱点・耐性（終盤の出現比率順） */
function stageEnemyInfo(stage) {
  const types = unlockedTypes(stage, 12).sort((x, y) => spawnWeight(y, stage) - spawnWeight(x, stage)).slice(0, 7);
  return types.map(t => ({ type: t, name: ENEMIES[t].name, weak: ENEMIES[t].weak.slice(), resist: ENEMIES[t].resist.slice() }));
}

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

/* ---------- 経験値・倍率（20ウェーブ用に再調整） ---------- */
function xpNeeded(level) { return Math.round(6 + (level - 1) * 5 + Math.pow(level - 1, 1.7)); }
function enemyHpMult(stage, wave) { return (1 + 0.32 * (stage - 1) + 0.05 * (stage - 1) ** 2) * (1 + 0.11 * (wave - 1)); }
function enemyDmgMult(stage, wave) { return 1 + 0.16 * (stage - 1) + 0.025 * (wave - 1); }
function goldMult(stage) { return 1 + 0.12 * (stage - 1); }
function spawnInterval(stage, wave, tn) {
  return Math.max(0.3, (1.75 - 0.045 * (wave - 1)) * (1 - 0.3 * Math.min(1, tn)) / (1 + 0.02 * (stage - 1)));
}
function bossHp(stage, mid) { return ENEMIES.boss.hp * enemyHpMult(stage, MAX_WAVE) * (mid ? 0.4 : 1); }

/* ---------- 魔法書（永続強化） ---------- */
function bookCost(spellId, lv) {   // lv = 現在のレベル（0〜9）→ lv+1 への費用
  const i = SPELL_IDS.indexOf(spellId);
  return { gold: Math.round(60 * Math.pow(1.55, lv) * (1 + 0.08 * i) / 5) * 5, rune: lv < 5 ? 1 : 2 };
}
function bookBonus(lv) { return BOOK_STEP * lv; }
function bookUpgrade(sv, spellId) {
  const lv = sv.book[spellId] || 0;
  if (lv >= BOOK_MAX) return { ok: false, error: '上限' };
  if (sv.cleared < SPELL_UNLOCK[spellId]) return { ok: false, error: '未解放' };
  const c = bookCost(spellId, lv);
  if (sv.gold < c.gold) return { ok: false, error: 'ゴールド不足' };
  if (sv.runes < c.rune) return { ok: false, error: 'ルーン不足' };
  sv.gold -= c.gold; sv.runes -= c.rune; sv.book[spellId] = lv + 1;
  return { ok: true, lv: lv + 1 };
}

/* ---------- クリア評価 ---------- */
/** 城壁の残り：100%＝3（金冠）／50%以上＝2（銀冠）／それ未満＝1（銅冠） */
function clearRating(wall, wallMax) {
  if (wall >= wallMax - 0.5) return 3;
  return wall >= wallMax * 0.5 ? 2 : 1;
}
const RATING_NAME = { 1: '銅冠', 2: '銀冠', 3: '金冠' };
/** 初回の評価達成ごとの報酬を save に反映（初回クリア＋これまで未達だった評価ぶん） */
function applyClearRewards(sv, stage, rating) {
  const prev = (sv.stageBest && sv.stageBest[stage]) || 0;
  const rw = { runes: 0, gold: 0, firstClear: false, newRatings: [] };
  if (stage > sv.cleared) { sv.cleared = stage; rw.firstClear = true; rw.runes += 2; rw.gold += 150 * stage; }
  for (let t = prev + 1; t <= rating; t++) { rw.newRatings.push(t); rw.runes += t === 3 ? 2 : 1; rw.gold += 100 * stage * t; }
  if (rating > prev) sv.stageBest[stage] = rating;
  sv.runes += rw.runes; sv.gold += rw.gold;
  return rw;
}

/* ---------- ジェム ---------- */
const GEM_RARITIES = [
  { name: '通常', color: '#8c867a', mult: 1 }, { name: '精良', color: '#3a8f5a', mult: 1.6 }, { name: 'レア', color: '#2f6fd6', mult: 2.6 },
  { name: 'エピック', color: '#8a3fc4', mult: 4 }, { name: 'レジェンド', color: '#c8962a', mult: 6.2 }, { name: '絶世', color: '#c8321e', mult: 9.5 }, { name: 'ミス', color: '#1d1b19', mult: 15 },
];
const GEM_TYPES = ['power', 'crit', 'cdr', 'fire', 'ice', 'thunder', 'xp', 'gold', 'wall'];
const GEM_INFO = {
  power: { name: '全威力', stat: 'power', base: 3, unit: '%', atk: true },
  crit: { name: '会心率', stat: 'crit', base: 2, unit: '%', atk: true },
  cdr: { name: '迅速', stat: 'cdr', base: 2.5, unit: '%', atk: true },
  fire: { name: '炎威', stat: 'e_fire', base: 4, unit: '%', atk: true },
  ice: { name: '氷威', stat: 'e_ice', base: 4, unit: '%', atk: true },
  thunder: { name: '雷威', stat: 'e_thunder', base: 4, unit: '%', atk: true },
  xp: { name: '経験', stat: 'xp', base: 4, unit: '%' },
  gold: { name: '黄金', stat: 'gold', base: 4, unit: '%' },
  wall: { name: '城壁', stat: 'wall', base: 12, unit: '' },
};
const EXEC_RATE = 0.02;   // 絶世・ミス級の攻撃系ジェムの特殊効果：命中時2%で即死（ボス無効）
function gemValue(g) {
  const v = GEM_INFO[g.type].base * GEM_RARITIES[g.rarity].mult;
  return g.type === 'wall' ? Math.round(v) : Math.round(v * 10) / 10;
}
function gemText(g) { const i = GEM_INFO[g.type]; return `${GEM_RARITIES[g.rarity].name}の${i.name}石 +${gemValue(g)}${i.unit}`; }
function rollFx(rng, type, rarity) {
  if (!GEM_INFO[type].atk || rarity < 5) return null;
  return rng() < (rarity === 5 ? 0.4 : 0.7) ? 'exec' : null;
}
function rollGemRarity(stage, rng, mode) {
  const s = Math.max(0, stage - 1);
  let w;
  if (mode === 'boss') w = [0, 15, 40, 30, 12 + 0.4 * s, 2.5 + 0.2 * s, 0.5 + 0.08 * s];
  else if (mode === 'elite') w = [30, 40, 20, 8, 1.8 + 0.1 * s, 0.2 + 0.05 * s, 0.04 + 0.01 * s];
  else w = [70 - s, 22, 6 + 0.3 * s, 1.5 + 0.15 * s, 0.4 + 0.05 * s, 0.08 + 0.02 * s, 0.02 + 0.005 * s];
  return weightedIndex(rng, w);
}
function genGem(stage, rng, opts) {
  opts = opts || {};
  const type = opts.type || rpick(rng, GEM_TYPES);
  const rarity = opts.rarity != null ? opts.rarity : rollGemRarity(stage, rng, opts.mode);
  const g = { id: opts.id || ('g' + Math.floor(rng() * 1e9).toString(36)), type, rarity };
  const fx = rollFx(rng, type, rarity); if (fx) g.fx = fx;
  return g;
}
function rollGemDrops(kind, rng, extraRate) {
  if (kind === 'boss') return GEM_DROP.boss;
  const p = (kind === 'elite' ? GEM_DROP.elite : GEM_DROP.normal) * (1 + (extraRate || 0));
  return rng() < p ? 1 : 0;
}
function socketCount(item) { return RARITIES[item.rarity].sockets; }
function socketedIds(sv) { const s = new Set(); for (const it of sv.inv) for (const g of (it.sock || [])) if (g) s.add(g); return s; }
function freeGems(sv) { const s = socketedIds(sv); return sv.gems.filter(g => !s.has(g.id)); }
function socketGem(sv, itemId, gemId, index) {
  const it = sv.inv.find(i => i.id === itemId), g = sv.gems.find(x => x.id === gemId);
  if (!it || !g) return { ok: false, error: '対象がありません' };
  if (socketedIds(sv).has(gemId)) return { ok: false, error: 'すでにはまっています' };
  const n = socketCount(it); it.sock = Array.isArray(it.sock) ? it.sock : [];
  while (it.sock.length < n) it.sock.push(null);
  let k = index != null ? index : it.sock.findIndex(x => !x);
  if (k < 0 || k >= n) return { ok: false, error: '空きソケットがありません' };
  if (it.sock[k]) return { ok: false, error: 'ソケットが埋まっています' };
  it.sock[k] = gemId; return { ok: true, index: k };
}
function unsocketGem(sv, itemId, index) {
  const it = sv.inv.find(i => i.id === itemId);
  if (!it || !it.sock || !it.sock[index]) return { ok: false, error: 'ジェムがありません' };
  it.sock[index] = null; return { ok: true };       // 付け替えはコストなし
}
/** 同種・同レアリティの未装着ジェム3個 → 1段階上の1個（最大ミス） */
function mergeGems(sv, type, rarity, rng) {
  if (rarity >= GEM_RARITIES.length - 1) return { ok: false, error: '最高ランクです' };
  const pool = freeGems(sv).filter(g => g.type === type && g.rarity === rarity);
  if (pool.length < 3) return { ok: false, error: '素材が足りません' };
  const used = pool.slice(0, 3), ids = new Set(used.map(g => g.id));
  sv.gems = sv.gems.filter(g => !ids.has(g.id));
  const out = { id: 'g' + (sv.nextGid++), type, rarity: rarity + 1 };
  const fx = used.find(g => g.fx) ? 'exec' : rollFx(rng || Math.random, type, rarity + 1);
  if (fx) out.fx = fx;
  sv.gems.push(out); return { ok: true, gem: out };
}
function mergeAllGems(sv, rng) {
  let n = 0;
  for (let again = true; again;) {
    again = false;
    for (const type of GEM_TYPES) for (let r = 0; r < GEM_RARITIES.length - 1; r++) {
      while (mergeGems(sv, type, r, rng).ok) { n++; again = true; }
    }
  }
  return n;
}
/** 所持上限超過：未装着で最低ランクのジェムを手放す（ゴールド化） */
function addGem(sv, gem) {
  sv.gems.push(gem); let gold = 0;
  while (sv.gems.length > GEM_CAP) {
    const free = freeGems(sv).filter(g => g !== gem);
    if (!free.length) break;
    free.sort((a, c) => a.rarity - c.rarity);
    const g = free[0]; sv.gems.splice(sv.gems.indexOf(g), 1); gold += 10 * (g.rarity + 1) * (g.rarity + 1);
  }
  sv.gold += gold; return gold;
}

/* ---------- 戦闘計算 ---------- */
function newUq() { return { chain: 0, missile: 0, missileMult: 1, meteorArea: 0, ice: 0, thunderCd: 0, laser: 0, otherPen: 0, gemdrop: 0, boss: 0 }; }
function emptyStats() {
  return { power: 0, crit: 0, cdr: 0, area: 0, wall: 0, xp: 0, gold: 0, elem: {}, exec: 0, uq: newUq() };
}
/** 装備のユニーク効果（エピック以上）。m=1 通常、m=2 レジェンドの強力版 */
const UNIQUES = {
  chain: { desc: m => `雷鎖の連鎖 +${m}`, apply(u, m) { u.chain += m; } },
  missile: { desc: m => `ミサイル +${m}発（威力-10%）`, apply(u, m) { u.missile += m; u.missileMult *= 0.9; } },
  meteor: { desc: m => `隕石の範囲 +${25 * m}%`, apply(u, m) { u.meteorArea += 0.25 * m; } },
  ice: { desc: m => `氷柱 +${m}本`, apply(u, m) { u.ice += m; } },
  thunder: { desc: m => `雷撃のクールダウン -${m === 2 ? 40 : 25}%`, apply(u, m) { u.thunderCd += m === 2 ? 0.40 : 0.25; } },
  laser: { desc: m => `集束光・波動光の威力 +${m === 2 ? 50 : 30}%（他魔法-10%）`, apply(u, m) { u.laser += m === 2 ? 0.5 : 0.3; u.otherPen = Math.min(0.3, u.otherPen + 0.1); } },
  gemdrop: { desc: m => `ジェムのドロップ率 +${50 * m}%`, apply(u, m) { u.gemdrop += 0.5 * m; } },
  boss: { desc: m => `ボスへのダメージ +${m === 2 ? 35 : 20}%`, apply(u, m) { u.boss += m === 2 ? 0.35 : 0.2; } },
};
const UNIQUE_IDS = Object.keys(UNIQUES);
function uniqueTexts(item) { return ((item && item.uniques) || []).filter(u => UNIQUES[u.id]).map(u => UNIQUES[u.id].desc(u.m)); }
/** 単発ダメージ（テスト・結果表示用の素の計算）。属性相性はここでは含めない */
function calcDamage(base, stats, spellId, rng, o) {
  o = o || {};
  const u = stats.uq, isLaser = spellId === 'beam' || spellId === 'wave';
  const um = u ? (isLaser ? 1 + u.laser : (u.otherPen > 0 ? 1 - u.otherPen : 1)) : 1;
  const el = SPELLS[spellId] ? SPELLS[spellId].elem : null;
  const mult = (1 + stats.power) * (1 + ((el && stats.elem && stats.elem[el]) || 0)) * (1 + BOOK_STEP * (o.book || 0)) * um * (o.mult || 1);
  const variance = rng ? 0.92 + rng() * 0.16 : 1;
  const crit = rng ? rng() < CRIT_BASE + (stats.crit || 0) : false;
  return { dmg: Math.max(1, Math.round(base * mult * variance * (crit ? 1.5 : 1))), crit };
}
function hitChance(translucent) { return translucent ? 1 - GHOST_MISS : 1; }
function cdMult(st) { return Math.max(0.3, 1 - st.cdr); }

/* ---------- 装備 ---------- */
const STAT_INFO = {
  power: { name: '全威力', unit: '%', w: 1.0 },
  crit: { name: '会心率', unit: '%', w: 1.6 },
  cdr: { name: 'クールダウン短縮', unit: '%', w: 1.2 },
  area: { name: '効果範囲', unit: '%', w: 0.8 },
  wall: { name: '城壁HP', unit: '', w: 0.2 },
  xp: { name: '経験値', unit: '%', w: 0.5 },
  gold: { name: 'ゴールド', unit: '%', w: 0.3 },
  e_magic: { name: '魔属性威力', unit: '%', w: 0.7 }, e_fire: { name: '炎属性威力', unit: '%', w: 0.7 }, e_ice: { name: '氷属性威力', unit: '%', w: 0.7 },
  e_thunder: { name: '雷属性威力', unit: '%', w: 0.7 }, e_wind: { name: '風属性威力', unit: '%', w: 0.7 }, e_phys: { name: '物理威力', unit: '%', w: 0.7 },
};
const AFFIX_RANGE = {
  power: [4, 8], crit: [2, 4], cdr: [2, 5], area: [4, 8], wall: [15, 30], xp: [5, 10], gold: [5, 12],
  e_magic: [8, 15], e_fire: [8, 15], e_ice: [8, 15], e_thunder: [8, 15], e_wind: [8, 15], e_phys: [8, 15],
};
const BASE_STAT = { hood: ['cdr', 4], robe: ['wall', 40], boots: ['xp', 8], wand: ['power', 8], ring: ['crit', 3], neck: ['area', 8] };
const SLOT_BIAS = {
  hood: { cdr: 4, power: 2, e_thunder: 1.5 },
  robe: { wall: 4, xp: 1.5 },
  boots: { xp: 4, gold: 3, cdr: 2 },
  wand: { power: 4, e_magic: 2, e_fire: 2, e_ice: 2, e_thunder: 2, e_wind: 1.5, e_phys: 1.5 },
  ring: { crit: 4, power: 2, gold: 2 },
  neck: { area: 4, wall: 2, xp: 2 },
};
const SLOT_WORDS = {
  hood: ['フード', '頭巾', '魔女帽', '頭布'],
  robe: ['ローブ', '法衣', '羽織', '外套'],
  boots: ['ブーツ', '足袋', '草鞋', '長靴'],
  wand: ['スティック', '古杖', '霊杖', '錫杖'],
  ring: ['リング', '指輪', '印環', '指環'],
  neck: ['ネックレス', '勾玉', '数珠', '首飾り'],
};
const GENERIC_PREFIX = ['月読の', '朱雀の', '玄武の', '白虎の', '青龍の', '暁の', '黄昏の', '幽玄の', '天狼の', '桜花の', '螢火の', '神楽の', '墨染の', '千年の', '蒼穹の', '夜叉の', '風花の', '残月の', '朧の', '常磐の'];
const ELEM_PREFIX = { e_magic: '星霊の', e_fire: '紅蓮の', e_ice: '霜降の', e_thunder: '雷鳴の', e_wind: '疾風の', e_phys: '岩砕の' };

function round1(v) { return Math.round(v * 10) / 10; }
function baseValue(item) {
  const key = BASE_STAT[item.slot][0], v0 = BASE_STAT[item.slot][1];
  const raw = v0 * (1 + 0.12 * (item.ilvl - 1)) * RARITIES[item.rarity].mult * (1 + 0.15 * item.enh);
  return key === 'wall' ? Math.round(raw) : round1(raw);
}
function itemStatList(item) {
  const list = [{ key: BASE_STAT[item.slot][0], v: baseValue(item), base: true }];
  for (const a of item.affixes) list.push({ key: a.key, v: a.v });
  return list;
}
function fmtStat(key, v) { const i = STAT_INFO[key]; return `${i.name} +${v}${i.unit}`; }
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
  const item = { id: opts.id || ('x' + Math.floor(rng() * 1e9).toString(36)), slot, rarity, ilvl: stage, enh: 0, name: '', affixes: [], uniques: [], sock: [] };
  const used = new Set([BASE_STAT[slot][0]]);
  const n = RARITIES[rarity].affixes;
  const keys = Object.keys(AFFIX_RANGE);
  for (let i = 0; i < n; i++) {
    const cand = keys.filter(k => !used.has(k));
    const key = cand[weightedIndex(rng, cand.map(k => SLOT_BIAS[slot][k] || 1))];
    used.add(key);
    const [lo, hi] = AFFIX_RANGE[key], scale = 1 + 0.06 * (stage - 1);
    item.affixes.push({ key, v: key === 'wall' ? Math.round(rrange(rng, lo, hi) * scale) : Math.max(1, Math.round(rrange(rng, lo, hi) * scale)) });
  }
  for (let i = 0; i < RARITIES[rarity].sockets; i++) item.sock.push(null);
  if (rarity >= 2) {
    const first = rpick(rng, UNIQUE_IDS);
    if (rarity === 2) item.uniques = [{ id: first, m: 1 }];
    else if (rng() < 0.5) item.uniques = [{ id: first, m: 2 }];
    else item.uniques = [{ id: first, m: 1 }, { id: rpick(rng, UNIQUE_IDS.filter(k => k !== first)), m: 1 }];
  }
  const elemAff = item.affixes.find(a => ELEM_PREFIX[a.key]);
  item.name = (elemAff ? ELEM_PREFIX[elemAff.key] : rpick(rng, GENERIC_PREFIX)) + rpick(rng, SLOT_WORDS[slot]);
  return item;
}
function rollDrop(kind, rng) {
  if (kind === 'boss') return 1 + (rng() < DROP_RATE.bossExtra ? 1 : 0);
  return rng() < (kind === 'elite' ? DROP_RATE.elite : DROP_RATE.normal) ? 1 : 0;
}
/** 装備＋ソケットのジェムからステータスを合算。gemMap は id→ジェム */
function computeEquipStats(items, gemMap) {
  const st = emptyStats();
  const add = (key, v) => {
    if (key === 'wall') st.wall += v;
    else if (key.startsWith('e_')) { const el = key.slice(2); st.elem[el] = (st.elem[el] || 0) + v / 100; }
    else st[key] += v / 100;
  };
  for (const it of items) {
    if (!it) continue;
    for (const s of itemStatList(it)) add(s.key, s.v);
    for (const u of (it.uniques || [])) if (UNIQUES[u.id]) UNIQUES[u.id].apply(st.uq, u.m);
    for (const gid of (it.sock || [])) {
      const g = gid && gemMap ? gemMap[gid] : null;
      if (!g) continue;
      add(GEM_INFO[g.type].stat, gemValue(g));
      if (g.fx === 'exec') st.exec += EXEC_RATE;
    }
  }
  return st;
}
function itemScore(item, gemMap) {
  if (!item) return 0;
  let t = 0;
  for (const s of itemStatList(item)) t += s.v * STAT_INFO[s.key].w;
  t += 6 * (item.uniques ? item.uniques.length : 0);
  return Math.round(t * 10) / 10;
}
function enhanceCost(enh, rarity) { return Math.round(20 * Math.pow(1.55, enh) * RARITIES[rarity].cost / 5) * 5; }
function totalEnhanceSpent(enh, rarity) { let t = 0; for (let k = 0; k < enh; k++) t += enhanceCost(k, rarity); return t; }
function sellBase(item) { return Math.round(RARITIES[item.rarity].sell * (1 + 0.35 * (item.ilvl - 1))); }
function enhanceRefund(item) { return Math.round(ENH_REFUND * totalEnhanceSpent(item.enh, item.rarity)); }
function sellPrice(item) { return sellBase(item) + enhanceRefund(item); }
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
  const e = b.eq;
  b.stats = { power: e.power, crit: e.crit, cdr: Math.min(0.6, e.cdr), area: e.area, wall: e.wall, xp: e.xp, gold: e.gold, elem: e.elem || {}, exec: e.exec || 0, uq: e.uq || newUq() };
}
function createBattle(opts) {
  const rng = opts.rng || mulberry32(opts.seed || 1);
  const stage = opts.stage || 1;
  const cleared = opts.cleared != null ? opts.cleared : stage - 1;
  const b = {
    stage, rng, time: 0, wave: 1, waveT: 0, inGap: false, spawning: true, state: 'playing',
    eq: Object.assign(emptyStats(), opts.equipStats || {}), book: opts.book || {},
    spells: { missile: { lv: 1, cd: 0.3, opt: {} } }, syn: new Set(), unlocked: new Set(opts.onlySpells || unlockedSpells(cleared)),
    wall: 0, wallMax: 0, player: { level: 1, xp: 0 },
    enemies: [], projs: [], lobs: [], cols: [], logs: [], pulses: [], zones: [], metes: [], beam: null, barrageAcc: 0,
    events: [], eid: 1, spawnT: 1.0, kills: 0, goldF: 0, drops: [], gemDrops: [], runes: 0, pending: 0, choices: null,
    boss: null, midBoss: null, bossSpawned: false, elites: 0, maxWave: 1, rerolls: FREE_REROLLS, dmgBy: {}, reachBy: {},
    wallHurt: 0, wallFlash: 0, roulette: null, burstDepth: 0,
    bossPity: opts.bossPity || 0, ownedSlots: new Set(opts.ownedSlots || []), firstDropDone: false,
  };
  if (opts.startSpells) for (const id of Object.keys(opts.startSpells)) b.spells[id] = { lv: 1, cd: 0.3, opt: {}, ...opts.startSpells[id] };
  b.eq.elem = b.eq.elem || {}; b.eq.uq = b.eq.uq || newUq();
  deriveStats(b);
  b.wallMax = BASE_WALL + b.stats.wall; b.wall = b.wallMax;
  b.events.push({ type: 'wave', wave: 1 });
  return b;
}
function ev(b, e) { b.events.push(e); }
const bookLv = (b, id) => (b.book && b.book[id]) || 0;
const oc = (b, sid, oid) => { const s = b.spells[sid]; return (s && s.opt[oid]) || 0; };
const spLv = (b, id) => SPELLS[id].lv[b.spells[id].lv - 1];
const areaM = b => 1 + b.stats.area;

function makeEnemy(b, type, x, y, o) {
  o = o || {};
  const d = ENEMIES[type];
  const wv = type === 'boss' ? MAX_WAVE : b.wave;
  const elite = !!o.elite;
  const hp = type === 'boss' ? bossHp(b.stage, o.mid) : d.hp * enemyHpMult(b.stage, wv) * (elite ? 4 : 1);
  const e = {
    id: b.eid++, type, x, y, hp, maxHp: hp, r: d.r * (elite ? 1.45 : 1) * (o.mid ? 0.85 : 1), spd: d.spd,
    dmg: d.dmg * enemyDmgMult(b.stage, wv) * (elite ? 2 : 1) * (o.mid ? 0.7 : 1), elite, boss: type === 'boss', mid: !!o.mid, summoned: !!o.summoned,
    slowT: 0, slowAmt: 0, frozenT: 0, atk: 0.4, flash: 0, seed: b.rng(), age: 0,
    phaseT: b.rng() * GHOST_CYCLE, summonT: 1.5, translucent: false, stopped: false, atWall: false, reached: false,
    shockT: 0, shockAcc: 0, shockDmg: 0, bursted: false,
  };
  b.enemies.push(e);
  return e;
}
function spawnGroup(b) {
  const types = unlockedTypes(b.stage, b.wave);
  const type = types[weightedIndex(b.rng, types.map(t => spawnWeight(t, b.stage)))];
  let n = 1 + Math.floor(b.wave / 6) + (b.rng() < 0.3 ? 1 : 0);
  if (type === 'dash') n = 3 + Math.floor(b.rng() * 3);
  if (type === 'golem' || type === 'shield') n = 1 + (b.wave >= 14 && b.rng() < 0.4 ? 1 : 0);
  const cx = 34 + b.rng() * (FIELD_W - 68);
  for (let i = 0; i < n; i++) {
    if (b.enemies.length >= MAX_ENEMIES) break;
    const r = ENEMIES[type].r;
    const x = Math.max(r, Math.min(FIELD_W - r, cx + (i - (n - 1) / 2) * r * 2.3 + (b.rng() - 0.5) * 10));
    const elite = b.wave >= 3 && type !== 'dash' && b.rng() < ELITE_CHANCE;
    if (elite) b.elites++;
    makeEnemy(b, type, x, -14 - b.rng() * 22, { elite });
  }
}
function startWave(b) {
  ev(b, { type: 'wave', wave: b.wave });
  b.maxWave = b.wave; b.spawning = true; b.spawnT = 0.6;
  const nm = stageInfo(b.stage).boss;
  if (b.wave === MID_WAVE) {
    const m = makeEnemy(b, 'boss', FIELD_W / 2 + (b.rng() - 0.5) * 80, -50, { mid: true });
    m.name = nm + 'の影'; b.midBoss = m; ev(b, { type: 'boss', name: m.name, mid: true });
  }
  if (b.wave === MAX_WAVE && !b.bossSpawned) {
    b.bossSpawned = true;
    b.boss = makeEnemy(b, 'boss', FIELD_W / 2, -60);
    b.boss.name = nm; ev(b, { type: 'boss', name: nm });
  }
}
function frontEnemies(b, n, excl) {
  const arr = [];
  for (const e of b.enemies) if (e.hp > 0 && !(excl && excl.has(e.id))) arr.push(e);
  arr.sort((p, q) => q.y - p.y);
  return n == null ? arr : arr.slice(0, n);
}
function nearestTo(b, x, y, excl) {
  let best = null, bd = 1e12;
  for (const e of b.enemies) {
    if (e.hp <= 0 || (excl && excl.has(e.id))) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
/** 密集地の中心（近傍の敵数が最大の敵の位置） */
function densest(b, minY, rad) {
  rad = rad || 60; let best = null, bn = -1;
  for (const e of b.enemies) {
    if (e.hp <= 0 || e.y < (minY == null ? 20 : minY)) continue;
    let n = 0; for (const o of b.enemies) if (o.hp > 0 && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= rad * rad) n += o.boss ? 3 : 1;
    if (n > bn || (n === bn && e.y > best.y)) { bn = n; best = e; }
  }
  return best ? { x: best.x, y: best.y } : null;
}
function applySlow(e, amt, t) { if (e.hp <= 0) return; e.slowAmt = Math.max(e.slowAmt * (e.slowT > 0 ? 1 : 0), amt); e.slowT = Math.max(e.slowT, t); }
function aoe(b, x, y, r, base, sid, o) {
  let n = 0;
  for (const e of b.enemies.slice()) {
    if (e.hp <= 0 || (o && o.skip === e)) continue;
    if (Math.hypot(e.x - x, e.y - y) <= r + e.r * 0.5) { dealDamage(b, e, base, sid, o); n++; }
  }
  return n;
}

function dealDamage(b, e, base, spellId, o) {
  o = o || {};
  if (e.hp <= 0) return 0;
  if (e.type === 'ghost' && e.translucent && !o.sure && b.rng() > hitChance(true)) { ev(b, { type: 'miss', x: e.x, y: e.y - e.r }); return 0; }
  const sp = SPELLS[spellId], u = b.stats.uq;
  const em = elemMult(e.type, sp.elem, b.stage);
  let m = (1 + b.stats.power) * (1 + (b.stats.elem[sp.elem] || 0)) * (1 + BOOK_STEP * bookLv(b, spellId)) * em;
  if (spellId === 'beam' || spellId === 'wave') m *= 1 + u.laser; else if (u.otherPen > 0) m *= 1 - u.otherPen;
  if (e.boss && u.boss) m *= 1 + u.boss;
  const crit = !o.noCrit && b.rng() < CRIT_BASE + b.stats.crit;
  let dmg = Math.max(1, Math.round(base * SPELL_POWER * m * (0.94 + b.rng() * 0.12) * (crit ? 1.5 : 1)));
  let exec = false;
  if (b.stats.exec > 0 && !e.boss && b.rng() < Math.min(0.1, b.stats.exec)) { exec = true; dmg = Math.max(dmg, Math.ceil(e.hp)); }
  b.dmgBy[spellId] = (b.dmgBy[spellId] || 0) + Math.min(dmg, e.hp);
  e.hp -= dmg; e.flash = 0.12;
  ev(b, { type: 'hit', x: e.x, y: e.y, dmg, crit, spell: spellId, dot: !!o.dot, weak: em > 1 ? 1 : em < 1 ? -1 : 0, exec });
  if (e.hp <= 0) killEnemy(b, e, spellId);
  return dmg;
}
function addXp(b, v) {
  const p = b.player;
  p.xp += v * (1 + b.stats.xp);
  while (p.xp >= xpNeeded(p.level)) { p.xp -= xpNeeded(p.level); p.level++; b.pending++; ev(b, { type: 'levelup', level: p.level }); }
}
function doRoulette(b) {
  const ids = Object.keys(b.spells).filter(id => b.spells[id].lv < 5);
  if (!ids.length) { const g = 100 * b.stage; b.goldF += g; b.roulette = { gold: g }; }
  else {
    const id = rpick(b.rng, ids), s = b.spells[id];
    b.roulette = { spell: id, from: s.lv, to: s.lv + 1 }; s.lv++;
  }
  ev(b, { type: 'roulette', r: b.roulette, owned: Object.keys(b.spells) });
}
function killEnemy(b, e, spellId) {
  const i = b.enemies.indexOf(e);
  if (i >= 0) b.enemies.splice(i, 1);
  b.kills++;
  const d = ENEMIES[e.type];
  let gold = d.gold * goldMult(b.stage) * (1 + b.stats.gold);
  if (e.elite) gold *= 6;
  b.goldF += gold;
  addXp(b, d.xp * (e.elite ? 5 : 1));
  ev(b, { type: 'die', x: e.x, y: e.y, r: e.r, etype: e.type, elite: e.elite });
  if (e.type === 'splitter') {
    for (let k = 0; k < 2; k++) {
      const s = makeEnemy(b, 'splitlet', e.x + (k ? 10 : -10), e.y + (b.rng() - 0.5) * 8);
      s.hp = s.maxHp = ENEMIES.splitlet.hp * enemyHpMult(b.stage, b.wave);
    }
  }
  if (b.syn.has('iceburst') && (e.slowT > 0 || e.frozenT > 0) && !e.bursted && b.burstDepth < 3) {   // 氷晶破裂
    e.bursted = true; b.burstDepth++;
    const L = b.spells.icicle ? spLv(b, 'icicle') : SPELLS.icicle.lv[0];
    aoe(b, e.x, e.y, 62 * areaM(b), L.dmg * 1.1, 'icicle', { noCrit: true, sure: true });
    ev(b, { type: 'boom', x: e.x, y: e.y, r: 62, col: '#6fb6e8' });
    b.burstDepth--;
  }
  const real = !e.summoned && e.type !== 'imp' && e.type !== 'splitlet';
  const kind = e.mid ? 'elite' : e.boss ? 'boss' : e.elite ? 'elite' : 'normal';
  if (real) {
    const n = e.mid ? 1 : rollDrop(kind, b.rng);
    for (let k = 0; k < n; k++) {
      const dopts = { mode: kind };
      if (!b.firstDropDone) { const free = SLOTS.filter(sl => !b.ownedSlots.has(sl)); if (free.length) dopts.slot = rpick(b.rng, free); }
      if (kind === 'boss') dopts.pity = b.bossPity;
      const item = genEquipment(b.stage, b.rng, dopts);
      b.firstDropDone = true;
      if (kind === 'boss') b.bossPity = item.rarity === 3 ? 0 : Math.min(BOSS_PITY_MAX, b.bossPity + 1);
      b.drops.push(item); ev(b, { type: 'loot', x: e.x, y: e.y, item });
    }
    const gn = e.mid ? 1 : rollGemDrops(kind, b.rng, b.stats.uq.gemdrop);
    for (let k = 0; k < gn; k++) {
      const g = genGem(b.stage, b.rng, { mode: kind });
      b.gemDrops.push(g); ev(b, { type: 'gemdrop', x: e.x, y: e.y, gem: g });
    }
  }
  if (e.boss) {
    doRoulette(b);                                     // ボス撃破でルーレット
    if (!e.mid) {
      b.runes += 1;                                    // 魔導ルーン（確定1個）
      b.state = 'won';
      b.goldF += 100 + 20 * b.stage;
      for (const o of b.enemies) ev(b, { type: 'die', x: o.x, y: o.y, r: o.r, etype: o.type, elite: false, vanish: true });
      b.enemies.length = 0; b.projs.length = 0; b.lobs.length = 0; b.metes.length = 0; b.zones.length = 0; b.beam = null;
      ev(b, { type: 'won' });
    }
  }
}
function wallHit(b, dmg) {
  b.wall -= dmg; b.wallHurt += dmg; b.wallFlash = 0.25;
  ev(b, { type: 'wallhit', dmg });
  if (b.wall <= 0) { b.wall = 0; b.state = 'lost'; ev(b, { type: 'lost' }); }
}

function updateEnemies(b, dt) {
  for (const e of b.enemies.slice()) {
    if (e.hp <= 0) continue;
    e.age += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowAmt = 0; }
    if (e.shockT > 0) {
      e.shockT -= dt; e.shockAcc += dt;
      if (e.shockAcc >= 0.5) { e.shockAcc -= 0.5; dealDamage(b, e, e.shockDmg, 'chain', { sure: true, noCrit: true, dot: true }); if (e.hp <= 0) continue; }
    }
    if (e.type === 'ghost') { e.phaseT = (e.phaseT + dt) % GHOST_CYCLE; e.translucent = e.phaseT > GHOST_FADE_FROM; }
    if (e.frozenT > 0) { e.frozenT -= dt; continue; }
    const sp = e.spd * (1 - e.slowAmt);
    if (e.type === 'bones' && e.y >= BONES_STOP_Y) {
      e.stopped = true; e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 4.0;
        for (let k = 0; k < 2 && b.enemies.length < MAX_ENEMIES; k++) {
          const s = makeEnemy(b, 'imp', e.x + (k ? 16 : -16), e.y + 4, { summoned: true });
          s.hp = s.maxHp = ENEMIES.imp.hp * enemyHpMult(b.stage, b.wave);
        }
        ev(b, { type: 'summon', x: e.x, y: e.y });
      }
      continue;
    }
    if (e.y + e.r * 0.7 < WALL_Y) { e.y += sp * dt; e.atWall = false; }
    else {
      if (!e.atWall) { e.atWall = true; if (!e.reached) { e.reached = true; b.reachBy[e.type] = (b.reachBy[e.type] || 0) + 1; } }
      e.atk += dt;
      if (e.atk >= 1) { e.atk -= 1; wallHit(b, e.dmg); if (b.state === 'lost') return; }
    }
  }
  separate(b);
}
function separate(b) {
  const cell = 44, grid = new Map(), arr = b.enemies;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i], k = Math.floor(e.x / cell) * 4096 + Math.floor(e.y / cell);
    let g = grid.get(k); if (!g) { g = []; grid.set(k, g); } g.push(e);
  }
  for (const e of arr) {
    const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const g = grid.get((cx + ox) * 4096 + (cy + oy)); if (!g) continue;
      for (const o of g) {
        if (o.id <= e.id) continue;
        const dx = o.x - e.x, dy = o.y - e.y, md = (e.r + o.r) * 0.8, d2 = dx * dx + dy * dy;
        if (d2 < md * md && d2 > 0.0001) {
          const d = Math.sqrt(d2), push = (md - d) * 0.25, wE = o.r / (e.r + o.r), wO = e.r / (e.r + o.r);
          e.x -= dx / d * push * wE * 2; e.y -= dy / d * push * wE * 2 * 0.5;
          o.x += dx / d * push * wO * 2; o.y += dy / d * push * wO * 2 * 0.5;
        }
      }
    }
    e.x = Math.max(e.r * 0.6, Math.min(FIELD_W - e.r * 0.6, e.x));
    if (e.y > WALL_Y - e.r * 0.5) e.y = WALL_Y - e.r * 0.5;
  }
}

/* ---------- 魔法（自動発動） ---------- */
function cdOpt(b, id) {
  const o = k => oc(b, id, k), u = b.stats.uq;
  let m = 1;
  switch (id) {
    case 'missile': m = Math.pow(0.8, o('rapid')); break;
    case 'icicle': m = Math.pow(0.85, o('fast')); break;
    case 'thunder': m = Math.pow(0.8, o('fast')) * (1 - Math.min(0.6, u.thunderCd)); break;
    case 'log': m = Math.pow(1.15, o('heavy')); break;
    case 'chain': m = Math.pow(0.8, o('fast')); break;
    case 'fstar': m = Math.pow(0.8, o('fast')); break;
    case 'beam': m = Math.pow(1.2, o('focus')); break;
    case 'wave': m = Math.pow(0.85, o('fast')) * Math.pow(1.15, o('pow')) * (bookLv(b, 'wave') >= 5 ? 0.9 : 1); break;
    case 'meteor': m = Math.pow(1.25, o('heavy')); break;
    case 'storm': m = Math.pow(0.85, o('fast')) * Math.pow(1.15, o('pow')); break;
  }
  return m;
}
function spellCd(b, id) { return SPELLS[id].cd * cdOpt(b, id) * cdMult(b.stats); }
function castSpells(b, dt) {
  for (const id of Object.keys(b.spells)) {
    const s = b.spells[id];
    s.cd -= dt;
    if (s.cd > 0) continue;
    if (!b.enemies.length || (id !== 'storm' && !b.enemies.some(e => e.y > 0))) { s.cd = 0.1; continue; }
    CAST[id](b, s);
    s.cd = spellCd(b, id) + (id === 'beam' ? b.beamDur : 0);
    ev(b, { type: 'cast', spell: id });
  }
}
function castMissile(b, s, extra) {
  const L = spLv(b, 'missile'), vol = oc(b, 'missile', 'volley');
  const n = L.n + vol + b.stats.uq.missile + (bookLv(b, 'missile') >= 5 ? 1 : 0);
  const dmg = L.dmg * Math.pow(0.85, vol) * b.stats.uq.missileMult * (b.syn.has('pierce') ? 1.3 : 1);
  const tg = frontEnemies(b, n);
  if (!tg.length) return;
  const chain = oc(b, 'missile', 'homing') + (b.syn.has('pierce') ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const t = tg[i % tg.length];
    b.projs.push({ kind: 'missile', x: MAGE_X + 14 + (i - (n - 1) / 2) * 6, y: MAGE_Y - 28, vx: (i - (n - 1) / 2) * 90, vy: -150, tid: t.id, dmg, chain, hit: new Set(), life: 5 });
  }
}
function castFireball(b, s) {
  const L = spLv(b, 'fireball'), twin = oc(b, 'fireball', 'twin');
  const n = 1 + twin, dmg = L.dmg * Math.pow(0.7, twin);
  const r = L.r * (1 + 0.2 * oc(b, 'fireball', 'wide')) * (bookLv(b, 'fireball') >= 5 ? 1.15 : 1) * areaM(b);
  const c = densest(b, 20, 55);
  if (!c) return;
  for (let i = 0; i < n; i++) {
    const tx = c.x + (i ? (i % 2 ? 1 : -1) * 34 * Math.ceil(i / 2) : 0), ty = c.y;
    b.lobs.push({ sx: MAGE_X + 12, sy: MAGE_Y - 26, tx: Math.max(10, Math.min(FIELD_W - 10, tx)), ty, t: -i * 0.18, T: 0.75, dmg, r, burn: oc(b, 'fireball', 'burn') });
  }
}
function castIcicle(b, s) {
  const L = spLv(b, 'icicle'), cols = oc(b, 'icicle', 'cols'), deep = oc(b, 'icicle', 'deep');
  const n = L.n + 2 * cols + b.stats.uq.ice + (bookLv(b, 'icicle') >= 5 ? 1 : 0), dmg = L.dmg * Math.pow(0.8, cols);
  const off = (b.rng() - 0.5) * 20;
  for (let i = 0; i < n; i++) b.cols.push({ x: FIELD_W * (i + 1) / (n + 1) + off, y: WALL_Y, dmg, hit: new Set(), slow: 0.35 + 0.15 * deep, slowT: 2 + deep });
}
function castThunder(b, s) {
  const L = spLv(b, 'thunder'), dbl = oc(b, 'thunder', 'double');
  const r = L.r * (1 + 0.3 * oc(b, 'thunder', 'area')) * (bookLv(b, 'thunder') >= 5 ? 1.3 : 1) * areaM(b);
  const dmg = L.dmg * Math.pow(0.8, dbl), tg = frontEnemies(b, 1 + dbl);
  for (const t of tg) {
    const x = t.x, y = t.y;
    ev(b, { type: 'bolt', pts: [{ x, y }] }); ev(b, { type: 'spark', x, y, r });
    aoe(b, x, y, r, dmg, 'thunder');
  }
}
function castLog(b, s) {
  const L = spLv(b, 'log'), twin = oc(b, 'log', 'twin'), heavy = oc(b, 'log', 'heavy');
  const n = 1 + twin, dmg = L.dmg * Math.pow(0.75, twin) * Math.pow(1.25, heavy), w = L.w * (1 + 0.4 * oc(b, 'log', 'wide'));
  const f = frontEnemies(b, 4), base = f.length ? f[Math.floor(b.rng() * f.length)].x : FIELD_W / 2;
  for (let i = 0; i < n; i++) b.logs.push({ x: Math.max(30, Math.min(FIELD_W - 30, base + (i - (n - 1) / 2) * 70)), y: WALL_Y, w, dmg, hit: new Set(), kb: 38 * (bookLv(b, 'log') >= 5 ? 1.5 : 1) });
}
function castChain(b, s) {
  const L = spLv(b, 'chain');
  const n = Math.max(1, L.n + 2 * oc(b, 'chain', 'jump') - oc(b, 'chain', 'focus') + b.stats.uq.chain + (bookLv(b, 'chain') >= 5 ? 1 : 0));
  let dmg = L.dmg * Math.pow(1.3, oc(b, 'chain', 'focus'));
  const first = frontEnemies(b, 1)[0]; if (!first) return;
  const hit = new Set(), pts = [];
  let cur = first;
  for (let i = 0; i < n && cur; i++) {
    hit.add(cur.id); pts.push({ x: cur.x, y: cur.y });
    const tgt = cur; dealDamage(b, tgt, dmg, 'chain');
    if (b.syn.has('shock') && tgt.hp > 0) { tgt.shockT = 3; tgt.shockDmg = L.dmg * 0.3; }
    dmg *= 0.9;
    let nx = null, bd = 120 * 120;
    for (const e of b.enemies) { if (e.hp <= 0 || hit.has(e.id)) continue; const d = (e.x - tgt.x) ** 2 + (e.y - tgt.y) ** 2; if (d < bd) { bd = d; nx = e; } }
    cur = nx;
  }
  ev(b, { type: 'bolt', pts, chain: true });
}
function castFstar(b, s) {
  const L = spLv(b, 'fstar'), dn = oc(b, 'fstar', 'dense');
  const n = L.n + 2 * dn, dmg = L.dmg * Math.pow(0.8, dn);
  const fz = 0.12 + 0.10 * oc(b, 'fstar', 'freeze') + (bookLv(b, 'fstar') >= 5 ? 0.10 : 0);
  const spread = Math.min(1.5, 0.9 + 0.06 * n);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
    b.projs.push({ kind: 'shard', x: MAGE_X + 8, y: MAGE_Y - 30, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, dmg, fz, life: 1.6 });
  }
}
function castBeam(b, s) {
  const L = spLv(b, 'beam');
  b.beamDur = 2 + oc(b, 'beam', 'long') + (bookLv(b, 'beam') >= 5 ? 0.5 : 0);
  const dmg = L.dmg * Math.pow(1.35, oc(b, 'beam', 'focus')) * (b.syn.has('twinlight') ? 1.6 : 1);
  b.beam = { t: 0, dur: b.beamDur, tick: 0, tid: 0, w: L.w * (1 + 0.6 * oc(b, 'beam', 'thick')), dmg };
  b.barrageAcc = 0;
}
function beamTarget(b) {
  let best = null, bs = -1;
  for (const e of b.enemies) { if (e.hp <= 0) continue; const sc = (e.boss ? 1e7 : 0) + (e.elite ? 1e6 : 0) + e.hp; if (sc > bs) { bs = sc; best = e; } }
  return best;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function updateBeam(b, dt) {
  const m = b.beam; if (!m) return;
  m.t += dt; m.tick += dt;
  let t = m.tid ? b.enemies.find(e => e.id === m.tid && e.hp > 0) : null;
  if (!t) { t = beamTarget(b); m.tid = t ? t.id : 0; }
  if (t) {
    const ax = MAGE_X + 14, ay = MAGE_Y - 28; m.ax = ax; m.ay = ay;
    const dx = t.x - ax, dy = t.y - ay, d = Math.hypot(dx, dy) || 1; m.ex = ax + dx / d * 800; m.ey = ay + dy / d * 800; m.tx = t.x; m.ty = t.y;
    if (m.tick >= 0.2) {
      m.tick -= 0.2;
      for (const e of b.enemies.slice()) if (e.hp > 0 && distSeg(e.x, e.y, ax, ay, m.ex, m.ey) <= m.w / 2 + e.r * 0.7) dealDamage(b, e, m.dmg, 'beam', { sure: true });
    }
    if (b.syn.has('barrage') && b.spells.missile) {      // 誘導弾幕：照射中、ミサイルの半分の間隔で自動発射
      b.barrageAcc += dt;
      const iv = spellCd(b, 'missile') / 2;
      if (b.barrageAcc >= iv) { b.barrageAcc -= iv; castMissile(b, b.spells.missile, true); }
    }
  }
  if (m.t >= m.dur) b.beam = null;
}
function castWeb(b, s) {
  const L = spLv(b, 'web'), wide = oc(b, 'web', 'wide'), dense = oc(b, 'web', 'dense');
  const c = densest(b, WALL_Y - 280, 70) || { x: FIELD_W / 2, y: WALL_Y - 100 };
  const r = L.r * (1 + 0.3 * wide) * (bookLv(b, 'web') >= 5 ? 1.2 : 1) * areaM(b);
  const dur = Math.max(2, 4 + 2 * oc(b, 'web', 'dur') - dense);
  b.zones.push({ kind: 'web', spell: 'web', x: c.x, y: Math.min(c.y, WALL_Y - 40), r, t: 0, dur, tick: 0, dmg: L.dmg * Math.pow(0.85, wide) * Math.pow(1.35, dense) });
}
function castWave(b, s) {
  const L = spLv(b, 'wave'), dmg = L.dmg * Math.pow(1.3, oc(b, 'wave', 'pow')) * (b.syn.has('twinlight') ? 1.6 : 1);
  b.pulses.push({ y: WALL_Y, dmg, hit: new Set() });
  if (oc(b, 'wave', 'echo')) b.pulses.push({ y: WALL_Y + 0.6 * 520, dmg: dmg * 0.6, hit: new Set() });
}
function castWhirl(b, s) {
  const L = spLv(b, 'whirl'), twin = oc(b, 'whirl', 'twin'), n = 1 + twin;
  const dur = 5 + 2 * oc(b, 'whirl', 'dur') + (bookLv(b, 'whirl') >= 5 ? 1 : 0), r = L.r * (1 + 0.25 * oc(b, 'whirl', 'big')) * areaM(b);
  const c = densest(b, 60, 60) || { x: FIELD_W / 2, y: WALL_Y - 120 };
  for (let i = 0; i < n; i++) b.zones.push({ kind: 'whirl', spell: 'whirl', x: Math.max(30, Math.min(FIELD_W - 30, c.x + (i ? (i % 2 ? 1 : -1) * 60 : 0))), y: Math.min(c.y + 30, WALL_Y - 30), r, t: 0, dur, tick: 0, dmg: L.dmg * Math.pow(0.8, twin), pull: b.syn.has('eye') ? 90 : 28 });
}
function castMeteor(b, s) {
  const L = spLv(b, 'meteor'), twin = oc(b, 'meteor', 'twin'), n = 1 + twin;
  const dmg = L.dmg * Math.pow(1.4, oc(b, 'meteor', 'heavy')) * Math.pow(0.75, twin);
  const r = L.r * (1 + 0.2 * oc(b, 'meteor', 'big')) * (1 + b.stats.uq.meteorArea) * (bookLv(b, 'meteor') >= 5 ? 1.15 : 1) * areaM(b);
  const c = densest(b, 20, 70); if (!c) return;
  for (let i = 0; i < n; i++) b.metes.push({ x: Math.max(20, Math.min(FIELD_W - 20, c.x + (i ? (i % 2 ? 1 : -1) * 55 * Math.ceil(i / 2) : 0))), y: c.y, r, t: -i * 0.25, delay: 1.1, dmg });
}
function castStorm(b, s) {
  const L = spLv(b, 'storm'), dmg = L.dmg * Math.pow(1.3, oc(b, 'storm', 'pow')) * (b.syn.has('eye') ? 1.5 : 1);
  const kb = 36 * (1 + 0.6 * oc(b, 'storm', 'push')) * (bookLv(b, 'storm') >= 5 ? 1.5 : 1);
  ev(b, { type: 'storm' });
  for (const e of b.enemies.slice()) {
    if (e.hp <= 0 || e.y < -10) continue;
    const alive = dealDamage(b, e, dmg, 'storm', { sure: true }) >= 0 && e.hp > 0;
    if (alive) e.y = Math.max(-10, e.y - kb * (e.boss ? 0.3 : 1));
  }
}
const CAST = { missile: castMissile, fireball: castFireball, icicle: castIcicle, thunder: castThunder, log: castLog, chain: castChain, fstar: castFstar, beam: castBeam, web: castWeb, wave: castWave, whirl: castWhirl, meteor: castMeteor, storm: castStorm };

function updateProjs(b, dt) {
  for (let i = b.projs.length - 1; i >= 0; i--) {
    if (i >= b.projs.length) continue;
    const p = b.projs[i];
    p.life -= dt;
    let dead = p.life <= 0;
    if (!dead && p.kind === 'missile') {
      let t = b.enemies.find(e => e.id === p.tid && e.hp > 0);
      if (!t) { t = nearestTo(b, p.x, p.y, p.hit); if (t) p.tid = t.id; else dead = true; }
      if (t) {
        const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 380;
        p.vx += (dx / d * sp - p.vx) * Math.min(1, dt * 9); p.vy += (dy / d * sp - p.vy) * Math.min(1, dt * 9);
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (Math.hypot(t.x - p.x, t.y - p.y) <= t.r + 6) {
          p.hit.add(t.id);
          dealDamage(b, t, p.dmg, 'missile');
          if (b.syn.has('blast')) { aoe(b, t.x, t.y, 38 * areaM(b), p.dmg * 0.5, 'missile', { skip: t, noCrit: true }); ev(b, { type: 'boom', x: t.x, y: t.y, r: 38, col: '#2d4a9c' }); }
          if (p.chain > 0) { p.chain--; const n = nearestTo(b, p.x, p.y, p.hit); if (n) p.tid = n.id; else dead = true; } else dead = true;
        }
      }
    } else if (!dead && p.kind === 'shard') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < -30 || p.x < -30 || p.x > FIELD_W + 30) dead = true;
      else for (const e of b.enemies) {
        if (e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= e.r + 4) {
          dealDamage(b, e, p.dmg, 'fstar');
          if (e.hp > 0 && b.rng() < p.fz) { e.frozenT = Math.max(e.frozenT, 1.2); ev(b, { type: 'freeze', x: e.x, y: e.y }); }
          dead = true; break;
        }
      }
    }
    if (dead && b.projs[i] === p) b.projs.splice(i, 1);
  }
}
function updateLobs(b, dt) {
  for (let i = b.lobs.length - 1; i >= 0; i--) {
    if (i >= b.lobs.length) continue;
    const l = b.lobs[i]; l.t += dt;
    if (l.t < l.T) continue;
    aoe(b, l.tx, l.ty, l.r, l.dmg, 'fireball');
    ev(b, { type: 'boom', x: l.tx, y: l.ty, r: l.r, col: '#d6402a', big: true });
    if (l.burn) b.zones.push({ kind: 'burn', spell: 'fireball', x: l.tx, y: l.ty, r: l.r * 0.8, t: 0, dur: 2, tick: 0, dmg: l.dmg * 0.2 });
    b.lobs.splice(i, 1);
  }
}
function updateCols(b, dt) {
  for (let i = b.cols.length - 1; i >= 0; i--) {
    if (i >= b.cols.length) continue;
    const c = b.cols[i]; c.y -= 430 * dt;
    for (const e of b.enemies.slice()) {
      if (e.hp <= 0 || c.hit.has(e.id)) continue;
      if (Math.abs(e.x - c.x) <= e.r + 9 && c.y <= e.y + e.r) {
        c.hit.add(e.id); dealDamage(b, e, c.dmg, 'icicle');
        if (e.hp > 0) applySlow(e, c.slow, c.slowT);
      }
    }
    if (c.y < -30) b.cols.splice(i, 1);
  }
}
function updateLogs(b, dt) {
  for (let i = b.logs.length - 1; i >= 0; i--) {
    if (i >= b.logs.length) continue;
    const l = b.logs[i]; l.y -= 240 * dt;
    for (const e of b.enemies.slice()) {
      if (e.hp <= 0 || l.hit.has(e.id)) continue;
      if (Math.abs(e.x - l.x) <= l.w / 2 + e.r * 0.8 && Math.abs(e.y - l.y) <= e.r + 16) {
        l.hit.add(e.id); dealDamage(b, e, l.dmg, 'log');
        if (e.hp > 0) e.y = Math.max(-10, e.y - l.kb * (e.boss ? 0.3 : 1));
      }
    }
    if (l.y < -40) b.logs.splice(i, 1);
  }
}
function updatePulses(b, dt) {
  for (let i = b.pulses.length - 1; i >= 0; i--) {
    if (i >= b.pulses.length) continue;
    const p = b.pulses[i]; p.y -= 520 * dt;
    if (p.y <= WALL_Y) for (const e of b.enemies.slice()) {
      if (e.hp > 0 && !p.hit.has(e.id) && p.y <= e.y + e.r) { p.hit.add(e.id); dealDamage(b, e, p.dmg, 'wave', { sure: true }); }
    }
    if (p.y < -40) b.pulses.splice(i, 1);
  }
}
function updateZones(b, dt) {
  for (let i = b.zones.length - 1; i >= 0; i--) {
    if (i >= b.zones.length) continue;
    const z = b.zones[i]; z.t += dt; z.tick += dt;
    if (z.kind === 'whirl') {
      z.y -= 45 * dt;
      for (const e of b.enemies) {
        if (e.hp <= 0 || e.boss) continue;
        const dx = z.x - e.x, d = Math.hypot(dx, z.y - e.y);
        if (d <= z.r * 1.6) e.x += Math.sign(dx) * Math.min(Math.abs(dx), z.pull * dt);
      }
    }
    const iv = z.kind === 'whirl' ? 0.4 : 0.5;
    if (z.tick >= iv) {
      z.tick -= iv;
      aoe(b, z.x, z.y, z.r, z.dmg, z.spell, { sure: true, noCrit: true, dot: true });
    }
    if (z.t >= z.dur || z.y < -40) b.zones.splice(i, 1);
  }
}
function updateMeteors(b, dt) {
  for (let i = b.metes.length - 1; i >= 0; i--) {
    if (i >= b.metes.length) continue;
    const m = b.metes[i]; m.t += dt;
    if (m.t < m.delay) continue;
    aoe(b, m.x, m.y, m.r, m.dmg, 'meteor');
    ev(b, { type: 'boom', x: m.x, y: m.y, r: m.r, col: '#d6402a', big: true });
    if (b.syn.has('burnmeteor')) b.zones.push({ kind: 'burn', spell: 'meteor', x: m.x, y: m.y, r: m.r * 0.8, t: 0, dur: 3, tick: 0, dmg: m.dmg * 0.12 });
    b.metes.splice(i, 1);
  }
}

function updateWaves(b, dt) {
  if (b.inGap) {
    b.waveT += dt;
    if (b.waveT >= WAVE_GAP) { b.inGap = false; b.waveT = 0; b.wave++; startWave(b); }
    return;
  }
  b.waveT += dt;
  if (b.spawning) {
    if (b.waveT >= WAVE_LEN) b.spawning = false;
    else {
      b.spawnT -= dt;
      if (b.spawnT <= 0) {
        if (b.wave === MAX_WAVE && !b.boss) { b.spawnT = 1; return; }
        spawnGroup(b);
        let iv = spawnInterval(b.stage, b.wave, Math.min(1, b.waveT / WAVE_LEN));
        if (b.wave === MAX_WAVE || b.wave === MID_WAVE) iv *= 1.6;
        b.spawnT = iv;
      }
    }
  }
  if (!b.spawning && b.enemies.length === 0 && b.wave < MAX_WAVE) {   // 敵を全て倒しきればウェーブ完了
    b.inGap = true; b.waveT = 0; ev(b, { type: 'waveend', wave: b.wave });
  }
}
function stepBattle(b, dt) {
  if (b.state !== 'playing') return;
  b.time += dt;
  if (b.wallFlash > 0) b.wallFlash -= dt;
  updateWaves(b, dt);
  updateEnemies(b, dt);
  if (b.state !== 'playing') return;
  castSpells(b, dt);
  updateBeam(b, dt);
  updateProjs(b, dt); updateLobs(b, dt); updateCols(b, dt); updateLogs(b, dt); updatePulses(b, dt); updateZones(b, dt); updateMeteors(b, dt);
  if (b.state === 'playing' && b.pending > 0) { b.state = 'levelup'; b.choices = makeChoices(b); }
}

/* ---------- レベルアップ3択 ---------- */
function makeChoices(b) {
  const cand = [];
  const owned = Object.keys(b.spells).length;
  for (const id of SPELL_IDS) {
    if (!b.unlocked.has(id)) continue;
    const s = b.spells[id];
    if (!s) { if (owned < MAX_SPELLS) cand.push({ kind: 'spell-new', id, w: owned < 3 ? 4 : 3 }); continue; }
    if (s.lv < 5) cand.push({ kind: 'spell-up', id, w: 2.2 });
    for (const o of SPELLS[id].opts) if ((s.opt[o.id] || 0) < o.max) cand.push({ kind: 'option', id, opt: o.id, w: o.trade ? 1.1 : 1.7 });
  }
  for (const sid of synAvailable(b)) cand.push({ kind: 'synergy', id: sid, w: 8 });
  const out = [];
  while (out.length < 3 && cand.length) out.push(cand.splice(weightedIndex(b.rng, cand.map(o => o.w)), 1)[0]);
  const fillers = [{ kind: 'heal' }, { kind: 'gold' }];
  while (out.length < 3) out.push(fillers[out.length % 2]);
  return out;
}
function rerollChoices(b) {
  if (b.state !== 'levelup' || b.rerolls <= 0) return false;
  b.rerolls--;
  const key = cs => cs.map(c => c.kind + (c.id || '') + (c.opt || '')).sort().join('|');
  const old = key(b.choices);
  let nc = makeChoices(b);
  for (let k = 0; k < 6 && key(nc) === old; k++) nc = makeChoices(b);
  b.choices = nc; return true;
}
function applyCard(b, c) {
  if (b.state !== 'levelup') return;
  if (c.kind === 'spell-new') b.spells[c.id] = { lv: 1, cd: 0.2, opt: {} };
  else if (c.kind === 'spell-up') b.spells[c.id].lv++;
  else if (c.kind === 'option') b.spells[c.id].opt[c.opt] = (b.spells[c.id].opt[c.opt] || 0) + 1;
  else if (c.kind === 'synergy') b.syn.add(c.id);
  else if (c.kind === 'heal') b.wall = Math.min(b.wallMax, b.wall + b.wallMax * 0.2);
  else if (c.kind === 'gold') b.goldF += 50 * b.stage;
  b.pending--;
  if (b.pending > 0) b.choices = makeChoices(b);
  else { b.choices = null; b.state = 'playing'; }
}

/* ---------- ヘッドレス・シミュレーション ---------- */
const SMART_NEW = ['fireball', 'icicle', 'thunder', 'chain', 'meteor', 'missile', 'fstar', 'beam', 'wave', 'web', 'whirl', 'storm', 'log'];
function pickCard(b, policy, prng) {
  const cs = b.choices;
  if (policy === 'smart') {   // 手堅く遊ぶプレイヤー：複合＞攻撃を伸ばす強化オプション＞新規魔法＞レベルアップ
    const score = c => {
      if (c.kind === 'synergy') return 9;
      if (c.kind === 'option') { const o = SPELLS[c.id].opts.find(x => x.id === c.opt); return o.trade ? 3.5 : 6; }
      if (c.kind === 'spell-new') return 5 - 0.1 * SMART_NEW.indexOf(c.id);
      if (c.kind === 'spell-up') return c.id === 'missile' ? 5.5 : 4.5;
      return 0;
    };
    return cs.slice().sort((x, y) => score(y) - score(x))[0];
  }
  return cs[Math.floor(prng() * cs.length)];
}
function simulateBattle(o) {
  const seed = o.seed || 1;
  const rng = mulberry32(seed), prng = mulberry32((seed * 2654435761) >>> 0);
  const b = createBattle({ stage: o.stage || 1, cleared: o.cleared, equipStats: o.equipStats, book: o.book, rng, ownedSlots: o.ownedSlots, onlySpells: o.onlySpells, startSpells: o.startSpells });
  const dt = o.dt || 1 / 30, maxT = o.maxTime || 600;
  let guard = 0;
  while ((b.state === 'playing' || b.state === 'levelup') && b.time < maxT && guard++ < 400000) {
    if (b.state === 'levelup') { applyCard(b, pickCard(b, o.policy, prng)); continue; }
    stepBattle(b, dt);
    b.events.length = 0;
  }
  return {
    won: b.state === 'won', lost: b.state === 'lost', time: b.time, level: b.player.level, kills: b.kills,
    gold: Math.floor(b.goldF), drops: b.drops.length, gemDrops: b.gemDrops.length, wave: b.maxWave, wall: b.wall, wallMax: b.wallMax,
    rating: b.state === 'won' ? clearRating(b.wall, b.wallMax) : 0, elites: b.elites,
    spellIds: Object.keys(b.spells), syn: Array.from(b.syn), dmgBy: b.dmgBy, reachBy: b.reachBy, bossReached: b.bossSpawned,
  };
}

/* ---------- セーブ（純粋部分） ---------- */
const DEFAULT_SETTINGS = { mute: false, fps30: false };
function defaultSave() {
  return { v: 2, gold: 0, runes: 0, cleared: 0, inv: [], gems: [], equipped: { hood: null, robe: null, boots: null, wand: null, ring: null, neck: null }, book: {}, stageBest: {}, nextId: 1, nextGid: 1, settings: Object.assign({}, DEFAULT_SETTINGS), bestWave: {}, bossPity: 0 };
}
function sanitizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const s = Object.assign(d, raw);
  s.v = 2;
  s.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
  s.equipped = Object.assign(defaultSave().equipped, raw.equipped || {});
  s.inv = Array.isArray(raw.inv) ? raw.inv.filter(it => it && SLOTS.includes(it.slot) && RARITIES[it.rarity] && Array.isArray(it.affixes)) : [];
  s.gems = Array.isArray(raw.gems) ? raw.gems.filter(g => g && GEM_INFO[g.type] && GEM_RARITIES[g.rarity] && g.id) : [];
  const gids = new Set(s.gems.map(g => g.id)), used = new Set();
  for (const it of s.inv) {
    it.uniques = Array.isArray(it.uniques) ? it.uniques.filter(u => u && UNIQUES[u.id] && (u.m === 1 || u.m === 2)) : [];
    const n = RARITIES[it.rarity].sockets, sk = Array.isArray(it.sock) ? it.sock.slice(0, n) : [];
    while (sk.length < n) sk.push(null);
    it.sock = sk.map(x => (x && gids.has(x) && !used.has(x) ? (used.add(x), x) : null));
  }
  const ids = new Set(s.inv.map(i => i.id));
  for (const k of SLOTS) if (!ids.has(s.equipped[k])) s.equipped[k] = null;
  s.gold = Math.max(0, Math.floor(+s.gold || 0));
  s.runes = Math.max(0, Math.floor(+s.runes || 0));
  s.cleared = Math.max(0, Math.min(15, Math.floor(+s.cleared || 0)));
  s.bossPity = Math.max(0, Math.min(BOSS_PITY_MAX, Math.floor(+s.bossPity || 0)));
  s.book = {};
  for (const id of SPELL_IDS) { const v = Math.floor(+((raw.book || {})[id]) || 0); if (v > 0) s.book[id] = Math.min(BOOK_MAX, v); }
  s.stageBest = {};
  for (const k of Object.keys(raw.stageBest || {})) { const v = Math.floor(+raw.stageBest[k] || 0); if (v >= 1 && v <= 3) s.stageBest[k] = v; }
  s.bestWave = (raw.bestWave && typeof raw.bestWave === 'object') ? raw.bestWave : {};
  s.nextId = Math.max(1, Math.floor(+s.nextId || 1)); s.nextGid = Math.max(1, Math.floor(+s.nextGid || 1));
  return s;
}
const EXPORT_PREFIX = 'MHSAVE2:';
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
  SAVE_KEY, SLOTS, SLOT_NAME, INV_CAP, GEM_CAP, RARITIES, ELEM_IDS, ELEMS, SPELL_IDS, SPELL_UNLOCK, SPELLS, SYN_IDS, SYNERGIES, ENEMIES, SPAWN_TYPES, CHAPTERS, BOSS_NAMES,
  WAVE_LEN, WAVE_GAP, MAX_WAVE, MID_WAVE, MAX_ENEMIES, MAX_SPELLS, FREE_REROLLS, ENH_REFUND, FIELD_W, FIELD_H, WALL_Y, MAGE_X, MAGE_Y, BASE_WALL, WEAK_MULT, BOOK_MAX, BOOK_STEP,
  STAT_INFO, AFFIX_RANGE, BASE_STAT, DROP_RATE, GEM_DROP, ELITE_CHANCE, GHOST_MISS, GEM_RARITIES, GEM_TYPES, GEM_INFO, EXEC_RATE, RATING_NAME, UNIQUES, UNIQUE_IDS,
  stageInfo, stageEnemyInfo, enemyAffinity, elemMult, resistMult, spawnWeight, unlockedTypes, unlockedSpells, synAvailable, mulberry32, weightedIndex,
  xpNeeded, enemyHpMult, enemyDmgMult, goldMult, spawnInterval, bossHp,
  bookCost, bookBonus, bookUpgrade, clearRating, applyClearRewards,
  gemValue, gemText, genGem, rollGemRarity, rollGemDrops, socketCount, socketedIds, freeGems, socketGem, unsocketGem, mergeGems, mergeAllGems, addGem,
  emptyStats, calcDamage, hitChance, cdMult, uniqueTexts,
  baseValue, itemStatList, fmtStat, rollRarity, genEquipment, rollDrop, computeEquipStats, itemScore, enhanceCost,
  totalEnhanceSpent, sellPrice, sellBase, enhanceRefund, addToInventory,
  createBattle, stepBattle, applyCard, dealDamage, makeChoices, rerollChoices, deriveStats, simulateBattle, defaultSave, sanitizeSave, exportSave, importSave, killEnemy, makeEnemy, spawnGroup,
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
const SLOT_ICON = { hood: '頭', robe: '衣', boots: '靴', wand: '杖', ring: '環', neck: '首' };

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
const gemMap = () => { const m = {}; for (const g of save.gems) m[g.id] = g; return m; };

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

const screens = { title: $('s-title'), home: $('s-home'), equip: $('s-equip'), book: $('s-book'), result: $('s-result') };
const G = { mode: 'title', b: null, paused: false, selStage: 1, tab: 'all', endTimer: 0, pendingConfirm: null, lastResult: null, shake: 0, acc: 0, pick: null };
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
const ech = (el, res) => `<span class="ech${res ? ' res' : ''}" style="--ec:${ELEMS[el].color}">${ELEMS[el].name}</span>`;
const crownHtml = r => r ? `<span class="crown c${r}">${RATING_NAME[r]}</span>` : '';
const gemColor = g => GEM_RARITIES[g.rarity].color;

/* ---------- ホーム ---------- */
function renderHome() {
  $('home-gold').textContent = fmt(save.gold); $('home-rune').textContent = fmt(save.runes);
  let html = '';
  for (let ci = 0; ci < 3; ci++) {
    html += `<div class="chapter"><h3>${esc(CHAPTERS[ci].name)}</h3><div class="stages">`;
    for (let k = 1; k <= 5; k++) {
      const n = ci * 5 + k, locked = n > save.cleared + 1, done = n <= save.cleared, rt = save.stageBest[n];
      html += `<button class="stage-btn${locked ? ' locked' : ''}${done ? ' done' : ''}${n === G.selStage ? ' sel' : ''}" data-act="pickStage" data-arg="${n}"${locked ? ' disabled' : ''}>${ci + 1}-${k}<small>${locked ? '封' : rt ? RATING_NAME[rt] : 'STAGE'}</small></button>`;
    }
    html += '</div></div>';
  }
  $('stage-list').innerHTML = html;
  const st = G.selStage, si = stageInfo(st), best = save.bestWave[st] || 0, bossAff = enemyAffinity('boss', st);
  const foes = stageEnemyInfo(st).map(f => `<div class="foe"><span class="fn">${esc(f.name)}</span><span>弱点${f.weak.map(e => ech(e)).join('') || '―'}<small>耐性</small>${f.resist.map(e => ech(e, true)).join('') || '―'}</span></div>`).join('');
  const mine = Array.from(new Set(unlockedSpells(save.cleared).map(id => SPELLS[id].elem)));
  $('stage-detail').innerHTML = `<h4>${esc(si.ch.name.replace('　', ' '))} ${si.inChapter}</h4>
    <div class="row"><span>ボス</span><b>${esc(si.boss)}</b></div>
    <div class="row"><span>ボスの属性</span><span>弱点${bossAff.weak.map(e => ech(e)).join('')}<small>耐性</small>${bossAff.resist.map(e => ech(e, true)).join('')}</span></div>
    <div class="foes"><div class="row"><span>主な敵と弱点（炎の列は+50%・斜線は-40%）</span></div>${foes}</div>
    <div class="row"><span>使える属性</span><span>${mine.map(e => ech(e)).join('')}</span></div>
    <div class="row"><span>敵の強さ</span><b>HP ×${enemyHpMult(st, 1).toFixed(2)}（第20波 ×${enemyHpMult(st, 20).toFixed(2)}）</b></div>
    <div class="row"><span>最高到達／評価</span><b>${best ? '第' + best + '波' : '未挑戦'}　${crownHtml(save.stageBest[st]) || (st <= save.cleared ? '' : '')}</b></div>`;
}
function fpsLabel() { return '30fpsモード：' + (save.settings.fps30 ? 'ON' : 'OFF'); }
function renderTitleBtns() { $('btn-continue').classList.toggle('hidden', !hasSave); $('pause-mute').textContent = muteLabel(); $('set-mute').textContent = muteLabel(); $('set-fps').textContent = fpsLabel(); }

/* ---------- 装備・ジェム画面 ---------- */
function statLines(item) {
  return itemStatList(item).map(s => `<div class="${s.base ? 'base' : ''}"><span>${esc(STAT_INFO[s.key].name)}</span><span>+${s.v}${STAT_INFO[s.key].unit}</span></div>`).join('');
}
const sockHtml = it => {
  const gm = gemMap(), n = socketCount(it), sk = it.sock || [];
  let h = '<div class="sock-row">';
  for (let i = 0; i < n; i++) {
    const g = sk[i] ? gm[sk[i]] : null;
    h += g ? `<button class="sock fill" style="--gc:${gemColor(g)}" data-act="unsock" data-arg="${it.id}:${i}">${GEM_INFO[g.type].name.slice(0, 2)}</button>` : `<button class="sock" data-act="pickSock" data-arg="${it.id}:${i}">＋</button>`;
  }
  return h + '</div>';
};
function gemGroups(list) {
  const m = new Map();
  for (const g of list) { const k = g.type + '|' + g.rarity + '|' + (g.fx || ''); let e = m.get(k); if (!e) { e = { g, n: 0, ids: [] }; m.set(k, e); } e.n++; e.ids.push(g.id); }
  return Array.from(m.values()).sort((a, b) => b.g.rarity - a.g.rarity || GEM_TYPES.indexOf(a.g.type) - GEM_TYPES.indexOf(b.g.type));
}
function gemTile(grp, act, arg) {
  const g = grp.g, i = GEM_INFO[g.type];
  return `<button class="gem" style="--gc:${gemColor(g)}" data-act="${act}" data-arg="${arg}"><span class="gx">×${grp.n}</span><span class="gn">${GEM_RARITIES[g.rarity].name}の${i.name}石</span><span>+${gemValue(g)}${i.unit}</span>${g.fx ? '<span class="gfx">命中時2%で即死（ボス無効）</span>' : ''}</button>`;
}
function renderEquip() {
  $('eq-gold').textContent = fmt(save.gold);
  const gm = gemMap();
  $('slot-row').innerHTML = SLOTS.map(sl => {
    const it = getItem(save.equipped[sl]);
    if (!it) return `<div class="slot empty"><span class="sl">${SLOT_NAME[sl]}</span><span class="nm" style="color:var(--ink-soft)">― 未装備 ―</span></div>`;
    const bs = itemStatList(it)[0], filled = (it.sock || []).filter(Boolean).length;
    return `<button class="slot" style="--rc:${RARITIES[it.rarity].color}" data-act="openItem" data-arg="${it.id}"><span class="sl">${SLOT_NAME[sl]}</span><span class="nm">${esc(it.name)}${it.enh ? ' +' + it.enh : ''}</span><span class="st">${esc(fmtStat(bs.key, bs.v))}</span><span class="sk">石 ${filled}/${socketCount(it)}</span></button>`;
  }).join('');
  const tabs = [['all', '全て'], ...SLOTS.map(s => [s, SLOT_NAME[s].slice(0, 3)]), ['gem', 'ジェム']];
  $('inv-tabs').innerHTML = tabs.map(([k, n]) => `<button class="tab${G.tab === k ? ' on' : ''}" data-act="tab" data-arg="${k}">${n}</button>`).join('');
  $('btn-sellc').classList.toggle('hidden', G.tab === 'gem'); $('btn-mergeall').classList.toggle('hidden', G.tab !== 'gem');
  if (G.tab === 'gem') {
    const free = freeGems(save), mergeable = GEM_TYPES.reduce((n, t) => n + GEM_RARITIES.slice(0, -1).filter((_, r) => free.filter(g => g.type === t && g.rarity === r).length >= 3).length, 0);
    $('inv-note').innerHTML = `ジェム <b>${save.gems.length} / ${GEM_CAP}</b>（未装着 ${free.length}）　同種・同ランクの未装着ジェム<b>3個→1段上</b>に合成できます。${mergeable ? '合成できる組があります。' : ''}`;
    const grp = gemGroups(free);
    $('inv-grid').innerHTML = grp.length ? `<div class="gem-list" style="grid-column:1/-1;max-height:none">${grp.map(gr => gemTile(gr, 'mergeOne', gr.g.type + ':' + gr.g.rarity)).join('')}</div><p class="note" style="grid-column:1/-1;font-size:11px;color:var(--ink-soft)">タップで、そのジェム3個を1つ上のランクへ合成（3個以上のとき）。装着は装備の詳細から。</p>` : '<div class="empty-msg">ジェムがありません。<br>敵（エリート・ボスは高確率）が落とします。</div>';
    return;
  }
  const full = save.inv.length >= INV_CAP;
  $('inv-note').innerHTML = `所持 <b style="color:${full ? 'var(--vermilion)' : 'inherit'}">${save.inv.length} / ${INV_CAP}</b>　上限を超えると<b>装備していない最古のコモンから自動売却</b>されます。`;
  const rank = it => (save.equipped[it.slot] === it.id ? 100 : 0) + it.rarity * 10;
  const list = save.inv.filter(i => G.tab === 'all' || i.slot === G.tab).sort((a, b) => rank(b) - rank(a) || itemScore(b) - itemScore(a));
  $('inv-grid').innerHTML = list.length ? list.map(it => {
    const bs = itemStatList(it)[0];
    return `<button class="item r${it.rarity}" style="--rc:${RARITIES[it.rarity].color}" data-act="openItem" data-arg="${it.id}">${save.equipped[it.slot] === it.id ? '<span class="eqm">装</span>' : ''}<span class="nm">${esc(it.name)}${it.enh ? ' +' + it.enh : ''}${(it.uniques || []).length ? '<span class="uq-mark">印</span>' : ''}</span><span class="meta">${SLOT_NAME[it.slot]} ・ ${RARITIES[it.rarity].name} ・ 石${socketCount(it)}</span><span class="meta">${esc(fmtStat(bs.key, bs.v))}</span></button>`;
  }).join('') : '<div class="empty-msg">装備がありません。<br>敵を倒して戦利品を集めよう。</div>';
}
function uniqueLines(it) {
  const t = uniqueTexts(it);
  return t.length ? `<div class="uniq">${t.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : '';
}
function openItem(id) {
  const it = getItem(id); if (!it) return;
  G.pick = null;
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
    <div class="stat-list">${statLines(it)}</div>${uniqueLines(it)}
    <div class="loot-h" style="margin-top:8px">ソケット（${socketCount(it)}）</div>${sockHtml(it)}
    <div id="gem-pick"></div>${cmp}
    <div class="item-actions">
      ${isEq ? `<button class="btn" data-act="unequip" data-arg="${id}">外す</button>` : `<button class="btn primary" data-act="equip" data-arg="${id}">装備する</button>`}
      <button class="btn" data-act="enhance" data-arg="${id}"${!canEnh || save.gold < cost ? ' disabled' : ''}>${canEnh ? '強化 +' + (it.enh + 1) + '（' + fmt(cost) + '金）' : '強化 上限'}</button>
      <button class="btn danger" data-act="sell" data-arg="${id}"${isEq ? ' disabled' : ''}>売却 ${fmt(sellPrice(it))}金${it.enh ? '（強化費の' + Math.round(ENH_REFUND * 100) + '%返還込み）' : ''}</button>
      <button class="btn ghost" data-act="closeItem">閉じる</button>
    </div>
    <p class="note" style="font-size:11px;color:var(--ink-soft);margin:10px 0 0">強化は基本ステータス（◆）のみ伸びます。失敗はありません（上限+10）。ソケットのジェムはタップで外せます（付け替えは無料）。売却するとジェムは手元に戻ります。${isEq ? '装備中の品は売却できません。' : ''}</p>`;
  overlay('ov-item', true);
}
function showGemPick(itemId, index) {
  G.pick = { itemId, index };
  const grp = gemGroups(freeGems(save));
  $('gem-pick').innerHTML = `<div class="loot-h">はめるジェムを選ぶ</div>` + (grp.length ? `<div class="gem-list">${grp.map(gr => gemTile(gr, 'putGem', gr.ids[0])).join('')}</div>` : '<div class="note" style="font-size:12px">未装着のジェムがありません。</div>');
}

/* ---------- 魔法書 ---------- */
function renderBook() {
  $('bk-gold').textContent = fmt(save.gold); $('bk-rune').textContent = fmt(save.runes);
  $('book-list').innerHTML = SPELL_IDS.map(id => {
    const S = SPELLS[id], lv = save.book[id] || 0, locked = save.cleared < SPELL_UNLOCK[id], c = bookCost(id, lv), max = lv >= BOOK_MAX;
    const can = !locked && !max && save.gold >= c.gold && save.runes >= c.rune;
    return `<div class="book${locked ? ' locked' : ''}" style="--bc:${S.color}"><div class="bi">${S.icon}</div><div class="bt"><b>${esc(S.name)}</b> ${ech(S.elem)} 　書Lv <b>${lv}</b>/${BOOK_MAX}<br>威力 +${Math.round(BOOK_STEP * lv * 100)}%　<span class="bm">Lv5：${esc(S.book5)}${lv >= 5 ? '（有効）' : ''}</span>${locked ? `<br><span class="bm">ステージ${SPELL_UNLOCK[id]}クリアで解放</span>` : ''}</div>
      <button class="btn small" data-act="bookUp" data-arg="${id}"${can ? '' : ' disabled'}>${locked ? '未解放' : max ? '最大' : fmt(c.gold) + '金＋ルーン' + c.rune}</button></div>`;
  }).join('');
}

/* ---------- 戦闘開始・終了 ---------- */
function calcView() {
  const w = innerWidth, h = innerHeight, pad = 8;
  const scale = Math.min(w / FIELD_W, (h - pad) / FIELD_H);
  return { w, h, scale, ox: (w - FIELD_W * scale) / 2, oy: h - FIELD_H * scale - pad };
}
let VP = calcView();
function startBattle(stage) {
  const eq = computeEquipStats(equippedItems(), gemMap());
  VP = calcView();
  const ownedSlots = SLOTS.filter(sl => save.inv.some(i => i.slot === sl));
  G.b = createBattle({ stage, cleared: save.cleared, equipStats: eq, book: save.book, seed: (Math.random() * 4294967296) >>> 0, ownedSlots, bossPity: save.bossPity || 0 });
  G.canFast = stage <= save.cleared; G.speed = 1; updateSpeedBtn();
  G.paused = false; G.endTimer = 0; G.acc = 0; G.stage = stage; G.shake = 0;
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
  let gemGold = 0;
  for (const g of b.gemDrops) { g.id = 'g' + (save.nextGid++); gemGold += addGem(save, g); }
  save.runes += b.runes;
  save.bestWave[stage] = Math.max(save.bestWave[stage] || 0, b.maxWave);
  save.bossPity = b.bossPity || 0;
  let rating = 0, rw = null;
  if (kind === 'won') { rating = clearRating(b.wall, b.wallMax); rw = applyClearRewards(save, stage, rating); }
  writeSave();
  G.lastResult = { kind, stage, gold, b, newItems, soldGold, soldN, rating, rw, gemGold, autoEquipped };
  renderResult(); show('result');
  Sfx.play(kind === 'won' ? 'win' : 'lose');
  G.b = null;
}
function statsHtml(b) {
  const by = b.dmgBy || {}, ids = SPELL_IDS.filter(id => by[id] > 0).sort((x, y) => by[y] - by[x]);
  const mx = ids.length ? by[ids[0]] : 1;
  const rows = ids.map(id => `<div class="dr"><span class="nm">${esc(SPELLS[id].name)}</span><span class="bar-d"><i style="width:${Math.max(2, Math.round(by[id] / mx * 100))}%;--c:${SPELLS[id].color}"></i></span><span class="v">${fmt(by[id])}</span></div>`).join('');
  const rb = b.reachBy || {}, rk = Object.keys(rb).sort((x, y) => rb[y] - rb[x]);
  const reach = rk.length ? `城壁に最も接近を許した敵：<b>${esc(ENEMIES[rk[0]].name)}</b>（${rb[rk[0]]}体）` : '城壁に届いた敵：なし';
  const syn = Array.from(b.syn).map(id => SYNERGIES[id].name);
  return `<div class="loot-h">魔法別の与ダメージ</div><div class="dmg-rows">${rows || '<div class="dr">記録なし</div>'}<div class="dr" style="margin-top:4px">${reach}</div>${syn.length ? `<div class="dr">発動した複合：${esc(syn.join('・'))}</div>` : ''}</div>`;
}
function renderResult() {
  const r = G.lastResult, b = r.b, si = stageInfo(r.stage);
  const head = r.kind === 'won' ? ['討伐成功', 'win', `${si.boss} を討ち取った`] : r.kind === 'retreat' ? ['撤退', 'lose', '戦利品は持ち帰った'] : ['城壁、崩れる', 'lose', '倒れても、集めたものは残る'];
  const loot = r.newItems.map(n => {
    const it = n.item, R = RARITIES[it.rarity], bs = itemStatList(it)[0];
    return `<div class="loot" style="--rc:${R.color}"><div><span class="nm">${esc(it.name)}</span><span class="badge">NEW</span>${n.upgrade ? '<span class="badge up">強化候補</span>' : ''}${n.gone ? '<span class="badge" style="background:#777">自動売却</span>' : ''}<div class="sc">${SLOT_NAME[it.slot]} ・ ${R.name} ・ 石${socketCount(it)} ・ ${esc(fmtStat(bs.key, bs.v))}</div></div><span class="sc">★${itemScore(it)}</span></div>`;
  }).join('');
  const gl = gemGroups(b.gemDrops).map(gr => `<div class="loot" style="--rc:${gemColor(gr.g)}"><div><span class="nm">${esc(GEM_RARITIES[gr.g.rarity].name)}の${GEM_INFO[gr.g.type].name}石</span>${gr.n > 1 ? ' ×' + gr.n : ''}${gr.g.fx ? '<span class="badge">特殊</span>' : ''}<div class="sc">+${gemValue(gr.g)}${GEM_INFO[gr.g.type].unit}</div></div></div>`).join('');
  const wallPct = Math.round(b.wall / b.wallMax * 100);
  const rw = r.rw;
  const rwLines = [];
  if (b.runes) rwLines.push(`ボス撃破：魔導ルーン +${b.runes}`);
  if (rw) {
    if (rw.firstClear) rwLines.push('初回クリア');
    for (const t of rw.newRatings) rwLines.push(`初達成：${RATING_NAME[t]}`);
    if (rw.runes || rw.gold) rwLines.push(`評価報酬：ルーン +${rw.runes}・ゴールド +${fmt(rw.gold)}`);
  }
  $('result-body').innerHTML = `<h2 class="${head[1]}">${head[0]}</h2><div class="sub">${esc(si.ch.name.replace('　', ' '))} ${si.inChapter}　${esc(head[2])}</div>
    ${r.kind === 'won' ? `<div class="crown-big">${crownHtml(r.rating)}</div>` : ''}
    <div class="res-rows">
      <div><span>城壁の残り</span><b>${wallPct}%（${Math.ceil(b.wall)} / ${Math.round(b.wallMax)}）</b></div>
      <div><span>到達ウェーブ</span><b>第${b.maxWave}波 / ${MAX_WAVE}</b></div>
      <div><span>撃破数</span><b>${fmt(b.kills)}</b></div>
      <div><span>到達レベル</span><b>Lv ${b.player.level}</b></div>
      <div><span>獲得ゴールド</span><b style="color:var(--gold)">+${fmt(r.gold)}${r.soldGold ? '（自動売却 +' + fmt(r.soldGold) + '）' : ''}</b></div>
      <div><span>所持ゴールド／ルーン</span><b>${fmt(save.gold)} ／ ${fmt(save.runes)}</b></div>
    </div>
    ${rwLines.length ? `<p class="sold-note rw">${rwLines.map(esc).join('<br>')}</p>` : ''}
    ${b.roulette ? `<p class="sold-note">ボスのルーレット：${b.roulette.spell ? esc(SPELLS[b.roulette.spell].name) + ' Lv' + b.roulette.from + '→' + b.roulette.to : 'ゴールド +' + b.roulette.gold}</p>` : ''}
    ${statsHtml(b)}
    ${rw && rw.firstClear ? `<p class="sold-note" style="color:var(--gold)">★ ${r.stage < 15 ? '次のステージが解放された。' + (SPELL_IDS.find(id => SPELL_UNLOCK[id] === r.stage) ? '新しい魔法「' + SPELLS[SPELL_IDS.find(id => SPELL_UNLOCK[id] === r.stage)].name + '」を習得！' : '') : '全ステージを制覇した！'}</p>` : ''}
    <div class="loot-h">獲得したジェム ${b.gemDrops.length}個</div>
    <div class="loot-list">${gl || '<div class="sc" style="color:var(--ink-soft);font-size:12px">ジェムは出なかった。エリートとボスは高確率で落とす。</div>'}</div>
    <div class="loot-h">獲得した装備 ${r.newItems.length}個</div>
    <div class="loot-list">${loot || '<div class="sc" style="color:var(--ink-soft);font-size:12px">今回は戦利品なし。エリート（金の輪の敵）とボスは高確率で落とす。</div>'}</div>
    ${r.autoEquipped.length ? `<p class="sold-note" style="color:#2c7a4b">空いていた部位に自動で装備した：${r.autoEquipped.map(i => esc(i.name)).join('、')}</p>` : ''}
    ${r.soldN ? `<p class="sold-note">所持上限(${INV_CAP})を超えたため、古いコモンを ${r.soldN}個 自動売却しました。</p>` : ''}
    <div class="res-btns">
      <div class="row"><button class="btn" data-act="goEquip">装備</button><button class="btn" data-act="goBook">魔法書</button><button class="btn" data-act="retry">もう一度</button></div>
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
  goBook() { Sfx.play('ui'); renderBook(); show('book'); },
  bookUp(id) {
    const r = bookUpgrade(save, id);
    if (!r.ok) { toast(r.error); return; }
    writeSave(); Sfx.play('loot'); renderBook(); toast(`${SPELLS[id].name} の魔法書が Lv${r.lv} になった`, SPELLS[id].color);
  },
  pickStage(n) { n = +n; if (n > save.cleared + 1) return; Sfx.play('ui'); G.selStage = n; renderHome(); },
  sortie() { Sfx.init(); Sfx.play('ui'); startBattle(G.selStage); },
  retry() { Sfx.play('ui'); const s = G.lastResult ? G.lastResult.stage : G.selStage; G.selStage = s; startBattle(s); },
  tab(k) { G.tab = k; renderEquip(); },
  openItem(id) { Sfx.play('ui'); openItem(id); },
  closeItem() { overlay('ov-item', false); G.pick = null; renderEquip(); },
  pickSock(arg) { const [id, i] = String(arg).split(':'); showGemPick(id, +i); },
  putGem(gid) {
    if (!G.pick) return;
    const { itemId, index } = G.pick, r = socketGem(save, itemId, gid, index);
    if (!r.ok) { toast(r.error); return; }
    writeSave(); Sfx.play('loot'); openItem(itemId); renderEquip();
  },
  unsock(arg) {
    const [id, i] = String(arg).split(':'), r = unsocketGem(save, id, +i);
    if (!r.ok) return;
    writeSave(); Sfx.play('ui'); openItem(id); renderEquip();
  },
  mergeOne(arg) {
    const [t, r] = String(arg).split(':'), res = mergeGems(save, t, +r);
    if (!res.ok) { toast(res.error); return; }
    writeSave(); Sfx.play('loot'); renderEquip(); toast('合成：' + gemText(res.gem), gemColor(res.gem));
  },
  mergeAll() {
    const n = mergeAllGems(save);
    if (!n) { toast('合成できるジェムがありません'); return; }
    writeSave(); Sfx.play('loot'); renderEquip(); toast(`${n}回 合成した`);
  },
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
    confirmBox(`このコードのセーブで、現在のデータを上書きします。\n（ゴールド ${fmt(r.save.gold)}・装備 ${r.save.inv.length}個・ジェム ${r.save.gems.length}個・クリア ${r.save.cleared}面）\nよろしいですか？`, '読み込む', () => {
      save = r.save; hasSave = true; writeSave(); G.selStage = Math.min(15, save.cleared + 1);
      renderTitleBtns(); renderHome(); overlay('ov-settings', false); toast('セーブを読み込んだ');
    }, '読み込む');
  },
  resetData() {
    confirmBox('すべてのセーブデータ（装備・ジェム・魔法書・クリア状況）を\n消去します。元には戻せません。\n本当によろしいですか？', '消去する', () => {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無視 */ }
      save = defaultSave(); hasSave = false; G.selStage = 1; overlay('ov-settings', false); overlay('ov-pause', false); G.b = null;
      renderTitleBtns(); show('title'); toast('データを初期化した');
    }, '消去する');
  },
  confirmYes() { const cb = G.pendingConfirm; G.pendingConfirm = null; overlay('ov-confirm', false); if (cb) cb(); },
  confirmNo() { G.pendingConfirm = null; overlay('ov-confirm', false); },
  pause() { if (G.mode !== 'battle' || !G.b || G.b.state !== 'playing') return; G.paused = true; renderTitleBtns(); overlay('ov-pause', true); },
  resume() { G.paused = false; overlay('ov-pause', false); },
  retreat() { confirmBox('撤退しますか？\nここまでのゴールドと装備・ジェムは持ち帰れます。', '撤退する', () => { overlay('ov-pause', false); G.paused = false; if (G.b) finishBattle('retreat'); }); },
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
  const ns = Object.keys(b.spells).length;
  $('lu-slots').innerHTML = `魔法 <b class="${ns >= MAX_SPELLS ? 'full' : ''}">${ns}/${MAX_SPELLS}</b>　複合 <b>${b.syn.size}/${SYN_IDS.length}</b>${ns >= MAX_SPELLS ? '　（魔法枠が満杯：新規は出ません）' : ''}`;
  const rr = $('lu-reroll'); rr.textContent = `引き直す（無料 残り${b.rerolls}回）`; rr.disabled = b.rerolls <= 0;
  $('lu-cards').innerHTML = b.choices.map((c, i) => {
    let icon = '?', name = '', tag = '', lv = '', desc = '', col = '#1d1b19', extra = '', cls = '';
    if (c.kind === 'spell-new' || c.kind === 'spell-up') {
      const S = SPELLS[c.id], cur = b.spells[c.id] ? b.spells[c.id].lv : 0;
      icon = S.icon; name = S.name; col = S.color; tag = (c.kind === 'spell-new' ? '新規魔法' : '魔法強化') + '・' + ELEMS[S.elem].name;
      lv = c.kind === 'spell-new' ? 'Lv 1' : `Lv ${cur} → ${cur + 1}`; desc = S.desc(S.lv[cur]);
    } else if (c.kind === 'option') {
      const S = SPELLS[c.id], o = S.opts.find(x => x.id === c.opt), cur = b.spells[c.id].opt[c.opt] || 0;
      icon = S.icon; name = `${S.name}：${o.name}`; col = S.color; tag = '強化オプション'; cls = ' opt';
      lv = `${cur} → ${cur + 1} 回目（最大${o.max}）`; desc = o.desc; if (o.trade) extra = '<div class="card-trade">⚠ 代償あり（トレードオフ）</div>';
    } else if (c.kind === 'synergy') {
      const Y = SYNERGIES[c.id]; icon = '合'; name = Y.name; col = '#b3402a'; tag = '複合魔法'; cls = ' syn';
      lv = `${SPELLS[Y.a].name} ＋ ${SPELLS[Y.b].name}`; desc = Y.desc;
    } else if (c.kind === 'heal') { icon = '癒'; name = '城壁を修繕'; tag = '頁の余白'; desc = '城壁の最大HPの20%を回復する'; col = '#2c7a4b'; }
    else { icon = '金'; name = '金貨の包み'; tag = '頁の余白'; desc = `ゴールド +${50 * b.stage}`; col = '#b8860b'; }
    return `<button class="card${cls}" style="--cc:${col}" data-act="card" data-arg="${i}"><div class="card-icon">${icon}</div><div><div class="card-tag">${tag}</div><div class="card-name">${esc(name)}</div><div class="card-lv">${esc(lv)}</div><div class="card-desc">${esc(desc)}</div>${extra}</div></button>`;
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
  const mx = MAGE_X - e.x, my = MAGE_Y - e.y, d = Math.hypot(mx, my) || 1, dx = mx / d, dy = my / d;
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
    case 'shield': {
      blob(c, 0, bob - R * 0.1, R * 0.78, R * 0.82, sd, 0.05, 12); inked(c, fill, 2);
      for (const sx of [-1, 1]) eye(c, sx * R * 0.26, -R * 0.35 + bob, R * 0.17, dx, dy);
      c.beginPath(); c.moveTo(-R * 1.0, R * 0.0); c.lineTo(R * 1.0, R * 0.0); c.lineTo(R * 0.82, R * 0.8); c.quadraticCurveTo(0, R * 1.45, -R * 0.82, R * 0.8); c.closePath(); inked(c, '#d9d2c0', 2.6);
      c.beginPath(); c.moveTo(0, R * 0.05); c.lineTo(0, R * 1.15); c.moveTo(-R * 0.85, R * 0.4); c.lineTo(R * 0.85, R * 0.4); inkLine(c, 1.2, INK, 0.5);
      c.beginPath(); c.arc(0, R * 0.4, R * 0.15, 0, TAU); c.fillStyle = '#e3b84a'; c.fill(); inkLine(c, 1.3);
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

/* ---------- 演出管理 ---------- */
const fxList = [], parts = [], nums = [];
const MAX_PARTS = 420, MAX_NUMS = 48;
const SPELL_COL = {}; for (const id of SPELL_IDS) SPELL_COL[id] = SPELLS[id].color;
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
  let nHit = 0;
  for (const e of evs) {
    switch (e.type) {
      case 'hit': {
        if (e.dot) { if (Math.random() < 0.25) splat(e.x, e.y, 1, SPELL_COL[e.spell], 40, 1.6); break; }
        const col = SPELL_COL[e.spell] || INK;
        if (nHit++ < 8) { splat(e.x, e.y, 3, col, 70, 2); addNum(e.x, e.y, String(e.dmg), col, false); }
        if (e.weak > 0 && nHit < 6) addNum(e.x, e.y - 10, '弱点!', '#b8860b', true);
        if (e.weak < 0 && nHit < 6) addNum(e.x, e.y - 10, '耐性', '#8c867a', false);
        if (e.crit) addNum(e.x, e.y - 6, '会心!', GOLD, true);
        if (e.exec) addNum(e.x, e.y - 14, '即死!', VERMILION, true);
        Sfx.play('hit'); break;
      }
      case 'miss': addNum(e.x, e.y, 'すか', '#8c867a', false); break;
      case 'die': {
        splat(e.x, e.y, e.elite ? 22 : e.vanish ? 6 : 10, '#1d1b19', e.elite ? 150 : 110, e.elite ? 3.4 : 2.6);
        if (fxList.length > 160) fxList.shift();
        fxList.push({ k: 'blot', x: e.x, y: e.y, r: e.r * (e.elite ? 2.1 : 1.5), t: 0, life: 1.7, seed: Math.random() * 99 });
        if (e.etype === 'boss') { G.shake = 6; for (let i = 0; i < 40; i++) splat(e.x, e.y, 1, '#b8860b', 240, 4); Sfx.play('boom'); }
        else if (!e.vanish) Sfx.play('pop');
        break;
      }
      case 'bolt': {
        const segs = [], pts = e.pts;
        if (e.chain) {
          segs.push(jagged(MAGE_X + 14, MAGE_Y - 28, pts[0].x, pts[0].y, 8, 22));
        } else segs.push(jagged(pts[0].x + (Math.random() - 0.5) * 30, pts[0].y - 380, pts[0].x, pts[0].y, 7, 34));
        for (let i = 1; i < pts.length; i++) segs.push(jagged(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, 5, 14));
        fxList.push({ k: 'bolt', segs, t: 0, life: 0.3, col: e.chain ? '#2a9d8f' : '#1b8a6b' });
        Sfx.play('zap'); break;
      }
      case 'spark': fxList.push({ k: 'spark', x: e.x, y: e.y, r: e.r, t: 0, life: 0.35 }); break;
      case 'boom': fxList.push({ k: 'boom', x: e.x, y: e.y, r: e.r, col: e.col, t: 0, life: 0.5 }); splat(e.x, e.y, e.big ? 12 : 5, e.col, 170, 3); if (e.big) { G.shake = Math.max(G.shake, 2.5); Sfx.play('boom'); } else Sfx.play('pop'); break;
      case 'freeze': splat(e.x, e.y, 4, SPELL_COL.fstar, 80, 2.2); break;
      case 'storm': fxList.push({ k: 'storm', t: 0, life: 0.7 }); G.shake = Math.max(G.shake, 2); Sfx.play('ice'); break;
      case 'cast': Sfx.play(e.spell === 'beam' ? 'laser' : e.spell === 'icicle' || e.spell === 'fstar' ? 'ice' : e.spell === 'missile' ? 'shot' : ''); break;
      case 'levelup': fxList.push({ k: 'lvring', t: 0, life: 0.9 }); Sfx.play('lvl'); break;
      case 'wallhit': G.shake = Math.max(G.shake, 1.5); Sfx.play('hurt'); break;
      case 'summon': fxList.push({ k: 'summon', x: e.x, y: e.y, t: 0, life: 0.5 }); break;
      case 'wave': showBanner('wave', e.wave); break;
      case 'boss': showBanner('boss', e.name); G.shake = 4; Sfx.play('warn'); break;
      case 'roulette': {
        const r = e.r;
        showBanner('roulette', r.spell ? `${SPELLS[r.spell].name}　Lv${r.from} → Lv${r.to}` : `ゴールド +${r.gold}`);
        Sfx.play('lvl'); break;
      }
      case 'loot': {
        const R = RARITIES[e.item.rarity];
        fxList.push({ k: 'loot', x: e.x, y: e.y, col: R.color, t: 0, life: 0.9 });
        toast(`戦利品：${e.item.name}（${R.name}）`, R.color); Sfx.play('loot'); break;
      }
      case 'gemdrop': toast(`ジェム：${gemText(e.gem)}`, gemColor(e.gem)); fxList.push({ k: 'loot', x: e.x, y: e.y, col: gemColor(e.gem), t: 0, life: 0.9 }); Sfx.play('gem'); break;
      case 'won': G.endTimer = 2.4; break;
      case 'lost': G.endTimer = 1.6; fxList.push({ k: 'lvring', t: 0, life: 1.2, dark: true }); break;
    }
  }
}
let bannerTimer = null;
function showBanner(kind, v) {
  const el = $('banner');
  if (kind === 'wave') {
    el.className = 'banner wave'; el.innerHTML = `<div class="small">WAVE</div><div class="big">第${v}波</div>`; if (v > 1) Sfx.play('wave');
  } else if (kind === 'roulette') {
    el.className = 'banner wave'; el.innerHTML = `<div class="small">ROULETTE ― ボスの褒賞</div><div class="big" style="font-size:24px">${esc(v)}</div>`;
  } else { el.className = 'banner boss'; el.innerHTML = `<div class="band"></div><div class="body"><div class="big">警告</div><div class="small">${esc(v)}　現る</div></div><div class="band"></div>`; }
  void el.offsetWidth; el.classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.add('hidden'), kind === 'boss' ? 3200 : kind === 'roulette' ? 2600 : 1900);
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
function drawFx(c, t) {
  for (const f of fxList) {
    const k = f.t / f.life;
    switch (f.k) {
      case 'bolt': {
        const a = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
        for (const pass of [[8, 0.9, INK], [4.6, 1, f.col], [1.5, 1, '#e9f3d8']]) {
          c.lineWidth = pass[0]; c.globalAlpha = pass[1] * a * (Math.random() < 0.15 ? 0.5 : 1); c.strokeStyle = pass[2]; c.lineJoin = 'round'; c.lineCap = 'round';
          for (const s of f.segs) { c.beginPath(); c.moveTo(s[0], s[1]); for (let i = 2; i < s.length; i += 2) c.lineTo(s[i], s[i + 1]); c.stroke(); }
        }
        c.globalAlpha = 1; break;
      }
      case 'boom': {
        const r = f.r * (0.4 + 0.75 * Math.sqrt(k)), col = f.col || '#c8321e';
        c.globalAlpha = 0.45 * (1 - k); c.fillStyle = col; c.beginPath(); c.arc(f.x, f.y, r, 0, TAU); c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.arc(f.x, f.y, r * 0.95, 0, TAU); inkLine(c, 3 * (1 - k) + 0.5, INK, 0.7 * (1 - k)); break;
      }
      case 'blot': {
        const r = f.r * (0.55 + Math.min(1, k * 4) * 0.45);
        blob(c, f.x, f.y, r, r * 0.8, f.seed, 0.25, 9); c.fillStyle = INK; c.globalAlpha = 0.3 * Math.pow(1 - k, 1.6); c.fill();
        blob(c, f.x + r * 0.5, f.y + r * 0.2, r * 0.3, r * 0.25, f.seed + 5, 0.3, 7); c.globalAlpha = 0.22 * Math.pow(1 - k, 1.6); c.fill(); c.globalAlpha = 1; break;
      }
      case 'lvring': {
        const r = 20 + k * 150, col = f.dark ? '#b3402a' : '#d9a02a';
        c.save(); c.translate(MAGE_X, MAGE_Y); c.scale(1, 0.55);
        c.beginPath(); c.arc(0, 0, r, 0, TAU); inkLine(c, 5 * (1 - k) + 1, col, 0.9 * (1 - k));
        c.beginPath(); c.arc(0, 0, r * 0.82, 0, TAU); c.setLineDash([6, 8]); inkLine(c, 2, INK, 0.6 * (1 - k)); c.setLineDash([]);
        c.restore(); break;
      }
      case 'spark': { c.beginPath(); c.arc(f.x, f.y, f.r * (0.5 + k * 0.6), 0, TAU); c.fillStyle = `rgba(27,138,107,${0.3 * (1 - k)})`; c.fill(); inkLine(c, 2.4 * (1 - k) + 0.6, INK, 0.8 * (1 - k)); break; }
      case 'storm': {
        c.globalAlpha = 0.55 * (1 - k);
        for (let i = 0; i < 14; i++) {
          const y = FIELD_H * ((i * 0.37 + k * 0.5) % 1), x0 = (hash(i * 3.1) * FIELD_W * 1.4) - 60 + k * 160;
          c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo(x0 + 50, y - 14, x0 + 110, y + 4); inkLine(c, 2, '#4f8a6a', 0.8);
        }
        c.globalAlpha = 1; break;
      }
      case 'summon': c.beginPath(); c.arc(f.x, f.y, 10 + k * 34, 0, TAU); inkLine(c, 2, '#9a3fd0', 0.8 * (1 - k)); break;
      case 'loot': {
        const px = f.x + (MAGE_X - f.x) * Math.min(1, k * 1.6), py = f.y + (MAGE_Y - f.y) * Math.min(1, k * 1.6) - Math.sin(k * Math.PI) * 30;
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
function drawWall(c, b, t) {
  const y0 = WALL_Y, frac = b.wall / b.wallMax, flash = b.wallFlash > 0 ? Math.min(1, b.wallFlash * 4) : 0;
  // 地面（城壁の内側）
  c.fillStyle = 'rgba(29,27,25,0.05)'; c.fillRect(-40, y0, FIELD_W + 80, FIELD_H - y0 + 40);
  // 石積み
  for (let row = 0; row < 2; row++) {
    const y = y0 + row * 14;
    for (let i = -1; i < 12; i++) {
      const x = i * 32 + (row ? 16 : 0);
      c.beginPath(); c.rect(x, y, 32, 14); c.fillStyle = flash > 0 ? `rgba(220,120,90,${0.35 + flash * 0.4})` : (hash(i * 7 + row * 3) < 0.5 ? '#e4dccb' : '#ece5d4'); c.fill(); inkLine(c, 1.6, INK, 0.9);
    }
  }
  for (let i = 0; i < 12; i++) {   // 銃眼
    const x = i * 30 + 6; c.beginPath(); c.rect(x, y0 - 10, 18, 10); c.fillStyle = '#e4dccb'; c.fill(); inkLine(c, 1.6, INK, 0.9);
  }
  const cracks = Math.floor((1 - frac) * 14);
  for (let i = 0; i < cracks; i++) {   // 城壁が傷むほどヒビが増える
    const x = 10 + hash(i * 5.3) * (FIELD_W - 20), y = y0 + hash(i * 2.1) * 10;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 6, y + 8); c.lineTo(x - 2, y + 14); c.lineTo(x + 4, y + 22); inkLine(c, 1.6, '#b3402a', 0.85);
  }
  c.beginPath(); c.moveTo(-40, y0 + 28); c.lineTo(FIELD_W + 40, y0 + 28); inkLine(c, 3, INK, 0.9);
}
function drawBattle(t) {
  const b = G.b, { w, h, scale, ox, oy } = VP, d = cv.dpr, ci = stageInfo(G.stage).chapter;
  drawPaper(w, h, ci);
  const sh = G.shake > 0.3 ? G.shake : 0, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  cx.setTransform(d * scale, 0, 0, d * scale, (ox + sx) * d, (oy + sy) * d);
  cx.save(); cx.beginPath(); cx.rect(-60, -oy / scale - 4, FIELD_W + 120, FIELD_H + oy / scale + 40); cx.clip();
  for (let i = 0; i < 7; i++) { const x = hash(i * 3.3 + ci) * FIELD_W, y = hash(i * 7.7 + ci) * 500, r = 60 + hash(i) * 70; const g = cx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(29,27,25,0.05)'); g.addColorStop(1, 'rgba(29,27,25,0)'); cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2); }
  // 魔法陣（魔法使いの足元）
  cx.save(); cx.translate(MAGE_X, MAGE_Y + 12); cx.scale(1, 0.4); cx.rotate(t * 0.05);
  for (const [r, ww, a] of [[70, 1.2, 0.25], [48, 1, 0.2]]) { cx.beginPath(); cx.arc(0, 0, r, 0, TAU); inkLine(cx, ww, INK, a); }
  cx.restore();
  // 地面系の魔法
  for (const z of b.zones) {
    const a = Math.min(1, z.t / 0.4) * Math.min(1, (z.dur - z.t) / 0.5 + 0.2);
    if (z.kind === 'web') {
      cx.beginPath(); cx.arc(z.x, z.y, z.r, 0, TAU); cx.fillStyle = `rgba(42,157,143,${0.1 * a})`; cx.fill(); cx.setLineDash([6, 5]); inkLine(cx, 1.6, '#2a9d8f', 0.8 * a); cx.setLineDash([]);
      for (let i = 0; i < 8; i++) { const an = i / 8 * TAU; cx.beginPath(); cx.moveTo(z.x, z.y); cx.lineTo(z.x + Math.cos(an) * z.r, z.y + Math.sin(an) * z.r); inkLine(cx, 0.9, '#2a9d8f', 0.5 * a); }
      for (const f of [0.35, 0.7]) { cx.beginPath(); cx.arc(z.x, z.y, z.r * f, 0, TAU); inkLine(cx, 0.9, '#2a9d8f', 0.45 * a); }
    } else if (z.kind === 'burn') {
      cx.beginPath(); cx.arc(z.x, z.y, z.r, 0, TAU); cx.fillStyle = `rgba(200,50,30,${0.16 * a})`; cx.fill(); cx.setLineDash([5, 5]); inkLine(cx, 1.6, VERMILION, 0.8 * a); cx.setLineDash([]);
      for (let i = 0; i < 5; i++) { const an = i * 1.9 + z.x, rr = z.r * 0.6 * hash(z.y + i), fx = z.x + Math.cos(an) * rr, fy = z.y + Math.sin(an) * rr * 0.7, fh = 6 + 5 * Math.abs(Math.sin(t * 6 + i)); cx.beginPath(); cx.moveTo(fx - 4, fy); cx.quadraticCurveTo(fx, fy - fh * 1.4, fx + 4, fy); cx.closePath(); cx.fillStyle = '#d98a1f'; cx.globalAlpha = a; cx.fill(); inkLine(cx, 1.3); cx.globalAlpha = 1; }
    }
  }
  for (const m of b.metes) {   // 隕石の予告
    if (m.t < 0) continue;
    const k = m.t / m.delay;
    cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, TAU); cx.fillStyle = `rgba(214,64,42,${0.05 + 0.12 * k})`; cx.fill(); cx.setLineDash([6, 5]); inkLine(cx, 1.8, '#d6402a', 0.8); cx.setLineDash([]);
    cx.beginPath(); cx.arc(m.x, m.y, m.r * k, 0, TAU); inkLine(cx, 1.2, '#d6402a', 0.6);
    const fy = m.y - (1 - k) * 420, fx = m.x - (1 - k) * 160;
    cx.beginPath(); cx.moveTo(fx + 40, fy - 90); cx.lineTo(fx, fy); inkLine(cx, 9, 'rgba(214,64,42,0.35)'); cx.beginPath(); cx.moveTo(fx + 40, fy - 90); cx.lineTo(fx, fy); inkLine(cx, 3, '#e8803a', 0.8);
    blob(cx, fx, fy, 13, 12, 7 + Math.floor(t * 10), 0.18, 9); cx.fillStyle = '#3b2b25'; cx.fill(); inkLine(cx, 2);
  }
  for (const p of b.pulses) {   // 波動光
    if (p.y > WALL_Y + 20) continue;
    cx.beginPath(); cx.moveTo(-10, p.y + 14); cx.quadraticCurveTo(FIELD_W / 2, p.y - 18, FIELD_W + 10, p.y + 14); inkLine(cx, 9, 'rgba(154,79,208,0.35)'); cx.beginPath(); cx.moveTo(-10, p.y + 14); cx.quadraticCurveTo(FIELD_W / 2, p.y - 18, FIELD_W + 10, p.y + 14); inkLine(cx, 3, '#9a4fd0', 0.95);
  }
  for (const l of b.logs) {   // 轢丸太
    cx.save(); cx.translate(l.x, l.y); cx.beginPath(); cx.rect(-l.w / 2, -14, l.w, 28); cx.fillStyle = '#b08a5c'; cx.fill(); inkLine(cx, 2.2);
    for (let i = 0; i < 4; i++) { const yy = -10 + ((t * 40 + i * 9) % 28); cx.beginPath(); cx.moveTo(-l.w / 2 + 3, yy); cx.lineTo(l.w / 2 - 3, yy); inkLine(cx, 1, INK, 0.45); }
    cx.beginPath(); cx.ellipse(0, -14, l.w / 2, 6, 0, 0, TAU); cx.fillStyle = '#d2b07e'; cx.fill(); inkLine(cx, 1.8); cx.restore();
  }
  drawWall(cx, b, t);
  // 敵（y順）
  const list = b.enemies.slice().sort((a, bb) => a.y - bb.y);
  for (const e of list) drawEnemy(cx, e, t, ci);
  // 魔法使い（城壁の後ろ）
  cx.save(); cx.translate(MAGE_X, MAGE_Y); drawPlayer(cx, t, 0, b); cx.restore();
  for (const c of b.cols) {   // 氷柱
    cx.beginPath(); cx.moveTo(c.x - 7, c.y + 24); cx.lineTo(c.x, c.y - 8); cx.lineTo(c.x + 7, c.y + 24); cx.closePath(); cx.fillStyle = 'rgba(160,210,245,0.9)'; cx.fill(); inkLine(cx, 1.8, INK, 0.85);
    cx.beginPath(); cx.moveTo(c.x - 2, c.y + 20); cx.lineTo(c.x, c.y); inkLine(cx, 1, '#fff', 0.9);
  }
  for (const l of b.lobs) {   // 火玉（放物線）
    if (l.t < 0) continue;
    const k = l.t / l.T, x = l.sx + (l.tx - l.sx) * k, y = l.sy + (l.ty - l.sy) * k - Math.sin(k * Math.PI) * 150;
    cx.beginPath(); cx.arc(x, y, 8, 0, TAU); cx.fillStyle = '#e8803a'; cx.fill(); inkLine(cx, 2.2); cx.beginPath(); cx.arc(x - 1.5, y - 2, 3, 0, TAU); cx.fillStyle = '#ffe9a8'; cx.fill();
    cx.beginPath(); cx.arc(l.tx, l.ty, l.r * k * 0.9, 0, TAU); cx.setLineDash([4, 4]); inkLine(cx, 1.2, '#d6402a', 0.5); cx.setLineDash([]);
  }
  for (const p of b.projs) {
    if (p.kind === 'missile') {
      cx.beginPath(); cx.moveTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); cx.lineTo(p.x, p.y); inkLine(cx, 4, '#2d4a9c', 0.5);
      cx.beginPath(); cx.arc(p.x, p.y, 5, 0, TAU); cx.fillStyle = '#3d5fc4'; cx.fill(); inkLine(cx, 1.8);
      cx.beginPath(); cx.arc(p.x - 1, p.y - 1, 1.6, 0, TAU); cx.fillStyle = '#fff'; cx.fill();
    } else {
      cx.save(); cx.translate(p.x, p.y); cx.rotate(Math.atan2(p.vy, p.vx)); cx.beginPath(); cx.moveTo(7, 0); cx.lineTo(-4, -3.4); cx.lineTo(-2, 0); cx.lineTo(-4, 3.4); cx.closePath(); cx.fillStyle = '#bfe3f7'; cx.fill(); inkLine(cx, 1.4); cx.restore();
    }
  }
  if (b.beam && b.beam.ex != null) {   // 集束光
    const m = b.beam, fl = 0.85 + Math.random() * 0.15, a = Math.max(0, Math.min(1, m.t / 0.12, (m.dur - m.t) / 0.2));
    for (const [wm, al, col] of [[1.9, 0.95, INK], [1.2, 1, '#7a2fb0'], [0.35, 1, '#f1e6fa']]) {
      cx.beginPath(); cx.moveTo(m.ax, m.ay); cx.lineTo(m.ex, m.ey); cx.lineWidth = m.w * wm * fl; cx.globalAlpha = al * a; cx.strokeStyle = col; cx.lineCap = 'round'; cx.stroke();
    }
    cx.globalAlpha = 1;
  }
  drawFx(cx, t);
  drawParts(cx);
  drawNums(cx);
  cx.restore();
  drawOverlayFrame(cx, w, h);
  if (b.wallFlash > 0) {
    cx.setTransform(1, 0, 0, 1, 0, 0);
    const g = cx.createLinearGradient(0, cv.height, 0, cv.height * 0.6); g.addColorStop(0, `rgba(179,64,42,${Math.min(0.4, b.wallFlash * 1.6)})`); g.addColorStop(1, 'rgba(179,64,42,0)'); cx.fillStyle = g; cx.fillRect(0, 0, cv.width, cv.height);
  }
}
const hudEl = { hp: $('hp-fill'), hpt: $('hp-text'), lv: $('lv-text'), xp: $('xp-fill'), wave: $('wave-text'), time: $('time-text'), gold: $('gold-text'), loot: $('loot-text'), spell: $('spell-text'), boss: $('boss-bar'), bn: $('boss-name'), bf: $('boss-fill') };
function updateHud(b) {
  const p = b.player;
  hudEl.hp.style.transform = `scaleX(${clamp(b.wall / b.wallMax, 0, 1).toFixed(3)})`;
  setText(hudEl.hpt, `城壁 ${Math.ceil(b.wall)} / ${Math.round(b.wallMax)}`);
  setText(hudEl.lv, 'Lv ' + p.level);
  hudEl.xp.style.transform = `scaleX(${clamp(p.xp / xpNeeded(p.level), 0, 1).toFixed(3)})`;
  setText(hudEl.wave, `第${b.wave}波 / ${MAX_WAVE}` + (b.wave === MAX_WAVE ? ' ボス' : b.inGap ? ' 休止' : b.spawning ? '' : ' 掃討中'));
  const s = Math.floor(b.time); setText(hudEl.time, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  setText(hudEl.gold, '金 ' + fmt(b.goldF));
  setText(hudEl.loot, `戦利品 ${b.drops.length}・石 ${b.gemDrops.length}`);
  setText(hudEl.spell, `魔法 ${Object.keys(b.spells).length}/${MAX_SPELLS}`);
  const bs = b.enemies.find(e => e.boss);
  if (bs && b.state !== 'won') { hudEl.boss.classList.remove('hidden'); setText(hudEl.bn, bs.name || 'ボス'); hudEl.bf.style.transform = `scaleX(${clamp(bs.hp / bs.maxHp, 0, 1).toFixed(3)})`; }
  else hudEl.boss.classList.add('hidden');
}

/* ---------- タイトル／ホーム背景（墨絵ドゥードル） ---------- */
const doodles = [];
function initDoodles() {
  const types = ['slimy', 'dash', 'golem', 'splitter', 'bones', 'ghost', 'shield', 'dash'];
  const rnd = mulberry32(42);
  types.forEach((ty, i) => doodles.push({ type: ty, x: rnd() * innerWidth, y: innerHeight * (0.18 + 0.7 * rnd()), vx: (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 14), r: ENEMIES[ty].r * (1.3 + rnd() * 0.5), seed: rnd(), ph: rnd() * 6 }));
}
function drawTitleBg(t, dt) {
  const w = innerWidth, h = innerHeight, d = cv.dpr, ci = G.mode === 'home' || G.mode === 'equip' || G.mode === 'book' ? Math.min(2, Math.floor((G.selStage - 1) / 5)) : 0;
  drawPaper(w, h, ci);
  cx.setTransform(d, 0, 0, d, 0, 0);
  cx.globalAlpha = G.mode === 'title' ? 1 : 0.28;
  for (const o of doodles) {
    o.x += o.vx * dt; if (o.x < -60) o.x = w + 60; if (o.x > w + 60) o.x = -60;
    const e = { x: 0, y: 0, r: o.r, type: o.type, seed: o.seed, flash: 0, slowAmt: 0, frozenT: 0, translucent: Math.sin(t + o.ph) > 0.4, summonT: 9, stopped: false, elite: false, hp: 1, maxHp: 1 };
    cx.save(); cx.translate(o.x, o.y + Math.sin(t * 1.3 + o.ph) * 6); cx.scale(o.vx < 0 ? 1 : -1, 1);
    drawEnemy(cx, e, t, 0);
    cx.restore();
  }
  cx.globalAlpha = 1;
  if (G.mode === 'title') {
    for (let i = 0; i < 6; i++) { const a = t * 0.4 + i * 1.05; const x = w / 2 + Math.cos(a * 1.3) * w * 0.38, y = h * 0.5 + Math.sin(a) * h * 0.3; cx.beginPath(); cx.arc(x, y, 2.2, 0, TAU); cx.fillStyle = Object.values(SPELL_COL)[i]; cx.globalAlpha = 0.55; cx.fill(); }
    cx.globalAlpha = 1;
  }
  drawOverlayFrame(cx, w, h);
}

/* ---------- メインループ ---------- */
let lastTs = 0, timeAcc = 0, lastDraw = 0, skipDt = 0;
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
window.__MH = { ACT, G, get save() { return save; }, startBattle, finishBattle, renderHome, renderEquip, renderBook, openItem, handleEvents, drawBattle, frame };
})();
