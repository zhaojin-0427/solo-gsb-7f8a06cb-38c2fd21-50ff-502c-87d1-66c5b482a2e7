'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/synth.js');
const engine = require('../public/engine.js');

const CHORD_COMMANDS = [
  { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
  { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
  { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
];
const TWO_STEP_ONLY = [{ id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }];

function synth(commands, targetIds, scope) {
  return S.synth({ commands, scope: scope || 'editor', targetIds });
}
function ids(triggered) {
  return triggered.map((t) => t.commandId);
}
// 解出后用引擎独立复核：触发列表恰好等于目标，且事件满足首键 t=0、间隔 ∈ {1,800}、事件数 ≤ 5
function assertValidSolution(r, targetIds) {
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.ok(r.events.length >= 1 && r.events.length <= 5);
  assert.equal(r.events[0].t, 0);
  for (let i = 1; i < r.events.length; i++) {
    const gap = r.events[i].t - r.events[i - 1].t;
    assert.ok(gap === 1 || gap === 800, '间隔只能是 1 或 800ms，实际 ' + gap);
  }
  assert.deepEqual(ids(r.replay.triggered), targetIds);
}

test('两步命令 + 后续单步：最少 3 个事件，间隔 1ms', () => {
  const commands = [
    { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
    { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
  ];
  const r = synth(commands, ['openFile', 'save']);
  assertValidSolution(r, ['openFile', 'save']);
  // 候选键 [Ctrl+F, Ctrl+K, Ctrl+S]：首个命中为按键序列 [K,F,S]、间隔 [1,1]
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+F', 'Ctrl+S']);
  assert.deepEqual(r.events.map((e) => e.t), [0, 1, 2]);
});

test('失配结算 + 两步命中：目标 [mark, openFile] 需要 3 个事件', () => {
  const r = synth(CHORD_COMMANDS, ['mark', 'openFile']);
  assertValidSolution(r, ['mark', 'openFile']);
  // K@0 等待；K@1 失配先结算 mark 并成为新前缀；F@2 命中 openFile
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+K', 'Ctrl+F']);
  assert.deepEqual(r.events.map((e) => e.t), [0, 1, 2]);
});

test('重复目标：单步命令连发两次，2 个事件间隔 1ms', () => {
  const commands = [{ id: 'save', scope: 'editor', keys: ['Ctrl+S'] }];
  const r = synth(commands, ['save', 'save']);
  assertValidSolution(r, ['save', 'save']);
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+S' }, { t: 1, key: 'Ctrl+S' }]);
});

test('三个目标可在 5 个事件内完成：失配结算两次再触发单步', () => {
  const r = synth(CHORD_COMMANDS, ['mark', 'mark', 'save']);
  assertValidSolution(r, ['mark', 'mark', 'save']);
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+K', 'Ctrl+S']);
  assert.deepEqual(r.events.map((e) => e.t), [0, 1, 2]);
});

test('恰为 5 个事件的解：两个两步命令 + 结束结算前缀', () => {
  const r = synth(CHORD_COMMANDS, ['openFile', 'openFile', 'mark']);
  assertValidSolution(r, ['openFile', 'openFile', 'mark']);
  assert.equal(r.events.length, 5);
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+F', 'Ctrl+K', 'Ctrl+F', 'Ctrl+K']);
});

test('需要 800ms 间隔：窗口内会误成两步命令，超时结算才得到目标顺序', () => {
  const commands = [
    { id: 'a', scope: 'editor', keys: ['Ctrl+P'] },
    { id: 'x', scope: 'editor', keys: ['Ctrl+P', 'Ctrl+Q'] },
    { id: 'b', scope: 'editor', keys: ['Ctrl+Q'] }
  ];
  const r = synth(commands, ['a', 'b']);
  assertValidSolution(r, ['a', 'b']);
  // [P,Q] 间隔 1ms 会命中两步命令 x；间隔 800ms 先超时结算 a，Q 再作新起点触发 b
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+P', 'Ctrl+Q']);
  assert.deepEqual(r.events.map((e) => e.t), [0, 800]);
});

test('不夹带其他命令：精确匹配触发序列（长度也必须相等）', () => {
  // K,K 在间隔 1ms 下会结算两次 mark；目标只写一个 mark 时不得取它
  const r = synth(CHORD_COMMANDS, ['mark', 'save']);
  assertValidSolution(r, ['mark', 'save']);
  assert.deepEqual(ids(r.replay.triggered), ['mark', 'save']);
});

test('无解：三个两步命令至少需要 6 个事件，超出 5 个事件上限', () => {
  const r = synth(TWO_STEP_ONLY, ['openFile', 'openFile', 'openFile']);
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
  assert.equal(r.events, undefined);
  assert.match(r.note, /仅限于上述搜索范围/);
  assert.match(r.note, /最多 5 个事件/);
  assert.ok(r.checked > 0); // 确实枚举过
});

test('无解：作用域覆盖使目标绑定全部不生效（弹窗下无编辑器绑定）', () => {
  const r = synth(CHORD_COMMANDS, ['mark', 'openFile'], 'popup');
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
  assert.match(r.note, /仅限于上述搜索范围/);
});

test('全局绑定的目标在任意作用域都可合成', () => {
  const commands = [
    { id: 'p', scope: 'global', keys: ['Ctrl+P'] },
    { id: 'q', scope: 'global', keys: ['Ctrl+Q'] }
  ];
  const r = synth(commands, ['p', 'q'], 'popup');
  assertValidSolution(r, ['p', 'q']);
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+P', 'Ctrl+Q']);
});

test('候选按键超过 5 种：报错并停止搜索', () => {
  const commands = 'ABCDEF'.split('').map((ch) => ({
    id: 'c' + ch, scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = synth(commands, ['cA', 'cB']);
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /超过上限 5/);
});

test('候选按键恰为 5 种：不超限', () => {
  const commands = 'ABCDE'.split('').map((ch) => ({
    id: 'c' + ch, scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = synth(commands, ['cA', 'cB']);
  assert.equal(r.ok, true);
  assert.equal(r.candidateKeys.length, 5);
  assert.equal(r.solved, true);
});

test('目标 ID 数量必须为 2～3 个', () => {
  let r = synth(CHORD_COMMANDS, ['mark']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /需为 2～3 个/);

  r = synth(CHORD_COMMANDS, ['mark', 'save', 'mark', 'save']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /需为 2～3 个/);

  r = synth(CHORD_COMMANDS, 'mark,save');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /数组/);
});

test('目标命令 ID 无效：为空或不在配置中均停止搜索', () => {
  let r = synth(CHORD_COMMANDS, ['mark', '']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /命令 ID 不能为空/);

  r = synth(CHORD_COMMANDS, ['mark', 'ghost']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /"ghost" 不在命令配置中/);
});

test('配置或作用域无效：停止搜索并指出原因', () => {
  const dup = [
    { id: 'a', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'b', scope: 'editor', keys: ['ctrl+s'] }
  ];
  let r = synth(dup, ['a', 'b']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /重复绑定/);

  r = synth(CHORD_COMMANDS, ['mark', 'save'], 'sidebar');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /作用域/);
});

test('候选按键排序去重：命令表行顺序不影响合成结果', () => {
  const a = synth(CHORD_COMMANDS, ['mark', 'openFile']);
  const b = synth([...CHORD_COMMANDS].reverse(), ['mark', 'openFile']);
  assert.deepEqual(a.candidateKeys, ['Ctrl+F', 'Ctrl+K', 'Ctrl+S']);
  assert.deepEqual(b.candidateKeys, a.candidateKeys);
  assert.deepEqual(b.events, a.events);
});

test('返回的脚本经引擎回放后触发列表恰好等于目标', () => {
  const r = synth(CHORD_COMMANDS, ['openFile', 'openFile', 'mark']);
  const replay = engine.replay({ commands: CHORD_COMMANDS }, 'editor', r.events);
  assert.deepEqual(ids(replay.triggered), ['openFile', 'openFile', 'mark']);
});

test('搜索元数据：间隔选项与计数', () => {
  assert.deepEqual(S.GAPS, [1, 800]);
  assert.equal(S.MAX_EVENTS, 5);
  assert.equal(S.MAX_KEYS, 5);
  const r = synth(CHORD_COMMANDS, ['save', 'save']);
  assert.equal(r.ok, true);
  assert.equal(r.gaps.join(','), '1,800');
  assert.equal(r.waitMs, 800);
  assert.ok(Number.isInteger(r.checked) && r.checked > 0);
});
