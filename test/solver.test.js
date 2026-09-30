// 求解器单元测试：覆盖验收要求的最小误码与规范裁决，以及不可张成、
// 零综合症、近 40 列性能与正确性（与小规模穷举交叉验证）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';

/**
 * 直接用列向量构造矩阵行串（m 行 n 列）。
 * @param {string[]} columns 每个元素是长度 m 的 0/1 列串（字符顺序=行号）
 * @returns {string[]}
 */
function matrixFromColumns(columns) {
  const n = columns.length;
  const m = n === 0 ? 0 : columns[0].length;
  /** @type {string[]} */
  const rows = new Array(m).fill('');
  for (let r = 0; r < m; r += 1) {
    let line = '';
    for (let c = 0; c < n; c += 1) line += columns[c][r];
    rows[r] = line;
  }
  return rows;
}

/**
 * 穷举 2^n 求参考解：返回最小重量解的位串（同重量字典序最小）。
 * @param {string[]} rows
 * @param {string} syndrome
 * @returns {string | null}
 */
function bruteForce(rows, syndrome) {
  const n = rows[0].length;
  const cols = new Array(n);
  for (let j = 0; j < n; j += 1) {
    let v = 0n;
    for (let r = 0; r < rows.length; r += 1) if (rows[r][j] === '1') v |= 1n << BigInt(r);
    cols[j] = v;
  }
  let target = 0n;
  for (let r = 0; r < syndrome.length; r += 1) if (syndrome[r] === '1') target |= 1n << BigInt(r);

  /** @type {string | null} */
  let best = null;
  const total = 1 << n;
  for (let mask = 0; mask < total; mask += 1) {
    let xor = 0n;
    let bs = '';
    let w = 0;
    for (let j = 0; j < n; j += 1) {
      const bit = (mask >> j) & 1;
      bs += bit;
      if (bit) {
        xor ^= cols[j];
        w += 1;
      }
    }
    if (xor !== target) continue;
    if (best === null || w < countOnes(best) || (w === countOnes(best) && bs < best)) best = bs;
  }
  return best;
}

/** @param {string} s */
function countOnes(s) {
  let w = 0;
  for (const ch of s) if (ch === '1') w += 1;
  return w;
}

// ---------------------------------------------------------------------------
// 验收用例 1：4 阶单位阵 + 综合症 0010。
// 数学事实：单位阵中第 j 列是第 j 位为 1 的单位向量；综合症 0010（第 3 个
// 字符为 1）唯一等于第 3 列，故最小重量解只能是第 3 列，重量 1，证据 0010。
// （验收文字若写“第4列”，与“证据 0010”自相矛盾，置换不变性可证伪。）
// ---------------------------------------------------------------------------
test('单位矩阵 + 综合症 0010：唯一最小解是第 3 列，重量 1，异或证据 0010', () => {
  const rows = ['1000', '0100', '0010', '0001'];
  const r = solve(rows, '0010');
  assert.equal(r.solvable, true);
  assert.deepEqual(r.columns, [3]);
  assert.equal(r.weight, 1);
  assert.equal(r.bitstring, '0010');
  assert.equal(r.evidence, '0010');
});

test('单位矩阵：任意单比特综合症命中对应列', () => {
  const rows = ['1000', '0100', '0010', '0001'];
  for (const [s, col] of [['1000', 1], ['0100', 2], ['0010', 3], ['0001', 4]]) {
    const r = solve(rows, s);
    assert.deepEqual(r.columns, [col], `s=${s}`);
    assert.equal(r.weight, 1);
    assert.equal(r.evidence, s);
  }
});

