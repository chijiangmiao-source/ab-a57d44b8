'use strict';

// 一次性验收运行器（compose 服务 verify 执行后退出，以退出码报告）。
// 环节：
//   1) 最小误码 / 规范裁决 / 不可张成 的代码级单元测试；
//   2) 页面构建检查：前端资源齐备、JS 语法通过、并发失效逻辑存在；
//   3) 启动真实静态服务，健康路径与复核页面 API/HTTP 冒烟（含两条验收锚点）。

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let passes = 0;

function ok(cond, name, detail) {
  if (cond) { passes++; console.log(`  ✅ ${name}`); }
  else { failures++; console.error(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// ---------- 1) 单元测试 ----------
section('1/3 代码单元测试（最小误码 · 规范裁决 · 不可张成 · 解析定位）');
const ut = spawnSync(process.execPath, [
  '--test',
  'test/solver.test.js',
  'test/parser.test.js',
  'test/codec.test.js',
], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(ut.stdout);
if (ut.stderr) process.stderr.write(ut.stderr);
ok(ut.status === 0, 'node --test 全部通过', `退出码 ${ut.status}`);

// ---------- 2) 页面构建检查 ----------
section('2/3 页面构建检查（静态资源 / JS 语法 / 并发失效）');
const htmlPath = path.join(ROOT, 'public/index.html');
const appPath = path.join(ROOT, 'public/app.js');
const cssPath = path.join(ROOT, 'public/styles.css');
ok(fs.existsSync(htmlPath), 'public/index.html 存在');
ok(fs.existsSync(appPath), 'public/app.js 存在');
ok(fs.existsSync(cssPath), 'public/styles.css 存在');
const html = fs.readFileSync(htmlPath, 'utf8');
ok(html.includes('/app.js') && html.includes('/styles.css'), '页面引用了前端脚本与样式');
const checkApp = spawnSync(process.execPath, ['--check', appPath], { encoding: 'utf8' });
ok(checkApp.status === 0, 'app.js 通过 node --check 语法检查', checkApp.stderr);
const appSrc = fs.readFileSync(appPath, 'utf8');
ok(/reqSeq\+\+|reqSeq \+\+/.test(appSrc), '草稿修改会使在途请求令牌失效（防止旧结果覆盖新草稿）');
ok(/\/api\/verify/.test(appSrc), '前端调用复核 API /api/verify');
ok(/localStorage/.test(appSrc), '草稿本地保留、清空时移除');

// ---------- 3) HTTP / API 冒烟 ----------
section('3/3 启动静态服务：健康路径 + 复核页面 API/HTTP 冒烟');

function waitForServer(target, timeoutMs, cb) {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    const req = http.get({ host: target.host, port: target.port, path: '/healthz', timeout: 500 }, (res) => {
      res.resume();
      if (res.statusCode === 200) return cb(true);
      retry();
    });
    req.on('error', retry);
    req.on('timeout', () => { req.destroy(); retry(); });
  };
  function retry() { if (Date.now() < deadline) setTimeout(tick, 300); else cb(false); }
  tick();
}

function api(target, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({
      host: target.host, port: target.port, path: '/api/verify', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
function get(target, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: target.host, port: target.port, path: urlPath }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: raw, ct: res.headers['content-type'] || '' }));
    }).on('error', reject);
  });
}

// TARGET_URL 指向已运行的服务（compose verify -> http://web:8080）；
// 未设置时在本地临时拉起 server.js 自测。
const TARGET_URL = process.env.TARGET_URL || '';
let target;
let spawned = false;
if (TARGET_URL) {
  const u = new URL(TARGET_URL);
  target = { host: u.hostname, port: Number(u.port || 80) };
} else {
  target = { host: '127.0.0.1', port: Number(process.env.VERIFY_PORT || 18080) };
}
const PORT = target.port;
let srv = null;
let srvLog = '';
if (!TARGET_URL) {
  const env = { ...process.env, PORT: String(PORT), HOST: '0.0.0.0' };
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawned = true;
  srv.stdout.on('data', (d) => (srvLog += d));
  srv.stderr.on('data', (d) => (srvLog += d));
}

