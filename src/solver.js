// 精确求解二进制线性系统 Hx = s 的最小汉明重量解。
//
// 方法（n <= 40，m <= 32）：
//   1. GF(2) 高斯消元：s 不在列空间时立即判定“不可综合”，无需任何枚举；
//      同时得到秩 rank（最小重量上界）。
//   2. 按重量 w = 1, 2, ... 逐层做折半搜索（meet-in-the-middle）：列切成
//      两半（每半至多 20 列），两侧各自枚举“恰好选 wL / wR 列”的组合并建
//      异或哈希表，表碰撞即该重量有解。首个可行重量即最小重量——既不限制
//      误码数，也不随机尝试，更不枚举 2^40 种全组合（最坏单层组合数上界
//      仅为 C(20,10) ≈ 1.8×10^5）。
//   3. 规范裁决：同一异或值只保留位串字典序最小的选法（列号从小到大读，
//      '0' < '1'）；配对碰撞时先比左半位串、再比右半，取全局最小。

/**
 * @typedef {Object} SolveResult
 * @property {boolean} solvable
 * @property {number[]} [columns]   取值为 1 的列号（1 基，升序）
 * @property {number}   [weight]    汉明重量
 * @property {string}   [bitstring] 长度 n 的 0/1 位串，第 j 个字符对应第 j 列
 * @property {string}   [evidence]  选中列逐列异或得到的 m 位综合症串
 * @property {number}   [rank]      矩阵秩
 */

/**
 * @param {string[]} matrixRows 长度一致的 0/1 串数组（m 行 n 列，按行给出）
 * @param {string} syndrome     长度 m 的 0/1 串；第 r 个字符对应第 r 行
 * @returns {SolveResult}
 */
export function solve(matrixRows, syndrome) {
  const m = matrixRows.length;
  if (m === 0) {
    return syndrome.length === 0
      ? { solvable: true, columns: [], weight: 0, bitstring: '', evidence: '', rank: 0 }
      : { solvable: false, rank: 0 };
  }
  const n = matrixRows[0].length;

  // 第 j 列：BigInt 的第 r 位为 H[r][j]；字符下标即行号、列号。
  const cols = new Array(n);
  for (let j = 0; j < n; j += 1) {
    let v = 0n;
    for (let r = 0; r < m; r += 1) {
      if (matrixRows[r][j] === '1') v |= 1n << BigInt(r);
    }
    cols[j] = v;
  }

  let target = 0n;
  for (let r = 0; r < m; r += 1) {
    if (syndrome[r] === '1') target |= 1n << BigInt(r);
  }

  const basis = buildBasis(cols);
  const rank = basis.size;

  // s = 0：零向量是重量 0 的唯一最小解。
  if (target === 0n) {
    return {
      solvable: true,
      columns: [],
      weight: 0,
      bitstring: '0'.repeat(n),
      evidence: '0'.repeat(m),
      rank,
    };
  }

  // s 不落在列空间 -> 不存在任何解，且不产生任何“证据”。
  if (reduceByBasis(target, basis) !== 0n) {
    return { solvable: false, rank };
  }

  const half = n >> 1; // 左半 [0, half)，右半 [half, n)
  const leftTables = new Map();
  const rightTables = new Map();
  /**
   * @param {Map<number, Map<bigint, number[]>>} cache
   */
  const getTable = (cache, lo, hi, k) => {
    let table = cache.get(k);
    if (!table) {
      table = buildXorTable(cols, lo, hi, k);
      cache.set(k, table);
    }
    return table;
  };

  // target 在列空间中，必能由至多 rank 个原始列线性表示，故 w <= rank。
  for (let w = 1; w <= rank; w += 1) {
    /** @type {{ L: number[]; R: number[] } | null} */
    let best = null;

    const wLMin = Math.max(0, w - (n - half));
    const wLMax = Math.min(w, half);
    for (let wL = wLMin; wL <= wLMax; wL += 1) {
      const left = getTable(leftTables, 0, half, wL);
      const right = getTable(rightTables, half, n, w - wL);
      if (left.size === 0 || right.size === 0) continue;

      // 遍历较小的表去查较大的表。
      const [first, second, firstIsLeft] =
        left.size <= right.size ? [left, right, true] : [right, left, false];

      for (const [xor, pick] of first) {
        const other = second.get(target ^ xor);
        if (other === undefined) continue;
        const candidate = firstIsLeft ? { L: pick, R: other } : { L: other, R: pick };
        if (best === null || pairLess(candidate, best)) best = candidate;
      }
    }

    if (best !== null) {
      return buildResult(best.L.concat(best.R), cols, n, m, rank);
    }
  }

  // 理论不可达：已通过张成判定；保留兜底以防编程错误被误当成“解”。
  return { solvable: false, rank };
}