// ---------------------------------------------------------------------------
// 验收用例 2：两列均为 11，目标 11。两个重量 1 解：第 1 列位串 10、
// 第 2 列位串 01；按列号顺序比较且 0 < 1，01 更小，选第 2 列。
// ---------------------------------------------------------------------------
test('两列均为 11、目标 11：规范裁决选位串 01 对应的第 2 列', () => {
  const rows = ['11', '11'];
  const r = solve(rows, '11');
  assert.equal(r.solvable, true);
  assert.deepEqual(r.columns, [2]);
  assert.equal(r.weight, 1);
  assert.equal(r.bitstring, '01');
  assert.equal(r.evidence, '11');
});

test('两列均为 11、目标 00：零向量重量 0 是最小解', () => {
  const r = solve(['11', '11'], '00');
  assert.deepEqual(r.columns, []);
  assert.equal(r.weight, 0);
  assert.equal(r.bitstring, '00');
  assert.equal(r.evidence, '00');
});

// ---------------------------------------------------------------------------
// 不可张成：不得返回解或伪造证据。
// ---------------------------------------------------------------------------
test('目标不可张成：报告不可综合且无任何证据字段', () => {
  // 两列都是 01，列空间只含 {00,01}；目标 10 不可张成。
  const r = solve(['00', '11'], '10');
  assert.equal(r.solvable, false);
  assert.equal('evidence' in r, false);
  assert.equal('bitstring' in r, false);
  assert.equal('columns' in r, false);
});

test('单零列矩阵 + 非零目标：不可综合', () => {
  const r = solve(['0'], '1');
  assert.equal(r.solvable, false);
});

// ---------------------------------------------------------------------------
// 最小重量与规范裁决的更多用例。
// ---------------------------------------------------------------------------
test('存在重量 1 解时不取重量 2 解', () => {
  // 列：c1=10, c2=01, c3=11；目标 11 既等于 c3（重量1）也等于 c1⊕c2（重量2）。
  const rows = matrixFromColumns(['10', '01', '11']);
  const r = solve(rows, '11');
  assert.deepEqual(r.columns, [3]);
  assert.equal(r.weight, 1);
});

test('同重量多位解：位串字典序最小（最靠左的 1 尽量靠后）', () => {
  // 四列：c1=c3=10，c2=c4=01，目标 11。重量 2 的解中 0011（第3、4列）最小。
  const rows = matrixFromColumns(['10', '01', '10', '01']);
  const r = solve(rows, '11');
  assert.equal(r.weight, 2);
  assert.equal(r.bitstring, '0011');
  assert.deepEqual(r.columns, [3, 4]);
  assert.equal(r.evidence, '11');
});

test('最小重量为 3：三列异或', () => {
  // c1=100, c2=010, c3=001，目标 111 -> 必须取全部三列。
  const rows = matrixFromColumns(['100', '010', '001']);
  const r = solve(rows, '111');
  assert.equal(r.weight, 3);
  assert.equal(r.bitstring, '111');
  assert.equal(r.evidence, '111');
});

test('有零列与重复列时规范解避开零列并取靠后的等价列', () => {
  // c1=00（零列），c2=11，c3=11；目标 11 -> 重量1，第3列（001 < 010）。
  const rows = matrixFromColumns(['00', '11', '11']);
  const r = solve(rows, '11');
  assert.deepEqual(r.columns, [3]);
  assert.equal(r.bitstring, '001');
});

