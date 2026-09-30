// 页面构建检查：静态页面无需打包，这里做“构建验收”等价检查——
//   1. public/ 下必需文件存在；
//   2. 所有前端与服务端 JS 通过 node --check 语法检查；
//   3. HTML 引用的资源确实存在；
//   4. 页面包含关键交互钩子（按钮、输入框、健康路径相关文案）。
// 失败时以非 0 退出码报告。

import { execFile } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

/** @param {string} msg */
function fail(msg) {
  failures += 1;
  console.error(`  ✗ ${msg}`);
}

/** @param {string} msg */
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

/**
 * @param {string} file
 * @returns {Promise<void>}
 */
function nodeCheck(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', file], (err, stdout, stderr) => {
      if (err) fail(`语法检查失败 ${file}: ${stderr || err.message}`);
      else pass(`语法检查通过 ${file.replace(root + '/', '')}`);
      resolve();
    });
  });
}

async function exists(/** @type {string} */ file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

console.log('== 页面构建检查 ==');

const required = [
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'src/server.js',
  'src/solver.js',
  'src/parser.js',
];
for (const rel of required) {
  // eslint-disable-next-line no-await-in-loop
  if (await exists(join(root, rel))) pass(`文件存在 ${rel}`);
  else fail(`缺少文件 ${rel}`);
}

for (const rel of ['public/app.js', 'src/server.js', 'src/solver.js', 'src/parser.js']) {
  // eslint-disable-next-line no-await-in-loop
  await nodeCheck(join(root, rel));
}

const html = await readFile(join(root, 'public/index.html'), 'utf8');
for (const asset of ['/app.js', '/styles.css']) {
  if (html.includes(asset) && (await exists(join(root, 'public', asset.replace(/^\//, ''))))) {
    pass(`HTML 引用资源存在 ${asset}`);
  } else {
    fail(`HTML 引用资源缺失 ${asset}`);
  }
}
for (const hook of ['id="matrix"', 'id="syndrome"', 'id="btn-review"', 'id="btn-clear"', '/api/review']) {
  const haystack = hook === '/api/review' ? (await readFile(join(root, 'public', 'app.js'), 'utf8')) : html;
  if (haystack.includes(hook)) pass(`页面包含 ${hook}`);
  else fail(`页面缺少 ${hook}`);
}

if (failures > 0) {
  console.error(`构建检查失败：${failures} 项`);
  process.exit(1);
}
console.log('构建检查全部通过。');
