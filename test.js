// あなたはAIです — ロジックのテスト
// 使いかた: node test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(id) {
  const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error('script#' + id + ' not found');
  return m[1];
}
const logicSrc = extract('logic');
const uiSrc = extract('ui');

let fails = 0, checks = 0;
const ngCount = {};
function ok(cond, msg) { checks++; if (!cond) { fails++; const k = msg.replace(/[:：].*$/, ''); ngCount[k] = (ngCount[k] || 0) + 1; if (fails < 40) console.error('  NG: ' + msg); } }

// 1. 構文チェックと外部リソース
for (const [name, src] of [['logic', logicSrc], ['ui', uiSrc]]) {
  try { new vm.Script(src, { filename: name + '.js' }); console.log('構文OK: script#' + name); }
  catch (e) { fails++; console.error('構文エラー: ' + name, e.message); }
}
ok(!/(src|href)\s*=\s*["']https?:/i.test(html), '外部URLを読み込んでいない');
ok(!/@import|url\(\s*["']?https?:/i.test(html), 'CSSで外部URLを使っていない');

// 2. ロジック読み込み
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(logicSrc, ctx);
const G = ctx.module.exports;
const T = G.T;
const KANJI = /[一-鿿]/, WEEKDAY = /[月火水木金土日曜]/g;
// Lv1〜3（小学校低学年）：使ってよい漢字は1年生の漢字だけ（曜日の「曜」も可）
const GRADE1 = '一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六曜';
function kidsKanjiOk(s) { return [...String(s)].every(ch => !KANJI.test(ch) || GRADE1.includes(ch)); }
// Lv1〜3 で使わない むずかしい ことば（やさしいことば変換表で 言いかえたもの）
const HARD_WORDS = /ようてん|要点|たんたん|淡々|しんみ|親身|さんしょう|参照|がいとう|該当|きそく|規則|ゆうせん|優先|かくにん|確認|かいとう|回答|といあわせ|問い合わせ|プロフィール|りれき|履歴|こうもく|項目|ばくぜん|かいしゃく|解釈|ていきょう|しゅうりょう|終了/;
function kidsText(s, tag) { ok(kidsKanjiOk(s), `${tag} 1年生の漢字だけ: ${s}`); ok(!HARD_WORDS.test(s), `${tag} むずかしい ことばを使わない: ${s}`); }

// 独立して書いた判定：項目ごとに上から見て、最初に当てはまったルール
function myEval(m, it) {
  const sc = G.SCENES[m.scene], vals = {}, hits = [];
  for (const sid of m.slots) {
    let found = null;
    m.rules.forEach((r, i) => { if (!found && r.slot === sid && r.conds.every(c => it[c.k] === c.v)) found = { slot: sid, index: i, val: r.out }; });
    if (!found) return null;
    vals[sid] = found.val; hits.push(found);
  }
  for (const d of sc.defaults) if (!m.slots.includes(d.slot)) { if (!d.conds.every(c => it[c.k] === c.v)) return null; vals[d.slot] = d.out; }
  return { vals, hits };
}

// 3. 機嫌メーターの設定どおりに動くか
for (const c of G.LEVELS) {
  const s = c.mood, lv = c.lv;
  ok(G.moodStep(s.max, 'perfect', lv) === s.max, `Lv${lv} 機嫌は最大より上がらない`);
  ok(G.moodStep(1, 'perfect', lv) === Math.min(s.max, 1 + s.perfect), `Lv${lv} 正解で +${s.perfect}`);
  ok(G.moodStep(s.max, 'tone', lv) === s.max - s.tone, `Lv${lv} 言い方ミスで -${s.tone}`);
  ok(G.moodStep(s.max, 'askBad', lv) === s.max - s.ask, `Lv${lv} 下手な聞き返しで -${s.ask}`);
  ok(G.moodStep(s.max, 'content', lv) === s.max - s.content, `Lv${lv} 内容ミスで -${s.content}`);
  ok(G.moodStep(1, 'content', lv) === 0, `Lv${lv} 0 より下がらない`);
  ok(s.content >= s.tone, `Lv${lv} 内容ミスのほうが重い`);
}
for (let lv = 2; lv <= 10; lv++) {
  ok(G.L(lv).counts >= G.L(lv - 1).counts, `Lv${lv} ルール数はレベルとともに増える`);
  ok(G.L(lv).mood.max <= G.L(lv - 1).mood.max, `Lv${lv} 機嫌の余裕はレベルとともに少なくなる`);
}

// 4. 上司・取引先のような「AIに合わないルール」がない
Object.keys(G.SCENES).forEach(id => {
  const sc = G.SCENES[id];
  ok(!sc.lib.concat(sc.defaults).some(r => r.conds.some(c => c.k === 'boss')), `${id} 上司ルールがない`);
  for (let lv = sc.minLv; lv <= 10; lv++) G.getManual(id, lv).rules.forEach(r => { const p = G.ruleParts(id, r, true); ok(!/上司|取引先/.test(p.cond + p.out), `${id} Lv${lv} 上司・取引先の言葉がない: ${p.cond}`); });
});

// 5. ユーザーと場面がかたよらない
const rngPick = G.seededRng('pick-test');
for (let lv = 1; lv <= 10; lv++) {
  const cu = {}, cs = {}, N = 3000;
  for (let i = 0; i < N; i++) { const st = G.pickStage(lv, rngPick); cu[st.user] = (cu[st.user] || 0) + 1; cs[st.scene] = (cs[st.scene] || 0) + 1; }
  const maxU = Math.max(...Object.values(cu)) / N;
  ok(maxU <= 0.2, `Lv${lv} どのユーザーも20%以下 (最大 ${(maxU * 100).toFixed(0)}%)`);
  ok(Object.keys(cu).length >= 6, `Lv${lv} ユーザーは6人以上`);
  ok(Object.keys(cs).length >= 8, `Lv${lv} 場面は8つ以上 (${Object.keys(cs).length})`);
  if (lv <= 3) Object.keys(cs).forEach(id => ok(G.SCENES[id].kana, `Lv${lv} はひらがなの場面だけ: ${id}`));
}
const genders = new Set(G.USERS.map(u => u.age)), styles = {};
G.USERS.forEach(u => { styles[u.style] = styles[u.style] || new Set(); styles[u.style].add(u.age); });
ok(G.USERS.length >= 10 && genders.size >= 4, 'いろいろな年代のユーザーが10人以上');
Object.keys(styles).forEach(st => ok(styles[st].size >= 2, `話し方「${st}」は2つ以上の年代にいる`));
ok(Object.keys(G.SCENES).length >= 10, '場面は10以上');

// 5-2. Lv1 のバリエーション：100回はじめたときの「さいしょのメッセージ」が30種類以上
{
  const r1 = G.seededRng('opening-test'), open = new Set();
  for (let i = 0; i < 100; i++) { const st = G.pickStage(1, r1); open.add(G.makeSession(st.scene, 1, r1, st.user).qs[0].msg); }
  ok(open.size >= 30, `Lv1 の最初のメッセージが100回中30種類以上 (${open.size})`);
}
// 話し方：どのレベルでも全タイプが出て、どれも30%以下
{
  const r2 = G.seededRng('style-test');
  for (let lv = 1; lv <= 10; lv++) {
    const c = {}; for (let i = 0; i < 600; i++) { const st = G.pickStage(lv, r2); const s = G.userById(st.user).style; c[s] = (c[s] || 0) + 1; }
    Object.keys(G.STYLE_NAME).forEach(s => ok(c[s] > 0, `Lv${lv} 話し方「${s}」が出る`));
    const mx = Math.max(...Object.values(c)) / 600; ok(mx <= 0.3, `Lv${lv} どの話し方も30%以下 (${(mx * 100).toFixed(0)}%)`);
  }
  // イライラさんは最初から機嫌が低く、言い方ミスで多く下がる
  for (let lv = 1; lv <= 10; lv++) {
    ok(G.moodStart(lv, 'iraira') < G.L(lv).mood.max || G.L(lv).mood.max === 1, `Lv${lv} イライラさんは機嫌が低くスタート`);
    ok(G.moodStart(lv, 'zakkuri') === G.L(lv).mood.max, `Lv${lv} ふつうの人は最大からスタート`);
    ok(G.moodStep(5, 'tone', lv, 'iraira') === Math.max(0, 5 - G.L(lv).mood.tone - G.STYLE_MOOD.iraira.tone), `Lv${lv} イライラさんの言い方ミス`);
  }
}
// 画面のことば（ひらがな版）にも むずかしい ことばがない
{
  const kanaUI = [];
  (uiSrc.match(/U\('([^']*)'/g) || []).forEach(x => kanaUI.push(x.slice(3, -1)));
  (uiSrc.match(/T\('\{([^|]*)\|/g) || []).forEach(x => kanaUI.push(x.slice(4, -1)));
  (uiSrc.match(/\b(?:k|fk|ik): \[[^\]]*\]/g) || []).forEach(x => kanaUI.push(x));
  (uiSrc.match(/k: '[^']*'/g) || []).forEach(x => kanaUI.push(x));
  kanaUI.forEach(t => kidsText(t, '画面のことば（かな）'));
  ok(G.L(1).fit === '小学校 低学年' && G.L(2).fit === '小学校 低学年' && G.L(3).fit === '小学校 低学年', 'Lv1〜3 は小学校低学年');
  ok(/images\/tutorial\/step1\.webp/.test(uiSrc), 'チュートリアルの画像を使う');
  for (let i = 1; i <= 5; i++) { const f = path.join(__dirname, 'images/tutorial/step' + i + '.webp'); ok(fs.existsSync(f) && fs.statSync(f).size < 150 * 1024, `チュートリアル画像 step${i}.webp（150KB未満）`); }
}
// 最初から遊べるレベルの設定
ok(/var FREE_LEVELS = 7;/.test(uiSrc), '最初から遊べるレベルの設定がある（Lv7）');

// ---------- 時刻・日付の常識チェック（場面ごとに1つ） ----------
function mins(t) { const m = /^(\d+):(\d\d)$/.exec(t); return +m[1] * 60 + +m[2]; }
function dayOffsetOf(today, mo, d) {
  // いちばん近い日（-30日〜+330日の中）を探す。日だけのときは -15〜+20日
  const lo = mo == null ? -15 : -30, hi = mo == null ? 20 : 330;
  for (let i = 0; i <= Math.max(-lo, hi); i++) for (const j of [i, -i]) {
    if (j < lo || j > hi) continue;
    const x = new Date(today.getTime() + j * 86400000);
    if ((mo == null || x.getUTCMonth() + 1 === mo) && x.getUTCDate() === d) return j;
  }
  return null;
}
function datesIn(S, text) {
  const out = [], re = /(\d+)(?:月|がつ ?)(\d+)(?:日|にち)|(?:^|[^\d月つ ])(\d+)(?:日|にち)（/g; let m;
  while ((m = re.exec(text))) out.push(m[1] ? dayOffsetOf(S.today, +m[1], +m[2]) : dayOffsetOf(S.today, null, +m[3]));
  return out;
}
function commonSense(id, S, text, tag) {
  const times = (text.match(/\d+:\d\d/g) || []).map(mins);
  if (id === 'tv') times.forEach(t => ok(t > S.now, `${tag} 常識：もう始まった番組を「これから」と答えない (${text})`));
  if (id === 'bus') times.forEach(t => ok(t > S.now, `${tag} 常識：もう出たバスを答えない (${text})`));
  if (id === 'train' && !/明日/.test(text) && /発/.test(text)) ok(times[0] >= S.now + 10, `${tag} 常識：今から間に合わない電車を答えない (${text})`);
  if (id === 'shop' && /行けます/.test(text)) { const r = S.rows.find(x => text.startsWith(x.name)); ok(r && S.now + r.walk >= r.open && S.now + r.walk < r.close, `${tag} 常識：閉まっている店に「行けます」と言わない`); }
  if (['bday', 'remind', 'hotel', 'gomi'].includes(id)) datesIn(S, text).forEach(o => ok(o !== null && o >= 0, `${tag} 常識：過ぎた日付を「これから」として答えない (${text})`));
}

// 6. 場面 × レベルごとに 300問以上
const QN = 300, rng = G.seededRng('test-run-v7');
const summary = [];
let total = 0;
for (const id of Object.keys(G.SCENES)) {
  const sc = G.SCENES[id];
  let prevCount = 0;
  for (let lv = sc.minLv; lv <= 10; lv++) {
    const tag = `${id}/Lv${lv}`, cfg = G.L(lv), m = G.getManual(id, lv), rules = m.rules;
    const spec = rules.filter(r => !r.def).length;
    ok(spec >= prevCount, `${tag} ルール数が前のレベル以上 (${spec})`); prevCount = spec;
    ok(spec <= cfg.counts, `${tag} ルール数はレベルの上限以内`);
    ok(m.slots.includes('tone'), `${tag} 言い方のルールがある`);
    ok(JSON.stringify(G.getManual(id, lv).rules) === JSON.stringify(rules), `${tag} 同じ指示書（ふたりモード用）`);
    rules.forEach(r => {
      const p = G.ruleParts(id, r, m.kanji), s = p.cond + p.out;
      ok(!/[{}|]|undefined|NaN|null/.test(s), `${tag} 文章がきれい: ${s}`);
      if (lv <= 3) kidsText(s, tag + ' 指示書');
      if (lv >= 4) ok(KANJI.test(s), `${tag} Lv4〜の指示書のルールに漢字: ${s}`);
    });
    m.slots.forEach(sid => ok(!KANJI.test(G.slotTitle(id, sid, m.kanji)) || m.kanji, `${tag} 項目名`));
    const hits = new Array(rules.length).fill(0), users = {};
    let made = 0, asks = 0, follows = 0, needless = 0;
    while (made < QN) {
      const sess = G.makeSession(id, lv, rng);
      users[sess.user] = 1;
      ok(sc.users.includes(sess.user), `${tag} この場面に出られるユーザー`);
      let prevMemo = null;
      ok(new Set(sess.qs.map(q => q.msg)).size === sess.qs.length, `${tag} 1つのチャットに同じメッセージがない`);
      // 会話の流れ：同じ種類の質問はくり返さない（ちがうパラメータで1回だけ、続けてはだめ）
      {
        const ks = sess.qs.map(q => G.kindOf(q)); let rep = 0;
        ks.forEach((k, i) => { if (ks.indexOf(k) < i) rep++; if (i > 0) ok(k !== ks[i - 1], `${tag} 同じ種類の質問が続かない`); });
        ok(rep <= 1, `${tag} 同じ種類の質問のくり返しは1回まで (${rep})`);
        ok(sess.qs.length >= 3, `${tag} チャットは3問以上`);
      }
      // 絵文字と「〜」はゆるふわさんだけ
      {
        const u = G.userById(sess.user), EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;
        if (u.style !== 'yurufuwa') sess.qs.forEach(q => ok(!EMOJI.test(q.msg) && !/〜/.test(q.msg), `${tag} ゆるふわさん以外は絵文字・「〜」なし: ${q.msg}`));
      }
      sess.qs.forEach((q, qi) => {
        made++;
        const it = q.item, mine = myEval(m, it);
        ok(mine && JSON.stringify(mine.vals) === JSON.stringify(q.vals) && JSON.stringify(mine.hits.map(h => h.index)) === JSON.stringify(q.hits.map(h => h.index)), `${tag} 解釈の再計算`);
        mine && mine.hits.forEach(h => hits[h.index]++);
        const okc = q.cands.filter(c => c.ok);
        ok(okc.length === 1 && okc[0].key === q.answer, `${tag} 完全な正解はちょうど1つ`);
        ok(new Set(q.cands.map(c => c.key)).size === q.cands.length && new Set(q.cands.map(c => c.text)).size === q.cands.length, `${tag} 候補はすべてちがう`);
        ok(q.cands.length === 4, `${tag} 候補は4つ`);
        ok(q.cands.some(c => c.toneWrong), `${tag} 言い方だけちがう候補がある`);
        q.cands.forEach(c => ok(G.judge(q, c.key) === (c.ok ? 'perfect' : c.toneWrong ? 'tone' : c.askBad ? 'askBad' : 'content'), `${tag} 判定`));
        const th = Object.create(sc); th.S = sess.S; th.m = m; th.user = G.userById(sess.user);
        const askSlot = m.slots.find(s => q.vals[s] === 'ask');
        if (askSlot) {
          // 参照情報で決められない → 正しい聞き返しだけが正解
          asks++;
          ok(q.askCorrect === askSlot && okc[0].ask, `${tag} 聞き返しが必要なときは聞き返しが正解`);
          ok(q.cands.some(c => c.askBad === 'open'), `${tag} ばくぜんとした聞き返しの候補`);
          ok(q.cands.some(c => c.wrong && c.wrong.why === 'guess'), `${tag} 当てずっぽうの候補`);
          const nx = sess.qs[qi + 1];
          ok(nx && nx.followOf === qi && !nx.askCorrect, `${tag} 聞き返しのあと、ユーザーが答えて次のターンになる`);
          if (nx) { const e2 = myEval(m, nx.item); ok(e2 && !Object.values(e2.vals).includes('ask'), `${tag} ユーザーの答えであいまいさが解ける`); }
        } else {
          ok(!q.cands.some(c => c.ok && c.ask), `${tag} 情報が足りているときは聞き返しは正解でない`);
          q.cands.filter(c => c.askBad).forEach(c => { ok(c.askBad === 'needless', `${tag} いらない聞き返し`); needless++; });
          const right = th.content(q.vals, it, sess.S, prevMemo, q.x);
          ok(right && right.key + '#' + q.vals.tone === q.answer, `${tag} 正解＝データから計算した答え`);
          q.cands.filter(c => c.wrong).forEach(c => {
            const w = c.wrong, outs = sc.lib.concat(sc.defaults).filter(r => r.slot === w.slot).map(r => r.out);
            ok(w.slot !== 'tone' && outs.includes(w.val) && w.val !== q.vals[w.slot], `${tag} 読みちがいは別の読み方: ${w.slot}=${w.val}`);
            const v2 = Object.assign({}, q.vals); v2[w.slot] = w.val;
            const c2 = th.content(v2, it, sess.S, prevMemo, q.x);
            ok(c2 && c2.key === c.content.key && c2.key !== right.key, `${tag} 読みちがいの答えを再計算できる`);
          });
        }
        if (q.followOf != null) follows++;
        // 常識チェック（時刻・日付）：正しい返事が「もう過ぎたもの」を答えていないか
        if (!askSlot) commonSense(id, sess.S, okc[0].content.text, tag);
        // 文字のレベル：Lv4〜は漢字まじり、Lv6〜は長いひらがなの続きがない
        if (lv >= 4) {
          const u = G.userById(sess.user);
          if (u.age !== 'child') ok(KANJI.test(q.msg), `${tag} Lv4〜のユーザーのメッセージに漢字: ${q.msg}`);
          q.cands.forEach(c => ok(KANJI.test(c.text), `${tag} Lv4〜の返事に漢字: ${c.text}`));
        }
        if (lv >= 4) ok(!/^[ぁ-んー\s、。！？〜🎵✨💦😢😭]+$/.test(q.msg), `${tag} Lv4〜のメッセージがひらがなだけでない: ${q.msg}`);
        if (lv >= 6) q.cands.forEach(c => ok(!/[ぁ-ん]{15,}/.test(c.text.replace(/\s/g, '')), `${tag} Lv6〜の返事に長いひらがなの続きがない: ${c.text}`));
        if (lv <= 3) [q.msg, q.pre ? q.pre.join(' ') : ''].concat(q.cands.map(c => c.text)).forEach(t => kidsText(t, tag + ' 文'));
        ok(!/[{}|]|undefined|NaN|null/.test(q.msg + q.cands.map(c => c.text).join('')), `${tag} 表示の文がきれい`);
        ok(!/。。|、、|？？/.test(q.msg + q.cands.map(c => c.text).join('')), `${tag} 句読点が重ならない: ${q.msg}`);
        prevMemo = q.memo;
      });
      if (lv <= 3) {
        const c = sess.ctx;
        [].concat(c.info ? c.info.flat() : [], c.table ? [c.table.cap].concat(c.table.cols, c.table.rows.flat()) : [], c.log ? c.log.flat() : [], c.list ? [c.list.cap].concat(c.list.rows.flat()) : [], c.profile ? c.profile.flat() : [], c.past || [], c.grid ? [c.grid.cap].concat(c.grid.rows.map(r => r[0])) : [])
          .forEach(t => kidsText(String(t), tag + ' わかっていること'));
        m.slots.forEach(sid => kidsText(G.slotTitle(id, sid, m.kanji), tag + ' 見出し'));
      }
    }
    total += made;
    rules.forEach((r, i) => ok(hits[i] > 0, `${tag} ルール${i + 1}（${r.slot}:${r.out}）が使われる`));
    if (rules.some(r => r.out === 'ask')) ok(asks > 0 && follows > 0, `${tag} 聞き返しの問題が出る`);
    summary.push(`${tag}: ルール${rules.length}（とくべつ${spec}）, 出題${made}, 聞き返し${asks}, いらない聞き返し候補${needless}, ユーザー${Object.keys(users).length}人`);
  }
}

// イラスト一覧（問題パターン.md）と、ゲームの中の表がそろっているか
const doc = fs.readFileSync(path.join(__dirname, '問題パターン.md'), 'utf8');
const docFiles = new Set((doc.match(/`[a-z_]+\.png`/g) || []).map(x => x.slice(1, -1)));
const codeFiles = new Set((uiSrc.match(/images\/[a-z_]+\.png/g) || []).map(x => x.slice(7)));
ok(docFiles.size === codeFiles.size && [...docFiles].every(f => codeFiles.has(f)), `イラスト一覧が一致 (md ${docFiles.size} / code ${codeFiles.size})`);
console.log('イラストの数: ' + codeFiles.size);
console.log(summary.join('\n'));
if (fails) console.log(ngCount);
console.log(`\n出題 合計 ${total} 問 / チェック ${checks} こ / NG ${fails} こ`);
process.exit(fails ? 1 : 0);
