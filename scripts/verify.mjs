// 一次性验收编排（Compose verify 服务入口，执行完毕即以退出码报告结果）：
//   1. 代码测试：最小汉明重量求解与规范裁决（node --test）
//   2. 页面构建检查
//   3. 健康路径与复核页面的 API/HTTP 冒烟（BASE_URL 指向 Compose 中的 web 服务）
// 任一步失败立即以非 0 退出码结束。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>}
 */
function run(label, cmd, args, env = {}) {
  return new Promise((resolve) => {
    console.log(`\n========== ${label} ==========`);
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const steps = [
    () =>
      run(
        '1/3 代码测试：最小汉明重量与规范裁决',
        process.execPath,
        ['--test', 'test/solver.test.js', 'test/api.test.js'],
      ),
    () => run('2/3 页面构建检查', process.execPath, ['scripts/build-check.mjs']),
    () =>
      run(
        '3/3 健康路径与复核页面 API/HTTP 冒烟',
        process.execPath,
        ['scripts/smoke.mjs'],
        { BASE_URL: process.env.BASE_URL ?? 'http://web:8080' },
      ),
  ];

  for (const step of steps) {
    const code = await step();
    if (code !== 0) {
      console.error(`\n验收失败（退出码 ${code}）。`);
      process.exit(code);
    }
  }
  console.log('\n✅ 一次性验收全部通过。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
