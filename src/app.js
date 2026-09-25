/**
 * 浏览器端交互：指针逐格编辑草稿、发起审计、渲染结论。
 * 领域规则全部来自 ./flow.js（与 Node 测试/冒烟共用同一份实现）。
 */
import {
  createGrid,
  resizeGrid,
  audit,
  movesOf,
  toggleFragile,
  indexOf,
  rcOf,
  FAILURE,
} from './flow.js';
import { exampleSafe, exampleFault } from './examples.js';

const KIND_TEXT = {
  [FAILURE.BOUNDARY]: '边界外流',
  [FAILURE.STUCK]: '无去路',
  [FAILURE.FRAGILE]: '进入脆弱接缝',
  [FAILURE.CYCLE]: '等高区域循环',
};
const KIND_DESC = {
  [FAILURE.BOUNDARY]: '水流至屋面边界格后没有任何允许流向，雨水将溢出边界，未进入排水口。',
  [FAILURE.STUCK]: '水流进入四周更高的洼地，没有任何允许流向，将在病害区域积水。',
  [FAILURE.FRAGILE]: '存在一条允许流向跨越不可过水的脆弱接缝，雨水会被引入病害接缝。',
  [FAILURE.CYCLE]: '水流在等高区域中循环打转，永远无法到达排水口。',
};

const PALETTE = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626'];

const els = {
  grid: document.getElementById('grid'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  elevValue: document.getElementById('elevValue'),
  rowsInput: document.getElementById('rowsInput'),
  colsInput: document.getElementById('colsInput'),
  applySize: document.getElementById('applySize'),
  loadSafe: document.getElementById('loadSafe'),
  loadFault: document.getElementById('loadFault'),
  clearGrid: document.getElementById('clearGrid'),
  auditBtn: document.getElementById('auditBtn'),
};

const state = {
  grid: exampleSafe(),
  tool: 'elev',
  result: null,       // 最近一次审计结论
  stale: false,       // 结论是否已因草稿修改而失效
  catchmentOf: null,  // 正在高亮的排水口 id
  selected: null,     // 最近点击的格
};

const label = (i) => {
  const { r, c } = rcOf(state.grid, i);
  return `(${r + 1},${c + 1})`;
};

/** 排水口按行优先编号 D1、D2… */
function drainOrdinals() {
  const map = new Map();
  let n = 0;
  for (let i = 0; i < state.grid.rows * state.grid.cols; i++) {
    if (state.grid.drains[i]) {
      n += 1;
      map.set(i, `D${n}`);
    }
  }
  return map;
}

function elevationTint(e) {
  const { elev } = state.grid;
  let min = Infinity;
  let max = -Infinity;
  for (const v of elev) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const t = max === min ? 0.5 : (e - min) / (max - min);
  return `hsl(205 32% ${93 - t * 24}%)`;
}

/* ---------------- 网格渲染 ---------------- */

function renderGrid() {
  const { rows, cols } = state.grid;
  const g = els.grid;
  g.innerHTML = '';
  g.dataset.tool = state.tool;
  const parts = [];
  for (let c = 0; c < cols; c++) {
    parts.push('var(--cell)');
    if (c < cols - 1) parts.push('var(--gap)');
  }
  g.style.gridTemplateColumns = parts.join(' ');
  const rowParts = [];
  for (let r = 0; r < rows; r++) {
    rowParts.push('var(--cell)');
    if (r < rows - 1) rowParts.push('var(--gap)');
  }
  g.style.gridTemplateRows = rowParts.join(' ');

  for (let gr = 0; gr < 2 * rows - 1; gr++) {
    for (let gc = 0; gc < 2 * cols - 1; gc++) {
      const r = gr >> 1;
      const c = gc >> 1;
      if (gr % 2 === 0 && gc % 2 === 0) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.i = String(indexOf(state.grid, r, c));
        g.appendChild(cell);
      } else if (gr % 2 === 0) {
        // 垂直接缝：(r, c) 与 (r, c+1)
        const edge = document.createElement('div');
        edge.className = 'edge edge-v';
        edge.dataset.a = String(indexOf(state.grid, r, c));
        edge.dataset.b = String(indexOf(state.grid, r, c + 1));
        g.appendChild(edge);
      } else if (gc % 2 === 0) {
        // 水平接缝：(r, c) 与 (r+1, c)
        const edge = document.createElement('div');
        edge.className = 'edge edge-h';
        edge.dataset.a = String(indexOf(state.grid, r, c));
        edge.dataset.b = String(indexOf(state.grid, r + 1, c));
        g.appendChild(edge);
      } else {
        g.appendChild(document.createElement('div'));
      }
    }
  }
  refreshCells();
  refreshEdges();
}

