/**
 * 一次性验证：代码测试 → 生产构建 → 导排领域冒烟。
 * 任一环节失败即记录，全部环节执行完后以退出码报告总结果（0 通过 / 1 失败）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const steps = [
  ['代码测试', ['--test', 'tests/**/*.test.mjs']],
  ['生产构建', ['scripts/build.mjs']],
  ['导排领域冒烟', ['scripts/smoke.mjs']],
];

let failed = 0;
for (const [name, args] of steps) {
  console.log(`\n========== ${name} ==========`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`✗ ${name} 未通过（退出码 ${r.status}）`);
  } else {
    console.log(`✓ ${name} 通过`);
  }
}

if (failed > 0) {
  console.error(`\nverify：${failed} 个环节未通过`);
  process.exit(1);
}
console.log('\nverify：代码测试、生产构建、导排领域冒烟全部通过');
