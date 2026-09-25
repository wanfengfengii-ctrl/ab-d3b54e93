/**
 * 古建屋面雨水导排 · 领域逻辑（纯函数，浏览器与 Node 共用，无任何依赖）。
 *
 * 网格模型：
 *  - 每格一个整数高程 elev[i]；部分格为排水口 drains[i]；
 *  - 相邻（共边）两格之间可标记"脆弱接缝"（不可过水）。
 *
 * 水流规则：
 *  - 水每一步流向"相邻且高度不高于当前格"中的最低格；
 *  - 若最低格有多个（并列），则每个并列最低格都是一个允许流向；
 *  - 排水口为终点：水进入排水口即被收集，不再外流。
 *
 * 审计语义（覆盖每个普通格的全部允许流向，任一允许流向失效即整体不安全）：
 *  - 边界外流：边界格没有任何允许流向，雨水流出屋面边界；
 *  - 无去路：  内部格没有任何允许流向（洼地积水）；
 *  - 进入脆弱接缝：某个允许流向跨越脆弱接缝；
 *  - 等高区域循环：水流在等高区域中打转，永远无法到达排水口。
 * 不允许"存在一条通往排水口的路线即判定安全"。
 */

export const FAILURE = Object.freeze({
  BOUNDARY: 'boundary', // 边界外流
  STUCK: 'stuck',       // 无去路
  FRAGILE: 'fragile',   // 进入脆弱接缝
  CYCLE: 'cycle',       // 等高区域循环
});

/** 创建 rows×cols 的空草稿网格。 */
export function createGrid(rows, cols, fill = 0) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError('rows/cols 必须为正整数');
  }
  return {
    rows,
    cols,
    elev: new Array(rows * cols).fill(fill),
    drains: new Array(rows * cols).fill(false),
    // 水平接缝：(r,c) 与 (r,c+1) 之间，索引 r*(cols-1)+c
    fragileH: new Array(rows * Math.max(cols - 1, 0)).fill(false),
    // 垂直接缝：(r,c) 与 (r+1,c) 之间，索引 r*cols+c
    fragileV: new Array(Math.max(rows - 1, 0) * cols).fill(false),
  };
}

export const indexOf = (grid, r, c) => r * grid.cols + c;
export const rcOf = (grid, i) => ({ r: Math.floor(i / grid.cols), c: i % grid.cols });

export function isBoundary(grid, i) {
  const { r, c } = rcOf(grid, i);
  return r === 0 || c === 0 || r === grid.rows - 1 || c === grid.cols - 1;
}

/** 相邻格索引，升序（上、左、右、下），保证后续链构造确定性。 */
export function neighborsOf(grid, i) {
  const { rows, cols } = grid;
  const { r, c } = rcOf(grid, i);
  const out = [];
  if (r > 0) out.push(i - cols);
  if (c > 0) out.push(i - 1);
  if (c < cols - 1) out.push(i + 1);
  if (r < rows - 1) out.push(i + cols);
  return out;
}

/** 两格之间的接缝定位；不相邻返回 null。 */
export function edgeBetween(grid, i, j) {
  const a = rcOf(grid, i);
  const b = rcOf(grid, j);
  if (a.r === b.r && Math.abs(a.c - b.c) === 1) {
    return { orient: 'H', index: a.r * (grid.cols - 1) + Math.min(a.c, b.c) };
  }
  if (a.c === b.c && Math.abs(a.r - b.r) === 1) {
    return { orient: 'V', index: Math.min(a.r, b.r) * grid.cols + a.c };
  }
  return null;
}

export function isFragile(grid, i, j) {
  const e = edgeBetween(grid, i, j);
  if (!e) return false;
  return e.orient === 'H' ? grid.fragileH[e.index] : grid.fragileV[e.index];
}

export function setFragile(grid, i, j, value) {
  const e = edgeBetween(grid, i, j);
  if (!e) return false;
  if (e.orient === 'H') grid.fragileH[e.index] = Boolean(value);
  else grid.fragileV[e.index] = Boolean(value);
  return true;
}

export function toggleFragile(grid, i, j) {
  return setFragile(grid, i, j, !isFragile(grid, i, j));
}

/**
 * 允许流向：相邻格中"高度不高于当前格"的最低格（并列最低全部允许）。
 * 排水口为终点，无出边。全部相邻格都更高时返回空数组（无去路/边界外流）。
 */
export function movesOf(grid, i) {
  if (grid.drains[i]) return [];
  const nbrs = neighborsOf(grid, i);
  if (nbrs.length === 0) return [];
  let min = Infinity;
  for (const j of nbrs) if (grid.elev[j] < min) min = grid.elev[j];
  if (min > grid.elev[i]) return [];
  return nbrs.filter((j) => grid.elev[j] === min);
}

