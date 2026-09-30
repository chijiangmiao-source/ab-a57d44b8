'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solve } = require('../lib/solver');
const { decodeSyndrome, encodeEvidence } = require('../lib/syndrome-codec');

// 暴力参考实现：枚举全部 2^n（仅用于小规模对拍）。
function bruteForce(H, s) {
  const m = H.length;
  const n = m ? H[0].length : 0;
  let best = null;
  for (let mask = 0; mask < (1 << n); mask++) {
    const acc = new Array(m).fill(0);
    let w = 0;
    for (let j = 0; j < n; j++) {
      if ((mask >>> j) & 1) {
        w++;
        for (let i = 0; i < m; i++) acc[i] ^= H[i][j];
      }
    }
    if (acc.some((v, i) => v !== s[i])) continue;
    if (best === null || w < best.w || (w === best.w && canonicalLess(mask, best.mask, n))) {
      best = { mask, w };
    }
  }
  return best;
}
function canonicalLess(a, b, n) {
  for (let j = 0; j < n; j++) {
    const x = (a >>> j) & 1;
    const y = (b >>> j) & 1;
    if (x !== y) return x === 0;
  }
  return false;
}

function verifyResult(H, s, r) {
  const m = H.length;
  const n = H[0].length;
  assert.equal(r.feasible, true);
  assert.equal(r.solution.length, n);
  assert.ok(r.solution.every((v) => v === 0 || v === 1));
  const acc = new Array(m).fill(0);
  for (let j = 0; j < n; j++) if (r.solution[j]) for (let i = 0; i < m; i++) acc[i] ^= H[i][j];
  assert.deepEqual(acc, s, 'Hx 必须等于 s');
  assert.equal(r.weight, r.solution.reduce((a, b) => a + b, 0));
  assert.equal(r.evidence.length, r.weight + 1);
  assert.deepEqual(r.evidence[0], new Array(m).fill(0));
  assert.deepEqual(r.evidence[r.evidence.length - 1], s, '证据末项必须等于综合症');
}

test('验收：4 阶单位矩阵 + 综合症位串 0010 只返回第 4 列，重量 1，证据位串 0010', () => {
  const H = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const displayed = [0, 0, 1, 0]; // 位串 "0010"
  const s = decodeSyndrome(displayed);
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 1);
  assert.deepEqual(r.columns, [4]);
  assert.deepEqual(r.solution, [0, 0, 0, 1]);
  // 面向页面的证据位串
  assert.deepEqual(r.evidence.map(encodeEvidence), [[0, 0, 0, 0], [0, 0, 1, 0]]);
});

test('验收：两列均为 11、目标 11，规范解取位串 01 即第 2 列', () => {
  const H = [
    [1, 1],
    [1, 1],
  ];
  const displayed = [1, 1];
  const s = decodeSyndrome(displayed);
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 1);
  assert.deepEqual(r.columns, [2]);
  assert.deepEqual(r.solution, [0, 1]);
});

test('验收：目标不在列空间时不可综合且无任何证据字段', () => {
  // 第 3 行（内部行 2）全零；位串第 2 位对齐内部行 2 => "010" 不可张成
  const H = [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ];
  const s = decodeSyndrome([0, 1, 0]);
  const r = solve(H, s);
  assert.equal(r.feasible, false);
  assert.equal(r.evidence, undefined);
  assert.equal(r.solution, undefined);
  assert.equal(r.weight, undefined);
});

test('零综合症：最小重量为 0 的零向量，证据仅含全零起点', () => {
  const H = [
    [1, 0, 1],
    [0, 1, 1],
  ];
  const s = [0, 0];
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 0);
  assert.deepEqual(r.columns, []);
  assert.deepEqual(r.solution, [0, 0, 0]);
  assert.deepEqual(r.evidence, [[0, 0]]);
});

test('需要多列组合：在重量 2 解与重量 3 解之间选重量 2', () => {
  // 列：c1=10, c2=01, c3=11；目标 11 可由 c3（重量1）直接得到
  const H = [
    [1, 0, 1],
    [0, 1, 1],
  ];
  const s = [1, 1];
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 1);
  assert.deepEqual(r.columns, [3]);
});

test('同重量规范裁决：多个等重解时位串 0 优先（偏向更大列号）', () => {
  // c1=11, c2=11, c3=10, c4=01；目标 11 的重量1解为第1、2列 => 取第2列（0100 优于 1000）
  const H = [
    [1, 1, 1, 0],
    [1, 1, 0, 1],
  ];
  const s = [1, 1];
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 1);
  assert.deepEqual(r.columns, [2]);
});

