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
function ok(cond, msg) { checks++; if (!cond) { fails++; if (fails < 40) console.error('  NG: ' + msg); } }

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

// ---------- テスト側で独立して書いた判定 ----------
// 項目（いつ・どこ・言い方…）ごとに、上から順に見て最初に当てはまったルール
function myEval(m, it) {
  const th = G.THEMES[m.themeId], vals = {}, hits = [];
  for (const sid of m.slots) {
    let found = null;
    m.rules.forEach((r, i) => { if (!found && r.slot === sid && r.conds.every(c => it[c.k] === c.v)) found = { slot: sid, index: i, val: r.out }; });
    if (!found) return null;
    vals[sid] = found.val; hits.push(found);
  }
  for (const d of th.defaults) if (!m.slots.includes(d.slot)) { if (!d.conds.every(c => it[c.k] === c.v)) return null; vals[d.slot] = d.out; }
  return { vals, hits };
}

// 3. 機嫌メーターの設定どおりに動くか
for (const aud of ['kids', 'adults']) for (const d of ['easy', 'normal', 'hard']) {
  const s = G.MOOD[aud][d];
  ok(G.moodStep(s.max, 'perfect', aud, d) === s.max, `${aud}/${d} 機嫌は最大より上がらない`);
  ok(G.moodStep(2, 'perfect', aud, d) === Math.min(s.max, 2 + s.perfect), `${aud}/${d} 正解で +${s.perfect}`);
  ok(G.moodStep(s.max, 'tone', aud, d) === s.max - s.tone, `${aud}/${d} 言い方ミスで -${s.tone}`);
  ok(G.moodStep(s.max, 'content', aud, d) === s.max - s.content, `${aud}/${d} 内容ミスで -${s.content}`);
  ok(G.moodStep(1, 'content', aud, d) === 0, `${aud}/${d} 0 より下がらない`);
  ok(s.content >= s.tone, `${aud}/${d} 内容ミスのほうが重い`);
}
ok(G.MOOD.kids.easy.max >= G.MOOD.kids.hard.max && G.MOOD.kids.easy.content <= G.MOOD.adults.hard.content, 'かんたんほど機嫌に余裕がある');

// 4. ルール数：おとなは同じむずかしさのこどもより多い
for (const d of ['easy', 'normal', 'hard']) for (let i = 0; i < 3; i++) ok(G.LEVELS.adults[d].counts[i] > G.LEVELS.kids[d].counts[i], `おとなの${d}はこどもより ルールが多い (レベル${i + 1})`);

const N = 500;
const rng = G.seededRng('test-run-v4');
const KANJI = /[一-鿿]/;
const summary = [];
let total = 0;

