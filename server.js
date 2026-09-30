'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { solve } = require('./lib/solver');
const { parseInput } = require('./lib/parser');
const { decodeSyndrome, encodeEvidence } = require('./lib/syndrome-codec');

const PORT = Number(process.env.PORT || process.env.HOST_PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('未找到页面');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return sendJson(res, 200, { ok: true, service: 'parity-check', time: new Date().toISOString() });
  }

  if (req.method === 'POST' && req.url === '/api/verify') {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return sendJson(res, 413, { ok: false, error: 'payload too large' });
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        return sendJson(res, 400, { ok: false, error: '请求不是合法 JSON' });
      }
      const matrixText = String(payload.matrix ?? '');
      const syndromeText = String(payload.syndrome ?? '');
      const { issues, matrix, syndrome } = parseInput(matrixText, syndromeText);

      if (issues.length > 0) {
        // 草稿错误：只返回可定位的问题，不产生任何“结论/证据”。
        return sendJson(res, 200, { ok: true, status: 'invalid', issues });
      }

      // 推迟到下一个事件循环，使客户端能够以请求令牌区分新旧草稿的结论。
      setImmediate(() => {
        let result;
        try {
          result = solve(matrix, decodeSyndrome(syndrome));
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: '求解失败：' + err.message });
        }
        if (!result.feasible) {
          // 不可张成：明确告知“不可综合”，不附带任何伪造证据。
          return sendJson(res, 200, {
            ok: true,
            status: 'infeasible',
            message: '目标综合症不在校验矩阵的列空间内，不可综合（无解）。',
          });
        }
        return sendJson(res, 200, {
          ok: true,
          status: 'solved',
          result: {
            solution: result.solution,
            weight: result.weight,
            columns: result.columns,
            evidence: result.evidence.map((vec) => encodeEvidence(vec)),
          },
        });
      });
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405, { allow: 'GET, POST' });
  res.end('method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`[parity-check] listening on http://${HOST}:${PORT}`);
});

module.exports = { server };