function chainSteps() {
  // 格 → 出现的步序号（1 起）；循环链中重复格会拥有两个步序号
  const map = new Map();
  if (state.result && !state.result.ok && !state.stale) {
    state.result.chain.forEach((cell, k) => {
      if (!map.has(cell)) map.set(cell, []);
      map.get(cell).push(k + 1);
    });
  }
  return map;
}

function chainEdgeKeys() {
  const keys = new Set();
  if (state.result && !state.result.ok && !state.stale) {
    const { chain } = state.result;
    for (let k = 0; k + 1 < chain.length; k++) {
      keys.add(`${Math.min(chain[k], chain[k + 1])}|${Math.max(chain[k], chain[k + 1])}`);
    }
  }
  return keys;
}

function refreshCells() {
  const ord = drainOrdinals();
  const steps = chainSteps();
  const res = state.result;
  const catchment =
    res && res.ok && !state.stale && state.catchmentOf !== null
      ? new Set(res.drains[state.catchmentOf].catchment)
      : null;
  const catchColor = state.catchmentOf !== null ? PALETTE[state.catchmentOf % PALETTE.length] : null;

  for (const cell of els.grid.querySelectorAll('.cell')) {
    const i = Number(cell.dataset.i);
    const g = state.grid;
    cell.style.background = elevationTint(g.elev[i]);
    cell.classList.toggle('drain', g.drains[i]);
    cell.classList.toggle('selected', state.selected === i);
    cell.classList.toggle('chain', steps.has(i));
    cell.classList.toggle(
      'chain-end',
      res && !res.ok && !state.stale && res.chain[res.chain.length - 1] === i,
    );
    cell.classList.toggle('catchment', Boolean(catchment && catchment.has(i)));
    if (catchment && catchment.has(i)) cell.style.setProperty('--catch', catchColor);
    else cell.style.removeProperty('--catch');

    let html = `<span class="elev">${g.elev[i]}</span>`;
    if (g.drains[i]) html += `<span class="drain-badge">${ord.get(i)}</span>`;
    if (steps.has(i)) html += `<span class="step-badge">${steps.get(i).join('·')}</span>`;
    cell.innerHTML = html;
  }
}

function refreshEdges() {
  const keys = chainEdgeKeys();
  for (const edge of els.grid.querySelectorAll('.edge')) {
    const a = Number(edge.dataset.a);
    const b = Number(edge.dataset.b);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    edge.classList.toggle('fragile', isFragileEdge(a, b));
    edge.classList.toggle('chain-edge', keys.has(`${lo}|${hi}`));
  }
}

function isFragileEdge(a, b) {
  const { grid } = state;
  const ea = rcOf(grid, a);
  const eb = rcOf(grid, b);
  if (ea.r === eb.r) {
    return grid.fragileH[ea.r * (grid.cols - 1) + Math.min(ea.c, eb.c)];
  }
  return grid.fragileV[Math.min(ea.r, eb.r) * grid.cols + ea.c];
}

/* ---------------- 结论渲染 ---------------- */

