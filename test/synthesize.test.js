'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/synthesize.js');
const engine = require('../public/engine.js');

const CHORD_COMMANDS = [
  { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
  { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
  { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
];
const TWO_STEP_ONLY = [{ id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }];

function synth(commands, targetIds, scope) {
  return S.synthesize({ commands, scope: scope || 'editor', targetIds });
}
function ids(triggered) {
  return triggered.map((t) => t.commandId);
}

test('重复单步目标：最短脚本为两个单键，间隔取 1ms', () => {
  const r = synth(CHORD_COMMANDS, ['save', 'save']);
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+S' }, { t: 1, key: 'Ctrl+S' }]);
  assert.deepEqual(ids(r.replay.triggered), ['save', 'save']);
  // n=1 的 3 个脚本 + n=2 命中前的 8 个按键元组×2 间隔 + 命中脚本
  assert.equal(r.checked, 3 + 8 * 2 + 1);
});

test('结束结算：单步 + 两步前缀在结束时结算出其单步命令', () => {
  // save 立即触发；Ctrl+K 是前缀，完整回放的结束结算触发 mark
  const r = synth(CHORD_COMMANDS, ['save', 'mark']);
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+S' }, { t: 1, key: 'Ctrl+K' }]);
  assert.deepEqual(ids(r.replay.triggered), ['save', 'mark']);
});

test('失配结算：第二键失配先结算前缀，再作新起点', () => {
  // (Ctrl+K, Ctrl+S)@1ms：Ctrl+S 不构成两步序列 → 失配结算 mark，Ctrl+S 同时触发 save
  const r = synth(CHORD_COMMANDS, ['mark', 'save']);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+S']);
  assert.deepEqual(r.events.map((e) => e.t), [0, 1]);
  assert.deepEqual(ids(r.replay.triggered), ['mark', 'save']);
});

test('两步命令目标：追加单键凑出顺序，按按键序列升序取键', () => {
  const r = synth(CHORD_COMMANDS, ['openFile', 'save']);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events, [
    { t: 0, key: 'Ctrl+K' },
    { t: 1, key: 'Ctrl+F' },
    { t: 2, key: 'Ctrl+S' }
  ]);
  assert.deepEqual(ids(r.replay.triggered), ['openFile', 'save']);
});

test('不能夹带其他命令：需用第三个键引出第二个目标', () => {
  // openFile 后只按 Ctrl+K 会在结束时额外结算出 mark；Ctrl+F 则未匹配。
  // 三元组 (Ctrl+K, Ctrl+F, Ctrl+K)：openFile 后 Ctrl+K 结束结算 mark —— 恰好是目标
  const r = synth(CHORD_COMMANDS, ['openFile', 'mark']);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events.map((e) => e.key), ['Ctrl+K', 'Ctrl+F', 'Ctrl+K']);
  assert.deepEqual(ids(r.replay.triggered), ['openFile', 'mark']);
});

test('重复两步目标：两组两步序列各占两键，共 4 个事件', () => {
  const r = synth(CHORD_COMMANDS, ['openFile', 'openFile']);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events, [
    { t: 0, key: 'Ctrl+K' },
    { t: 1, key: 'Ctrl+F' },
    { t: 2, key: 'Ctrl+K' },
    { t: 3, key: 'Ctrl+F' }
  ]);
  assert.deepEqual(ids(r.replay.triggered), ['openFile', 'openFile']);
});

