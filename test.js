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

// ---------- テスト側で独立して書いた判定（ゲームの判定関数は使わない） ----------
function myAtom(sp, it) {
  const k = sp.k, v = sp.v;
  switch (sp.op) {
    case 'eq': return it[k] === v;
    case 'ne': return !(it[k] === v);
    case 'in': return v.some(x => x === it[k]);
    case 'ge': return !(it[k] < v);
    case 'le': return !(it[k] > v);
    case 'even': return [0, 2, 4, 6].includes(it[k]);
    case 'sumge': return it[k[0]] + it[k[1]] >= v;
    case 'eqk': return it[k[0]] === it[k[1]];
    case 'nek': return it[k[0]] !== it[k[1]];
    case 'ltk': return it[k[0]] < it[k[1]];
  }
  throw new Error('unknown op ' + sp.op);
}
function myEval(rules, it) {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.fallback || r.conds.every(c => myAtom(c, it))) {
      if (r.exc && myAtom(r.exc.cond, it)) return { index: i, branch: 1, answer: r.exc.out };
      return { index: i, branch: 0, answer: r.out };
    }
  }
  return null;
}
// 表：条件に合う行の中で、いちばん小さい／大きい値を持つ行を「全部」数える
function myRows(rows, ins, it) {
  let cand = rows.map((r, i) => i);
  for (const [col, op, raw] of ins.f || []) {
    if (op === 'ismin') { const m = Math.min(...cand.map(i => rows[i][col])); cand = cand.filter(i => rows[i][col] === m); continue; }
    const v = typeof raw === 'string' && raw.startsWith('@') ? it[raw.slice(1)] : raw;
    const test = { eq: (a, b) => a === b, ne: (a, b) => a !== b, le: (a, b) => a <= b, ge: (a, b) => a >= b, lt: (a, b) => a < b, gt: (a, b) => a > b }[op];
    cand = cand.filter(i => test(rows[i][col], v));
  }
  if (!cand.length) return [];
  const [col, dir] = ins.pick;
  const best = dir === 'min' ? Math.min(...cand.map(i => rows[i][col])) : Math.max(...cand.map(i => rows[i][col]));
  return cand.filter(i => rows[i][col] === best);
}
// 文章：画面に出る文から、もう一度 情報を読み取る
function md(s) { const m = /(\d+)月(\d+)日/.exec(s); return Date.UTC(2026, +m[1] - 1, +m[2]); }
function daysBetween(a, b) { return Math.round((md(b) - md(a)) / 86400000); }
function only(text, words) { const hit = words.map((w, i) => text.includes(w) ? i : -1).filter(i => i >= 0); return hit.length === 1 ? hit[0] : -1; }
const READERS = {
  letter(lines) {
    const all = lines.join('\n'), last = lines[lines.length - 1];
    const has1 = all.includes('あした'), has2 = all.includes('にちようび');
    return {
      from: last.startsWith('ともだちの') ? 0 : last === 'せんせいより' ? 1 : last === 'おばあちゃんより' ? 2 : -1,
      word: only(all, ['あそぼう', 'おまつり', 'ありがとう', 'こいぬ']),
      when: has1 && has2 ? -1 : has1 ? 1 : has2 ? 2 : 0,
      ask: all.includes('？') ? 1 : 0, draw: all.includes('えも かいたよ') ? 1 : 0, bang: (all.match(/！/g) || []).length
    };
  },
  memo(lines) {
    const all = lines.join('\n');
    const t = /(?:あつまる じかんは|集まる時間は) (\S+) です/.exec(all), w = /(?:てんきよほうは|天気予ほうは) (\S+) です/.exec(all);
    return {
      place: only(all, ['こうえん', 'プール', 'きょうしつ', 'たいいくかん']),
      weather: w ? ['はれ', 'あめ', 'くもり'].indexOf(w[1]) : -1,
      lunch: /(きゅうしょく|給食)は ありません/.test(all) ? 1 : /(きゅうしょく|給食)は あります/.test(all) ? 0 : -1,
      time: t ? ['7じ', '7じはん', '8じ', '8じはん'].indexOf(t[1]) : -1,
      shoes: all.includes('うわばき') ? 1 : 0
    };
  },
  mail(lines, it) {
    const all = lines.join('\n'), d = /(\d+月\d+日)までに/.exec(all);
    const left = d ? daysBetween(it.todayText, d[1]) : null;
    return {
      topic: only(lines[0], ['見積もり', '請求書', 'ログイン', '住所変更', '解約']),
      corp: all.includes('株式会社') ? 1 : 0, urgent: lines[0].includes('【至急】') ? 1 : 0, contract: all.includes('契約番号') ? 1 : 0,
      angry: all.includes('困っています') ? 1 : 0, deadline: left === null ? 0 : left <= 3 ? 1 : 2
    };
  },
  expense(lines, it) {
    const all = lines.join('\n'), a = /([\d,]+)円の精算/.exec(all), d = /(\d+月\d+日)に/.exec(all);
    const el = daysBetween(d[1], it.todayText);
    return {
      cat: only(all, ['交通費', '会議費', '書籍代', '宿泊費']),
      amount: [2800, 9500, 18000, 42000, 85000].indexOf(+a[1].replace(/,/g, '')),
      receipt: all.includes('領収書を添付します') ? 1 : 0, pre: all.includes('事前に承認をいただいています') ? 1 : 0,
      elapsed: el < 10 ? 0 : el < 30 ? 1 : 2
    };
  }
};