/** 调整尺寸并保留重叠区域的草稿内容。 */
export function resizeGrid(grid, rows, cols) {
  const next = createGrid(rows, cols);
  const rKeep = Math.min(grid.rows, rows);
  const cKeep = Math.min(grid.cols, cols);
  for (let r = 0; r < rKeep; r++) {
    for (let c = 0; c < cKeep; c++) {
      const from = indexOf(grid, r, c);
      const to = indexOf(next, r, c);
      next.elev[to] = grid.elev[from];
      next.drains[to] = grid.drains[from];
    }
  }
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      if (r < rows && c < cols - 1) {
        next.fragileH[r * (cols - 1) + c] = grid.fragileH[r * (grid.cols - 1) + c];
      }
    }
  }
  for (let r = 0; r < grid.rows - 1; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (r < rows - 1 && c < cols) {
        next.fragileV[r * cols + c] = grid.fragileV[r * grid.cols + c];
      }
    }
  }
  return next;
}

/** Tarjan 强连通分量（迭代实现），返回每格所属分量编号。 */
function tarjanComp(adj) {
  const n = adj.length;
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const comp = new Array(n).fill(-1);
  const stack = [];
  let counter = 0;
  let ncomp = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = true;
    const call = [[s, 0]];
    while (call.length > 0) {
      const frame = call[call.length - 1];
      const v = frame[0];
      if (frame[1] < adj[v].length) {
        const w = adj[v][frame[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          call.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
      } else {
        call.pop();
        if (call.length > 0) {
          const p = call[call.length - 1][0];
          low[p] = Math.min(low[p], low[v]);
        }
        if (low[v] === index[v]) {
          let w;
          do {
            w = stack.pop();
            onStack[w] = false;
            comp[w] = ncomp;
          } while (w !== v);
          ncomp++;
        }
      }
    }
  }
  return comp;
}

/** 确定性 DFS：从 start 出发、仅经过 unsafe 格，寻找满足 pred 的格，返回路径。 */
function findPath(moves, unsafe, start, pred) {
  const visited = new Set();
  const path = [];
  const dfs = (u) => {
    visited.add(u);
    path.push(u);
    if (pred(u)) return true;
    for (const v of moves[u]) {
      if (!visited.has(v) && unsafe[v] && dfs(v)) return true;
    }
    path.pop();
    return false;
  };
  return dfs(start) ? path.slice() : null;
}

/** 在同一强连通分量内构造从 s 出发回到 s 的闭环（等高循环）。 */
function buildLoop(moves, comp, s) {
  const targetComp = comp[s];
  const visited = new Set([s]);
  const path = [s];
  const dfs = (u) => {
    for (const v of moves[u]) {
      if (comp[v] !== targetComp) continue;
      if (v === s) {
        path.push(v);
        return true;
      }
      if (!visited.has(v)) {
        visited.add(v);
        path.push(v);
        if (dfs(v)) return true;
        path.pop();
      }
    }
    return false;
  };
  dfs(s);
  return path.slice();
}

/**
 * 审计整张草稿网格。
 * 安全：{ ok:true, drains:[{id,index,r,c,catchment}], cellDrains:[[drainId…]…] }
 * 不安全：{ ok:false, origin, kind, chain } —— origin 为行优先首个问题起点，
 * chain 为一条可复核的失效流向链（可用 verifyFailureChain 逐步复核）。
 */
export function audit(grid) {
  const n = grid.rows * grid.cols;
  const moves = new Array(n);
  for (let i = 0; i < n; i++) moves[i] = movesOf(grid, i);

  // 直接跨越脆弱接缝的允许流向（记录每个格的第一个，确定性）
  const fragileTarget = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (grid.drains[i]) continue;
    for (const j of moves[i]) {
      if (isFragile(grid, i, j)) {
        fragileTarget[i] = j;
        break;
      }
    }
  }

  // 等高循环：水流高程单调不增，任何有向环必为等高区域；SCC 大小 ≥2 即在环上
  const comp = tarjanComp(moves);
  const compSize = new Map();
  for (let i = 0; i < n; i++) compSize.set(comp[i], (compSize.get(comp[i]) || 0) + 1);
  const onCycle = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!grid.drains[i] && compSize.get(comp[i]) >= 2) onCycle[i] = true;
  }

  // 失效种子：直接跨接缝 / 无去路（含边界外流）/ 位于等高环上
  const unsafe = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (grid.drains[i]) continue;
    if (fragileTarget[i] >= 0 || moves[i].length === 0 || onCycle[i]) unsafe[i] = true;
  }
  // 反向传播：凡存在一条允许流向能到达失效种子的普通格，均不安全
  const rev = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const j of moves[i]) rev[j].push(i);
  const stack = [];
  for (let i = 0; i < n; i++) if (unsafe[i]) stack.push(i);
  while (stack.length > 0) {
    const x = stack.pop();
    for (const p of rev[x]) {
      if (!unsafe[p]) {
        unsafe[p] = true;
        stack.push(p);
      }
    }
  }

  // 行优先（索引升序即行优先）首个问题起点
  let origin = -1;
  for (let i = 0; i < n; i++) {
    if (!grid.drains[i] && unsafe[i]) {
      origin = i;
      break;
    }
  }

  if (origin === -1) {
    // 安全：每个排水口的汇水格集合（反向可达），以及每格可达排水口
    const drainIdx = [];
    for (let i = 0; i < n; i++) if (grid.drains[i]) drainIdx.push(i);
    const cellDrains = Array.from({ length: n }, () => []);
    const drains = drainIdx.map((idx, id) => {
      const seen = new Array(n).fill(false);
      const queue = [idx];
      seen[idx] = true;
      while (queue.length > 0) {
        const x = queue.pop();
        for (const p of rev[x]) {
          if (!seen[p]) {
            seen[p] = true;
            queue.push(p);
          }
        }
      }
      const catchment = [];
      for (let i = 0; i < n; i++) {
        if (seen[i]) {
          catchment.push(i);
          cellDrains[i].push(id);
        }
      }
      const { r, c } = rcOf(grid, idx);
      return { id, index: idx, r, c, catchment };
    });
    return { ok: true, drains, cellDrains };
  }

  // 生成一条可复核的失效流向链（优先级：跨接缝 > 无去路/边界外流 > 等高循环）
  // 注意：起点可能只是"流入"直接跨接缝的格，需先沿允许流向抵达该格
  const toFragile = findPath(moves, unsafe, origin, (x) => fragileTarget[x] >= 0);
  if (toFragile) {
    const x = toFragile[toFragile.length - 1];
    return { ok: false, origin, kind: FAILURE.FRAGILE, chain: toFragile.concat([fragileTarget[x]]) };
  }
  const toStuck = findPath(moves, unsafe, origin, (x) => !grid.drains[x] && moves[x].length === 0);
  if (toStuck) {
    const last = toStuck[toStuck.length - 1];
    const kind = isBoundary(grid, last) ? FAILURE.BOUNDARY : FAILURE.STUCK;
    return { ok: false, origin, kind, chain: toStuck };
  }
  const toCycle = findPath(moves, unsafe, origin, (x) => onCycle[x]);
  const s = toCycle[toCycle.length - 1];
  const loop = buildLoop(moves, comp, s);
  return { ok: false, origin, kind: FAILURE.CYCLE, chain: toCycle.concat(loop.slice(1)) };
}

