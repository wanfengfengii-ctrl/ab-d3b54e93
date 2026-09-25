import './styles.css';
import {
  CELL,
  FAIL,
  FAIL_LABEL,
  createGrid,
  parseElevation,
  auditGrid,
} from './domain/drainage.js';

const STORE_KEY = 'roof-audit-draft-v1';

/** @type {{rows:number,cols:number,cells:Array<{elevation:number,kind:string}>}} */
let grid = createGrid(5, 5, () => ({ elevation: 0 }));
let tool = 'elevation';
let selected = null; // {r,c} 高程编辑选中
let lastAudit = null; // 最近一次审计结果
let stale = false; // 草稿相对最近审计是否已修改
let painting = false;
let highlightSet = null; // 安全时选中的汇水集合高亮

const els = {
  grid: document.querySelector('#grid'),
  rowsInput: document.querySelector('#rowsInput'),
  colsInput: document.querySelector('#colsInput'),
  newGridBtn: document.querySelector('#newGridBtn'),
  tools: document.querySelector('.tools'),
  editBar: document.querySelector('#editBar'),
  auditBtn: document.querySelector('#auditBtn'),
  staleBanner: document.querySelector('#staleBanner'),
  status: document.querySelector('#status'),
  report: document.querySelector('#report'),
};

// ---------- 草稿持久化（仅本地） ----------
function saveDraft() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ rows: grid.rows, cols: grid.cols, cells: grid.cells }),
    );
  } catch {
    /* 隐私模式等场景下静默忽略 */
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.cells) || data.cells.length !== data.rows) return false;
    grid = { rows: data.rows, cols: data.cols, cells: data.cells };
    els.rowsInput.value = data.rows;
    els.colsInput.value = data.cols;
    return true;
  } catch {
    return false;
  }
}

// ---------- 失效管理：任何草稿修改都使旧结论失效 ----------
function markMutated() {
  stale = lastAudit !== null;
  lastAudit = null;
  highlightSet = null;
  saveDraft();
  render();
}

// ---------- 渲染 ----------
function chainKeys() {
  if (!lastAudit || lastAudit.safe) return new Map();
  const m = new Map();
  lastAudit.failure.path.forEach((p, i) => m.set(`${p.r},${p.c}`, i));
  return m;
}

