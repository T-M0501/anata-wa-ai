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
  if (lv <= 2) Object.keys(cs).forEach(id => ok(G.SCENES[id].kana, `Lv${lv} はひらがなの場面だけ: ${id}`));
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
// 最初から遊べるレベルの設定
ok(/var FREE_LEVELS = 7;/.test(uiSrc), '最初から遊べるレベルの設定がある（Lv7）');

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
      if (lv <= 2) ok(!KANJI.test(s.replace(WEEKDAY, '')), `${tag} Lv${lv}の指示書に漢字なし: ${s}`);
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
        // 文字のレベル：Lv4〜は漢字まじり、Lv6〜は長いひらがなの続きがない
        if (lv >= 4) {
          const u = G.userById(sess.user);
          if (u.age !== 'child') ok(KANJI.test(q.msg), `${tag} Lv4〜のユーザーのメッセージに漢字: ${q.msg}`);
          q.cands.forEach(c => ok(KANJI.test(c.text), `${tag} Lv4〜の返事に漢字: ${c.text}`));
        }
        if (lv >= 3) ok(!/^[ぁ-んー\s、。！？〜🎵✨💦😢😭]+$/.test(q.msg), `${tag} Lv3〜のメッセージがひらがなだけでない: ${q.msg}`);
        if (lv >= 6) q.cands.forEach(c => ok(!/[ぁ-ん]{15,}/.test(c.text.replace(/\s/g, '')), `${tag} Lv6〜の返事に長いひらがなの続きがない: ${c.text}`));
        if (sess.kana) [q.msg].concat(q.cands.map(c => c.text)).forEach(s => ok(lv > 2 || !KANJI.test(s.replace(WEEKDAY, '')), `${tag} Lv1〜2の文に漢字なし: ${s}`));
        ok(!/[{}|]|undefined|NaN|null/.test(q.msg + q.cands.map(c => c.text).join('')), `${tag} 表示の文がきれい`);
        prevMemo = q.memo;
      });
      if (lv <= 2) {
        const c = sess.ctx;
        [].concat(c.info ? c.info.flat() : [], c.table ? c.table.cols.concat(c.table.rows.flat()) : [], c.log ? c.log.flat() : [], c.list ? c.list.rows.flat() : [], c.profile ? c.profile.flat() : [], c.past || [])
          .forEach(s => ok(!KANJI.test(String(s).replace(WEEKDAY, '')), `${tag} Lv1〜2の参照情報に漢字なし: ${s}`));
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
