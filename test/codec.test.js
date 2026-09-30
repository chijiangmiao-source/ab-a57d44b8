'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeSyndrome, encodeEvidence } = require('../lib/syndrome-codec');

test('位串 0010（m=4）解码后唯一 1 位于内部行 3（单位矩阵第 4 列）', () => {
  assert.deepEqual(decodeSyndrome([0, 0, 1, 0]), [0, 0, 0, 1]);
});

test('编码与解码互逆', () => {
  const v = [1, 0, 1, 1, 0];
  assert.deepEqual(decodeSyndrome(encodeEvidence(v)), v);
  const b = [0, 1, 0, 1];
  assert.deepEqual(encodeEvidence(decodeSyndrome(b)), b);
});

test('m=2 时位串不发生歧义：11 仍为 11', () => {
  assert.deepEqual(decodeSyndrome([1, 1]), [1, 1]);
});

test('位串位置 k 对齐行 k（1 基，末位回绕到首行）', () => {
  // m=3：位串 100 的第 1 位 -> 内部行下标 1
  assert.deepEqual(decodeSyndrome([1, 0, 0]), [0, 1, 0]);
  // 内部行下标 2（第 3 行）的 1 显示在位串第 2 位
  assert.deepEqual(encodeEvidence([0, 0, 1]), [0, 1, 0]);
});
