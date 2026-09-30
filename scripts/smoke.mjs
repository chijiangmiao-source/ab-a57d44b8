// HTTP/API 冒烟脚本（verify 一次性验收服务使用）：
//   - 健康路径 GET /health（HTTP 200 + status ok）
//   - 复核页面 GET /（HTTP 200 + HTML 关键内容）
//   - 静态资源 GET /app.js
//   - 复核 API：单位阵 0010、两列 11、不可张成、行宽不一、非法字符、综合症长度不符
// 目标地址可用 BASE_URL 环境变量配置（Compose 中指向 web 服务）；
// 未配置时在本地随机端口临时启动静态服务，结束后退出。
// 全部通过退出码 0，任一失败退出码 1。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

/** @param {string} msg */
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
/** @param {string} msg */
function bad(msg) {
  failures += 1;
  console.error(`  ✗ ${msg}`);
}

/**
 * @param {string} baseUrl
 */
async function smoke(baseUrl) {
  console.log(`== HTTP/API 冒烟（${baseUrl}）==`);

  // 1. 健康路径
  {
    const resp = await fetch(`${baseUrl}/health`);
    if (resp.status !== 200) {
      bad(`GET /health 状态码 ${resp.status}`);
    } else {
      const body = await resp.json();
      if (body.status === 'ok') ok('GET /health -> 200 {status: ok}');
      else bad(`GET /health 响应内容异常：${JSON.stringify(body)}`);
    }
  }

  // 2. 复核页面
  {
    const resp = await fetch(`${baseUrl}/`);
    const ct = resp.headers.get('content-type') ?? '';
    const html = await resp.text();
    if (resp.status === 200 && ct.includes('text/html') && html.includes('综合症复核')) {
      ok('GET / -> 200 复核页面 HTML');
    } else {
      bad(`GET / 异常：status=${resp.status} contentType=${ct}`);
    }
  }

  // 3. 静态资源
  {
    const resp = await fetch(`${baseUrl}/app.js`);
    if (resp.status === 200 && (await resp.text()).includes('/api/review')) {
      ok('GET /app.js -> 200');
    } else {
      bad(`GET /app.js 异常：status=${resp.status}`);
    }
  }

  // 4. API 验收用例
  await review(baseUrl, {
    name: '单位阵 + 0010 -> 第 3 列 / 重量 1 / 证据 0010',
    payload: { rows: ['1000', '0100', '0010', '0001'], syndrome: '0010' },
    check: (b) =>
      b.status === 'solvable' &&
      JSON.stringify(b.columns) === '[3]' &&
      b.weight === 1 &&
      b.bitstring === '0010' &&
      b.evidence === '0010',
  });

  await review(baseUrl, {
    name: '两列均为 11、目标 11 -> 第 2 列（位串 01）',
    payload: { rows: ['11', '11'], syndrome: '11' },
    check: (b) =>
      b.status === 'solvable' &&
      JSON.stringify(b.columns) === '[2]' &&
      b.bitstring === '01' &&
      b.evidence === '11',
  });

  await review(baseUrl, {
    name: '目标不可张成 -> unsolvable 且无证据字段',
    payload: { rows: ['00', '11'], syndrome: '10' },
    check: (b) =>
      b.status === 'unsolvable' &&
      !('evidence' in b) &&
      !('bitstring' in b) &&
      !('columns' in b),
  });

  await review(baseUrl, {
    name: '行宽不一 -> invalid 且定位到第 2 行',
    payload: { rows: ['101', '10', '111'], syndrome: '101' },
    check: (b) =>
      b.status === 'invalid' &&
      b.error?.code === 'ROW_WIDTH_MISMATCH' &&
      b.error?.rowWidth?.row === 1 &&
      !('evidence' in b),
  });

  await review(baseUrl, {
    name: '含非法字符 -> invalid 且给出行列坐标',
    payload: { rows: ['1a1', '01o'], syndrome: '11' },
    check: (b) =>
      b.status === 'invalid' &&
      b.error?.code === 'ILLEGAL_CHARACTER' &&
      Array.isArray(b.error?.cells) &&
      b.error.cells.length === 2 &&
      b.error.cells[0].row === 0 &&
      b.error.cells[0].column === 1,
  });

  await review(baseUrl, {
    name: '综合症长度不符 -> invalid 且给出期望/实际长度',
    payload: { rows: ['10', '01'], syndrome: '101' },
    check: (b) =>
      b.status === 'invalid' &&
      b.error?.code === 'SYNDROME_LENGTH_MISMATCH' &&
      b.error?.syndromeLength?.expected === 2 &&
      b.error?.syndromeLength?.actual === 3,
  });

  await review(baseUrl, {
    name: 'revision 原样回显（前端据此丢弃过期响应）',
    payload: { revision: 12345, rows: ['10', '01'], syndrome: '10' },
    check: (b) => b.revision === 12345,
  });
}

/**
 * @param {string} baseUrl
 * @param {{name: string, payload: unknown, check: (b: any) => boolean}} cfg
 */
async function review(baseUrl, cfg) {
  const resp = await fetch(`${baseUrl}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg.payload),
  });
  if (resp.status !== 200) {
    bad(`${cfg.name}：HTTP ${resp.status}`);
    return;
  }
  let body;
  try {
    body = await resp.json();
  } catch (err) {
    bad(`${cfg.name}：响应不是 JSON（${err instanceof Error ? err.message : err}）`);
    return;
  }
  if (cfg.check(body)) ok(cfg.name);
  else bad(`${cfg.name}：响应 ${JSON.stringify(body)}`);
}

async function main() {
  let baseUrl = process.env.BASE_URL ?? '';
  /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
  let child = null;

  if (!baseUrl) {
    console.log('未设置 BASE_URL，本地临时启动静态服务（随机端口）…');
    child = spawn(process.execPath, [join(root, 'src', 'server.js')], {
      cwd: root,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    });
    /** @type {string} */
    let output = '';
    baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const m = output.match(/listening on http:\/\/[^:]+:(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${m[1]}`);
        }
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`本地服务提前退出 code=${code}\n${output}`));
      });
    });
  }

  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/health`);
      break;
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`等待服务就绪超时：${baseUrl}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  try {
    await smoke(baseUrl.replace(/\/$/, ''));
  } finally {
    if (child) child.kill('SIGTERM');
  }

  if (failures > 0) {
    console.error(`冒烟失败：${failures} 项`);
    process.exit(1);
  }
  console.log('冒烟全部通过。');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
