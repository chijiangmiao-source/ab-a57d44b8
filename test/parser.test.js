'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInput } = require('../lib/parser');

test('合法矩阵与综合症解析成功', () => {
  const { issues, matrix, syndrome } = parseInput('1 0 1\n0 1 1', '1 0');
  assert.deepEqual(issues, []);
  assert.deepEqual(matrix, [[1, 0, 1], [0, 1, 1]]);
  assert.deepEqual(syndrome, [1, 0]);
});

test('逗号分隔与多余空白同样合法', () => {
  const { issues, matrix } = parseInput('1,0, 1\n 0 ,1,1', '1,0');
  assert.deepEqual(issues, []);
  assert.deepEqual(matrix, [[1, 0, 1], [0, 1, 1]]);
});

test('紧凑 0/1 串逐字符拆位（矩阵与综合症）', () => {
  const { issues, matrix, syndrome } = parseInput('1000\n0100\n0010\n0001', '0010');
  assert.deepEqual(issues, []);
  assert.deepEqual(matrix, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.deepEqual(syndrome, [0, 0, 1, 0]);
});

test('首行有非法笔误时，参考宽度取众数不误伤后续行', () => {
  const { issues } = parseInput('1a1\n101\n001', '000');
  const wm = issues.filter((i) => i.code === 'WIDTH_MISMATCH');
  // 参考宽度为众数 3，只有首行（占位 3）实际也是 3 => 不应有行宽错误
  assert.equal(wm.length, 0);
  assert.ok(issues.some((i) => i.code === 'ILLEGAL_CHAR' && i.row === 1));
});

test('行宽不一：错误可定位到具体行，原始草稿不丢弃', () => {
  const text = '1 0 1\n1 0\n0 0 1';
  const { issues } = parseInput(text, '0 0 0');
  const wm = issues.find((i) => i.code === 'WIDTH_MISMATCH');
  assert.ok(wm);
  assert.equal(wm.row, 2);
});

test('含非法字符：报告行列字符位', () => {
  const { issues } = parseInput('1 a 1\n0 1 x', '0 0');
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('ILLEGAL_CHAR'));
  const at = issues.find((i) => i.code === 'ILLEGAL_CHAR' && i.row === 1);
  assert.equal(at.col, 3); // "a" 起始字符位
});

test('综合症长度与矩阵行数不符：报告长度错误', () => {
  const { issues } = parseInput('1 0\n0 1', '0 0 1');
  assert.ok(issues.some((i) => i.code === 'SYNDROME_LENGTH'));
});

test('综合症含非法字符', () => {
  const { issues, syndrome } = parseInput('1 0\n0 1', '1 z');
  assert.ok(issues.some((i) => i.code === 'SYNDROME_ILLEGAL_CHAR'));
  assert.equal(syndrome[1], null);
});

test('空矩阵/空综合症分别报错', () => {
  const r1 = parseInput('', '0');
  assert.ok(r1.issues.some((i) => i.code === 'MATRIX_EMPTY'));
  const r2 = parseInput('1 0\n0 1', '');
  assert.ok(r2.issues.some((i) => i.code === 'SYNDROME_EMPTY'));
});

test('超过 32 行 / 40 列被拒绝并定位', () => {
  const rows = Array.from({ length: 33 }, () => '1 0').join('\n');
  const r1 = parseInput(rows, Array(33).fill('0').join(' '));
  assert.ok(r1.issues.some((i) => i.code === 'TOO_MANY_ROWS'));
  const wide = '0 '.repeat(41).trim();
  const r2 = parseInput(wide, '0');
  assert.ok(r2.issues.some((i) => i.code === 'TOO_MANY_COLS'));
});

test('多错误一次性全部返回，且不抛出', () => {
  const { issues } = parseInput('1 2\n1 0 0', 'x 0 1');
  assert.ok(issues.length >= 3);
});
