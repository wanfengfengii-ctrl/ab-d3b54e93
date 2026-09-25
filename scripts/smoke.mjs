/**
 * 导排领域冒烟：在领域层面验证关键场景，并检查生产构建产物完整。
 * 全部检查通过后以退出码 0 结束，否则以 1 结束。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAILURE,
  audit,
  createGrid,
  indexOf,
  movesOf,
  setFragile,
  verifyFailureChain,
} from '../src/flow.js';
import { exampleFault, exampleSafe } from '../src/examples.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

function gridFrom(elevRows, { drains = [], fragile = [] } = {}) {
  const g = createGrid(elevRows.length, elevRows[0].length);
  elevRows.forEach((row, r) => row.forEach((v, c) => { g.elev[r * g.cols + c] = v; }));
  for (const [r, c] of drains) g.drains[r * g.cols + c] = true;
  for (const [[r1, c1], [r2, c2]] of fragile) {
    setFragile(g, r1 * g.cols + c1, r2 * g.cols + c2, true);
  }
  return g;
}

console.log('[导排冒烟] 场景一：安全屋面');
const safe = exampleSafe();
const safeRes = audit(safe);
check('安全示例审计通过', () => expect(safeRes.ok, `预期安全，实际 ${JSON.stringify(safeRes)}`));
check('每个普通格都可达至少一个排水口', () => {
  for (let i = 0; i < safe.rows * safe.cols; i++) {
    if (!safe.drains[i]) expect(safeRes.cellDrains[i].length >= 1, `格 ${i} 不可达任何排水口`);
  }
});
check('汇水格集合覆盖全部屋面', () => {
  const covered = new Set();
  for (const d of safeRes.drains) for (const i of d.catchment) covered.add(i);
  expect(covered.size === safe.rows * safe.cols, `仅覆盖 ${covered.size} 格`);
});
check('汇水格沿允许流向确实汇入对应排水口', () => {
  const reaches = (from, target) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const x = stack.pop();
      if (x === target) return true;
      for (const y of movesOf(safe, x)) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return false;
  };
  for (const d of safeRes.drains) {
    for (const i of d.catchment) expect(reaches(i, d.index), `格 ${i} 无法汇入排水口 ${d.id}`);
  }
});

console.log('[导排冒烟] 场景二：病害屋面（脆弱接缝 + 边界洼地）');
const fault = exampleFault();
const faultRes = audit(fault);
check('病害示例审计不通过', () => expect(!faultRes.ok, '预期不安全'));
check('首个问题起点为行优先最小格 (4,5)，类型为进入脆弱接缝', () => {
  expect(faultRes.origin === indexOf(fault, 3, 4), `起点 ${faultRes.origin}`);
  expect(faultRes.kind === FAILURE.FRAGILE, `类型 ${faultRes.kind}`);
});
check('失效流向链可逐步复核', () => {
  const v = verifyFailureChain(fault, faultRes);
  expect(v.valid, v.problems.join(';'));
});

console.log('[导排冒烟] 场景三：四类失效逐一触发');
check('边界外流', () => {
  const g = gridFrom([[0, 1], [1, 1]]);
  const r = audit(g);
  expect(!r.ok && r.kind === FAILURE.BOUNDARY && verifyFailureChain(g, r).valid, JSON.stringify(r));
});
check('无去路', () => {
  const g = gridFrom([[5, 5, 5], [5, 0, 5], [5, 5, 5]], {
    drains: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]],
  });
  const r = audit(g);
  expect(!r.ok && r.kind === FAILURE.STUCK && verifyFailureChain(g, r).valid, JSON.stringify(r));
});
check('进入脆弱接缝', () => {
  const g = gridFrom([[5, 3]], { drains: [[0, 1]], fragile: [[[0, 0], [0, 1]]] });
  const r = audit(g);
  expect(!r.ok && r.kind === FAILURE.FRAGILE && verifyFailureChain(g, r).valid, JSON.stringify(r));
});
check('等高区域循环', () => {
  const g = gridFrom([[5, 5], [5, 5]]);
  const r = audit(g);
  expect(!r.ok && r.kind === FAILURE.CYCLE && verifyFailureChain(g, r).valid, JSON.stringify(r));
});

console.log('[导排冒烟] 场景四：单一路线不足以判定安全 + 行优先');
check('存在通往排水口的路线但另一允许流向失效时整体不安全', () => {
  const g = gridFrom([[5, 3], [3, 4]], { drains: [[0, 1]] });
  const r = audit(g);
  expect(!r.ok && r.origin === 0, JSON.stringify(r));
});
check('多处病害时按行优先返回首个问题起点', () => {
  const g = gridFrom([[5, 5, 6, 0]], { drains: [[0, 3]], fragile: [[[0, 2], [0, 3]]] });
  const r = audit(g);
  expect(!r.ok && r.origin === 0 && r.kind === FAILURE.CYCLE, JSON.stringify(r));
});

console.log('[导排冒烟] 场景五：生产构建产物');
check('dist/index.html 存在且引用的资源全部存在', () => {
  const htmlPath = path.join(dist, 'index.html');
  expect(existsSync(htmlPath), '缺少 dist/index.html（请先执行生产构建）');
  const html = readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  expect(refs.length >= 2, 'index.html 未引用任何资源');
  for (const ref of refs) expect(existsSync(path.join(dist, ref)), `缺少 ${ref}`);
});
check('healthz 健康检查端点文件存在', () => {
  expect(existsSync(path.join(dist, 'healthz')), '缺少 dist/healthz');
});
check('manifest.json 中每个文件都存在于 dist', () => {
  const manifestPath = path.join(dist, 'manifest.json');
  expect(existsSync(manifestPath), '缺少 dist/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [orig, info] of Object.entries(manifest.files)) {
    expect(existsSync(path.join(dist, info.name)), `${orig} -> ${info.name} 缺失`);
  }
});

if (failures > 0) {
  console.error(`\n导排领域冒烟：${failures} 项未通过`);
  process.exit(1);
}
console.log('\n导排领域冒烟：全部通过');