function renderResults() {
  const res = state.result;
  if (!res) {
    els.results.innerHTML = `
      <h2>审计结论</h2>
      <p class="muted">尚未审计。用指针编辑草稿后，点击「发起审计」。</p>`;
    return;
  }
  if (state.stale) {
    els.results.innerHTML = `
      <h2>审计结论</h2>
      <div class="banner stale"><strong>⚠ 结论已失效</strong>草稿在审计后被修改，以上一次结论作废。请重新「发起审计」。</div>
      <div class="stale-dim">${resultHtml(res)}</div>`;
    wireDrainCards();
    return;
  }
  els.results.innerHTML = `<h2>审计结论</h2>${resultHtml(res)}`;
  wireDrainCards();
}

function resultHtml(res) {
  if (!res.ok) {
    const kindText = KIND_TEXT[res.kind];
    const chainText = res.chain.map(label).join(' → ');
    return `
      <div class="banner bad"><strong>✗ 审计未通过</strong>已覆盖每个普通格的全部允许流向，发现失效。</div>
      <p class="kv"><b>首个问题起点（行优先）：</b>${label(res.origin)}</p>
      <p class="kv"><b>失效类型：</b>${kindText}</p>
      <p class="kv"><b>失效流向链（网格中已按步序标出）：</b></p>
      <div class="chain-text">${chainText}</div>
      <p class="kv muted">${KIND_DESC[res.kind]}</p>`;
  }
  const normalCount =
    state.grid.rows * state.grid.cols - state.grid.drains.filter(Boolean).length;
  const ord = drainOrdinals();
  const cards = res.drains
    .map((d) => {
      const color = PALETTE[d.id % PALETTE.length];
      const cells = d.catchment.map(label).join('、');
      const active = state.catchmentOf === d.id ? ' active' : '';
      return `
        <div class="drain-card${active}" data-drain="${d.id}" style="border-left-color:${color}">
          <b>排水口 ${ord.get(d.index)}</b> ${label(d.index)} ・ 汇水格 <b>${d.catchment.length}</b> 个
          <span class="muted">（点击${state.catchmentOf === d.id ? '取消' : ''}高亮）</span>
          <div class="cells">${cells}</div>
        </div>`;
    })
    .join('');
  const rows = [];
  for (let i = 0; i < state.grid.rows * state.grid.cols; i++) {
    if (state.grid.drains[i]) continue;
    const names = res.cellDrains[i].map((id) => ord.get(res.drains[id].index)).join('、');
    rows.push(`<div>${label(i)} → ${names}</div>`);
  }
  return `
    <div class="banner ok"><strong>✓ 审计通过</strong>已覆盖 ${normalCount} 个普通格的全部允许流向：每一格的水最终都能进入排水口。</div>
    <p class="kv"><b>各排水口汇水格集合：</b></p>
    ${cards}
    <details class="cell-table">
      <summary>逐格可达排水口结论（${normalCount} 格）</summary>
      <div class="rows">${rows.join('')}</div>
    </details>`;
}

function wireDrainCards() {
  for (const card of els.results.querySelectorAll('.drain-card')) {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.drain);
      state.catchmentOf = state.catchmentOf === id ? null : id;
      renderResults();
      refreshCells();
    });
  }
}

/* ---------------- 状态行 ---------------- */

function showCellInfo(i) {
  const g = state.grid;
  const ord = drainOrdinals();
  const parts = [`<strong>格 ${label(i)}</strong>`, `高程 ${g.elev[i]}`];
  if (g.drains[i]) {
    parts.push(`排水口 ${ord.get(i)}（水流终点）`);
  } else {
    const mv = movesOf(g, i);
    if (mv.length === 0) {
      parts.push('无允许流向（若审计将判为边界外流/无去路）');
    } else {
      parts.push(`允许流向 → ${mv.map(label).join('、')}`);
    }
  }
  if (state.result && !state.stale) {
    if (state.result.ok) {
      if (g.drains[i]) {
        parts.push('自身即排水口');
      } else {
        const names = state.result.cellDrains[i].map((id) => ord.get(state.result.drains[id].index));
        parts.push(`可达排水口：${names.join('、')}`);
      }
    } else if (state.result.chain.includes(i)) {
      parts.push('位于失效流向链上');
    }
  } else if (state.result && state.stale) {
    parts.push('（结论已失效，需重新审计）');
  }
  els.status.innerHTML = parts.join(' ｜ ');
}