for (const aud of ['kids', 'adults']) for (const diff of ['easy', 'normal', 'hard']) for (const genre of ['pic', 'text', 'table']) for (const t of G.ORDER[aud][genre]) {
  const th = G.THEMES[t], cfg = G.LEVELS[aud][diff];
  ok(th.aud === aud && th.genre === genre, `${t} の分類`);
  let prev = null;
  for (let lv = 1; lv <= 3; lv++) {
    const tag = `${aud}/${diff}/${genre}/${t}/Lv${lv}`;
    const m = G.getManual(t, diff, lv), rules = m.rules;
    const spec = rules.filter(r => !r.def).length;
    ok(spec === cfg.counts[lv - 1], `${tag} とくべつなルールの数 ${spec}`);
    ok(rules.length === spec + m.slots.length, `${tag} 各項目に「ふだんの読み方」が1つずつ`);
    ok(m.slots.includes('tone'), `${tag} 言い方のルールがある`);
    ok(JSON.stringify(G.getManual(t, diff, lv).rules) === JSON.stringify(rules), `${tag} 同じ指示書（ふたりモード用）`);
    rules.forEach(r => {
      const p = G.ruleParts(t, r, cfg.kanji), s = p.cond + p.out;
      ok(!/[{}|]|undefined|NaN|null/.test(s), `${tag} 文章がきれい: ${s}`);
      if (aud === 'kids' && diff === 'easy') ok(!KANJI.test(s), `${tag} こども かんたんは 漢字なし: ${s}`);
    });
    if (prev) {
      const sig = r => JSON.stringify([r.slot, r.conds, r.out]);
      const added = rules.filter(r => !r.def).map(sig).filter(s => !prev.filter(r => !r.def).map(sig).includes(s));
      ok(m.newIndex >= 0 && added.length === 1 && added[0] === sig(rules[m.newIndex]), `${tag} 新しいルールは1つだけ`);
    } else ok(m.newIndex === -1, `${tag} レベル1は新ルールなし`);
    prev = rules;

    const hits = new Array(rules.length).fill(0), ans = {}, kinds = { tone: 0 };
    let made = 0, follow = 0, sessions = 0, withNew = 0;
    while (made < N) {
      const sess = G.makeSession(t, diff, lv, rng);
      ok(sess.qs.length === cfg.n, `${tag} 1回の会話は${cfg.n}問`);
      sessions++; if (m.newIndex >= 0 && sess.qs.some(q => q.hits.some(h => h.index === m.newIndex))) withNew++;
      let prevMemo = null;
      sess.qs.forEach((q, qi) => {
        made++;
        const it = q.item, mine = myEval(m, it);
        ok(mine && JSON.stringify(mine.vals) === JSON.stringify(q.vals) && JSON.stringify(mine.hits.map(h => h.index)) === JSON.stringify(q.hits.map(h => h.index)), `${tag} 解釈の再計算`);
        mine && mine.hits.forEach(h => hits[h.index]++);
        if (it.follow) { follow++; ok(qi > 0, `${tag} 「さっきの／じゃあ」は2問目以降`); }
        // 正解はちょうど1つ・候補はすべてちがう
        const okc = q.cands.filter(c => c.ok);
        ok(okc.length === 1 && okc[0].key === q.answer, `${tag} 完全な正解はちょうど1つ`);
        ok(new Set(q.cands.map(c => c.key)).size === q.cands.length && new Set(q.cands.map(c => c.text)).size === q.cands.length, `${tag} 候補はすべてちがう`);
        ok(q.cands.length >= 3, `${tag} 候補は3つ以上`);
        // 正しい内容は、解釈した結果からデータで計算したもの
        const tObj = Object.create(th); tObj.S = sess.S; tObj.persona = sess.persona; tObj.m = m;
        const right = tObj.content(q.vals, it, sess.S, prevMemo, q.x);
        ok(right && right.key + '#' + q.vals.tone === q.answer, `${tag} 正解＝データから計算した答え`);
        // 言い方だけちがう候補がある
        ok(q.cands.some(c => c.toneWrong && c.content.key === right.key && c.tone !== q.vals.tone), `${tag} 言い方だけちがう候補がある`);
        // まちがいの候補は「よくある読みちがい」：1つの項目だけ別の読み方にしたもの
        q.cands.filter(c => c.wrong).forEach(c => {
          const w = c.wrong, outs = th.lib.concat(th.defaults).filter(r => r.slot === w.slot).map(r => r.out);
          ok(w.slot !== 'tone' && outs.includes(w.val) && w.val !== q.vals[w.slot], `${tag} 読みちがいは別の読み方: ${w.slot}=${w.val}`);
          const v2 = Object.assign({}, q.vals); v2[w.slot] = w.val;
          const c2 = tObj.content(v2, it, sess.S, prevMemo, q.x);
          ok(c2 && c2.key === c.content.key && c2.key !== right.key, `${tag} 読みちがいの答えを再計算できる`);
        });
        // 判定と機嫌
        q.cands.forEach(c => { const j = G.judge(q, c.key); ok(j === (c.ok ? 'perfect' : c.toneWrong ? 'tone' : 'content'), `${tag} 判定`); });
        // 表示する文に漢字なし（こども かんたん）
        if (aud === 'kids' && diff === 'easy') {
          [q.msg].concat(q.cands.map(c => c.text)).forEach(s => ok(!KANJI.test(s), `${tag} かんたんの文に漢字なし: ${s}`));
        }
        ok(!/[{}|]|undefined|NaN|null/.test(q.msg + q.cands.map(c => c.text).join('')), `${tag} 表示の文がきれい`);
        ans[q.answer] = (ans[q.answer] || 0) + 1;
        if (q.vals.tone === 'kind') kinds.tone++;
        prevMemo = q.memo;
      });
      if (aud === 'kids' && diff === 'easy') {
        const c = sess.ctx;
        const shown = [].concat(c.info ? c.info.flat() : [], c.table ? c.table.cols.concat(c.table.rows.flat()) : [], c.log ? c.log.flat() : [], c.list ? c.list.rows.flat() : [], c.grid ? [c.grid.cap].concat(c.grid.rows.map(r => r[0])) : []);
        shown.forEach(s => ok(!KANJI.test(String(s)), `${tag} かんたんの参照情報に漢字なし: ${s}`));
      }
    }
    total += made;
    rules.forEach((r, i) => ok(hits[i] > 0, `${tag} ルール${i + 1}が使われる`));
    if (m.newIndex >= 0) ok(withNew / sessions >= 0.6, `${tag} 新しいルールがほとんどの会話に出る (${Math.round(withNew / sessions * 100)}%)`);
    const vals = Object.values(ans), maxShare = Math.max(...vals) / made;
    ok(maxShare <= 0.7, `${tag} 答えがかたよらない (最大 ${(maxShare * 100).toFixed(0)}%)`);
    summary.push(`${tag}: ルール${rules.length}（とくべつ${spec}）, 出題${made}, 親身が正解${Math.round(kinds.tone / made * 100)}%, 続きの質問${follow}, 答え最大${(maxShare * 100).toFixed(0)}%`);
  }
}

// イラスト一覧（問題パターン.md）と、ゲームの中の表がそろっているか
const doc = fs.readFileSync(path.join(__dirname, '問題パターン.md'), 'utf8');
const docFiles = new Set((doc.match(/`[a-z_]+\.png`/g) || []).map(x => x.slice(1, -1)));
const codeFiles = new Set((uiSrc.match(/images\/[a-z_]+\.png/g) || []).map(x => x.slice(7)));
ok(docFiles.size === codeFiles.size && [...docFiles].every(f => codeFiles.has(f)), `イラスト一覧が一致 (md ${docFiles.size} / code ${codeFiles.size})`);
console.log('イラストの数: ' + codeFiles.size);
console.log(summary.join('\n'));
console.log(`\n出題 合計 ${total} 問 / チェック ${checks} こ / NG ${fails} こ`);
process.exit(fails ? 1 : 0);
