#!/usr/bin/env node
// 导排领域一次性冒烟：构造典型草稿，断言审计结论、失效原因、行优先首报与汇水集合。
// 若设置 SMOKE_BASE_URL，则追加对已部署静态站点的 HTTP 冒烟（首页 + 健康检查）。
// 任一断言失败即以非零码退出。

import { CELL, FAIL, createGrid, auditGrid, analyzeCell } from '../src/domain/drainage.js';

const failures = [];
let passed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function gridOf(elev, types = []) {
  const g = createGrid(elev.length, elev[0].length, (r, c) => ({ elevation: elev[r][c] }));
  for (const t of types) g.cells[t.r][t.c].kind = t.kind;
  return g;
}
const D = (r, c) => ({ r, c, kind: CELL.DRAIN });
const S = (r, c) => ({ r, c, kind: CELL.SEAM });

const set = (cells) => new Set(cells.map(({ r, c }) => `${r},${c}`));

console.log('场景 1：全部坡向排水口的安全网格');
{
  const g = gridOf(
    [
      [5, 4, 3],
      [4, 3, 2],
      [3, 2, 1],
    ],
    [D(2, 2)],
  );
  const res = auditGrid(g);
  check('整体判定安全', res.safe === true);
  check('8 个普通格均有结论', res.safe && res.cellResults.length === 8);
  const allToDrain = res.safe && res.cellResults.every((c) => c.reachableDrains.length === 1);
  check('每格结论均指向唯一排水口 (3,3)', allToDrain);
  const cm = res.safe ? res.drainCatchments.find((x) => x.drain.r === 2 && x.drain.c === 2) : null;
  check('排水口汇水集合含全部 8 格', !!cm && cm.cells.length === 8);
}

console.log('场景 2：并列最低去向中仅一条到排水口（接缝分支必须被审计出来）');
{
  const g = gridOf(
    [
      [9, 9, 9, 9, 9],
      [9, 1, 3, 1, 9],
      [9, 0, 9, 0, 9],
      [9, 9, 9, 9, 9],
    ],
    [D(2, 1), S(2, 3)],
  );
  const res = analyzeCell(g, 1, 2);
  check('存在安全路线但仍判不安全', res.safe === false);
  check('失效原因为进入脆弱接缝', !res.safe && res.failure.reason === FAIL.SEAM);
  const path = !res.safe ? res.failure.path.map((p) => `${p.r + 1},${p.c + 1}`).join('→') : '';
  check('失效链可复核到接缝格', !res.safe && path === '2,3→2,4→3,4', path);
}

console.log('场景 3：边界外流');
{
  const g = gridOf(
    [
      [5, 1],
      [5, 5],
    ],
    [],
  );
  const res = analyzeCell(g, 0, 0);
  check('边界低点导致外流失效', res.safe === false && res.failure.reason === FAIL.OUTFLOW);
}

console.log('场景 4：内部格无去路');
{
  const g = gridOf([
    [9, 9, 9],
    [9, 0, 9],
    [9, 9, 9],
  ]);
  const res = analyzeCell(g, 1, 1);
  check('内部局部低点无去路', res.safe === false && res.failure.reason === FAIL.DEAD_END);
}

console.log('场景 5：等高 2×2 区域循环');
{
  const g = gridOf([
    [9, 9, 9, 9],
    [9, 1, 1, 9],
    [9, 1, 1, 9],
    [9, 9, 9, 9],
  ]);
  const res = analyzeCell(g, 1, 1);
  check('等高区域判定循环失效', res.safe === false && res.failure.reason === FAIL.CYCLE);
  const p = res.safe ? [] : res.failure.path;
  check('失效链首尾闭合可复核', !res.safe && p.length >= 4 && `${p.at(-1).r},${p.at(-1).c}` === `${p[1].r},${p[1].c}`);
}

