import { describe, it, expect } from 'vitest';
import {
  CELL,
  FAIL,
  createGrid,
  allowedMoves,
  analyzeCell,
  auditGrid,
  parseElevation,
} from './drainage.js';

/** 由高程矩阵快速建网格；types 用 {r,c,kind} 覆盖类型 */
function gridOf(elev, types = []) {
  const g = createGrid(elev.length, elev[0].length, (r, c) => ({ elevation: elev[r][c] }));
  for (const t of types) g.cells[t.r][t.c].kind = t.kind;
  return g;
}

const D = (r, c) => ({ r, c, kind: CELL.DRAIN });
const S = (r, c) => ({ r, c, kind: CELL.SEAM });

describe('allowedMoves', () => {
  it('选择高程不高于当前格的最低相邻格，并列全部返回（按北东南西顺序）', () => {
    // 中央 3：四邻均为 1（并列最低），南 4 的情形见下例
    const g = gridOf([
      [9, 1, 9],
      [1, 3, 1],
      [9, 1, 9],
    ]);
    const { moves } = allowedMoves(g, 1, 1);
    expect(moves).toEqual([
      { r: 0, c: 1 },
      { r: 1, c: 2 },
      { r: 2, c: 1 },
      { r: 1, c: 0 },
    ]);
  });

  it('更高的邻格不参与；严格更低者压过并列等高', () => {
    // 中央 3：北 2（更低且唯一最低），东/西 3（等高但非最低），南 4（排除）
    const g = gridOf([
      [9, 2, 9],
      [3, 3, 3],
      [9, 4, 9],
    ]);
    expect(allowedMoves(g, 1, 1).moves).toEqual([{ r: 0, c: 1 }]);
  });

  it('边界格格内无去向 => OUTFLOW（界外兜底）', () => {
    const g = createGrid(1, 1, () => ({ elevation: 0 }));
    expect(allowedMoves(g, 0, 0)).toEqual({ moves: null, reason: FAIL.OUTFLOW });
  });

  it('边界格虽临边，但格内有更低邻格时不外流', () => {
    const g = gridOf([
      [5, 1],
      [5, 5],
    ]);
    expect(allowedMoves(g, 0, 0).moves).toEqual([{ r: 0, c: 1 }]);
  });

  it('内部格四周皆高 => DEAD_END', () => {
    // 中心点高程最低，四周格都更高：中心在 3x3 内部
    const g = gridOf([
      [9, 9, 9],
      [9, 0, 9],
      [9, 9, 9],
    ]);
    expect(allowedMoves(g, 1, 1)).toEqual({ moves: null, reason: FAIL.DEAD_END });
  });
});

