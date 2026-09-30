// 复核页面交互：
// - textarea / input 中的原始草稿始终可编辑；
// - 输入变化即清空旧结论并递增 revision，任何迟到的旧响应都会因 revision
//   不匹配而被丢弃（旧计算结果不会覆盖新草稿）；
// - 校验错误按行列定位并在矩阵预览中逐格高亮；
// - “清空”按钮同时清空草稿与结论。

const matrixEl = document.getElementById('matrix');
const syndromeEl = document.getElementById('syndrome');
const previewEl = document.getElementById('matrix-preview');
const draftErrorEl = document.getElementById('draft-error');
const resultEl = document.getElementById('result');
const btnReview = document.getElementById('btn-review');
const btnClear = document.getElementById('btn-clear');
const btnDemoIdentity = document.getElementById('btn-demo-identity');
const btnDemoTwin = document.getElementById('btn-demo-twin');

// 草稿修订号：每次修改 +1；复核响应只在 revision 匹配时才允许落地。
let revision = 0;
// 最近一次服务端返回的非法字符位置，用于在预览中高亮。
let markedCells = new Set();

/**
 * 草稿被修改：旧结论立即失效（不等响应回来），修订号递增。
 */
function markDirty() {
  revision += 1;
  markedCells = new Set();
  renderResultPending(null);
  renderPreview();
  draftErrorEl.textContent = '';
}

matrixEl.addEventListener('input', markDirty);
syndromeEl.addEventListener('input', markDirty);

btnClear.addEventListener('click', () => {
  revision += 1;
  matrixEl.value = '';
  syndromeEl.value = '';
  markedCells = new Set();
  renderPreview();
  draftErrorEl.textContent = '';
  renderResultEmpty();
  matrixEl.focus();
});

btnDemoIdentity.addEventListener('click', () => {
  matrixEl.value = ['1000', '0100', '0010', '0001'].join('\n');
  syndromeEl.value = '0010';
  markDirty();
});

btnDemoTwin.addEventListener('click', () => {
  matrixEl.value = ['11', '11'].join('\n');
  syndromeEl.value = '11';
  markDirty();
});

