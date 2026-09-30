// 零运行时依赖的静态服务 + 复核 API。
//
//   GET  /health                 健康检查（兼容 /healthz）
//   GET  /                       复核页面
//   GET  /<静态资源>             public/ 目录下的静态文件
//   POST /api/review             校验并精确求解，回显 revision 供前端裁决过期响应
//
// 端口与监听地址可通过环境变量配置：PORT（默认 8080）、HOST（默认 0.0.0.0）。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { parseInput } from './parser.js';
import { solve } from './solver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_BODY_BYTES = 256 * 1024;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/healthz')) {
    json(res, 200, { status: 'ok', service: 'syndrome-review', time: new Date().toISOString() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/review') {
    await handleReview(req, res);
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(pathname, res);
    return;
  }

  json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法。' } });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleReview(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(res, 400, {
      error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : '请求体无法解析。' },
    });
    return;
  }

  const revision = typeof body?.revision === 'number' ? body.revision : 0;
  const rawRows = Array.isArray(body?.rows) ? body.rows.slice(0, 64) : [];
  const syndromeRaw = typeof body?.syndrome === 'string' ? body.syndrome : '';
  if (!Array.isArray(body?.rows)) {
    json(res, 400, { revision, error: { code: 'BAD_REQUEST', message: 'rows 必须是字符串数组。' } });
    return;
  }

  const parsed = parseInput(rawRows.map(String), syndromeRaw);
  if (parsed.error) {
    // 校验失败：不附带任何结论或证据；错误可定位，草稿仍在前端保留可编辑。
    json(res, 200, { revision, status: 'invalid', error: parsed.error });
    return;
  }

  // 精确求解（同步计算，n<=40 时耗时上界有保证）。
  const result = solve(parsed.rows, parsed.syndrome);
  if (!result.solvable) {
    json(res, 200, {
      revision,
      status: 'unsolvable',
      rank: result.rank,
      message: '目标综合症不在矩阵列空间中，不可综合。',
    });
    return;
  }

  json(res, 200, {
    revision,
    status: 'solvable',
    columns: result.columns,
    weight: result.weight,
    bitstring: result.bitstring,
    evidence: result.evidence,
    rank: result.rank,
  });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体超过大小限制。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('请求体不是合法 JSON。'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 */
async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME.get(ext) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    json(res, 404, { error: { code: 'NOT_FOUND', message: '资源不存在。' } });
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    json(res, 500, { error: { code: 'INTERNAL', message: String(err?.message ?? err) } });
  });
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`[syndrome-review] listening on http://${HOST}:${actualPort}`);
});

export { server };
