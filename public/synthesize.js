/*
 * 命令宏脚本生成（浏览器与 Node 共用，沿用 engine.js 回放引擎）
 * - 沿用当前命令表与当前作用域；输入 2～3 个有序命令 ID（可重复）
 * - 从空事件生成按键脚本：完整回放（含失配 / 超时 / 结束结算、作用域覆盖）触发的
 *   命令 ID 列表必须恰好等于输入顺序，不能夹带其他命令
 * - 候选按键只取当前配置中出现的规范化按键（排序去重）
 * - 首事件 t=0；相邻事件间隔限 1 或 800ms；最多 5 个事件、5 种候选按键，超限报错
 * - 按（事件数、按键序列、时间戳序列）依次升序枚举，首个命中的脚本即唯一解
 * - 配置 / 作用域 / 目标 ID 无效或候选按键超限：停止搜索并报错
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShortcutSynthesize = factory(root.ShortcutEngine);
})(typeof self !== 'undefined' ? self : this, function (engine) {
  'use strict';

  var MAX_EVENTS = 5;                    // 脚本事件数上限
  var MAX_KEYS = 5;                      // 候选按键种数上限
  var MIN_TARGETS = 2;                   // 目标命令 ID 最少个数
  var MAX_TARGETS = 3;                   // 目标命令 ID 最多个数
  var GAPS = [1, engine.WAIT_MS];        // 相邻事件允许的间隔（毫秒）：窗口内 / 恰在截止

  /* 当前配置中出现过的规范化按键（排序去重 → 与命令表行顺序无关） */
  function collectKeys(commands) {
    var seen = {};
    commands.forEach(function (c) {
      c.keys.forEach(function (k) { seen[k] = true; });
    });
    return Object.keys(seen).sort();
  }

  /* 规范化目标命令 ID：去空白；非字符串/空白按缺失处理 */
  function normalizeTargets(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (id) {
      out.push(typeof id === 'string' ? id.trim() : '');
    });
    return out;
  }

  /*
   * 生成宏脚本。
   * input: { commands, scope, targetIds: [id, id, id?] }
   * 校验失败（停止搜索）：{ ok: false, errors: [...] }
   * 成功：{ ok: true, scope, targetIds, waitMs, maxEvents, maxKeys, gaps, candidateKeys,
   *        solved, checked, events, replay: { timeline, triggered }, note? }
   */
  function synthesize(input) {
    input = input || {};
    var errors = [];

    if (engine.SCOPES.indexOf(input.scope) === -1) {
      errors.push('当前作用域必须是 global / editor / popup');
    }

    var v = engine.validateCommands(input.commands || []);
    if (!v.ok) v.errors.forEach(function (e) { errors.push(e); });

    // 目标命令 ID：2～3 个、非空、均存在于命令配置（配置有效时才查存在性）
    var targetIds = normalizeTargets(input.targetIds);
    if (targetIds.length < MIN_TARGETS || targetIds.length > MAX_TARGETS) {
      errors.push('目标命令 ID 必须为 ' + MIN_TARGETS + '～' + MAX_TARGETS + ' 个有序 ID（当前 ' +
        targetIds.length + ' 个，可重复）');
    }
    targetIds.forEach(function (id, i) {
      if (!id) {
        errors.push('目标命令 #' + (i + 1) + '：命令 ID 不能为空');
      } else if (v.ok && !v.commands.some(function (c) { return c.id === id; })) {
        errors.push('目标命令 #' + (i + 1) + '：命令 ID "' + id + '" 不在命令配置中');
      }
    });

    // 限制：候选按键 ≤ 5 种（搜索的事件数上限 5 只约束枚举深度，无更多输入需要校验）
    var candidateKeys = collectKeys(v.commands);
    if (v.ok && candidateKeys.length > MAX_KEYS) {
      errors.push('候选按键 ' + candidateKeys.length + ' 种超过上限 ' + MAX_KEYS +
        '（当前配置中出现的规范化按键最多 ' + MAX_KEYS + ' 种）');
    }

    if (errors.length) return { ok: false, errors: errors };

    // 按（事件数、按键序列、时间戳序列）升序枚举，首个完整回放触发列表恰为目标序列的脚本即解
    var solution = null;
    var checked = 0;

    function matches(triggered) {
      if (triggered.length !== targetIds.length) return false;
      for (var i = 0; i < targetIds.length; i++) {
        if (triggered[i].commandId !== targetIds[i]) return false;
      }
      return true;
    }

    function buildEvents(keys, gaps) {
      var evs = [{ t: 0, key: keys[0] }];
      for (var i = 1; i < keys.length; i++) evs.push({ t: evs[i - 1].t + gaps[i - 1], key: keys[i] });
      return evs;
    }

    function search(n) {
      var keyTuple = [];
      var gapTuple = [];
      function tryScript() {
        var evs = buildEvents(keyTuple, gapTuple);
        checked++;
        var r = engine.replay({ commands: v.commands }, input.scope, evs);
        if (matches(r.triggered)) solution = { events: evs, replay: r };
      }
      // 时间戳序列（n-1 个间隔，每个 ∈ {1, 800}）：1 先于 800
      function enumGaps(pos) {
        if (solution) return;
        if (pos === n - 1) { tryScript(); return; }
        for (var g = 0; g < GAPS.length; g++) {
          gapTuple[pos] = GAPS[g];
          enumGaps(pos + 1);
          if (solution) return;
        }
      }
      // 按键序列：候选键升序，可重复
      function enumKeys(pos) {
        if (solution) return;
        if (pos === n) { enumGaps(0); return; }
        for (var k = 0; k < candidateKeys.length; k++) {
          keyTuple[pos] = candidateKeys[k];
          enumKeys(pos + 1);
          if (solution) return;
        }
      }
      enumKeys(0);
    }

    for (var n = 1; n <= MAX_EVENTS && !solution; n++) search(n);

    var result = {
      ok: true,
      scope: input.scope,
      targetIds: targetIds,
      waitMs: engine.WAIT_MS,
      maxEvents: MAX_EVENTS,
      maxKeys: MAX_KEYS,
      gaps: GAPS.slice(),
      candidateKeys: candidateKeys,
      checked: checked
    };

    if (solution) {
      result.solved = true;
      result.events = solution.events;
      result.replay = { timeline: solution.replay.timeline, triggered: solution.replay.triggered };
    } else {
      result.solved = false;
      result.note = '未找到可行脚本 —— 该结论仅限上述搜索范围：至多 ' + MAX_EVENTS +
        ' 个事件，候选按键为当前配置中出现的 ' + candidateKeys.length +
        ' 种规范化按键；首事件 t=0，相邻事件间隔仅取 1 或 ' + engine.WAIT_MS +
        'ms；完整回放触发的命令 ID 列表须恰好等于目标顺序（不夹带其他命令）';
    }
    return result;
  }

  return {
    MAX_EVENTS: MAX_EVENTS,
    MAX_KEYS: MAX_KEYS,
    MIN_TARGETS: MIN_TARGETS,
    MAX_TARGETS: MAX_TARGETS,
    GAPS: GAPS,
    synthesize: synthesize
  };
});