test('最小重量为 2 且需要规范裁决（构造只有重量2解）', () => {
  // c1=100,c2=010,c3=001,c4=110,c5=011；目标 101：
  // c1+c3 = 101（位串 10100）；c4+c5 = 101（00011）；重量同为 2，
  // 按列号顺序 0<1：10100 vs 00011，第1位 1 vs 0 => 00011 更优 => 列 4、5。
  const H = [
    [1, 0, 0, 1, 0],
    [0, 1, 0, 1, 1],
    [0, 0, 1, 0, 1],
  ];
  const s = [1, 0, 1];
  const r = solve(H, s);
  verifyResult(H, s, r);
  assert.equal(r.weight, 2);
  assert.deepEqual(r.columns, [4, 5]);
});

test('随机对拍：与 2^n 暴力枚举在最小重量与规范序上完全一致', () => {
  let seed = 20260930;
  const rand = () => {
    // 确定性 LCG
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let cases = 0;
  for (let trial = 0; trial < 300; trial++) {
    const m = 1 + Math.floor(rand() * 5);
    const n = 1 + Math.floor(rand() * 12);
    const H = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0)));
    const s = Array.from({ length: m }, () => (rand() < 0.5 ? 1 : 0));
    const r = solve(H, s);
    const bf = bruteForce(H, s);
    if (bf === null) {
      assert.equal(r.feasible, false, `trial ${trial}: 应为不可张成`);
    } else {
      verifyResult(H, s, r);
      assert.equal(r.weight, bf.w, `trial ${trial}: 重量不一致`);
      let mask = 0;
      r.solution.forEach((v, j) => { if (v) mask |= 1 << j; });
      assert.equal(mask, bf.mask, `trial ${trial}: 规范解不一致 ${mask} vs ${bf.mask}`);
    }
    cases++;
  }
  assert.ok(cases === 300);
});

test('跨半区切分的对拍（奇数列数，保证左右半合并位序正确）', () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  for (let trial = 0; trial < 100; trial++) {
    const m = 3;
    const n = 1 + Math.floor(rand() * 11); // 含奇数
    const H = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0)));
    const s = Array.from({ length: m }, () => (rand() < 0.5 ? 1 : 0));
    const r = solve(H, s);
    const bf = bruteForce(H, s);
    if (bf === null) { assert.equal(r.feasible, false); continue; }
    verifyResult(H, s, r);
    assert.equal(r.weight, bf.w);
    let mask = 0;
    r.solution.forEach((v, j) => { if (v) mask |= 1 << j; });
    assert.equal(mask, bf.mask);
  }
});

test('较大规模对拍 n=19..21（跨越左右半区，含等重量规范裁决）', () => {
  let seed = 20260930;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 19; n <= 21; n++) {
    for (let trial = 0; trial < 4; trial++) {
      const m = 5;
      const H = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.4 ? 1 : 0)));
      // 让综合症落在列空间：随机取子集 XOR，保证有解
      const s = new Array(m).fill(0);
      for (let j = 0; j < n; j++) if (rand() < 0.3) for (let i = 0; i < m; i++) s[i] ^= H[i][j];
      const r = solve(H, s);
      const bf = bruteForce(H, s);
      assert.ok(bf !== null);
      verifyResult(H, s, r);
      assert.equal(r.weight, bf.w, `n=${n} trial=${trial}`);
      let mask = 0;
      r.solution.forEach((v, j) => { if (v) mask |= 1 << j; });
      assert.equal(mask, bf.mask, `n=${n} trial=${trial} 规范解不一致`);
    }
  }
});

test('近 40 列规模：不枚举 2^40，限时完成且结果满足方程', () => {
  // 32 行 40 列随机矩阵，综合症取若干列 XOR（保证可解）
  let seed = 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const m = 32, n = 40;
  const H = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.4 ? 1 : 0)));
  const s = new Array(m).fill(0);
  for (const j of [2, 9, 17, 23, 31, 38]) for (let i = 0; i < m; i++) s[i] ^= H[i][j];
  const t0 = Date.now();
  const r = solve(H, s);
  const elapsed = Date.now() - t0;
  assert.equal(r.feasible, true);
  verifyResult(H, s, r);
  assert.ok(r.weight <= 6, '最小重量不应大于构造用的 6 列');
  assert.ok(elapsed < 30000, `应在 30s 内完成，实际 ${elapsed}ms`);
});

test('32×40 随机不可解情形也快速给出不可综合结论', () => {
  let seed = 99;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const m = 32, n = 40;
  // 秩亏矩阵：只让前 30 行非平凡，后两行全零
  const H = Array.from({ length: m }, (_, i) =>
    i >= 30 ? new Array(n).fill(0) : Array.from({ length: n }, () => (rand() < 0.4 ? 1 : 0)));
  const s = new Array(m).fill(0);
  s[31] = 1; // 与零行冲突 => 不可张成
  const t0 = Date.now();
  const r = solve(H, s);
  assert.equal(r.feasible, false);
  assert.ok(Date.now() - t0 < 30000);
});