/* ---------------- 编辑与审计 ---------------- */

function markStale() {
  if (state.result && !state.stale) {
    state.stale = true;
    state.catchmentOf = null;
    renderResults();
    refreshCells();
    refreshEdges();
  }
}

function applyTool(i) {
  const g = state.grid;
  if (state.tool === 'elev') {
    const v = Number.parseInt(els.elevValue.value, 10);
    const value = Number.isInteger(v) ? v : 0;
    if (g.elev[i] !== value) {
      g.elev[i] = value;
      markStale();
    }
  } else if (state.tool === 'drain') {
    g.drains[i] = !g.drains[i];
    markStale();
  }
  state.selected = i;
  refreshCells();
  showCellInfo(i);
}

function doAudit() {
  state.result = audit(state.grid);
  state.stale = false;
  state.catchmentOf = null;
  renderResults();
  refreshCells();
  refreshEdges();
  if (!state.result.ok) {
    state.selected = state.result.origin;
    showCellInfo(state.result.origin);
  }
}

/* ---------------- 事件 ---------------- */

let painting = false;

els.grid.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  const edge = e.target.closest('.edge');
  if (cell) {
    painting = true;
    applyTool(Number(cell.dataset.i));
  } else if (edge && state.tool === 'fragile') {
    toggleFragile(state.grid, Number(edge.dataset.a), Number(edge.dataset.b));
    markStale();
    refreshEdges();
  }
});
els.grid.addEventListener('pointerover', (e) => {
  if (!painting || state.tool !== 'elev') return;
  const cell = e.target.closest('.cell');
  if (cell) applyTool(Number(cell.dataset.i));
});
window.addEventListener('pointerup', () => {
  painting = false;
});

for (const radio of document.querySelectorAll('input[name="tool"]')) {
  radio.addEventListener('change', () => {
    state.tool = radio.value;
    els.grid.dataset.tool = state.tool;
  });
}

els.applySize.addEventListener('click', () => {
  const rows = Number.parseInt(els.rowsInput.value, 10);
  const cols = Number.parseInt(els.colsInput.value, 10);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 20 || cols > 20) {
    els.status.textContent = '行/列需为 1–20 的整数。';
    return;
  }
  state.grid = resizeGrid(state.grid, rows, cols);
  state.selected = null;
  markStale();
  renderGrid();
  els.status.textContent = `已调整为 ${rows} 行 × ${cols} 列（保留重叠区域草稿）。`;
});

els.loadSafe.addEventListener('click', () => {
  state.grid = exampleSafe();
  state.selected = null;
  markStale();
  syncSizeInputs();
  renderGrid();
  els.status.textContent = '已载入安全示例（双排水口 + 一道未被跨越的脆弱接缝）。';
});

els.loadFault.addEventListener('click', () => {
  state.grid = exampleFault();
  state.selected = null;
  markStale();
  syncSizeInputs();
  renderGrid();
  els.status.textContent = '已载入病害示例（脆弱接缝被跨越 + 边界洼地）。点击「发起审计」查看首个问题起点。';
});

els.clearGrid.addEventListener('click', () => {
  const { rows, cols } = state.grid;
  state.grid = createGrid(rows, cols, 0);
  state.selected = null;
  markStale();
  renderGrid();
  els.status.textContent = '已清空草稿（全部高程 0，无排水口、无脆弱接缝）。';
});

els.auditBtn.addEventListener('click', doAudit);

function syncSizeInputs() {
  els.rowsInput.value = String(state.grid.rows);
  els.colsInput.value = String(state.grid.cols);
}

/* ---------------- 启动 ---------------- */

syncSizeInputs();
renderGrid();
renderResults();
els.status.textContent = '点击格子查看其允许流向；选择工具后用指针逐格修改草稿。';