describe('analyzeCell', () => {
  it('所有允许流路抵达排水口才安全', () => {
    // 中心 3 并列最低去向为左右两个 1，均接排水口
    const g = gridOf(
      [
        [9, 9, 9, 9, 9],
        [9, 1, 3, 1, 9],
        [9, 0, 9, 0, 9],
        [9, 9, 9, 9, 9],
      ],
      [D(2, 1), D(2, 3)],
    );
    const res = analyzeCell(g, 1, 2);
    expect(res.safe).toBe(true);
    expect(res.reachableDrains).toEqual(
      expect.arrayContaining([
        { r: 2, c: 1 },
        { r: 2, c: 3 },
      ]),
    );
  });

  it('仅一条路通排水口、另一条并列去向失效 => 不安全（不得因存在安全路线而放行）', () => {
    // 中心 3：西侧 1 通向排水口；东侧 1 通向接缝
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
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.SEAM);
    expect(res.failure.path[0]).toEqual({ r: 1, c: 2 });
    expect(res.failure.path.at(-1)).toEqual({ r: 2, c: 3 });
  });

  it('流出边界失效（边界局部低点，格内再无“不高于”去向）', () => {
    const g = gridOf([
      [5, 1],
      [5, 5],
    ]);
    const res = analyzeCell(g, 0, 0);
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.OUTFLOW);
    // 失效链先到边界低点 (0,1)，外流原因记录在该终点
    expect(res.failure.path.map((p) => `${p.r},${p.c}`)).toEqual(['0,0', '0,1']);
  });

  it('无去路失效（局部低点被困）', () => {
    const g = gridOf(
      [
        [9, 9, 9],
        [9, 0, 9],
        [9, 9, 9],
      ],
      [],
    );
    const res = analyzeCell(g, 1, 1);
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.DEAD_END);
  });

  it('进入脆弱接缝失效', () => {
    const g = gridOf(
      [
        [9, 9, 9],
        [9, 2, 1],
        [9, 9, 9],
      ],
      [S(1, 2)],
    );
    const res = analyzeCell(g, 1, 1);
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.SEAM);
    expect(res.failure.path.at(-1)).toEqual({ r: 1, c: 2 });
  });

  it('等高区域 2x2 循环失效', () => {
    const g = gridOf([
      [9, 9, 9, 9],
      [9, 1, 1, 9],
      [9, 1, 1, 9],
      [9, 9, 9, 9],
    ]);
    const res = analyzeCell(g, 1, 1);
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.CYCLE);
    // 闭环链：末尾格重复环入口格以显式闭合，便于在网格上复核
    const path = res.failure.path;
    expect(path[0]).toEqual({ r: 1, c: 1 });
    expect(path.at(-1)).toEqual(path[1]);
    expect(path.length).toBeGreaterThanOrEqual(4);
  });

  it('大等高平板在大图上审计为线性性能（不指数爆炸；检测到等高循环）', () => {
    const n = 60;
    const g = createGrid(n, n, () => ({ elevation: 1 }));
    const t0 = Date.now();
    const res = analyzeCell(g, 30, 30);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.safe).toBe(false);
    expect(res.failure.reason).toBe(FAIL.CYCLE);
  });
});

describe('auditGrid', () => {
  it('安全网格：给出每格结论与各排水口汇水集合', () => {
    // 全部坡向 (2,2) 的排水口
    const g = gridOf(
      [
        [5, 4, 3],
        [4, 3, 2],
        [3, 2, 1],
      ],
      [D(2, 2)],
    );
    const res = auditGrid(g);
    expect(res.safe).toBe(true);
    expect(res.cellResults).toHaveLength(8);
    for (const cr of res.cellResults) {
      expect(cr.reachableDrains).toEqual([{ r: 2, c: 2 }]);
    }
    const c0 = res.drainCatchments.find((x) => x.drain.r === 2 && x.drain.c === 2);
    expect(c0.cells).toHaveLength(8);
  });

  it('不安全时按行优先返回首个问题起点', () => {
    // 左侧有严格下降通道通向排水口（(0,0)、(0,1) 安全）；
    // (0,2) 被边界低点 (0,3) 吸走而外流，是行优先顺序下首个问题格。
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
    expect(res.safe).toBe(false);
    expect(res.failure.start).toEqual({ r: 0, c: 2 });
    expect(res.failure.reason).toBe(FAIL.OUTFLOW);
    expect(res.failure.path.map((p) => `${p.r},${p.c}`)).toEqual(['0,2', '0,3']);
  });

  it('不安全网格中更靠前的坏格先报，即使它后面才有排水口', () => {
    const g = gridOf(
      [
        [0, 5, 5],
        [5, 5, 5],
        [5, 5, 5],
      ],
      [D(2, 2)],
    );
    const res = auditGrid(g);
    expect(res.safe).toBe(false);
    // (0,0) 高程 0，位于边界且最低去向为界外
    expect(res.failure.start).toEqual({ r: 0, c: 0 });
  });

  it('接缝不计入审计对象，排水口也不是审计对象', () => {
    const g = gridOf(
      [
        [2, 1],
        [2, 1],
      ],
      [S(0, 1), D(1, 1)],
    );
    const res = auditGrid(g);
    // (0,0) 最低东向为接缝 => 失效；普通格只有 (0,0)、(1,0)
    expect(res.cellResults).toHaveLength(0);
    expect(res.safe).toBe(false);
    expect(res.failure.start).toEqual({ r: 0, c: 0 });
  });
});

describe('parseElevation', () => {
  it('接受整数，拒绝小数与非数字', () => {
    expect(parseElevation(' 7 ')).toBe(7);
    expect(parseElevation('-3')).toBe(-3);
    expect(() => parseElevation('1.5')).toThrow();
    expect(() => parseElevation('abc')).toThrow();
  });
});
