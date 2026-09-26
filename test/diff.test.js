'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/diff.js');

const OLD = [
  { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
  { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
  { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
];

test('三个作用域全部搜索；相同配置无差异', () => {
  const r = D.compare(OLD, OLD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.scopes.map((s) => s.scope), ['global', 'editor', 'popup']);
  assert.deepEqual(r.secondKeyTimes, [1, 800]);
  for (const sc of r.scopes) {
    assert.equal(sc.groups.length, 0);
    assert.ok(sc.checked > 0); // 仍枚举并比较了全部样例
  }
});

test('删除单步命令：编辑器作用域检出差异，全局/弹窗不受影响', () => {
  const NEW = OLD.filter((c) => c.id !== 'mark');
  const r = D.compare(OLD, NEW);
  assert.equal(r.ok, true);

  const editor = r.scopes.find((s) => s.scope === 'editor');
  assert.equal(editor.keys.join(','), 'Ctrl+F,Ctrl+K,Ctrl+S'); // 按键排序去重
  assert.equal(editor.checked, 3 + 3 * 3 * 2); // 一键 + 两键 × {1,800}
  assert.equal(editor.groups.length, 9);

  // 每组代表样例最短；第一组即一键样例 [Ctrl+K@0]：旧结束结算触发 mark，新丢弃
  const g0 = editor.groups[0];
  assert.deepEqual(g0.sample, [{ t: 0, key: 'Ctrl+K' }]);
  assert.deepEqual(g0.oldTriggered, [{ commandId: 'mark', t: 0 }]);
  assert.deepEqual(g0.newTriggered, []);

  // 这些命令都是编辑器作用域绑定 → 全局、弹窗两套配置都无生效绑定，无差异
  assert.equal(r.scopes.find((s) => s.scope === 'global').groups.length, 0);
  assert.equal(r.scopes.find((s) => s.scope === 'popup').groups.length, 0);
});

test('同结果组合并为一组：代表样例取事件数最少，同长度按键升序', () => {
  const oldC = [{ id: 's', scope: 'editor', keys: ['Ctrl+A'] }];
  const newC = [
    { id: 'p', scope: 'popup', keys: ['Ctrl+P'] },
    { id: 'q', scope: 'popup', keys: ['Ctrl+Q'] }
  ];
  const editor = D.compare(oldC, newC).scopes.find((s) => s.scope === 'editor');

  // (旧 [s@0], 新 []) 组合可由 [A@0]、[A@0,P@1]、[A@0,Q@800] 等多样例产生 → 并为一组，代表取最短一键
  const g = editor.groups.find(
    (g) => g.oldTriggered.length === 1 && g.oldTriggered[0].t === 0 && g.newTriggered.length === 0
  );
  assert.ok(g);
  assert.deepEqual(g.sample, [{ t: 0, key: 'Ctrl+A' }]);

  // (旧 [s@1], 新 []) 组合：[P@0,A@1] 与 [Q@0,A@1] 同组，按键升序取 P 开头者
  const g2 = editor.groups.find(
    (g) => g.oldTriggered.length === 1 && g.oldTriggered[0].t === 1 && g.newTriggered.length === 0
  );
  assert.ok(g2);
  assert.deepEqual(g2.sample, [{ t: 0, key: 'Ctrl+P' }, { t: 1, key: 'Ctrl+A' }]);
});

test('触发时间不同（命令 ID 相同、时刻不同）也构成差异', () => {
  const oldC = [{ id: 'save', scope: 'editor', keys: ['Ctrl+S'] }];
  const newC = [
    { id: 'save', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'openFile', scope: 'editor', keys: ['Ctrl+S', 'Ctrl+F'] }
  ];
  const editor = D.compare(oldC, newC).scopes.find((s) => s.scope === 'editor');

  // [S@0, F@800]：旧 → save@0；新 → 超时结算 save@800
  let g = editor.groups.find(
    (g) => g.sample.length === 2 && g.sample[1].key === 'Ctrl+F' && g.sample[1].t === 800
  );
  assert.ok(g);
  assert.deepEqual(g.oldTriggered, [{ commandId: 'save', t: 0 }]);
  assert.deepEqual(g.newTriggered, [{ commandId: 'save', t: 800 }]);

  // [S@0, S@800]：旧 → save@0, save@800；新 → 首个 save 推迟到 800ms
  g = editor.groups.find(
    (g) => g.sample.length === 2 && g.sample[1].key === 'Ctrl+S' && g.sample[1].t === 800
  );
  assert.ok(g);
  assert.deepEqual(g.oldTriggered, [{ commandId: 'save', t: 0 }, { commandId: 'save', t: 800 }]);
  assert.deepEqual(g.newTriggered, [{ commandId: 'save', t: 800 }, { commandId: 'save', t: 800 }]);
});

test('命令表行顺序不影响比较结果', () => {
  const NEW = OLD.filter((c) => c.id !== 'mark');
  const a = D.compare(OLD, NEW);
  const b = D.compare([...OLD].reverse(), [...NEW].reverse());
  assert.deepEqual(a, b);
});

test('任一侧校验失败即停止搜索，并按侧别返回错误行', () => {
  // 旧配置有错
  let r = D.compare([{ id: 'x', scope: 'editor', keys: ['Ctrl+F5'] }], OLD);
  assert.equal(r.ok, false);
  assert.equal(r.scopes, undefined); // 未搜索
  assert.equal(r.errors.new.length, 0);
  assert.ok(r.errors.old.length > 0);
  assert.match(r.errors.old.join('\n'), /命令 #1/);

  // 新配置有错（作用域非法）
  r = D.compare(OLD, [{ id: 'a', scope: 'sidebar', keys: ['Ctrl+A'] }]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.old.length, 0);
  assert.ok(r.errors.new.length > 0);
  assert.match(r.errors.new.join('\n'), /命令 #1/);

  // 两侧同时有错
  r = D.compare(
    [{ id: 'dup', scope: 'editor', keys: ['Ctrl+A'] }, { id: 'dup', scope: 'editor', keys: ['Ctrl+B'] }],
    [{ id: 'z', scope: 'editor', keys: [] }]
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.old.length > 0 && r.errors.new.length > 0);
});

test('两套配置均为空：无样例、无差异', () => {
  const r = D.compare([], []);
  assert.equal(r.ok, true);
  for (const sc of r.scopes) {
    assert.equal(sc.keys.length, 0);
    assert.equal(sc.checked, 0);
    assert.equal(sc.groups.length, 0);
  }
});
