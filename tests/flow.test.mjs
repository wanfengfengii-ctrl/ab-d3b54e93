import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAILURE,
  audit,
  createGrid,
  indexOf,
  isFragile,
  movesOf,
  resizeGrid,
  setFragile,
  toggleFragile,
  verifyFailureChain,
} from '../src/flow.js';
import { exampleFault, exampleSafe } from '../src/examples.js';

/** 用高程矩阵快速构造草稿网格。 */
function gridFrom(elevRows, { drains = [], fragile = [] } = {}) {
  const rows = elevRows.length;
  const cols = elevRows[0].length;
  const g = createGrid(rows, cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) g.elev[r * cols + c] = elevRows[r][c];
  }
  for (const [r, c] of drains) g.drains[r * cols + c] = true;
  for (const [[r1, c1], [r2, c2]] of fragile) {
    setFragile(g, r1 * cols + c1, r2 * cols + c2, true);
  }
  return g;
}

test('createGrid 校验尺寸', () => {
  assert.throws(() => createGrid(0, 3), RangeError);
  assert.throws(() => createGrid(2, -1), RangeError);
  const g = createGrid(2, 3);
  assert.equal(g.elev.length, 6);
  assert.equal(g.fragileH.length, 4);
  assert.equal(g.fragileV.length, 3);
});

test('允许流向：流向不高于当前格的最低格，并列最低全部允许', () => {
  const g = gridFrom([
    [9, 3, 9],
    [3, 5, 4],
    [9, 5, 9],
  ]);
  // 中心高程 5：相邻最低为 3（两格并列），4 与等高的 5 都不是允许流向
  assert.deepEqual(movesOf(g, indexOf(g, 1, 1)), [indexOf(g, 0, 1), indexOf(g, 1, 0)]);
});

test('允许流向：相邻全更高则无去路', () => {
  const g = gridFrom([
    [2, 3, 2],
    [3, 1, 4],
    [2, 5, 2],
  ]);
  assert.deepEqual(movesOf(g, indexOf(g, 1, 1)), []);
});

test('排水口为终点，无出边', () => {
  const g = gridFrom([[5, 0]], { drains: [[0, 1]] });
  assert.deepEqual(movesOf(g, 1), []);
  assert.deepEqual(movesOf(g, 0), [1]); // 可流入排水口
});

test('脆弱接缝的标记与读取', () => {
  const g = createGrid(2, 2);
  assert.equal(isFragile(g, 0, 1), false);
  toggleFragile(g, 0, 1);
  assert.equal(isFragile(g, 0, 1), true);
  assert.equal(isFragile(g, 1, 0), true); // 无向
  setFragile(g, 0, 1, false);
  assert.equal(isFragile(g, 0, 1), false);
  assert.equal(toggleFragile(g, 0, 3), false); // 对角不相邻
});

test('边界外流：边界格无允许流向', () => {
  const g = gridFrom([
    [0, 1],
    [1, 1],
  ]);
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.BOUNDARY);
  assert.deepEqual(r.chain, [0]);
  assert.equal(verifyFailureChain(g, r).valid, true);
});

test('无去路：内部洼地积水', () => {
  // 边界一圈均为排水口，中央是洼地
  const g = gridFrom(
    [
      [5, 5, 5],
      [5, 0, 5],
      [5, 5, 5],
    ],
    {
      drains: [
        [0, 0], [0, 1], [0, 2],
        [1, 0], [1, 2],
        [2, 0], [2, 1], [2, 2],
      ],
    },
  );
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, indexOf(g, 1, 1));
  assert.equal(r.kind, FAILURE.STUCK);
  assert.deepEqual(r.chain, [indexOf(g, 1, 1)]);
  assert.equal(verifyFailureChain(g, r).valid, true);
});

test('进入脆弱接缝：即使接缝另一侧是排水口也算失效', () => {
  const g = gridFrom([[5, 3]], { drains: [[0, 1]], fragile: [[[0, 0], [0, 1]]] });
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.FRAGILE);
  assert.deepEqual(r.chain, [0, 1]);
  assert.equal(verifyFailureChain(g, r).valid, true);
});

test('未被水流跨越的脆弱接缝不影响安全', () => {
  // (0,0)-(0,1) 为脆弱接缝，但 (0,0) 流向排水口、(0,1) 流向 (1,1)，互不跨越
  const g = gridFrom(
    [
      [2, 3],
      [0, 1],
    ],
    { drains: [[1, 0]], fragile: [[[0, 0], [0, 1]]] },
  );
  const r = audit(g);
  assert.equal(r.ok, true);
  assert.equal(r.drains.length, 1);
  assert.deepEqual([...r.drains[0].catchment].sort(), [0, 1, 2, 3]);
});

test('等高区域循环：平地无出口', () => {
  const g = gridFrom([
    [5, 5],
    [5, 5],
  ]);
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.CYCLE);
  assert.deepEqual(r.chain, [0, 1, 0]);
  const v = verifyFailureChain(g, r);
  assert.equal(v.valid, true, v.problems.join(';'));
});

test('关键语义：存在通往排水口的路线不足以判定安全', () => {
  // (0,0) 的允许流向并列：一路进排水口，一路进边界死路 → 整体不安全
  const g = gridFrom(
    [
      [5, 3],
      [3, 4],
    ],
    { drains: [[0, 1]] },
  );
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.BOUNDARY);
  assert.deepEqual(r.chain, [0, 2]);
  assert.equal(verifyFailureChain(g, r).valid, true);
});