function render() {
  els.grid.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;
  const chain = chainKeys();
  const frag = document.createDocumentFragment();

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cell kind-${cell.kind}`;
      btn.dataset.r = r;
      btn.dataset.c = c;
      btn.setAttribute('aria-label', cellLabel(r, c, cell));

      const elev = document.createElement('span');
      elev.className = 'elev';
      elev.textContent = cell.elevation;
      btn.appendChild(elev);

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cell.kind === CELL.DRAIN ? '排' : cell.kind === CELL.SEAM ? '缝' : '';
      btn.appendChild(tag);

      if (selected && selected.r === r && selected.c === c) btn.classList.add('selected');
      if (chain.has(`${r},${c}`)) {
        btn.classList.add('chain');
        const step = document.createElement('span');
        step.className = 'step';
        step.textContent = chain.get(`${r},${c}`) + 1;
        btn.appendChild(step);
      }
      if (highlightSet && highlightSet.has(`${r},${c}`)) btn.classList.add('catchment');

      frag.appendChild(btn);
    }
  }
  els.grid.replaceChildren(frag);

  // 状态条
  els.staleBanner.classList.toggle('hidden', !stale);
  els.report.classList.toggle('hidden', stale || !lastAudit);
  if (stale || !lastAudit) {
    els.status.className = 'status';
    els.status.textContent = stale
      ? '草稿已修改：以下显示的旧结论已失效，必须重新发起审计。'
      : '尚未审计。标注高程、排水口与脆弱接缝后点击「发起审计」。';
  } else if (lastAudit.safe) {
    els.status.className = 'status ok';
    els.status.textContent = `审计通过：全部 ${lastAudit.cellResults.length} 个普通格的所有允许流向均可抵达排水口。`;
  } else {
    els.status.className = 'status bad';
    const f = lastAudit.failure;
    els.status.textContent = `审计不通过：首个问题起点为第 ${f.start.r + 1} 行第 ${f.start.c + 1} 列，失效类型：${FAIL_LABEL[f.reason]}。`;
  }

  renderEditBar();
  renderReport(chain);
}

function cellLabel(r, c, cell) {
  const kind = cell.kind === CELL.DRAIN ? '排水口' : cell.kind === CELL.SEAM ? '脆弱接缝' : '普通格';
  return `第${r + 1}行第${c + 1}列，${kind}，高程${cell.elevation}`;
}

function renderEditBar() {
  if (!selected || tool !== 'elevation') {
    els.editBar.innerHTML =
      '<span>提示：「高程」工具点击格逐格修改整数高程；「排水口 / 脆弱接缝 / 普通格」可按住指针拖扫涂刷。</span>';
    return;
  }
  const { r, c } = selected;
  const cell = grid.cells[r][c];
  els.editBar.innerHTML = `
    <span>正在编辑 第${r + 1} 行第 ${c + 1} 列（当前 ${cell.elevation}）：</span>
    <input id="elevInput" type="text" inputmode="numeric" value="${cell.elevation}" aria-label="整数高程" />
    <button id="elevApply" type="button">应用高程</button>
    <span id="elevError" class="error"></span>
  `;
  const input = els.editBar.querySelector('#elevInput');
  const apply = () => {
    try {
      const v = parseElevation(input.value);
      if (v !== cell.elevation) {
        cell.elevation = v;
        markMutated();
      }
    } catch (e) {
      els.editBar.querySelector('#elevError').textContent = e.message;
    }
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      apply();
      input.focus();
    }
  });
  els.editBar.querySelector('#elevApply').addEventListener('click', apply);
  queueMicrotask(() => input && input.focus());
}

function coord1(p) {
  return `(${p.r + 1}, ${p.c + 1})`;
}

function renderReport(chain) {
  if (!lastAudit) {
    els.report.replaceChildren();
    return;
  }

  if (!lastAudit.safe) {
    const f = lastAudit.failure;
    const wrap = document.createElement('div');

    const explain = document.createElement('p');
    explain.className = 'explain';
    const tailHint =
      f.reason === FAIL.OUTFLOW
        ? '链末格位于边界且格内再无“不高于”去向，水流出网格。'
        : f.reason === FAIL.DEAD_END
          ? '链末格四周均高于自身，水无去路。'
          : f.reason === FAIL.SEAM
            ? '链末格为脆弱接缝，水进入不可过水的病害区域。'
            : '链末格回到环入口，水可在等高区域无限循环。';
    explain.textContent = `失效类型「${FAIL_LABEL[f.reason]}」：${tailHint}`;
    wrap.appendChild(explain);

    const title = document.createElement('h3');
    title.textContent = '可复核失效流向链（网格中已按序号标出）';
    wrap.appendChild(title);

    const ol = document.createElement('ol');
    ol.className = 'chain-list';
    f.path.forEach((p, i) => {
      const li = document.createElement('li');
      const cell = grid.cells[p.r][p.c];
      const kind = cell.kind === CELL.DRAIN ? '排水口' : cell.kind === CELL.SEAM ? '脆弱接缝' : '普通格';
      li.textContent = `第 ${i + 1} 步：第 ${p.r + 1} 行第 ${p.c + 1} 列（${kind}，高程 ${cell.elevation}）`;
      li.addEventListener('mouseenter', () => highlightCell(p, true));
      li.addEventListener('mouseleave', () => highlightCell(p, false));
      ol.appendChild(li);
    });
    wrap.appendChild(ol);

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = '该起点的全部并列最低去向均已展开审计；以上是其中一条必然失效的流路。';
    wrap.appendChild(note);

    els.report.replaceChildren(wrap);
    return;
  }

  const wrap = document.createElement('div');

  const h3 = document.createElement('h3');
  h3.textContent = '各排水口汇水格集合（点击高亮）';
  wrap.appendChild(h3);

  for (const cm of lastAudit.drainCatchments) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'catchment-block';
    const cells = cm.cells.length
      ? cm.cells.map(coord1).join('、')
      : '（无普通格汇入）';
    block.innerHTML = `<strong>排水口 ${coord1(cm.drain)}</strong>：汇水 ${cm.cells.length} 格　<span class="muted">${cells}</span>`;
    block.addEventListener('click', () => {
      const next = new Set(cm.cells.map((p) => `${p.r},${p.c}`));
      highlightSet = highlightSet && [...highlightSet].join() === [...next].join() ? null : next;
      render();
    });
    wrap.appendChild(block);
  }

  const h3b = document.createElement('h3');
  h3b.textContent = '每格可达排水口结论';
  wrap.appendChild(h3b);

  const table = document.createElement('table');
  table.className = 'conclusions';
  table.innerHTML = '<thead><tr><th>普通格</th><th>高程</th><th>可达排水口（全部允许流路的终点）</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const cr of lastAudit.cellResults) {
    const tr = document.createElement('tr');
    const cell = grid.cells[cr.r][cr.c];
    tr.innerHTML = `<td>${coord1(cr)}</td><td>${cell.elevation}</td><td>${cr.reachableDrains.map(coord1).join('、')}</td>`;
    tr.addEventListener('mouseenter', () => highlightCell(cr, true));
    tr.addEventListener('mouseleave', () => highlightCell(cr, false));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);

  els.report.replaceChildren(wrap);
}

function highlightCell(p, on) {
  const el = els.grid.querySelector(`[data-r="${p.r}"][data-c="${p.c}"]`);
  if (el) el.classList.toggle('hover', on);
}

// ---------- 交互 ----------
els.tools.addEventListener('click', (e) => {
  const btn = e.target.closest('.tool');
  if (!btn) return;
  tool = btn.dataset.tool;
  els.tools.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b === btn));
  if (tool !== 'elevation') selected = null;
  render();
});

function paintAt(r, c) {
  const cell = grid.cells[r][c];
  if (tool === 'elevation') {
    selected = { r, c };
    render();
    return;
  }
  const kind = tool === 'drain' ? CELL.DRAIN : tool === 'seam' ? CELL.SEAM : CELL.NORMAL;
  if (cell.kind !== kind) {
    cell.kind = kind;
    markMutated();
  }
}

els.grid.addEventListener('pointerdown', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  e.preventDefault();
  painting = true;
  paintAt(Number(cellEl.dataset.r), Number(cellEl.dataset.c));
});

document.addEventListener('pointermove', (e) => {
  if (!painting || tool === 'elevation') return; // 高程不拖扫，避免误改
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cellEl = el && el.closest && el.closest('.cell');
  if (cellEl && els.grid.contains(cellEl)) {
    paintAt(Number(cellEl.dataset.r), Number(cellEl.dataset.c));
  }
});

document.addEventListener('pointerup', () => {
  painting = false;
});

els.newGridBtn.addEventListener('click', () => {
  const rows = Number(els.rowsInput.value);
  const cols = Number(els.colsInput.value);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 40 || cols > 40) {
    alert('行列数须为 1–40 的整数');
    return;
  }
  grid = createGrid(rows, cols, () => ({ elevation: 0 }));
  selected = null;
  stale = false;
  lastAudit = null;
  highlightSet = null;
  saveDraft();
  render();
});

els.auditBtn.addEventListener('click', () => {
  selected = null;
  highlightSet = null;
  lastAudit = auditGrid(grid);
  stale = false;
  render();
});

// ---------- 启动 ----------
loadDraft();
render();
