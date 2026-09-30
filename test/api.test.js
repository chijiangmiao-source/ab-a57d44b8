// API / HTTP 集成测试：用真实 HTTP 服务器（端口 0 自动分配）验证
// 健康路径、静态页面、复核接口、错误定位、不可张成响应与 revision 回显。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** @type {import('node:child_process').ChildProcessWithoutNullStreams} */
let server;
let baseUrl;

before(async () => {
  server = spawn(process.execPath, [join(root, 'src', 'server.js')], {
    cwd: root,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  });
  /** @type {string} */
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const m = output.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    server.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（code=${code}）：\n${output}`));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
});

/**
 * @param {string} path
 * @param {RequestInit & {json?: unknown}} [init]
 */
async function req(path, init) {
  const opts = { ...init };
  if (init?.json !== undefined) {
    opts.method = init.method ?? 'POST';
    opts.headers = { 'Content-Type': 'application/json', ...init.headers };
    opts.body = JSON.stringify(init.json);
  }
  return fetch(`${baseUrl}${path}`, opts);
}

test('GET /health 返回 200 与 ok 状态', async () => {
  const resp = await req('/health');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.status, 'ok');
});

test('GET /healthz 作为健康路径别名同样可用', async () => {
  const resp = await req('/healthz');
  assert.equal(resp.status, 200);
});

test('GET / 返回复核页面 HTML', async () => {
  const resp = await req('/');
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type') ?? '', /text\/html/);
  const html = await resp.text();
  assert.match(html, /综合症复核/);
  assert.match(html, /src="\/app\.js"/);
});

test('GET /app.js 与 /styles.css 静态资源可达', async () => {
  for (const p of ['/app.js', '/styles.css']) {
    const resp = await req(p);
    assert.equal(resp.status, 200, p);
  }
});

test('GET 未知资源返回 404', async () => {
  const resp = await req('/no-such-file.txt');
  assert.equal(resp.status, 404);
});

test('POST /api/review 单位阵 + 0010：第 3 列、重量 1、证据 0010', async () => {
  const resp = await req('/api/review', {
    json: {
      revision: 7,
      rows: ['1000', '0100', '0010', '0001'],
      syndrome: '0010',
    },
  });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.status, 'solvable');
  assert.deepEqual(body.columns, [3]);
  assert.equal(body.weight, 1);
  assert.equal(body.bitstring, '0010');
  assert.equal(body.evidence, '0010');
  // revision 必须原样回显，供前端丢弃过期响应。
  assert.equal(body.revision, 7);
});

test('POST 两列均为 11、目标 11：选择第 2 列（位串 01）', async () => {
  const resp = await req('/api/review', {
    json: { rows: ['11', '11'], syndrome: '11' },
  });
  const body = await resp.json();
  assert.equal(body.status, 'solvable');
  assert.deepEqual(body.columns, [2]);
  assert.equal(body.bitstring, '01');
  assert.equal(body.evidence, '11');
});

test('POST 不可张成目标：status=unsolvable 且不返回任何证据字段', async () => {
  const resp = await req('/api/review', {
    json: { rows: ['00', '11'], syndrome: '10' },
  });
  const body = await resp.json();
  assert.equal(body.status, 'unsolvable');
  assert.equal('evidence' in body, false);
  assert.equal('bitstring' in body, false);
  assert.equal('columns' in body, false);
  assert.match(body.message, /不可综合/);
});

test('POST 行宽不一：invalid + 精确定位出错行，且不返回证据', async () => {
  const resp = await req('/api/review', {
    json: { rows: ['101', '10', '111'], syndrome: '101' },
  });
  const body = await resp.json();
  assert.equal(body.status, 'invalid');
  assert.equal(body.error.code, 'ROW_WIDTH_MISMATCH');
  assert.deepEqual(body.error.rowWidth, { row: 1, expected: 3, actual: 2 });
  assert.equal('evidence' in body, false);
});

test('POST 含非法字符：invalid + 全部非法格的行列坐标', async () => {
  const resp = await req('/api/review', {
    json: { rows: ['1a1', '01o'], syndrome: '11' },
  });
  const body = await resp.json();
  assert.equal(body.status, 'invalid');
  assert.equal(body.error.code, 'ILLEGAL_CHARACTER');
  assert.deepEqual(body.error.cells, [
    { row: 0, column: 1, kind: 'illegal-char', char: 'a' },
    { row: 1, column: 2, kind: 'illegal-char', char: 'o' },
  ]);
});

test('POST 综合症长度不符：invalid + 期望/实际长度', async () => {
  const resp = await req('/api/review', {
    json: { rows: ['10', '01'], syndrome: '101' },
  });
  const body = await resp.json();
  assert.equal(body.status, 'invalid');
  assert.equal(body.error.code, 'SYNDROME_LENGTH_MISMATCH');
  assert.deepEqual(body.error.syndromeLength, { expected: 2, actual: 3 });
});

test('POST 非法 JSON：400 而非服务崩溃', async () => {
  const resp = await fetch(`${baseUrl}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(resp.status, 400);
  // 服务仍然存活。
  const health = await req('/health');
  assert.equal(health.status, 200);
});