// こども／おとなの ルール数（レベル1〜3）
const COUNTS = {
  kids:   { easy: [2, 3, 3], normal: [3, 4, 5], hard: [4, 5, 6] },
  adults: { easy: [4, 5, 6], normal: [6, 7, 8], hard: [8, 9, 10] }
};
for (const d of ['easy', 'normal', 'hard']) for (let i = 0; i < 3; i++) ok(COUNTS.adults[d][i] > COUNTS.kids[d][i], `おとなの${d}はこどもより ルールが多い (レベル${i + 1})`);

const N = 500;
const rng = G.seededRng('test-run-v2');
const summary = [];
const KANJI = /[一-鿿]/;
const WEEKDAY_KANJI = /[月火水木金曜日]/g;
let total = 0;

for (const aud of ['kids', 'adults']) for (const diff of ['easy', 'normal', 'hard']) for (const genre of ['pic', 'text', 'table']) for (const t of G.ORDER[aud][genre]) {
  const th = G.THEMES[t];
  ok(th.aud === aud && th.genre === genre, `${t} の分類`);
  const kanji = G.LEVELS[aud][diff].kanji;
  let prevRules = null;
  for (let lv = 1; lv <= 3; lv++) {
    const tag = `${aud}/${diff}/${genre}/${t}/Lv${lv}`;
    const m = G.getManual(t, diff, lv), rules = m.rules;
    ok(rules.length === COUNTS[aud][diff][lv - 1], `${tag} ルール数 ${rules.length}`);
    ok(rules[rules.length - 1].fallback && rules.filter(r => r.fallback).length === 1, `${tag} さいごは「どれにも当てはまらない」`);
    ok(JSON.stringify(G.getManual(t, diff, lv).rules) === JSON.stringify(rules), `${tag} 同じ指示書`);
    rules.forEach(r => {
      const p = G.ruleParts(t, r, kanji);
      const s = p.cond + (p.exc || '') + T(th.outText(r.out), kanji) + (r.exc ? T(th.outText(r.exc.out), kanji) : '');
      ok(!/[{}|]|undefined|NaN|null/.test(s), `${tag} 文章がきれい: ${s}`);
      if (aud === 'kids' && diff === 'easy') ok(!KANJI.test(s.replace(WEEKDAY_KANJI, '')), `${tag} こども かんたんは 漢字なし: ${s}`);
    });
    const kinds = rules.map(r => r.kind);
    G.LEVELS[aud][diff].req.forEach(k => ok(kinds.includes(k), `${tag} ${k} のルールがある`));
    if (prevRules) {
      const sig = r => JSON.stringify(r.conds) + JSON.stringify(r.exc) + r.out;
      const added = rules.map(sig).filter(s => !prevRules.map(sig).includes(s));
      ok(m.newIndex >= 0 && added.length === 1 && added[0] === sig(rules[m.newIndex]), `${tag} 新しいルールは1つだけ`);
    } else ok(m.newIndex === -1, `${tag} レベル1は新ルールなし`);
    prevRules = rules;

    const hits = new Array(rules.length).fill(0), excHits = new Array(rules.length).fill(0), ans = {}, rowAns = {};
    let made = 0;
    while (made < N) {
      const qs = G.makeQuestions(t, diff, lv, 5, rng);
      if (m.newIndex >= 0) ok(qs.some(q => q.ruleIndex === m.newIndex), `${tag} ステージに新ルールの問題`);
      for (const q of qs) {
        made++;
        let item = q.item;
        // 文章：画面の文から読み取った情報で判定しなおす
        if (genre === 'text') {
          const lines = item.lines.map(l => T(l, kanji));
          lines.forEach(l => ok(!/[{}|]|undefined|NaN/.test(l), `${tag} 文章がきれい: ${l}`));
          if (aud === 'kids' && diff === 'easy') lines.forEach(l => ok(!KANJI.test(l), `${tag} かんたんの文章に漢字なし: ${l}`));
          const read = READERS[t](lines, item);
          Object.keys(read).forEach(k => ok(read[k] === item[k], `${tag} 文章から ${k} が読み取れる (${read[k]} / ${item[k]}) ${lines.join(' ')}`));
          item = Object.assign({}, item, read);
          ok(new Set(th.outcomes).size === th.outcomes.length && th.outcomes.includes(q.answer), `${tag} 答えのボタンは1つだけ正解`);
        }
        if (t === 'delivery') ok(item.late === ([13, 15, 17][item.time] > [16, 15, 14, 13][item.region] ? 1 : 0), `${tag} 締切の判定`);
        if (t === 'lost') ok(daysBetween(item.foundText, item.todayText) === [0, 3, 7, 14][item.days], `${tag} 拾った日`);
        if (t === 'clinic') ok([...item.name].length === item.nameLen, `${tag} 名前の文字数`);
        if (t === 'sweets') ok(q.candidates.length === 4 && new Set(q.candidates).size === 4 && q.candidates.includes(q.answer), `${tag} 候補4つ・正解あり`);
        const mine = myEval(rules, item);
        ok(mine && mine.answer === q.ruleAnswer && mine.index === q.ruleIndex && mine.branch === q.branch, `${tag} 正解の再計算`);
        if (genre === 'table') {
          const rowsOk = myRows(q.rows, th.instr[mine.answer], item);
          ok(rowsOk.length === 1 && rowsOk[0] === q.answer, `${tag} 表の正解はちょうど1行 (${rowsOk})`);
          if (aud === 'kids' && diff === 'easy') {
            const shown = th.ctx(item).flat().concat(th.cols.map(c => c[1])).concat(q.rows.flatMap(r => th.cols.map(c => String(th.fmt(c[0], r[c[0]])))));
            shown.forEach(s => ok(!KANJI.test(T(s, false)), `${tag} かんたんの表に漢字なし: ${T(s, false)}`));
          }
          rowAns[q.answer] = (rowAns[q.answer] || 0) + 1;
        }
        hits[q.ruleIndex]++; if (q.branch) excHits[q.ruleIndex]++;
        ans[q.ruleAnswer] = (ans[q.ruleAnswer] || 0) + 1;
      }
    }
    total += made;
    rules.forEach((r, i) => {
      ok(hits[i] > 0, `${tag} ルール${i + 1}が出題される`);
      if (r.exc) ok(excHits[i] > 0 && excHits[i] < hits[i], `${tag} ルール${i + 1}の「ただし」も出題される`);
    });
    const vals = Object.values(ans), maxShare = Math.max(...vals) / made;
    ok(vals.length >= 2, `${tag} 答えが2種類以上`);
    ok(maxShare <= 0.75, `${tag} 答えがかたよらない (最大 ${(maxShare * 100).toFixed(0)}%)`);
    let rowInfo = '';
    if (genre === 'table') { const rs = Math.max(...Object.values(rowAns)) / made; ok(rs <= 0.7, `${tag} 正解の行がかたよらない (${(rs * 100).toFixed(0)}%)`); rowInfo = `, 正解の行 最大${(rs * 100).toFixed(0)}%`; }
    summary.push(`${tag}: ルール${rules.length}こ, 出題${made}, 答え最大${(maxShare * 100).toFixed(0)}%${rowInfo}`);
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
