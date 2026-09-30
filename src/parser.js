// 校验矩阵与综合症的输入解析及错误定位。
//
// 约定：矩阵按行录入，每行是一个 0/1 串；字符顺序同时是行号顺序（综合症）
// 与列号顺序（矩阵各列、解位串）。允许至多 32 行、40 列。

export const MAX_ROWS = 32;
export const MAX_COLS = 40;

/**
 * @typedef {Object} CellError
 * @property {number} row    0 基行号
 * @property {number} column 0 基列号（非法字符所在字符位置）
 * @property {string} kind   'illegal-char'
 * @property {string} char
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} code
 * @property {string} message
 * @property {{row: number, expected: number, actual: number}} [rowWidth]
 * @property {{expected: number, actual: number}} [syndromeLength]
 * @property {CellError[]} [cells]
 * @property {{actual: number}} [rowCount]
 * @property {{actual: number}} [columnCount]
 */

/**
 * @param {string[]} rawLines  原始草稿行（保留用户输入，便于继续编辑）
 * @param {string} syndromeRaw 原始综合症草稿
 * @returns {{rows: string[], syndrome: string, error: null} | {error: ValidationError, rows?: string[], syndrome?: string}}
 */
export function parseInput(rawLines, syndromeRaw) {
  const lines = rawLines.map((line) => stripOuter(line));
  const syndrome = stripOuter(syndromeRaw ?? '');

  // 空录入：视为尚未填写，报可定位的校验错误而非服务端异常。
  if (lines.length === 0 || lines.every((l) => l.length === 0)) {
    return {
      error: {
        code: 'EMPTY_MATRIX',
        message: '请至少录入一行校验矩阵。',
      },
    };
  }

  // 行数：仅统计非空行。
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length > MAX_ROWS) {
    return {
      error: {
        code: 'TOO_MANY_ROWS',
        message: `校验矩阵最多 ${MAX_ROWS} 行，当前为 ${nonEmpty.length} 行。`,
        rowCount: { actual: nonEmpty.length },
      },
    };
  }

  const width = nonEmpty[0].length;
  if (width === 0) {
    return {
      error: { code: 'EMPTY_MATRIX', message: '请至少录入一行校验矩阵。' },
    };
  }
  if (width > MAX_COLS) {
    return {
      error: {
        code: 'TOO_MANY_COLUMNS',
        message: `校验矩阵最多 ${MAX_COLS} 列，当前为 ${width} 列。`,
        columnCount: { actual: width },
      },
    };
  }

  // 行宽不一：逐行定位。
  for (let r = 0; r < nonEmpty.length; r += 1) {
    if (nonEmpty[r].length !== width) {
      return {
        error: {
          code: 'ROW_WIDTH_MISMATCH',
          message: `第 ${r + 1} 行长度为 ${nonEmpty[r].length}，与首行 ${width} 列不一致。`,
          rowWidth: { row: r, expected: width, actual: nonEmpty[r].length },
        },
      };
    }
  }

  // 非法字符：收集全部出现位置，页面逐格高亮。
  /** @type {CellError[]} */
  const cells = [];
  for (let r = 0; r < nonEmpty.length; r += 1) {
    for (let c = 0; c < nonEmpty[r].length; c += 1) {
      const ch = nonEmpty[r][c];
      if (ch !== '0' && ch !== '1') {
        cells.push({ row: r, column: c, kind: 'illegal-char', char: ch });
      }
    }
  }
  if (cells.length > 0) {
    return {
      error: {
        code: 'ILLEGAL_CHARACTER',
        message: `存在 ${cells.length} 个非 0/1 字符，已标出。`,
        cells,
      },
    };
  }

  // 综合症长度必须等于行数。
  if (syndrome.length !== nonEmpty.length) {
    return {
      error: {
        code: 'SYNDROME_LENGTH_MISMATCH',
        message: `综合症长度为 ${syndrome.length}，应等于矩阵行数 ${nonEmpty.length}。`,
        syndromeLength: { expected: nonEmpty.length, actual: syndrome.length },
      },
    };
  }
  if (!/^[01]*$/.test(syndrome)) {
    return {
      error: {
        code: 'ILLEGAL_CHARACTER_SYNDROME',
        message: '综合症只能包含 0 和 1。',
      },
    };
  }

  return { rows: nonEmpty, syndrome, error: null };
}

/**
 * 去掉录入时可能包裹的空白；不允许其它分隔符（逗号等会按非法字符定位）。
 * @param {string} text
 */
function stripOuter(text) {
  return String(text ?? '').trim();
}