console.log('场景 6：行优先首个问题起点');
{
  const g = gridOf(
    [
      [3, 2, 9, 0],
      [9, 1, 9, 9],
      [9, 0, 9, 9],
      [9, -1, 9, 9],
    ],
    [D(3, 1)],
  );
  const res = auditGrid(g);
  check('首个问题起点为 (1,3)', !res.safe && res.failure.start.r === 0 && res.failure.start.c === 2);
}

console.log('场景 7：两个排水口的汇水集合（单侧格不混入对侧，分水岭格同时汇入两侧）');
{
  // 左半部入左排水口，右半部入右排水口，中央高脊分隔；脊顶格两侧并列可达。
  const g = gridOf(
    [
      [2, 1, 9, 1, 2],
      [1, 0, 9, 0, 1],
      [9, 9, 9, 9, 9],
    ],
    [D(1, 1), D(1, 3)],
  );
  const res = auditGrid(g);
  check('双排水口网格安全', res.safe === true);
  if (res.safe) {
    const left = res.drainCatchments.find((x) => x.drain.c === 1);
    const right = res.drainCatchments.find((x) => x.drain.c === 3);
    const leftOnly = set([
      { r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 2, c: 1 },
    ]);
    const rightOnly = set([
      { r: 0, c: 3 }, { r: 0, c: 4 }, { r: 1, c: 4 }, { r: 2, c: 3 }, { r: 2, c: 4 },
    ]);
    check('左汇水集合含左半 5 个单侧格', !!left && [...leftOnly].every((k) => set(left.cells).has(k)));
    check('右汇水集合含右半 5 个单侧格', !!right && [...rightOnly].every((k) => set(right.cells).has(k)));
    check('左侧单侧格不出现在右汇水集合', !!right && ![...leftOnly].some((k) => set(right.cells).has(k)));
    check('右侧单侧格不出现在左汇水集合', !!left && ![...rightOnly].some((k) => set(left.cells).has(k)));
    check('脊顶格 (2,3) 同时汇入两个排水口',
      !!left && !!right && set(left.cells).has('1,2') && set(right.cells).has('1,2'));
  }
}

console.log('场景 8：大平板性能（线性三色 DFS，不指数爆炸）');
{
  const g = createGrid(50, 50, () => ({ elevation: 1 }));
  const t0 = Date.now();
  const res = auditGrid(g);
  check('50×50 审计在 1 秒内完成', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  check('大平板判定为循环失效', res.safe === false && res.failure.reason === FAIL.CYCLE);
}

async function httpSmoke() {
  const base = process.env.SMOKE_BASE_URL;
  if (!base) {
    console.log('（未设置 SMOKE_BASE_URL，跳过已部署站点 HTTP 冒烟）');
    return;
  }
  const root = base.replace(/\/+$/, '');
  const resolve = (u) => new URL(u.replace(/^\.\//, ''), `${root}/`).href;
  console.log(`站点 HTTP 冒烟：${base}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const health = await fetch(resolve('/health'), { signal: ctrl.signal });
    check('GET /health 返回 200', health.status === 200, `HTTP ${health.status}`);
    const home = await fetch(resolve('/'), { signal: ctrl.signal });
    check('GET / 返回 200', home.status === 200, `HTTP ${home.status}`);
    const html = await home.text();
    check('首页含应用挂载点', html.includes('id="app"'));
    const asset = html.match(/src="([^"]+\.js)"/);
    if (asset) {
      const js = await fetch(resolve(asset[1]), { signal: ctrl.signal });
      check('构建产物 JS 可访问', js.status === 200, `HTTP ${js.status}`);
    } else {
      check('首页引用构建产物 JS', false);
    }
  } catch (err) {
    check('站点 HTTP 冒烟请求成功', false, String(err && err.message || err));
  } finally {
    clearTimeout(timer);
  }
}

await httpSmoke();

console.log(`\n冒烟结果：${passed} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.error(`失败项：\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('全部冒烟通过。');
