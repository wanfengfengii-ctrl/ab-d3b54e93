// 屋面导排领域核心：纯函数，无 DOM 依赖。
//
// 规则（按共享边四邻域）：
//  - 普通格：审计对象。水每一步可流向“相邻且高程不高于当前格”的最低格；
//    若多个相邻格并列最低，则每一个并列方向都是允许流向，审计必须覆盖全部。
//  - 排水口(drain)：成功终点。
//  - 脆弱接缝(seam)：不可过水，水一旦进入即失效。
//  - 边界外流：格内没有任何不高于当前格的邻格时，边界格的水流出网格，失效。
//  - 无去路：同上情形但格在内部（四周格都更高），失效。
//  - 等高循环：允许流向构成的有向图中存在可到达的环，水可无限循环，失效。
//
// “安全”是格点的内在性质：从该格沿允许流向展开的全部可能路径，
// 每条都必须终于排水口。有限图上等价于：可达汇点全部是排水口，且不可达任何环。
// 用 DFS 三色标记（未访问/访问中/已完成）+ 记忆化，整体 O(V+E)。

export const CELL = Object.freeze({
  NORMAL: 'normal',
  DRAIN: 'drain',
  SEAM: 'seam',
});

/** 失效原因代码 */
export const FAIL = Object.freeze({
  OUTFLOW: 'outflow', // 流出边界
  DEAD_END: 'dead_end', // 无去路
  SEAM: 'seam', // 进入脆弱接缝
  CYCLE: 'cycle', // 等高区域循环
});

export const FAIL_LABEL = Object.freeze({
  [FAIL.OUTFLOW]: '流出边界',
  [FAIL.DEAD_END]: '无去路',
  [FAIL.SEAM]: '进入脆弱接缝',
  [FAIL.CYCLE]: '等高区域循环',
});

/**
 * @typedef {Object} Cell
 * @property {number} elevation 整数高程
 * @property {'normal'|'drain'|'seam'} kind
 */

/**
 * 构造网格。
 * @param {number} rows
 * @param {number} cols
 * @param {(r:number,c:number)=>{elevation:number,kind?:string}} [fill]
 * @returns {{rows:number,cols:number,cells:Cell[][]}}
 */
export function createGrid(rows, cols, fill) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
    throw new Error('网格行列数必须为正整数');
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const spec = fill ? fill(r, c) : null;
      const elevation = spec && Number.isInteger(spec.elevation) ? spec.elevation : 0;
      const kind = spec && spec.kind in CELL ? spec.kind : CELL.NORMAL;
      row.push({ elevation, kind });
    }
    cells.push(row);
  }
  return { rows, cols, cells };
}

/** 校验草稿高程（每格必须为整数高程） */
export function parseElevation(text) {
  if (!/^[+-]?\d+$/.test(String(text).trim())) {
    throw new Error('高程必须为整数');
  }
  return Number.parseInt(text, 10);
}

const DIRS = Object.freeze([
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
]);

/**
 * 计算某格的全部允许流向（高程不高于当前格的最低相邻格，含并列）。
 * 界外是“兜底去向”：格内仍有不高于当前格的邻格时，水只在格内最低间选择；
 * 当格内没有任何不高于当前格的邻格时，边界格的水流出边缘（OUTFLOW），
 * 内部格则为无去路（DEAD_END）。接缝高程参与比较、可被选中；选中即“进入接缝”。
 *
 * @returns {{moves:Array<{r:number,c:number}>|null, reason?:string}}
 */
export function allowedMoves(grid, r, c) {
  const cur = grid.cells[r][c];
  let min = Infinity;
  let lowest = [];

  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) continue; // 界外兜底，不参与比较
    const e = grid.cells[nr][nc].elevation;
    if (e <= cur.elevation) {
      if (e < min) {
        min = e;
        lowest = [{ r: nr, c: nc }];
      } else if (e === min) {
        lowest.push({ r: nr, c: nc });
      }
    }
  }

  if (lowest.length > 0) return { moves: lowest };

  const onBoundary = r === 0 || c === 0 || r === grid.rows - 1 || c === grid.cols - 1;
  return { moves: null, reason: onBoundary ? FAIL.OUTFLOW : FAIL.DEAD_END };
}

const keyOf = (r, c) => r * 100000 + c; // 行优先编码，行列数现实范围内不冲突

/**
 * 审计状态：跨多个普通格复用一次三色 DFS 的记忆化结果。
 * 安全性（“全部允许流路终于排水口”）是格点内在性质，与起点无关。
 */
