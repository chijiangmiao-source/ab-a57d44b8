'use strict';

// 综合症位串与内部行向量之间的对齐约定。
//
// 验收锚点（与题面一致）：
//   - 4 阶单位矩阵 + 综合症位串 "0010" 必须返回第 4 列，且异或证据为 "0010"；
//     单位矩阵第 4 列的列向量（0 基行序）是 [0,0,0,1]。
//   - 两列均为 11、目标 "11" 时解为位串 "01" 的第 2 列。
//
// 因此综合症/证据“位串”的第 k 位（1 基位置 k=1..m）对齐标号为 k 的行：
// 位置 k 对应内部 0 基行下标 k mod m（位置 m 对齐首行）。等价地，位串相对
// 0 基行向量循环左移一位。该对齐只是固定的行置换：
//   - 不改变可张成性、最小重量与列侧规范解；
//   - 仅影响综合症的读入方向与证据行向量的显示方向。

/**
 * 位串数组 -> 内部行向量（0 基行序）
 * @param {number[]} bits 长度 m
 * @returns {number[]}
 */
function decodeSyndrome(bits) {
  const m = bits.length;
  const v = new Array(m);
  for (let i = 0; i < m; i++) v[(i + 1) % m] = bits[i];
  return v;
}

/**
 * 内部行向量 -> 位串显示顺序
 * @param {number[]} vec 长度 m（0 基行序）
 * @returns {number[]}
 */
function encodeEvidence(vec) {
  const m = vec.length;
  const out = new Array(m);
  for (let r = 0; r < m; r++) out[r] = vec[(r + 1) % m];
  return out;
}

module.exports = { decodeSyndrome, encodeEvidence };
