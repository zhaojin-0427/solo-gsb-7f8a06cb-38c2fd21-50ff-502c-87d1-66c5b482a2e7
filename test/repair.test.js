'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/repair.js');

const CHORD_COMMANDS = [
  { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
  { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
  { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
];
const TWO_STEP_ONLY = [{ id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }];

function repair(commands, events, targetId, scope) {
  return R.repair({ commands, scope: scope || 'editor', events, targetId });
}
function ids(triggered) {
  return triggered.map((t) => t.commandId);
}

test('目标已触发：返回零改动，不搜索替换', () => {
  const r = repair(CHORD_COMMANDS, [{ t: 0, key: 'Ctrl+K' }, { t: 300, key: 'Ctrl+F' }], 'openFile');
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.equal(r.alreadyTriggered, true);
  assert.equal(r.original.targetHits, 1);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+K' }, { t: 300, key: 'Ctrl+F' }]);
  assert.deepEqual(ids(r.replay.triggered), ['openFile']);
});

test('一处替换：失配的第二键换成配置中的按键', () => {
  const r = repair(TWO_STEP_ONLY, [{ t: 0, key: 'Ctrl+K' }, { t: 300, key: 'Ctrl+X' }], 'openFile');
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.equal(r.alreadyTriggered, false);
  assert.equal(r.original.targetHits, 0);
  assert.deepEqual(r.changes, [{ index: 1, from: 'Ctrl+X', to: 'Ctrl+F' }]);
  // 时间戳与事件数保持不变
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+K' }, { t: 300, key: 'Ctrl+F' }]);
  assert.deepEqual(ids(r.replay.triggered), ['openFile']);
});

test('两处替换：按替换键序列升序取首个可行元组', () => {
  const r = repair(TWO_STEP_ONLY, [{ t: 0, key: 'Ctrl+A' }, { t: 300, key: 'Ctrl+B' }], 'openFile');
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  // 候选键 ['Ctrl+F','Ctrl+K']：元组 (F,F)、(F,K) 均不可行，(K,F) 命中
  assert.deepEqual(r.changes, [
    { index: 0, from: 'Ctrl+A', to: 'Ctrl+K' },
    { index: 1, from: 'Ctrl+B', to: 'Ctrl+F' }
  ]);
  assert.deepEqual(r.events.map((e) => e.t), [0, 300]); // 时间戳不变
  assert.equal(r.events.length, 2); // 事件数不变
  assert.deepEqual(ids(r.replay.triggered), ['openFile']);
});

test('改动处数优先：一处可行即不返回两处方案', () => {
  const r = repair([{ id: 'b', scope: 'editor', keys: ['Ctrl+B'] }], [{ t: 0, key: 'Ctrl+X' }], 'b');
  assert.equal(r.solved, true);
  assert.equal(r.changes.length, 1);
  assert.deepEqual(r.changes, [{ index: 0, from: 'Ctrl+X', to: 'Ctrl+B' }]);
});

test('事件下标升序：多处皆可时取最小下标', () => {
  const r = repair(
    [{ id: 'b', scope: 'editor', keys: ['Ctrl+B'] }],
    [{ t: 0, key: 'Ctrl+X' }, { t: 100, key: 'Ctrl+Y' }],
    'b'
  );
  assert.equal(r.solved, true);
  assert.deepEqual(r.changes, [{ index: 0, from: 'Ctrl+X', to: 'Ctrl+B' }]);
});

test('替换键升序：同一下标多个键可行时取排序最小者', () => {
  // 下标 1 换成 Ctrl+F 或 Ctrl+K 都能触发 openFile；候选键升序 → 选 Ctrl+F
  const commands = [
    { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
    { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }
  ];
  const events = [{ t: 0, key: 'Ctrl+K' }, { t: 100, key: 'Ctrl+X' }, { t: 200, key: 'Ctrl+F' }];
  const r = repair(commands, events, 'openFile');
  assert.equal(r.solved, true);
  assert.deepEqual(r.changes, [{ index: 1, from: 'Ctrl+X', to: 'Ctrl+F' }]);
  assert.deepEqual(ids(r.replay.triggered), ['openFile']);
});

test('原键不计替换：改动处的目标键必与原键不同', () => {
  const r = repair(TWO_STEP_ONLY, [{ t: 0, key: 'Ctrl+A' }, { t: 300, key: 'Ctrl+B' }], 'openFile');
  assert.equal(r.solved, true);
  for (const c of r.changes) assert.notEqual(c.from, c.to);
  assert.equal(r.changes.length, 2); // 恰好两处真实改动
});

test('无解：说明仅限当前替换范围与现有时间戳', () => {
  // 只有一个事件，两步命令至少需要两个按键 → 无可行替换
  const r = repair(TWO_STEP_ONLY, [{ t: 0, key: 'Ctrl+X' }], 'openFile');
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
  assert.equal(r.alreadyTriggered, false);
  assert.deepEqual(r.changes, []);
  assert.match(r.note, /仅限于当前替换范围/);
  assert.match(r.note, /时间戳/);
});

test('空事件列表：目标无法触发 → 无解', () => {
  const r = repair(CHORD_COMMANDS, [], 'mark');
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
});

test('事件数超过 8 个：报错并停止搜索', () => {
  const events = Array.from({ length: 9 }, (_, i) => ({ t: i, key: 'Ctrl+S' }));
  const r = repair(CHORD_COMMANDS, events, 'save');
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /超过上限 8/);
});

test('事件数恰为 8 个：不超限', () => {
  const events = Array.from({ length: 8 }, (_, i) => ({ t: i, key: 'Ctrl+S' }));
  const r = repair(CHORD_COMMANDS, events, 'save');
  assert.equal(r.ok, true);
  assert.equal(r.alreadyTriggered, true); // save 已触发 → 零改动
});

test('候选按键超过 12 种：报错并停止搜索', () => {
  const commands = 'ABCDEFGHIJKLM'.split('').map((ch, i) => ({
    id: 'c' + (i + 1), scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = repair(commands, [{ t: 0, key: 'Ctrl+A' }], 'c1');
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /超过上限 12/);
});

test('候选按键恰为 12 种：不超限', () => {
  const commands = 'ABCDEFGHIJKL'.split('').map((ch, i) => ({
    id: 'c' + (i + 1), scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = repair(commands, [{ t: 0, key: 'Ctrl+A' }], 'c1');
  assert.equal(r.ok, true);
  assert.equal(r.candidateKeys.length, 12);
});

test('配置无效：停止搜索并指出错误', () => {
  const r = repair(
    [{ id: 'a', scope: 'editor', keys: ['Ctrl+S'] }, { id: 'b', scope: 'editor', keys: ['ctrl+s'] }],
    [{ t: 0, key: 'Ctrl+S' }],
    'a'
  );
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /重复绑定/);
});

test('事件无效：停止搜索并指出错误', () => {
  const r = repair(CHORD_COMMANDS, [{ t: 500, key: 'Ctrl+S' }, { t: 100, key: 'Ctrl+S' }], 'save');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /递增/);
});

test('目标命令 ID 无效：停止搜索并指出错误', () => {
  let r = repair(CHORD_COMMANDS, [{ t: 0, key: 'Ctrl+S' }], '');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /目标命令 ID 不能为空/);

  r = repair(CHORD_COMMANDS, [{ t: 0, key: 'Ctrl+S' }], 'ghost');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /"ghost" 不在命令配置中/);
});

test('作用域无效：停止搜索并指出错误', () => {
  const r = repair(CHORD_COMMANDS, [{ t: 0, key: 'Ctrl+S' }], 'save', 'sidebar');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /作用域/);
});

test('候选按键排序去重：命令表行顺序不影响修正结果', () => {
  const events = [{ t: 0, key: 'Ctrl+A' }, { t: 300, key: 'Ctrl+B' }];
  const a = repair(TWO_STEP_ONLY, events, 'openFile');
  const b = repair([...TWO_STEP_ONLY].reverse(), events, 'openFile');
  assert.deepEqual(a.candidateKeys, ['Ctrl+F', 'Ctrl+K']);
  assert.deepEqual(b.candidateKeys, a.candidateKeys);
  assert.deepEqual(b.changes, a.changes);
  assert.deepEqual(b.events, a.events);
});

test('沿用当前作用域：目标绑定不在生效集合内则无解', () => {
  // save 是编辑器绑定；弹窗作用域下任何替换都无法触发它
  const r = repair(CHORD_COMMANDS, [{ t: 0, key: 'Ctrl+X' }], 'save', 'popup');
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
});

test('全局绑定的目标在任意作用域都可修正', () => {
  const commands = [{ id: 'palette', scope: 'global', keys: ['Ctrl+P'] }];
  const r = repair(commands, [{ t: 0, key: 'Ctrl+X' }], 'palette', 'popup');
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.deepEqual(r.changes, [{ index: 0, from: 'Ctrl+X', to: 'Ctrl+P' }]);
  assert.deepEqual(ids(r.replay.triggered), ['palette']);
});