test('安全时：汇水格集合可重叠，逐格可达结论完整', () => {
  const g = gridFrom([[0, 5, 0]], { drains: [[0, 0], [0, 2]] });
  const r = audit(g);
  assert.equal(r.ok, true);
  assert.equal(r.drains.length, 2);
  assert.deepEqual([...r.drains[0].catchment].sort((a, b) => a - b), [0, 1]);
  assert.deepEqual([...r.drains[1].catchment].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(r.cellDrains[1], [0, 1]); // 中间格可达两个排水口
  assert.deepEqual(r.cellDrains[0], [0]); // 排水口自身
});

test('行优先：首个问题起点取行优先最小格，而非失效种类', () => {
  // (0,0)(0,1) 等高循环；(0,2) 跨越脆弱接缝入排水口 —— 起点应为 (0,0) 的循环
  const g = gridFrom([[5, 5, 6, 0]], {
    drains: [[0, 3]],
    fragile: [[[0, 2], [0, 3]]],
  });
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.CYCLE);
});

test('单格无排水口：边界外流', () => {
  const g = gridFrom([[7]]);
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.kind, FAILURE.BOUNDARY);
  assert.deepEqual(r.chain, [0]);
});

test('resizeGrid 保留重叠区域草稿', () => {
  const g = gridFrom(
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
    { drains: [[0, 0]], fragile: [[[0, 1], [0, 2]], [[0, 2], [1, 2]]] },
  );
  const n = resizeGrid(g, 3, 2);
  assert.equal(n.rows, 3);
  assert.equal(n.cols, 2);
  assert.deepEqual(n.elev.slice(0, 4), [1, 2, 4, 5]);
  assert.equal(n.drains[0], true);
  assert.equal(isFragile(n, indexOf(n, 0, 0), indexOf(n, 0, 1)), false);
  // 缩小后 (0,1)-(0,2) 的水平接缝超出范围被丢弃；扩大到 3 列后内容仍在
  const m = resizeGrid(g, 2, 3);
  assert.equal(isFragile(m, indexOf(m, 0, 1), indexOf(m, 0, 2)), true);
  assert.equal(isFragile(m, indexOf(m, 0, 2), indexOf(m, 1, 2)), true);
});

test('内置安全示例：审计通过且结论可逐格复核', () => {
  const g = exampleSafe();
  const r = audit(g);
  assert.equal(r.ok, true);
  assert.equal(r.drains.length, 2);
  const n = g.rows * g.cols;
  const covered = new Set();
  for (const d of r.drains) for (const i of d.catchment) covered.add(i);
  assert.equal(covered.size, n, '汇水格集合应覆盖全部格');
  // 每个普通格至少可达一个排水口，且沿允许流向确实能走到该排水口
  const reaches = (from, target) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const x = stack.pop();
      if (x === target) return true;
      for (const y of movesOf(g, x)) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    if (g.drains[i]) continue;
    assert.ok(r.cellDrains[i].length >= 1, `格 ${i} 应至少可达一个排水口`);
    for (const id of r.cellDrains[i]) {
      assert.ok(reaches(i, r.drains[id].index), `格 ${i} 应可达排水口 ${id}`);
    }
  }
});

test('内置病害示例：行优先首个问题为 (4,5) 进入脆弱接缝，修复后暴露边界外流', () => {
  const g = exampleFault();
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, indexOf(g, 3, 4));
  assert.equal(r.kind, FAILURE.FRAGILE);
  assert.deepEqual(r.chain, [indexOf(g, 3, 4), indexOf(g, 3, 3)]);
  assert.equal(verifyFailureChain(g, r).valid, true);

  // 修复该接缝后重新审计：下一个问题起点为 (4,6)，失效链终止于边界洼地 (5,8)
  setFragile(g, indexOf(g, 3, 4), indexOf(g, 3, 3), false);
  const r2 = audit(g);
  assert.equal(r2.ok, false);
  assert.equal(r2.origin, indexOf(g, 3, 5));
  assert.equal(r2.kind, FAILURE.BOUNDARY);
  assert.equal(r2.chain[0], r2.origin);
  assert.equal(r2.chain[r2.chain.length - 1], indexOf(g, 4, 7));
  assert.equal(verifyFailureChain(g, r2).valid, true);
});

test('首个问题起点只是流入跨接缝格时，失效链仍完整可达', () => {
  // (0,0) 本身不跨接缝，但其允许流向 (0,1) 会跨越脆弱接缝进入排水口 (1,1)
  const g = gridFrom(
    [
      [5, 4],
      [9, 0],
    ],
    { drains: [[1, 1]], fragile: [[[0, 1], [1, 1]]] },
  );
  const r = audit(g);
  assert.equal(r.ok, false);
  assert.equal(r.origin, 0);
  assert.equal(r.kind, FAILURE.FRAGILE);
  assert.deepEqual(r.chain, [0, 1, 3]);
  assert.equal(verifyFailureChain(g, r).valid, true);
});

test('失效链复核器能识别被篡改的链', () => {
  const g = exampleFault();
  const r = audit(g);
  const tampered = { ...r, chain: [r.origin] };
  assert.equal(verifyFailureChain(g, tampered).valid, false);
  const wrongKind = { ...r, kind: FAILURE.CYCLE };
  assert.equal(verifyFailureChain(g, wrongKind).valid, false);
});
