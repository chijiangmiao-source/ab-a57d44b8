'use strict';

// 在 GF(2) 上精确求解 Hx = s 的最小汉明重量二进制向量。
//
// 硬性约束（验收要求）：
//   - 不限制误码数、不随机尝试、不枚举全部 2^n（n ≤ 40）个组合；
//   - 同重量时，按列号顺序比较位串（第 1 列在最前），0 小于 1，取规范解；
//   - s 不在列空间时返回 feasible=false，调用方不得展示任何“证据”。
//
// 算法：Meet-in-the-Middle（中途相遇）
//   将 n 列切成左右两半（各至多 20 列）。枚举每一半全部子集的 XOR
//   （每半至多 2^20 ≈ 1.05e6 个状态，而非 2^40）：
//     右半：xor 值 -> { 可达的最小重量, 各重量下规范序最小的子集位串 }；
//     左半：逐子集匹配 need = s XOR xorL，求全局最小重量 W；
//     再以 W 为界扫描左半，取合并位串规范序最小的一对。
//   时间 O(2^(n/2))，空间 O(2^(n/2))，对 32×40 以内规模精确且完备。

/**
 * @typedef {Object} SolveResult
 * @property {boolean} feasible
 * @property {number[]} [solution] 长度 n 的 0/1 向量（按列号顺序）
 * @property {number} [weight] 汉明重量
 * @property {number[]} [columns] 选中列的 1 基列号，按列号升序
 * @property {number[][]} [evidence] 逐列累加 XOR，长度 weight+1，首项为全零
 */

function popcount32(x) {
  x = x | 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// 在长度 len 的位串上比较 a/b：从第 0 位（列号最小）起，首个差异位上 0 更优。
function canonicalLess(aBits, bBits, len) {
  for (let j = 0; j < len; j++) {
    const a = (aBits >>> j) & 1;
    const b = (bBits >>> j) & 1;
    if (a !== b) return a === 0;
  }
  return false;
}

/**
 * 枚举一段列（colMasks[base .. base+len-1]）的全部子集。
 * 返回与子集下标对齐的 XOR 数组（重量即子集下标的 popcount）。
 */
function enumerateHalf(colMasks, base, len) {
  const size = 1 << len;
  const xors = new Uint32Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const bit = 31 - Math.clz32(low);
    xors[mask] = (xors[mask ^ low] ^ colMasks[base + bit]) >>> 0;
  }
  return xors;
}

/**
 * @param {number[][]} H m 行 n 列的 0/1 矩阵（m ≤ 32, n ≤ 40）
 * @param {number[]} s 长度 m 的 0/1 综合症
 * @returns {SolveResult}
 */
function solve(H, s) {
  const m = H.length;
  if (m === 0) {
    if (s.length !== 0) return { feasible: false };
    return { feasible: true, solution: [], weight: 0, columns: [], evidence: [[]] };
  }
  const n = H[0].length;

  // 列向量化：第 i 行对应整数的第 i 位（m ≤ 32）。
  const colMasks = new Uint32Array(n);
  for (let j = 0; j < n; j++) {
    let bits = 0;
    for (let i = 0; i < m; i++) if (H[i][j]) bits |= 1 << i;
    colMasks[j] = bits >>> 0;
  }
  let sMask = 0;
  for (let i = 0; i < m; i++) if (s[i]) sMask |= 1 << i;
  sMask = sMask >>> 0;

  if (n === 0) {
    if (sMask !== 0) return { feasible: false };
    return { feasible: true, solution: [], weight: 0, columns: [], evidence: [new Array(m).fill(0)] };
  }

  const nl = n >> 1;           // 左半列数
  const nr = n - nl;           // 右半列数（≤ 20）
  const xorL = enumerateHalf(colMasks, 0, nl);
  const xorR = enumerateHalf(colMasks, nl, nr);

  // ---- 第一遍扫描右半：记录每个 xor 值的最小重量 ----
  // minWR: xor -> 最小重量
  const minWR = new Map();
  for (let mask = 0; mask < xorR.length; mask++) {
    const x = xorR[mask];
    const w = popcount32(mask);
    const cur = minWR.get(x);
    if (cur === undefined || w < cur) minWR.set(x, w);
  }

  // ---- 第一遍扫描左半：确定全局最小重量 W ----
  let W = Infinity;
  for (let mask = 0; mask < xorL.length; mask++) {
    const need = (sMask ^ xorL[mask]) >>> 0;
    const wr = minWR.get(need);
    if (wr !== undefined) {
      const total = popcount32(mask) + wr;
      if (total < W) W = total;
    }
  }
  if (W === Infinity) return { feasible: false };

  // ---- 第二遍扫描右半：仅保留重量 ≤ W 的 (xor, 重量) 规范代表 ----
  // 键 = xor * 32 + weight（xor < 2^32，乘积 < 2^37，安全整数）。
  const rep = new Map();
  for (let mask = 0; mask < xorR.length; mask++) {
    const w = popcount32(mask);
    if (w > W) continue;
    const x = xorR[mask];
    const key = x * 32 + w;
    const cur = rep.get(key);
    if (cur === undefined || canonicalLess(mask, cur, nr)) rep.set(key, mask);
  }

  // ---- 第二遍扫描左半：在达到 W 的配对中取整体规范序最小者 ----
  // 合并位串中右半位于第 nl 位之后；比较按全列号顺序逐位进行。
  let bestL = -1, bestR = -1;
  for (let mask = 0; mask < xorL.length; mask++) {
    const wl = popcount32(mask);
    const need = (sMask ^ xorL[mask]) >>> 0;
    const wr = W - wl;
    if (wr < 0 || wr > nr) continue;
    const rMask = rep.get(need * 32 + wr);
    if (rMask === undefined) continue;

    if (bestL === -1 || combinedLess(mask, rMask, bestL, bestR, nl, nr)) {
      bestL = mask; bestR = rMask;
    }
  }

  function bitAt(maskL, maskR, j) {
    if (j < nl) return (maskL >>> j) & 1;
    return (maskR >>> (j - nl)) & 1;
  }
  function combinedLess(lA, rA, lB, rB) {
    for (let j = 0; j < n; j++) {
      const a = bitAt(lA, rA, j);
      const b = bitAt(lB, rB, j);
      if (a !== b) return a === 0;
    }
    return false;
  }

  // ---- 组装解 ----
  const solution = new Array(n).fill(0);
  const columns = [];
  for (let j = 0; j < nl; j++) if ((bestL >>> j) & 1) { solution[j] = 1; columns.push(j + 1); }
  for (let k = 0; k < nr; k++) if ((bestR >>> k) & 1) { solution[nl + k] = 1; columns.push(nl + k + 1); }

  // 逐列累加 XOR 证据（按列号升序），末项必须恰为 s。
  const evidence = [new Array(m).fill(0)];
  let acc = 0;
  for (const j1 of columns) {
    acc = (acc ^ colMasks[j1 - 1]) >>> 0;
    const vec = new Array(m);
    for (let i = 0; i < m; i++) vec[i] = (acc >>> i) & 1;
    evidence.push(vec);
  }

  return { feasible: true, solution, weight: W, columns, evidence };
}

module.exports = { solve, popcount32 };
