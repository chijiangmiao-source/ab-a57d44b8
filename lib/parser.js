'use strict';

// 网页录入内容的解析与校验。
// 允许以空白或逗号分隔的 0/1；行以换行分隔。
// 所有错误一次性收集（含 1 基行/列位置），便于页面定位，且不丢弃草稿。

const MAX_ROWS = 32;
const MAX_COLS = 40;

/**
 * @typedef {Object} Issue
 * @property {string} code 错误码
 * @property {string} message 中文说明
 * @property {number} [row] 1 基行号（矩阵行；综合症问题 row=0）
 * @property {number} [col] 1 基列号/字符位
 */

/** 将一段文本切分为 token 及其在原文中的字符下标 */
function tokenize(line) {
  const tokens = [];
  const re = /[^\s,]+/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], index: m.index });
  }
  return tokens;
}

/**
 * 把一个 token 展开为若干 0/1：
 *  - "0" / "1" 按单元素处理；
 *  - 仅由 0/1 组成的多字符紧凑串（如 "0010"）逐字符拆位；
 *  - 其余整体作为非法元素返回（null 占位并保留定位）。
 * 返回 { bits, bad }；bad 为非法原文（可能为 null）。
 */
function expandToken(tok) {
  if (tok.text === '0' || tok.text === '1') return { bits: [tok.text === '1' ? 1 : 0], bad: null };
  if (/^[01]+$/.test(tok.text)) {
    return { bits: tok.text.split('').map((ch) => (ch === '1' ? 1 : 0)), bad: null };
  }
  // 非法 token 按字符数占位，使行宽比较在同行存在笔误时仍尽量准确
  return { bits: new Array(tok.text.length).fill(null), bad: tok.text };
}

/**
 * @param {string} matrixText
 * @param {string} syndromeText
 * @returns {{issues: Issue[], matrix: number[][], syndrome: number[]}}
 */
function parseInput(matrixText, syndromeText) {
  const issues = [];
  const rawLines = String(matrixText ?? '').split(/\r?\n/);
  const lineTokens = [];
  for (const line of rawLines) {
    if (line.trim() === '') continue;
    lineTokens.push(tokenize(line));
  }

  if (lineTokens.length === 0) {
    issues.push({ code: 'MATRIX_EMPTY', message: '校验矩阵为空，请至少录入 1 行。' });
  }
  if (lineTokens.length > MAX_ROWS) {
    issues.push({
      code: 'TOO_MANY_ROWS',
      row: MAX_ROWS + 1,
      message: `校验矩阵最多 ${MAX_ROWS} 行，当前有 ${lineTokens.length} 行。`,
    });
  }

  const matrix = [];
  const rowLengths = [];
  lineTokens.forEach((tokens, li) => {
    const row = [];
    tokens.forEach((tok) => {
      const { bits, bad } = expandToken(tok);
      if (bad !== null) {
        issues.push({
          code: 'ILLEGAL_CHAR',
          row: li + 1,
          col: tok.index + 1,
          message: `第 ${li + 1} 行第 ${tok.index + 1} 列含非法字符“${bad}”，只允许 0 或 1。`,
        });
      }
      for (const b of bits) row.push(b);
    });
    rowLengths.push(row.length);
    matrix.push(row);
  });

  // 参考宽度取各行长度的众数（并列取最大），避免首行笔误污染后续行判断。
  let width = -1;
  if (rowLengths.length) {
    const freq = new Map();
    for (const len of rowLengths) freq.set(len, (freq.get(len) || 0) + 1);
    let bestFreq = -1;
    for (const [len, f] of freq) {
      if (f > bestFreq || (f === bestFreq && len > width)) { width = len; bestFreq = f; }
    }
    matrix.forEach((row, li) => {
      if (row.length !== width) {
        issues.push({
          code: 'WIDTH_MISMATCH',
          row: li + 1,
          col: row.length + 1,
          message: `第 ${li + 1} 行有 ${row.length} 个元素，与参考宽度 ${width} 不一致。`,
        });
      }
    });
  }

  if (width > MAX_COLS) {
    issues.push({
      code: 'TOO_MANY_COLS',
      message: `校验矩阵最多 ${MAX_COLS} 列，当前首行宽度为 ${width}。`,
    });
  }

  // ---- 综合症：允许单行内以空白/逗号分隔，也允许跨行 ----
  const synTokens = [];
  String(syndromeText ?? '').split(/\r?\n/).forEach((line) => {
    for (const t of tokenize(line)) synTokens.push(t);
  });
  const syndrome = [];
  synTokens.forEach((tok) => {
    const { bits, bad } = expandToken(tok);
    if (bad !== null) {
      issues.push({
        code: 'SYNDROME_ILLEGAL_CHAR',
        row: 0,
        col: tok.index + 1,
        message: `综合症第 ${tok.index + 1} 位含非法字符“${bad}”，只允许 0 或 1。`,
      });
      syndrome.push(null);
    } else {
      for (const b of bits) syndrome.push(b);
    }
  });
  if (synTokens.length === 0) {
    issues.push({ code: 'SYNDROME_EMPTY', row: 0, message: '综合症为空。' });
  } else if (
    lineTokens.length > 0
    && syndrome.length !== lineTokens.length
    && !issues.some((i) => i.code === 'SYNDROME_ILLEGAL_CHAR')
  ) {
    issues.push({
      code: 'SYNDROME_LENGTH',
      row: 0,
      col: syndrome.length + 1,
      message: `综合症长度 ${syndrome.length} 与矩阵行数 ${lineTokens.length} 不符（Hx=s 中 s 的长度须等于矩阵行数）。`,
    });
  }

  return { issues, matrix, syndrome };
}

module.exports = { parseInput, MAX_ROWS, MAX_COLS };