function createAuditState(grid) {
  const WHITE = 0;
  const GRAY = 1;
  const DONE_GOOD = 2;
  const DONE_BAD = 3;
  const color = new Map();
  const drainSets = new Map(); // 已完成好格 -> 可达排水口坐标集合
  const stack = []; // 当前 DFS 灰栈，元素 {r,c}

  function failNow(reason, extra) {
    return { safe: false, reason, path: [...stack, ...(extra ? [extra] : [])] };
  }

  function visit(r, c) {
    const k = keyOf(r, c);
    const seen = color.get(k);
    if (seen === DONE_GOOD) return { safe: true };
    if (seen === DONE_BAD) return { safe: false, cached: true };
    if (seen === GRAY) {
      // 回到灰栈中的格：允许流向成环，可无限循环。
      const idx = stack.findIndex((p) => p.r === r && p.c === c);
      return { safe: false, reason: FAIL.CYCLE, cycleFrom: idx, cycleTo: { r, c } };
    }

    color.set(k, GRAY);
    stack.push({ r, c });

    const { moves, reason } = allowedMoves(grid, r, c);
    if (!moves) {
      const result = failNow(reason); // 路径止于当前格（外流/无去路）
      stack.pop();
      color.set(k, DONE_BAD);
      return result;
    }

    const drains = new Set();
    let failure = null;
    for (const m of moves) {
      const target = grid.cells[m.r][m.c];
      if (target.kind === CELL.SEAM) {
        failure = failNow(FAIL.SEAM, { r: m.r, c: m.c });
        break;
      }
      if (target.kind === CELL.DRAIN) {
        drains.add(`${m.r},${m.c}`);
        continue;
      }
      const res = visit(m.r, m.c);
      if (!res.safe) {
        if (res.reason === FAIL.CYCLE && res.cycleFrom !== undefined) {
          // 用灰栈切出“起点 → 入环点 → 环 → 闭合”的完整可复核链。
          const prefix = stack.slice(0, res.cycleFrom);
          const loop = stack.slice(res.cycleFrom);
          failure = {
            safe: false,
            reason: FAIL.CYCLE,
            path: [...prefix, ...loop, res.cycleTo],
          };
        } else if (res.cached) {
          // 记忆化只记录“坏”，具体失效链从当前栈前缀重新下行取得：
          const rebuilt = rebuildBadPath(m.r, m.c);
          failure = { safe: false, reason: rebuilt.reason, path: [...stack, ...rebuilt.path] };
        } else {
          failure = { safe: false, reason: res.reason, path: res.path };
        }
        break;
      }
      for (const d of drainSets.get(keyOf(m.r, m.c))) drains.add(d);
    }

    stack.pop();
    if (failure) {
      color.set(k, DONE_BAD);
      return failure;
    }
    drainSets.set(k, drains);
    color.set(k, DONE_GOOD);
    return { safe: true };
  }

  // 对已知坏格重走一条确定的坏路，得到完整失效链。
  // 依据记忆化状态挑选坏后继（接缝 > 灰格成环 > 已判坏格），不会误入好分支。
  function rebuildBadPath(r, c) {
    const head = [];
    let cr = r;
    let cc = c;
    const guard = new Set();
    for (;;) {
      const k = keyOf(cr, cc);
      head.push({ r: cr, c: cc });
      const seen = color.get(k);
      if (seen === GRAY || guard.has(k)) {
        return { safe: false, reason: FAIL.CYCLE, path: [...head, { r: cr, c: cc }] };
      }
      guard.add(k);
      const cell = grid.cells[cr][cc];
      if (cell.kind === CELL.SEAM) return { safe: false, reason: FAIL.SEAM, path: head };

      const { moves, reason } = allowedMoves(grid, cr, cc);
      if (!moves) return { safe: false, reason, path: head };

      let next = null;
      for (const m of moves) {
        const t = grid.cells[m.r][m.c];
        const s = color.get(keyOf(m.r, m.c));
        if (t.kind === CELL.SEAM || s === GRAY || s === DONE_BAD) {
          next = m;
          break;
        }
      }
      // 全部去向都是排水口或已判好格，则此格不可能为坏；防御性兜底。
      if (!next) return { safe: false, reason: FAIL.DEAD_END, path: head };
      cr = next.r;
      cc = next.c;
    }
  }

  return {
    status(r, c) {
      const k = keyOf(r, c);
      return color.get(k) ?? WHITE;
    },
    WHITE,
    DONE_GOOD,
    analyze(r, c) {
      let res = visit(r, c);
      if (!res.safe) {
        if (res.cached) res = rebuildBadPath(r, c);
        return {
          safe: false,
          failure: { start: { r, c }, reason: res.reason ?? FAIL.DEAD_END, path: res.path },
        };
      }
      const list = [...drainSets.get(keyOf(r, c))].map((s) => {
        const [dr, dc] = s.split(',').map(Number);
        return { r: dr, c: dc };
      });
      return { safe: true, reachableDrains: list };
    },
  };
}

/**
 * 审计单个普通格：其全部允许流路都必须终于排水口。
 * @returns {{
 *   safe:boolean,
 *   failure?: {start:{r,c}, reason:string, path:Array<{r,c}>},
 *   reachableDrains?: Array<{r,c}>,
 * }}
 */
export function analyzeCell(grid, r, c) {
  if (!grid.cells[r]?.[c] || grid.cells[r][c].kind !== CELL.NORMAL) {
    throw new Error('审计起点必须是普通格');
  }
  return createAuditState(grid).analyze(r, c);
}

/**
 * 全网格审计：按行优先（从上到下、从左到右）检查每个普通格的全部允许流向。
 * 不安全时返回首个问题起点及一条可复核的失效流向链；
 * 安全时返回每格可达排水口结论及各排水口的汇水格集合。
 */
export function auditGrid(grid) {
  const state = createAuditState(grid);
  const cellResults = [];

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (cell.kind !== CELL.NORMAL) continue;
      const res = state.analyze(r, c);
      if (!res.safe) {
        return { safe: false, failure: res.failure, cellResults };
      }
      cellResults.push({ r, c, reachableDrains: res.reachableDrains });
    }
  }

  // 由“普通格可达哪些排水口”反算“每个排水口的汇水格集合”。
  const catchments = new Map();
  for (const cr of cellResults) {
    for (const d of cr.reachableDrains) {
      const k = `${d.r},${d.c}`;
      if (!catchments.has(k)) catchments.set(k, []);
      catchments.get(k).push({ r: cr.r, c: cr.c });
    }
  }
  const drainCatchments = [...catchments]
    .map(([k, cells]) => {
      const [r, c] = k.split(',').map(Number);
      return { drain: { r, c }, cells };
    })
    .sort((a, b) => a.drain.r - b.drain.r || a.drain.c - b.drain.c);

  return { safe: true, cellResults, drainCatchments };
}