// ---------------------------------------------------------------------------
// 与穷举交叉验证：随机小规模矩阵，结果必须与 2^n 枚举完全一致。
// ---------------------------------------------------------------------------
test('随机矩阵：与穷举参考在 200 个实例上完全一致', () => {
  let seed = 0x12345678;
  const rand = () => {
    // 确定性 LCG，保证测试可复现。
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return ((seed >>> 8) & 0xffff) / 0x10000;
  };

  for (let inst = 0; inst < 200; inst += 1) {
    const n = 1 + Math.floor(rand() * 10);
    const m = 1 + Math.floor(rand() * 6);
    const columns = Array.from({ length: n }, () => {
      let s = '';
      for (let r = 0; r < m; r += 1) s += rand() < 0.5 ? '0' : '1';
      return s;
    });
    const rows = matrixFromColumns(columns);
    let syndrome = '';
    for (let r = 0; r < m; r += 1) syndrome += rand() < 0.5 ? '0' : '1';

    const expected = bruteForce(rows, syndrome);
    const got = solve(rows, syndrome);
    if (expected === null) {
      assert.equal(got.solvable, false, `实例 ${inst} 应不可综合`);
    } else {
      assert.equal(got.solvable, true, `实例 ${inst} 应可综合`);
      assert.equal(got.bitstring, expected, `实例 ${inst} 位串不一致`);
      assert.equal(got.weight, countOnes(expected), `实例 ${inst} 重量不一致`);
      // 证据必须真正等于综合症。
      assert.equal(got.evidence, syndrome, `实例 ${inst} 证据不等于综合症`);
    }
  }
});

// ---------------------------------------------------------------------------
// 近 40 列：性能与正确性。
// ---------------------------------------------------------------------------
test('40 列单位阵 + 第 32 位综合症：瞬间返回重量 1', () => {
  const n = 40;
  const rows = matrixFromColumns(
    Array.from({ length: n }, (_, j) => {
      let s = '';
      for (let r = 0; r < n; r += 1) s += r === j ? '1' : '0';
      return s;
    }),
  );
  let syndrome = '';
  for (let r = 0; r < n; r += 1) syndrome += r === 31 ? '1' : '0';
  const t0 = Date.now();
  const r = solve(rows, syndrome);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `耗时过长：${ms}ms`);
  assert.deepEqual(r.columns, [32]);
  assert.equal(r.evidence, syndrome);
});

test('40 列全 1 列（32 行）+ 全 1 综合症：重量 1，规范解为最后一列（位串 39 个 0 + 1）', () => {
  const m = 32;
  const n = 40;
  const allOne = '1'.repeat(m);
  const rows = matrixFromColumns(Array.from({ length: n }, () => allOne));
  const r = solve(rows, allOne);
  assert.equal(r.weight, 1);
  assert.equal(r.bitstring, `${'0'.repeat(n - 1)}1`);
  assert.deepEqual(r.columns, [n]);
});

test('40 列随机秩亏矩阵：最小解重量不超过秩，证据等于综合症', () => {
  let seed = 0xabcdef01;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 0x100000000;
  };
  const m = 12;
  const n = 40;
  // 由 6 个随机基列生成其他列，保证秩 <= 6、最小重量 <= 6。
  const basisCols = Array.from({ length: 6 }, () => {
    let s = '';
    for (let r = 0; r < m; r += 1) s += rand() < 0.5 ? '1' : '0';
    return s;
  });
  const parse = (/** @type {string} */ s) => {
    let v = 0n;
    for (let r = 0; r < s.length; r += 1) if (s[r] === '1') v |= 1n << BigInt(r);
    return v;
  };
  const fmt = (/** @type {bigint} */ v) => {
    let s = '';
    for (let r = 0; r < m; r += 1) s += ((v >> BigInt(r)) & 1n) === 1n ? '1' : '0';
    return s;
  };
  const columns = Array.from({ length: n }, () => {
    let v = 0n;
    for (const b of basisCols) if (rand() < 0.5) v ^= parse(b);
    return fmt(v);
  });
  const rows = matrixFromColumns(columns);
  // 目标保证在列空间内（两个列向量异或）。
  const target = parse(columns[5]) ^ parse(columns[17]);
  const syndrome = fmt(target);
  const t0 = Date.now();
  const r = solve(rows, syndrome);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `40 列搜索耗时过长：${ms}ms`);
  assert.equal(r.solvable, true);
  assert.ok(r.weight <= 6, `重量 ${r.weight} 超过秩上界`);
  assert.equal(r.evidence, syndrome);
  assert.equal(r.bitstring.length, n);
});
