'use strict';

// 复核页面逻辑。
// 关键并发语义：每次“发起复核”带一个本地递增令牌 reqSeq；
// 草稿任一位被修改都会使旧令牌失效——旧计算结果返回时直接丢弃，
// 绝不能覆盖更新后的草稿与结论区。

const $ = (id) => document.getElementById(id);
const matrixEl = $('matrix');
const synEl = $('syndrome');
const issuesEl = $('issues');
const resultEl = $('result');
const emptyEl = $('emptyState');
const resultTag = $('resultTag');
const busyEl = $('busy');
const verifyBtn = $('verifyBtn');

let reqSeq = 0;
const DRAFT_KEY = 'parity-check-draft-v1';

// ---------- 草稿持久化（仅本地，刷新不丢；清空时移除） ----------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ matrix: matrixEl.value, syndrome: synEl.value }));
  } catch { /* 忽略存储异常 */ }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d) {
      matrixEl.value = d.matrix || '';
      synEl.value = d.syndrome || '';
    }
  } catch { /* 忽略 */ }
}

// ---------- 尺寸提示 ----------
function bitsOf(text) {
  return (text.match(/[01]/g) || []).length;
}
function dimsOf(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { rows: 0, cols: 0 };
  const widths = lines.map(bitsOf);
  return { rows: lines.length, cols: Math.max(...widths), widths };
}
function refreshMeta() {
  const d = dimsOf(matrixEl.value);
  $('matrixMeta').textContent = d.rows
    ? `${d.rows} 行 × 约 ${d.cols} 列（限制 32 × 40）`
    : '尚未录入';
  const len = bitsOf(synEl.value);
  $('syndromeMeta').textContent = len ? `${len} 位` : '尚未录入';
}

// ---------- 结论区渲染 ----------
function resetConclusion(tag, showEmpty) {
  issuesEl.hidden = true;
  issuesEl.innerHTML = '';
  resultEl.hidden = true;
  resultEl.innerHTML = '';
  emptyEl.hidden = !showEmpty;
  resultTag.textContent = tag;
}

function renderIssues(issues) {
  resetConclusion('草稿有误', false);
  issuesEl.hidden = false;
  for (const it of issues) {
    const div = document.createElement('div');
    div.className = 'issue';
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = it.code === 'SYNDROME_EMPTY' || it.code === 'SYNDROME_ILLEGAL_CHAR' || it.code === 'SYNDROME_LENGTH'
      ? '[综合症] '
      : it.row ? `[第 ${it.row} 行${it.col ? ` 第 ${it.col} 字符位` : ''}] ` : '';
    div.append(pos, document.createTextNode(it.message));
    issuesEl.appendChild(div);
  }
}

function bitStringHtml(bits) {
  return bits
    .map((b, j) => `<span class="${b ? 'on' : 'off'}">${b}</span>`)
    .join('');
}

function columnRuler(n) {
  let s = '';
  for (let j = 1; j <= n; j++) s += String(j % 10);
  return s;
}

function renderSolved(payload) {
  resetConclusion('复核完成：已综合', false);
  resultEl.hidden = false;
  const r = payload.result;

  const block = (title, inner) => {
    const b = document.createElement('div');
    b.className = 'result-block';
    const h = document.createElement('h3');
    h.textContent = title;
    const body = document.createElement('div');
    body.innerHTML = inner;
    b.append(h, body);
    resultEl.appendChild(b);
    return body;
  };

  block('最小汉明重量', `<span class="bits"><span class="on feat">w = ${r.weight}</span></span>`);
  block(
    '选中列（1 基列号）',
    `<span class="bits">${r.columns.map((c) => `第${c}列`).join('、') || '（无，零向量）'}</span>`,
  );
  block(
    `解向量 x（按列号顺序，共 ${r.solution.length} 位；上行数字为列号个位）`,
    `<div class="col-nums">${columnRuler(r.solution.length)}</div><div class="bits">${bitStringHtml(r.solution)}</div>`,
  );

  // 异或证据：0 → 逐列累加 → s；不可综合分支不会进入此函数。
  const ev = r.evidence
    .map((vec, idx) => {
      const cls = idx === r.evidence.length - 1 ? 'step final' : 'step';
      const label = idx === 0 ? '起点 0' : idx === r.evidence.length - 1 ? '结果 s' : `第 ${idx} 步`;
      return `<span class="${cls}">${label}: ${vec.join('')}</span>`;
    })
    .join('');
  block('异或证据（选中列按列号升序累加）', `<div class="evidence">${ev}</div>`);
}

function renderInfeasible(message) {
  // 不可综合：仅文字结论，刻意不渲染任何证据字段。
  resetConclusion('不可综合', false);
  resultEl.hidden = false;
  const div = document.createElement('div');
  div.className = 'infeasible';
  div.textContent = message;
  resultEl.appendChild(div);
}

// ---------- 发起复核 ----------
async function runVerify() {
  saveDraft();
  const seq = ++reqSeq;
  resetConclusion('复核中…', false);
  busyEl.hidden = false;
  verifyBtn.disabled = true;
  try {
    const resp = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matrix: matrixEl.value, syndrome: synEl.value }),
    });
    const data = await resp.json();
    // 旧请求结果：草稿可能已被修改，直接丢弃，绝不覆盖当前结论区。
    if (seq !== reqSeq) return;
    if (!resp.ok || !data.ok) {
      resetConclusion('服务异常', false);
      resultEl.hidden = false;
      resultEl.textContent = data.error || `请求失败（HTTP ${resp.status}）`;
      return;
    }
    if (data.status === 'invalid') renderIssues(data.issues);
    else if (data.status === 'infeasible') renderInfeasible(data.message);
    else if (data.status === 'solved') renderSolved(data);
    else resetConclusion('未知响应', true);
  } catch (err) {
    if (seq !== reqSeq) return;
    resetConclusion('网络错误', false);
    resultEl.hidden = false;
    resultEl.textContent = '无法连接复核服务：' + err.message;
  } finally {
    if (seq === reqSeq) {
      busyEl.hidden = true;
      verifyBtn.disabled = false;
    }
  }
}

// ---------- 事件绑定 ----------
verifyBtn.addEventListener('click', runVerify);

$('clearBtn').addEventListener('click', () => {
  reqSeq++; // 使任何在途结果失效
  matrixEl.value = '';
  synEl.value = '';
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
  refreshMeta();
  resetConclusion('等待复核', true);
  matrixEl.focus();
});

// 草稿任一位变化：旧结论立即消失、在途结果作废；草稿原文保留可编辑。
function onDraftChange() {
  reqSeq++;
  busyEl.hidden = true;
  verifyBtn.disabled = false;
  saveDraft();
  refreshMeta();
  resetConclusion('草稿已修改，请重新发起复核', true);
}
matrixEl.addEventListener('input', onDraftChange);
synEl.addEventListener('input', onDraftChange);

// 初始化
loadDraft();
refreshMeta();
resetConclusion('等待复核', true);
