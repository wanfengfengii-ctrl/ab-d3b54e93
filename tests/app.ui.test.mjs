import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 用极简 DOM 桩在 Node 中执行 app.js：
 * 验证网格渲染、审计按钮、编辑后结论失效、病害示例结论等界面接线。
 */

class ClassList {
  #set = new Set();
  add(...names) { names.forEach((n) => this.#set.add(n)); }
  remove(...names) { names.forEach((n) => this.#set.delete(n)); }
  toggle(name, force) {
    const want = force === undefined ? !this.#set.has(name) : force;
    if (want) this.#set.add(name);
    else this.#set.delete(name);
    return want;
  }
  contains(name) { return this.#set.has(name); }
}

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.classList = new ClassList();
    this.listeners = {};
    this._innerHTML = '';
    this.textContent = '';
    const store = {};
    this.style = {
      setProperty: (k, v) => { store[k] = v; },
      removeProperty: (k) => { delete store[k]; },
    };
  }
  set className(v) { this.classList = new ClassList(); if (v) this.classList.add(...v.split(/\s+/)); }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  matches(sel) {
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('input')) return this.tagName === 'input';
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n.matches && n.matches(sel)) return n;
      n = n.parent;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event); }
}

const IDS = [
  'grid', 'status', 'results', 'elevValue', 'rowsInput', 'colsInput',
  'applySize', 'loadSafe', 'loadFault', 'clearGrid', 'auditBtn',
];
const registry = Object.fromEntries(IDS.map((id) => [id, new El('div')]));
registry.elevValue.value = '5';
registry.rowsInput.value = '6';
registry.colsInput.value = '8';
const radios = ['elev', 'drain', 'fragile'].map((v) => {
  const r = new El('input');
  r.value = v;
  return r;
});

globalThis.document = {
  getElementById: (id) => registry[id],
  createElement: (tag) => new El(tag),
  querySelectorAll: (sel) => (sel === 'input[name="tool"]' ? radios : []),
};
globalThis.window = { addEventListener() {} };

await import('../src/app.js');

const { grid, results, status } = registry;
const cells = () => grid.querySelectorAll('.cell');
const edges = () => grid.querySelectorAll('.edge');
const firePointerDown = (el) => grid.fire('pointerdown', { target: el });

test('界面接线：渲染、审计、编辑失效、病害示例', () => {
  // 初始：安全示例，6×8 网格 + 接缝
  assert.equal(cells().length, 48);
  assert.equal(edges().length, 6 * 7 + 5 * 8);
  assert.match(results.innerHTML, /尚未审计/);

  // 发起审计 → 安全结论（含汇水格集合与逐格结论）
  registry.auditBtn.fire('click');
  assert.match(results.innerHTML, /✓ 审计通过/);
  assert.match(results.innerHTML, /汇水格/);
  assert.match(results.innerHTML, /逐格可达排水口结论/);

  // 任意草稿修改 → 旧结论失效
  const before = cells()[0].innerHTML;
  firePointerDown(cells()[0]); // 高程工具：写入高程值 5（原为 5？格(1,1) 高程为 5 → 需换值）
  // 格(1,1) 高程恰为 5，与输入相同则不构成修改；改为写入 9
  registry.elevValue.value = '9';
  firePointerDown(cells()[0]);
  assert.notEqual(cells()[0].innerHTML, before);
  assert.match(results.innerHTML, /结论已失效/);

  // 重新审计 → 结论恢复有效
  registry.auditBtn.fire('click');
  assert.doesNotMatch(results.innerHTML, /结论已失效/);

  // 排水口工具：点击切换排水口
  radios[1].fire('change');
  firePointerDown(cells()[10]);
  assert.match(cells()[10].innerHTML, /drain-badge/);
  assert.match(results.innerHTML, /结论已失效/);
  registry.auditBtn.fire('click');

  // 脆弱接缝工具：点击接缝切换
  radios[2].fire('change');
  const edgeList = edges();
  firePointerDown(edgeList[0]);
  assert.ok(edgeList[0].classList.contains('fragile'));

  // 载入病害示例 → 审计未通过，首个问题起点 (4,5)，类型进入脆弱接缝
  registry.loadFault.fire('click');
  registry.auditBtn.fire('click');
  assert.match(results.innerHTML, /✗ 审计未通过/);
  assert.match(results.innerHTML, /\(4,5\)/);
  assert.match(results.innerHTML, /进入脆弱接缝/);
  // 失效链已标注到网格（步序徽标）
  assert.ok(cells().some((c) => c.innerHTML.includes('step-badge')));

  // 状态行：点击格子显示允许流向
  radios[0].fire('change');
  firePointerDown(cells()[5]);
  assert.match(status.innerHTML, /允许流向|排水口|无允许流向/);
});