async function main() {
  const ready = await new Promise((r) => waitForServer(target, 10000, r));
  ok(ready, '静态服务启动且 /healthz 可访问', ready ? '' : `服务日志:\n${srvLog}`);
  if (!ready) throw new Error('server not ready');

  const health = await get(target, '/healthz');
  ok(health.status === 200 && /"ok":true/.test(health.body), 'GET /healthz 返回 200 且 ok=true');

  const page = await get(target, '/');
  ok(page.status === 200 && page.body.includes('校验矩阵'), 'GET / 返回复核页面 HTML');
  const js = await get(target, '/app.js');
  ok(js.status === 200 && /text\/javascript/.test(js.ct), 'GET /app.js 返回 JS 资源');
  const css = await get(target, '/styles.css');
  ok(css.status === 200, 'GET /styles.css 返回样式资源');

  // 锚点 A：单位矩阵 + 0010 => 第 4 列、重量 1、证据末项 0010
  const a = await api(target, {
    matrix: ['1000', '0100', '0010', '0001'].join('\n'),
    syndrome: '0010',
  });
  ok(a.status === 200 && a.json.status === 'solved', '锚点A：单位矩阵+0010 可综合');
  if (a.json.status === 'solved') {
    const r = a.json.result;
    ok(r.weight === 1, '锚点A：重量为 1', `实际 ${r.weight}`);
    ok(JSON.stringify(r.columns) === JSON.stringify([4]), '锚点A：只返回第 4 列', JSON.stringify(r.columns));
    const last = r.evidence[r.evidence.length - 1].join('');
    ok(last === '0010', '锚点A：异或证据为 0010', last);
  }

  // 锚点 B：两列均 11、目标 11 => 位串 01 的第 2 列
  const b = await api(target, { matrix: '11\n11', syndrome: '11' });
  ok(b.status === 200 && b.json.status === 'solved', '锚点B：11/11 + 11 可综合');
  if (b.json.status === 'solved') {
    const r = b.json.result;
    ok(r.weight === 1 && JSON.stringify(r.columns) === JSON.stringify([2]),
      '锚点B：规范解为第 2 列（位串 01）', `w=${r.weight}, cols=${JSON.stringify(r.columns)}`);
    ok(r.solution.join('') === '01', '锚点B：解位串为 01', r.solution.join(''));
  }

  // 锚点 C：不可张成 => infeasible 且无证据字段
  const c = await api(target, { matrix: '110\n011\n000', syndrome: '010' });
  ok(c.json.status === 'infeasible', '锚点C：不可张成被判为不可综合', c.json.status);
  ok(c.json.evidence === undefined && c.json.result === undefined,
    '锚点C：不返回任何伪造证据/解字段');

  // 输入错误：行宽不一 / 非法字符 / 综合症长度不符
  const d1 = await api(target, { matrix: '101\n10\n001', syndrome: '000' });
  ok(d1.json.status === 'invalid' && d1.json.issues.some((i) => i.code === 'WIDTH_MISMATCH' && i.row === 2),
    '行宽不一：错误可定位到第 2 行');
  const d2 = await api(target, { matrix: '1a1\n010', syndrome: '00' });
  ok(d2.json.status === 'invalid' && d2.json.issues.some((i) => i.code === 'ILLEGAL_CHAR' && i.row === 1),
    '含非法字符：可定位到行列');
  const d3 = await api(target, { matrix: '10\n01', syndrome: '001' });
  ok(d3.json.status === 'invalid' && d3.json.issues.some((i) => i.code === 'SYNDROME_LENGTH'),
    '综合症长度不符：报错且不给结论');

  // 近 40 列复核在服务端快速完成（冒烟，不枚举 2^40）
  let seed = 20260930;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const m = 32, n = 40;
  const H = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.4 ? 1 : 0)));
  const s = new Array(m).fill(0);
  for (const j of [3, 11, 20, 29, 37]) for (let i = 0; i < m; i++) s[i] ^= H[i][j];
  // 服务端按位串对齐约定读入综合症，发送前先转到显示行序
  const { encodeEvidence } = require('../lib/syndrome-codec');
  const sDisplay = encodeEvidence(s).join('');
  const t0 = Date.now();
  const big = await api(target, { matrix: H.map((r) => r.join(' ')).join('\n'), syndrome: sDisplay });
  ok(big.json.status === 'solved' && big.json.result.weight <= 5 && Date.now() - t0 < 30000,
    `近 40 列复核快速完成（${Date.now() - t0}ms）`, JSON.stringify(big.json).slice(0, 200));
}

main()
  .catch((e) => { failures++; console.error('验收运行异常：', e); })
  .finally(() => {
    if (srv) srv.kill();
    section('验收结果');
    console.log(`通过 ${passes} 项，失败 ${failures} 项`);
    process.exit(failures === 0 ? 0 : 1);
  });