btnReview.addEventListener('click', async () => {
  const myRevision = revision + 1;
  revision = myRevision;
  const rows = matrixEl.value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  const syndrome = syndromeEl.value.trim();

  btnReview.disabled = true;
  renderResultPending(myRevision);

  let payload;
  try {
    const resp = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: myRevision, rows, syndrome }),
    });
    payload = await resp.json();
  } catch (err) {
    btnReview.disabled = false;
    // 网络层失败也不得覆盖更新的草稿状态。
    if (revision !== myRevision) return;
    renderResultError(`复核请求失败：${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 请求已结束，无论结果是否过期都恢复按钮。
  btnReview.disabled = false;

  // 关键的过期保护：用户在等待期间改过草稿 -> 丢弃本次结果。
  if (payload.revision !== undefined && payload.revision !== revision) return;
  if (revision !== myRevision) return;
  draftErrorEl.textContent = '';
  markedCells = new Set();

  if (payload.status === 'invalid') {
    renderDraftError(payload.error);
    renderPreview();
    // 校验失败时旧结论必须消失，且不展示任何伪造证据。
    renderResultInvalid(payload.error);
    return;
  }

  if (payload.status === 'unsolvable') {
    renderResultUnsolvable(payload);
    renderPreview();
    return;
  }

  if (payload.status === 'solvable') {
    // 高亮被选中的列（第一处出现的列位置）。
    for (const col of payload.columns) markedCells.add(`sel:${col - 1}`);
    renderPreview(payload.columns);
    renderResultSolvable(payload);
    return;
  }

  renderResultError('服务端返回了无法识别的结论。');
});

/**
 * 矩阵预览：逐字符渲染，非法字符格标红、命中列标绿。
 * @param {number[]} [selectedColumns1]
 */
function renderPreview(selectedColumns1 = []) {
  const selected = new Set((selectedColumns1 ?? []).map((c) => c - 1));
  const lines = matrixEl.value.split('\n');
  previewEl.innerHTML = '';
  lines.forEach((rawLine, r) => {
    const line = rawLine.trim();
    if (line.length === 0) return;
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    const head = document.createElement('span');
    head.className = 'row-head';
    head.textContent = `第${r + 1}行`;
    rowEl.append(head);
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      const cell = document.createElement('span');
      cell.className = 'cell';
      cell.classList.add(ch === '1' ? 'one' : ch === '0' ? 'zero' : 'bad');
      if (ch !== '0' && ch !== '1') {
        cell.classList.add('bad');
        cell.title = `第 ${r + 1} 行第 ${c + 1} 列：非法字符 “${ch}”`;
      } else if (selected.has(c)) {
        cell.classList.add('sel');
      }
      cell.textContent = ch;
      rowEl.append(cell);
    }
    previewEl.append(rowEl);
  });
}

/**
 * @param {any} error
 */
function renderDraftError(error) {
  draftErrorEl.textContent = '';
  const main = document.createElement('span');
  main.textContent = error?.message ?? '输入不合法。';
  draftErrorEl.append(main);

  if (error?.code === 'ILLEGAL_CHARACTER' && Array.isArray(error.cells)) {
    // 按行分组展示可定位的错误。
    const groups = new Map();
    for (const cell of error.cells) {
      if (!groups.has(cell.row)) groups.set(cell.row, []);
      groups.get(cell.row).push(cell);
    }
    for (const [row, cells] of groups) {
      const line = document.createElement('span');
      line.className = 'err-line';
      const positions = cells
        .map((c) => `第 ${c.column + 1} 列 “${c.char}”`)
        .join('、');
      line.textContent = `第 ${row + 1} 行：${positions}`;
      draftErrorEl.append(line);
    }
  }
  if (error?.code === 'ROW_WIDTH_MISMATCH' && error.rowWidth) {
    const { row, expected, actual } = error.rowWidth;
    const line = document.createElement('span');
    line.className = 'err-line';
    line.textContent = `定位：第 ${row + 1} 行有 ${actual} 个字符，应为 ${expected} 个。`;
    draftErrorEl.append(line);
  }
  if (error?.code === 'SYNDROME_LENGTH_MISMATCH' && error.syndromeLength) {
    const { expected, actual } = error.syndromeLength;
    const line = document.createElement('span');
    line.className = 'err-line';
    line.textContent = `定位：综合症当前 ${actual} 个字符，应为 ${expected} 个。`;
    draftErrorEl.append(line);
  }
}

function renderResultEmpty() {
  resultEl.innerHTML = '<p class="muted">尚未发起复核。</p>';
}

/**
 * @param {number | null} myRevision
 */
function renderResultPending(myRevision) {
  if (myRevision === null) {
    // 草稿已变更：旧结论立即消失。
    resultEl.innerHTML = '<p class="muted">草稿已修改，原结论已失效，请重新发起复核。</p>';
    return;
  }
  resultEl.innerHTML =
    '<span class="badge pending">计算中</span><p class="muted">正在精确搜索最小汉明重量解…</p>';
}

/**
 * @param {any} error
 */
function renderResultInvalid(error) {
  resultEl.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'badge invalid';
  badge.textContent = '输入不合法';
  resultEl.append(badge);
  const p = document.createElement('p');
  p.textContent = error?.message ?? '请修正草稿后重新复核；本次不产生任何结论或证据。';
  resultEl.append(p);
}

/**
 * @param {any} payload
 */
function renderResultUnsolvable(payload) {
  resultEl.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'badge unsolvable';
  badge.textContent = '不可综合';
  resultEl.append(badge);
  const p = document.createElement('p');
  p.textContent = payload.message ?? '目标综合症不在矩阵列空间中。';
  resultEl.append(p);
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = '不存在满足 Hx = s 的二进制向量，因此不提供任何“证据”位串。';
  resultEl.append(note);
}

/**
 * @param {any} payload
 */
function renderResultSolvable(payload) {
  resultEl.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'badge solvable';
  badge.textContent = '可综合 · 最小重量解';
  resultEl.append(badge);

  const kv = document.createElement('div');
  kv.className = 'kv';

  kv.append(line('命中列号', payload.columns.map((c) => `第 ${c} 列`).join('、')));
  kv.append(line('最小重量', String(payload.weight)));
  kv.append(line('解位串 x', payload.bitstring));
  kv.append(line('异或证据', payload.evidence));
  if (typeof payload.rank === 'number') kv.append(line('矩阵秩', String(payload.rank)));

  resultEl.append(kv);
}

/**
 * @param {string} text
 */
function renderResultError(text) {
  resultEl.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'badge invalid';
  badge.textContent = '请求异常';
  resultEl.append(badge);
  const p = document.createElement('p');
  p.textContent = text;
  resultEl.append(p);
}

/**
 * @param {string} k
 * @param {string} v
 */
function line(k, v) {
  const row = document.createElement('div');
  row.className = 'line';
  const key = document.createElement('span');
  key.className = 'k';
  key.textContent = k;
  const val = document.createElement('span');
  val.className = 'v';
  val.textContent = v;
  row.append(key, val);
  return row;
}

// 初始渲染。
renderPreview();