/**
 * 逐步复核一条失效流向链（用于测试、冒烟与界面"复核"提示）。
 * 返回 { valid, problems[] }。
 */
export function verifyFailureChain(grid, outcome) {
  const problems = [];
  if (!outcome || outcome.ok) {
    return { valid: false, problems: ['审计结果为安全，无失效链可复核'] };
  }
  const { chain, kind, origin } = outcome;
  if (!Array.isArray(chain) || chain.length === 0) {
    return { valid: false, problems: ['失效链为空'] };
  }
  if (chain[0] !== origin) problems.push('失效链起点与首个问题起点不一致');
  for (let k = 0; k + 1 < chain.length; k++) {
    const a = chain[k];
    const b = chain[k + 1];
    if (!movesOf(grid, a).includes(b)) {
      problems.push(`第 ${k + 1} 步 ${a}→${b} 不是允许流向`);
    }
  }
  const last = chain[chain.length - 1];
  if (kind === FAILURE.FRAGILE) {
    const a = chain[chain.length - 2];
    if (chain.length < 2 || !isFragile(grid, a, last)) {
      problems.push('失效链未以跨越脆弱接缝结束');
    }
  } else if (kind === FAILURE.BOUNDARY || kind === FAILURE.STUCK) {
    if (grid.drains[last] || movesOf(grid, last).length !== 0) {
      problems.push('失效链末端并非无去路格');
    }
    const expect = isBoundary(grid, last) ? FAILURE.BOUNDARY : FAILURE.STUCK;
    if (expect !== kind) problems.push('失效类型与末端格位置不一致');
  } else if (kind === FAILURE.CYCLE) {
    const first = chain.indexOf(last);
    if (first === -1 || first === chain.length - 1) {
      problems.push('失效链未闭合为循环');
    } else {
      const loop = chain.slice(first);
      const h = grid.elev[loop[0]];
      if (!loop.every((x) => grid.elev[x] === h)) {
        problems.push('循环链上的高程不完全相等');
      }
    }
  } else {
    problems.push(`未知失效类型：${kind}`);
  }
  return { valid: problems.length === 0, problems };
}