/**
 * 枚举区间 [lo, hi) 内恰好选 k 列的全部组合，构造
 * xor -> 该异或值下位串字典序最小的升序下标数组 的映射。
 *
 * @param {bigint[]} cols
 * @param {number} lo
 * @param {number} hi
 * @param {number} k
 * @returns {Map<bigint, number[]>}
 */
function buildXorTable(cols, lo, hi, k) {
  /** @type {Map<bigint, number[]>} */
  const table = new Map();
  if (k < 0 || k > hi - lo) return table;

  /** @type {number[]} */
  const idx = [];
  /**
   * @param {number} start
   * @param {bigint} xor
   */
  const recurse = (start, xor) => {
    if (idx.length === k) {
      const prev = table.get(xor);
      if (prev === undefined || bitstringLess(idx, prev)) {
        table.set(xor, idx.slice());
      }
      return;
    }
    // 剩余需选个数：k - idx.length，本层位置上界为 hi - need。
    const need = k - idx.length;
    for (let p = start; p <= hi - need; p += 1) {
      idx.push(p);
      recurse(p + 1, xor ^ cols[p]);
      idx.pop();
    }
  };
  recurse(lo, 0n);
  return table;
}

/**
 * 比较两个（同区间、基数可不同的）升序下标数组对应的位串：
 * 从区间左端起第一个不同位置上，不含该位置的数组位串为 0，因而更小。
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean} a 的位串是否严格小于 b 的位串
 */
function bitstringLess(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) {
      return false; // 第一个差异位置 a[i] 只属于 a -> a 在该位为 1
    } else {
      return true; // 第一个差异位置 b[j] 只属于 b -> a 在该位为 0
    }
  }
  if (i < a.length) return false; // a 还有多余的 1
  if (j < b.length) return true;
  return false; // 完全相同
}

/**
 * 配对比较：左半位串优先，左半相同再比右半。
 * @param {{L: number[], R: number[]}} a
 * @param {{L: number[], R: number[]}} b
 */
function pairLess(a, b) {
  if (!sameArray(a.L, b.L)) return bitstringLess(a.L, b.L);
  return bitstringLess(a.R, b.R);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 由列集合构造主元消元基：Map<主元位, 基向量>。
 * @param {bigint[]} cols
 * @returns {Map<number, bigint>}
 */
function buildBasis(cols) {
  /** @type {Map<number, bigint>} */
  const basis = new Map();
  for (const original of cols) {
    const v = reduceByBasis(original, basis);
    if (v !== 0n) basis.set(bitLength(v) - 1, v);
  }
  return basis;
}

/**
 * 用现有主元基反复消去 v 的最高位。
 * @param {bigint} v
 * @param {Map<number, bigint>} basis
 * @returns {bigint}
 */
function reduceByBasis(v, basis) {
  while (v !== 0n) {
    const pivot = bitLength(v) - 1;
    const b = basis.get(pivot);
    if (b === undefined) break;
    v ^= b;
  }
  return v;
}

/**
 * @param {number[]} columns0 0 基升序列下标
 * @param {bigint[]} cols
 * @param {number} n
 * @param {number} m
 * @param {number} rank
 * @returns {SolveResult}
 */
function buildResult(columns0, cols, n, m, rank) {
  const chosen = new Set(columns0);
  let xor = 0n;
  let bitstring = '';
  for (let j = 0; j < n; j += 1) {
    if (chosen.has(j)) {
      xor ^= cols[j];
      bitstring += '1';
    } else {
      bitstring += '0';
    }
  }
  return {
    solvable: true,
    columns: columns0.map((j) => j + 1),
    weight: columns0.length,
    bitstring,
    evidence: formatBits(xor, m),
    rank,
  };
}

/**
 * @param {bigint} v
 * @param {number} m
 * @returns {string}
 */
function formatBits(v, m) {
  let out = '';
  for (let r = 0; r < m; r += 1) {
    out += ((v >> BigInt(r)) & 1n) === 1n ? '1' : '0';
  }
  return out;
}

/**
 * @param {bigint} v
 * @returns {number}
 */
function bitLength(v) {
  return v === 0n ? 0 : v.toString(2).length;
}
