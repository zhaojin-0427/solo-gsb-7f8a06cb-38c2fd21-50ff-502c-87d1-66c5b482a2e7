'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');

const CHORD_COMMANDS = [
  { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
  { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
  { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
];

function types(result) {
  return result.timeline.map((e) => e.type);
}
function triggeredIds(result) {
  return result.triggered.map((t) => t.commandId);
}

test('normalizeKey: 修饰键顺序等价、大小写不敏感', () => {
  assert.equal(E.normalizeKey('shift+ctrl+k').key, 'Ctrl+Shift+K');
  assert.equal(E.normalizeKey('Ctrl+Shift+K').key, 'Ctrl+Shift+K');
  assert.equal(E.normalizeKey('k').key, 'K');
  assert.equal(E.normalizeKey('META+1').key, 'Meta+1');
  assert.equal(E.normalizeKey('esc').key, 'Escape');
  assert.equal(E.normalizeKey('return').key, 'Enter');
  assert.equal(E.normalizeKey('alt+ctrl+shift+meta+f').key, 'Ctrl+Alt+Shift+Meta+F');
});

test('normalizeKey: 拒绝不支持的键与非法组合', () => {
  assert.equal(E.normalizeKey('Ctrl').ok, false);          // 缺主键
  assert.equal(E.normalizeKey('Ctrl+F5').ok, false);       // 不支持的主键
  assert.equal(E.normalizeKey('Ctrl+K+L').ok, false);      // 两个主键
  assert.equal(E.normalizeKey('Ctrl+Ctrl+K').ok, false);   // 修饰键重复
  assert.equal(E.normalizeKey('').ok, false);
  assert.equal(E.normalizeKey('Ctrl+Tab').ok, false);
});

test('validateCommands: 同作用域重复绑定报错，跨作用域允许', () => {
  const dup = E.validateCommands([
    { id: 'a', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'b', scope: 'editor', keys: ['ctrl+s'] }
  ]);
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join('\n'), /重复绑定/);

  const cross = E.validateCommands([
    { id: 'a', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'b', scope: 'global', keys: ['Ctrl+S'] }
  ]);
  assert.equal(cross.ok, true);
});

test('validateCommands: ID 必填且唯一、最多两步、作用域合法', () => {
  const r = E.validateCommands([
    { id: '', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'x', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'x', scope: 'editor', keys: ['Ctrl+A'] },
    { id: 'y', scope: 'sidebar', keys: ['Ctrl+B'] },
    { id: 'z', scope: 'editor', keys: ['Ctrl+A', 'Ctrl+B', 'Ctrl+C'] }
  ]);
  assert.equal(r.ok, false);
  const msg = r.errors.join('\n');
  assert.match(msg, /ID 不能为空/);
  assert.match(msg, /重复/);
  assert.match(msg, /作用域/);
  assert.match(msg, /最多支持两步/);
});

test('单步命令（非两步前缀）立即触发', () => {
  const r = E.replay({ commands: [{ id: 'save', scope: 'editor', keys: ['Ctrl+S'] }] }, 'editor', [
    { t: 0, key: 'Ctrl+S' }
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(types(r), ['trigger']);
  assert.equal(r.timeline[0].via, 'single');
  assert.deepEqual(triggeredIds(r), ['save']);
});

test('两步命令：800ms 内第二键命中则触发', () => {
  const r = E.replay({ commands: [{ id: 'openFile', scope: 'global', keys: ['Ctrl+K', 'Ctrl+F'] }] }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 300, key: 'Ctrl+F' }
  ]);
  assert.deepEqual(types(r), ['wait', 'trigger']);
  assert.equal(r.timeline[1].via, 'double');
  assert.deepEqual(triggeredIds(r), ['openFile']);
});

test('超时（>800ms）：先结算前缀触发单步，再处理当前键', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 900, key: 'Ctrl+S' }
  ]);
  assert.deepEqual(types(r), ['wait', 'timeout', 'trigger', 'trigger']);
  assert.equal(r.timeline[2].via, 'timeout');
  assert.deepEqual(triggeredIds(r), ['mark', 'save']);
});