test('800ms 间隔：窗口内会误触两步命令，恰在截止时先超时结算再作新起点', () => {
  // s=单步 Ctrl+K；c=两步 Ctrl+K Ctrl+X；x=单步 Ctrl+X
  // 目标 [s, x]：间隔 1ms 只会触发 c；间隔 800ms 超时结算 s，Ctrl+X 再触发 x
  const commands = [
    { id: 's', scope: 'editor', keys: ['Ctrl+K'] },
    { id: 'c', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+X'] },
    { id: 'x', scope: 'editor', keys: ['Ctrl+X'] }
  ];
  const r = synth(commands, ['s', 'x']);
  assert.equal(r.solved, true);
  assert.deepEqual(r.events, [{ t: 0, key: 'Ctrl+K' }, { t: engine.WAIT_MS, key: 'Ctrl+X' }]);
  assert.deepEqual(ids(r.replay.triggered), ['s', 'x']);
});

test('首事件 t=0，相邻间隔只取 1 或 800ms', () => {
  const r = synth(CHORD_COMMANDS, ['openFile', 'save']);
  assert.equal(r.events[0].t, 0);
  for (let i = 1; i < r.events.length; i++) {
    assert.ok([1, engine.WAIT_MS].includes(r.events[i].t - r.events[i - 1].t));
  }
});

test('脚本回放出的命令 ID 列表恰好等于输入顺序', () => {
  [['save', 'mark'], ['mark', 'save'], ['openFile', 'openFile'], ['save', 'save', 'mark']]
    .forEach((targetIds) => {
      const r = synth(CHORD_COMMANDS, targetIds);
      assert.equal(r.solved, true, JSON.stringify(targetIds));
      assert.deepEqual(ids(r.replay.triggered), targetIds);
      // 再用引擎独立复核一遍
      const replay = engine.replay({ commands: CHORD_COMMANDS }, 'editor', r.events);
      assert.deepEqual(ids(replay.triggered), targetIds);
    });
});

test('无解：5 个事件内无法触发三次仅有的两步命令', () => {
  const r = synth(TWO_STEP_ONLY, ['openFile', 'openFile', 'openFile']);
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
  assert.match(r.note, /仅限上述搜索范围/);
  assert.match(r.note, /至多 5 个事件/);
  // 2 个候选键、1～5 个事件全部枚举：Σ 2^n · 2^(n-1) = 2 + 8 + 32 + 128 + 512
  assert.equal(r.checked, 2 + 8 + 32 + 128 + 512);
});

test('候选按键排序去重：命令表行顺序不影响脚本', () => {
  const a = synth(CHORD_COMMANDS, ['openFile', 'save']);
  const b = synth([...CHORD_COMMANDS].reverse(), ['openFile', 'save']);
  assert.deepEqual(a.candidateKeys, ['Ctrl+F', 'Ctrl+K', 'Ctrl+S']);
  assert.deepEqual(b.candidateKeys, a.candidateKeys);
  assert.deepEqual(b.events, a.events);
});

test('作用域覆盖：当前作用域绑定覆盖全局同序列', () => {
  const commands = [
    { id: 'g', scope: 'global', keys: ['Ctrl+P'] },
    { id: 'e', scope: 'editor', keys: ['Ctrl+P'] }
  ];
  // 编辑器作用域下 Ctrl+P 只触发 e，全局 g 无法出现
  let r = synth(commands, ['g', 'g'], 'editor');
  assert.equal(r.solved, false);
  // 全局作用域下则 e 无法出现
  r = synth(commands, ['e', 'e'], 'global');
  assert.equal(r.solved, false);
  // 目标改为生效绑定即可生成
  r = synth(commands, ['e', 'e'], 'editor');
  assert.equal(r.solved, true);
  assert.deepEqual(ids(r.replay.triggered), ['e', 'e']);
  r = synth(commands, ['g', 'g'], 'global');
  assert.equal(r.solved, true);
  assert.deepEqual(ids(r.replay.triggered), ['g', 'g']);
});

test('目标 ID 个数必须为 2～3 个', () => {
  let r = synth(CHORD_COMMANDS, ['save']);
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /2～3 个有序 ID/);

  r = synth(CHORD_COMMANDS, ['save', 'save', 'save', 'save']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /2～3 个有序 ID/);
});

test('目标 ID 为空或不存在：停止搜索并指出原因', () => {
  let r = synth(CHORD_COMMANDS, ['save', '']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /目标命令 #2：命令 ID 不能为空/);

  r = synth(CHORD_COMMANDS, ['save', 'ghost']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /"ghost" 不在命令配置中/);
});

test('目标 ID 可重复', () => {
  const r = synth(CHORD_COMMANDS, ['save', 'save', 'save']);
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.deepEqual(ids(r.replay.triggered), ['save', 'save', 'save']);
});

test('作用域无效：停止搜索并指出原因', () => {
  const r = synth(CHORD_COMMANDS, ['save', 'save'], 'sidebar');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /作用域/);
});

test('配置无效：停止搜索并指出原因', () => {
  const commands = [
    { id: 'a', scope: 'editor', keys: ['Ctrl+S'] },
    { id: 'b', scope: 'editor', keys: ['ctrl+s'] }
  ];
  const r = synth(commands, ['a', 'b']);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /重复绑定/);
});

test('候选按键超过 5 种：报错并停止搜索', () => {
  const commands = 'ABCDEF'.split('').map((ch, i) => ({
    id: 'c' + (i + 1), scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = synth(commands, ['c1', 'c2']);
  assert.equal(r.ok, false);
  assert.equal(r.solved, undefined);
  assert.match(r.errors.join('\n'), /超过上限 5/);
});

test('候选按键恰为 5 种：不超限，可正常生成', () => {
  const commands = 'ABCDE'.split('').map((ch, i) => ({
    id: 'c' + (i + 1), scope: 'editor', keys: ['Ctrl+' + ch]
  }));
  const r = synth(commands, ['c1', 'c2']);
  assert.equal(r.ok, true);
  assert.equal(r.candidateKeys.length, 5);
  assert.equal(r.solved, true);
  assert.deepEqual(ids(r.replay.triggered), ['c1', 'c2']);
});

test('限制常量：最多 5 个事件、间隔 1 与 800ms、目标 2～3 个', () => {
  assert.equal(S.MAX_EVENTS, 5);
  assert.equal(S.MAX_KEYS, 5);
  assert.equal(S.MIN_TARGETS, 2);
  assert.equal(S.MAX_TARGETS, 3);
  assert.deepEqual(S.GAPS, [1, engine.WAIT_MS]);
});
