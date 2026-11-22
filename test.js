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
function ok(cond, msg) { checks++; if (!cond) { fails++; if (fails < 30) console.error('  NG: ' + msg); } }

// 1. 構文チェック
for (const [name, src] of [['logic', logicSrc], ['ui', uiSrc]]) {
  try { new vm.Script(src, { filename: name + '.js' }); console.log('構文OK: script#' + name); }
  catch (e) { fails++; console.error('構文エラー: ' + name, e.message); }
}
// 外部リソースが無いこと
ok(!/(src|href)\s*=\s*["']https?:/i.test(html), '外部URLを読み込んでいない');
ok(!/@import|url\(\s*["']?https?:/i.test(html), 'CSSで外部URLを使っていない');

// 2. ロジック読み込み
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(logicSrc, ctx);
const G = ctx.module.exports;

// テスト側で独立して書いた判定（ゲームのコードは使わない）
function myAtom(sp, it) {
  const k = sp.k, v = sp.v;
  if (sp.op === 'eq') return it[k] === v;
  if (sp.op === 'ne') return !(it[k] === v);
  if (sp.op === 'in') return v.some(x => x === it[k]);
  if (sp.op === 'ge') return !(it[k] < v);
  if (sp.op === 'le') return !(it[k] > v);
  if (sp.op === 'even') return [0, 2, 4, 6].includes(it[k]);
  if (sp.op === 'sumge') return it[k[0]] + it[k[1]] >= v;
  if (sp.op === 'eqk') return it[k[0]] === it[k[1]];
  if (sp.op === 'nek') return it[k[0]] !== it[k[1]];
  if (sp.op === 'ltk') return it[k[0]] < it[k[1]];
  throw new Error('unknown op ' + sp.op);
}
function myEval(rules, it) {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const hit = r.fallback || r.conds.every(c => myAtom(c, it));
    if (hit) {
      if (r.exc && myAtom(r.exc.cond, it)) return { index: i, branch: 1, answer: r.exc.out };
      return { index: i, branch: 0, answer: r.out };
    }
  }
  return null;
}

const RANGE = { easy: [2, 3], normal: [4, 5], hard: [6, 8] };
const N = 1200;
const rng = G.seededRng('test-run');
const summary = [];

for (const t of ['A', 'B', 'C']) {
  for (const d of ['easy', 'normal', 'hard']) {
    let prevRules = null;
    for (let lv = 1; lv <= 3; lv++) {
      const m = G.getManual(t, d, lv);
      const rules = m.rules;
      const tag = `${t}/${d}/Lv${lv}`;
      // ルール数
      ok(rules.length >= RANGE[d][0] && rules.length <= RANGE[d][1], `${tag} ルール数 ${rules.length}`);
      ok(rules[rules.length - 1].fallback, `${tag} さいごは「どれにも当てはまらない」`);
      ok(rules.filter(r => r.fallback).length === 1, `${tag} fallbackは1つ`);
      // 決まった指示書（同じ入力なら同じ）
      ok(JSON.stringify(G.getManual(t, d, lv).rules) === JSON.stringify(rules), `${tag} 同じ指示書`);
      // 文章
      rules.forEach((r, i) => {
        const p = G.ruleParts(t, r, G.DIFFS[d].kanji);
        const s = p.cond + (p.exc || '');
        ok(!/[{}|]|undefined|NaN/.test(s), `${tag} 文章がきれい: ${s}`);
        if (d === 'easy') ok(!/[一-龯]/.test(s.replace(/[月火水木金曜日]/g, '')), `${tag} かんたんは ひらがな: ${s}`);
      });
      // 種類
      const kinds = rules.map(r => r.kind);
      if (d === 'normal') { ok(kinds.includes('neg'), `${tag} 否定あり`); ok(kinds.includes('and'), `${tag} ANDあり`); }
      if (d === 'hard') { ['exc', 'count', 'and', 'neg'].forEach(k => ok(kinds.includes(k), `${tag} ${k}あり`)); }
      // レベルアップで1つふえる／入れかわる
      if (prevRules) {
        ok(m.newIndex >= 0, `${tag} 新しいルールの場所`);
        const prevSig = prevRules.map(r => JSON.stringify(r.conds) + JSON.stringify(r.exc) + r.out);
        const nowSig = rules.map(r => JSON.stringify(r.conds) + JSON.stringify(r.exc) + r.out);
        const added = nowSig.filter(s => !prevSig.includes(s));
        ok(added.length === 1 && added[0] === nowSig[m.newIndex], `${tag} 新ルールは1つだけ`);
        ok(rules.length === prevRules.length || rules.length === prevRules.length + 1, `${tag} ルール数の変化`);
      } else ok(m.newIndex === -1, `${tag} Lv1は新ルールなし`);
      prevRules = rules;

      // 問題をたくさん作る
      const hits = new Array(rules.length).fill(0), excHits = new Array(rules.length).fill(0), ans = {};
      let made = 0;
      while (made < N) {
        const qs = G.makeQuestions(t, d, lv, 5, rng);
        for (const q of qs) {
          made++;
          const mine = myEval(rules, q.item);
          ok(mine && mine.answer === q.answer && mine.index === q.ruleIndex && mine.branch === q.branch, `${tag} 正解の再計算 ${JSON.stringify(q.item)}`);
          hits[q.ruleIndex]++; if (q.branch) excHits[q.ruleIndex]++;
          ans[q.answer] = (ans[q.answer] || 0) + 1;
          if (t === 'B') ok([...q.item.name].length === q.item.nameLen, `${tag} 名前の文字数`);
          if (t === 'C') {
            ok(q.candidates.length === 4 && new Set(q.candidates).size === 4, `${tag} 候補4つ`);
            ok(q.candidates.includes(q.answer), `${tag} 候補に正解あり`);
          }
        }
        if (m.newIndex >= 0) ok(qs.some(q => q.ruleIndex === m.newIndex), `${tag} ステージに新ルールの問題`);
      }
      rules.forEach((r, i) => {
        ok(hits[i] > 0, `${tag} ルール${i + 1}が出題される`);
        if (r.exc) ok(excHits[i] > 0 && excHits[i] < hits[i], `${tag} ルール${i + 1}の「ただし」も出題される`);
      });
      const vals = Object.values(ans), maxShare = Math.max(...vals) / made;
      ok(vals.length >= 2, `${tag} 答えが2種類以上`);
      ok(maxShare <= 0.75, `${tag} 答えがかたよらない (最大 ${(maxShare * 100).toFixed(0)}%)`);
      summary.push(`${tag}: ルール${rules.length}こ, 出題${made}, ルール別 [${hits.join(',')}], 答え最大${(maxShare * 100).toFixed(0)}%`);
    }
  }
}

// イラスト一覧（問題パターン.md）と、ゲームの中の表がそろっているか
const doc = fs.readFileSync(path.join(__dirname, '問題パターン.md'), 'utf8');
const docFiles = new Set((doc.match(/`[a-z_]+\.png`/g) || []).map(x => x.slice(1, -1)));
const codeFiles = new Set((uiSrc.match(/images\/[a-z_]+\.png/g) || []).map(x => x.slice(7)));
ok(docFiles.size === codeFiles.size && [...docFiles].every(f => codeFiles.has(f)), `イラスト一覧が一致 (md ${docFiles.size} / code ${codeFiles.size})`);
console.log('イラストの数: ' + codeFiles.size);
console.log(summary.join('\n'));
console.log(`\nチェック ${checks} こ / NG ${fails} こ`);
process.exit(fails ? 1 : 0);