test('恰在截止（=800ms）：先结算前缀，当前键再作新起点', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 800, key: 'Ctrl+F' }
  ]);
  assert.deepEqual(types(r), ['wait', 'timeout', 'trigger', 'unmatched']);
  assert.deepEqual(triggeredIds(r), ['mark']); // Ctrl+F 单独无绑定 → 未匹配
});

test('边界：799ms 内命中仍算两步', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 799, key: 'Ctrl+F' }
  ]);
  assert.deepEqual(types(r), ['wait', 'trigger']);
  assert.deepEqual(triggeredIds(r), ['openFile']);
});

test('失配：结算前缀触发单步，失配键再作新起点', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 300, key: 'Ctrl+S' }
  ]);
  assert.deepEqual(types(r), ['wait', 'mismatch', 'trigger', 'trigger']);
  assert.equal(r.timeline[2].via, 'mismatch');
  assert.deepEqual(triggeredIds(r), ['mark', 'save']);
});

test('失配键可成为新的两步前缀', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 100, key: 'Ctrl+K' },   // 与 pending 不构成两步 → 结算 mark；自身又是前缀
    { t: 200, key: 'Ctrl+F' }    // 命中 openFile
  ]);
  assert.deepEqual(types(r), ['wait', 'mismatch', 'trigger', 'wait', 'trigger']);
  assert.deepEqual(triggeredIds(r), ['mark', 'openFile']);
});

test('前缀无单步命令：结算时丢弃', () => {
  const r = E.replay({ commands: [{ id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }] }, 'editor', [
    { t: 0, key: 'Ctrl+K' },
    { t: 200, key: 'Ctrl+X' }
  ]);
  assert.deepEqual(types(r), ['wait', 'mismatch', 'discard', 'unmatched']);
  assert.deepEqual(triggeredIds(r), []);
});

test('输入结束时结算待定前缀', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 0, key: 'Ctrl+K' }
  ]);
  assert.deepEqual(types(r), ['wait', 'end', 'trigger']);
  assert.equal(r.timeline[2].via, 'end');
  assert.deepEqual(triggeredIds(r), ['mark']);
});

test('作用域：仅当前作用域与全局生效，同序列当前作用域优先', () => {
  const commands = [
    { id: 'globalPalette', scope: 'global', keys: ['Ctrl+P'] },
    { id: 'editorPalette', scope: 'editor', keys: ['Ctrl+P'] },
    { id: 'popupOnly', scope: 'popup', keys: ['Ctrl+O'] }
  ];
  // 编辑器作用域：编辑器绑定覆盖全局
  let r = E.replay({ commands }, 'editor', [{ t: 0, key: 'Ctrl+P' }]);
  assert.deepEqual(triggeredIds(r), ['editorPalette']);
  // 弹窗作用域：编辑器绑定失效，回落到全局
  r = E.replay({ commands }, 'popup', [{ t: 0, key: 'Ctrl+P' }]);
  assert.deepEqual(triggeredIds(r), ['globalPalette']);
  // 其他作用域的绑定不生效
  r = E.replay({ commands }, 'editor', [{ t: 0, key: 'Ctrl+O' }]);
  assert.deepEqual(types(r), ['unmatched']);
  // 弹窗作用域下自己的绑定生效
  r = E.replay({ commands }, 'popup', [{ t: 0, key: 'Ctrl+O' }]);
  assert.deepEqual(triggeredIds(r), ['popupOnly']);
});

test('修饰键顺序等价的端到端回放', () => {
  const r = E.replay({ commands: [{ id: 'wrap', scope: 'editor', keys: ['Shift+Ctrl+K'] }] }, 'editor', [
    { t: 0, key: 'ctrl+shift+k' }
  ]);
  assert.deepEqual(triggeredIds(r), ['wrap']);
});

test('事件时间必须按毫秒递增', () => {
  const r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [
    { t: 500, key: 'Ctrl+S' },
    { t: 100, key: 'Ctrl+S' }
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /递增/);
});

test('非法事件与非法作用域报错', () => {
  let r = E.replay({ commands: CHORD_COMMANDS }, 'sidebar', []);
  assert.equal(r.ok, false);
  r = E.replay({ commands: CHORD_COMMANDS }, 'editor', [{ t: -1, key: 'Ctrl+F5' }]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});
