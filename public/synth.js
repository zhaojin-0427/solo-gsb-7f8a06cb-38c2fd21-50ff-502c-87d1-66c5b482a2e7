/*
 * 命令宏脚本合成（浏览器与 Node 共用，沿用 engine.js 回放引擎）
 * - 沿用当前命令表与当前作用域；输入 2～3 个有序命令 ID（可重复）
 * - 从空事件生成按键脚本，使「完整回放」触发的命令 ID 列表恰好等于输入顺序
 *   （长度与逐项 ID 全等，不夹带其他命令；触发时刻不要求）
 * - 候选按键只取当前配置中出现的规范化键（排序去重）
 * - 首事件 t=0；相邻事件间隔限 1 或 800ms；最多 5 个事件、5 种候选按键，超限报错
 * - 按（事件数、按键序列、时间戳序列）依次升序枚举，首个命中的脚本即唯一解
 *   （首事件恒为 0、间隔恒为正，故间隔序列的字典序与时间戳序列的字典序一致）
 * - 前缀失配、超时、结束结算与作用域覆盖均由 engine.replay 判定，本模块不另写匹配逻辑
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShortcutSynth = factory(root.ShortcutEngine);
})(typeof self !== 'undefined' ? self : this, function (engine) {
  'use strict';

  var MAX_EVENTS = 5;        // 脚本事件数上限
  var MAX_KEYS = 5;          // 候选按键种数上限
  var MIN_TARGETS = 2;       // 目标命令 ID 最少数
  var MAX_TARGETS = 3;       // 目标命令 ID 最多数
  var GAPS = [1, engine.WAIT_MS]; // 相邻事件允许的间隔（毫秒）

  /* 当前配置中出现过的规范化按键（排序去重 → 与命令表行顺序无关） */
  function collectKeys(commands) {
    var seen = {};
    commands.forEach(function (c) {
      c.keys.forEach(function (k) { seen[k] = true; });
    });
    return Object.keys(seen).sort();
  }

  /* 触发列表的命令 ID 序列是否与目标恰好全等（不多不少） */
  function exactIds(triggered, targetIds) {
    if (triggered.length !== targetIds.length) return false;
    for (var i = 0; i < targetIds.length; i++) {
      if (triggered[i].commandId !== targetIds[i]) return false;
    }
    return true;
  }

  /*
   * 合成命令宏脚本。
   * input: { commands, scope, targetIds: [id1, id2, id3?] }
   * 校验失败（停止搜索）：{ ok: false, errors: [...] }
   * 成功：{ ok: true, scope, targetIds, waitMs, gaps, maxEvents, maxKeys, candidateKeys,
   *        checked, solved, events?, replay: { timeline, triggered }?, note? }
   */
  function synth(input) {
    input = input || {};
    var errors = [];

    if (engine.SCOPES.indexOf(input.scope) === -1) {
      errors.push('当前作用域必须是 global / editor / popup');
    }

    var v = engine.validateCommands(input.commands || []);
    if (!v.ok) v.errors.forEach(function (e) { errors.push(e); });

    // 目标命令 ID：必须是 2～3 个有序字符串（可重复），且均存在于命令配置中
    var rawTargets = Array.isArray(input.targetIds) ? input.targetIds : null;
    var targetIds = [];
    if (rawTargets === null) {
      errors.push('目标命令 ID 必须是包含 ' + MIN_TARGETS + '～' + MAX_TARGETS + ' 个 ID 的数组');
    } else if (rawTargets.length < MIN_TARGETS || rawTargets.length > MAX_TARGETS) {
      errors.push('目标命令 ID 需为 ' + MIN_TARGETS + '～' + MAX_TARGETS + ' 个（当前 ' + rawTargets.length + ' 个）');
    } else {
      rawTargets.forEach(function (id, i) {
        var s = typeof id === 'string' ? id.trim() : '';
        if (!s) {
          errors.push('目标命令 #' + (i + 1) + '：命令 ID 不能为空');
        } else {
          targetIds.push(s);
          if (v.ok && !v.commands.some(function (c) { return c.id === s; })) {
            errors.push('目标命令 ID "' + s + '" 不在命令配置中');
          }
        }
      });
    }

    // 限制：候选按键 ≤ 5 种（事件数上限由搜索深度保证，不依赖用户输入）
    var candidateKeys = collectKeys(v.commands);
    if (v.ok && candidateKeys.length > MAX_KEYS) {
      errors.push('候选按键 ' + candidateKeys.length + ' 种超过上限 ' + MAX_KEYS +
        '（当前配置中出现的规范化按键最多 ' + MAX_KEYS + ' 种）');
    }

    if (errors.length) return { ok: false, errors: errors };

    var config = { commands: v.commands };
    var scope = input.scope;
    var checked = 0;
    var found = null;

    // 由按键序列与间隔序列构造事件（首事件 t=0），并完整回放校验
    function tryScript(keys, gapList) {
      checked++;
      var events = [{ t: 0, key: keys[0] }];
      for (var i = 1; i < keys.length; i++) {
        events.push({ t: events[i - 1].t + gapList[i - 1], key: keys[i] });
      }
      var r = engine.replay(config, scope, events);
      if (exactIds(r.triggered, targetIds)) {
        found = { events: events, replay: r };
      }
    }

    // 枚举固定事件数 n：按键序列（可重复）升序 × 间隔序列（每项 1|800）升序
    function searchN(n) {
      var keys = new Array(n);
      var gapList = new Array(Math.max(0, n - 1));
      (function enumKeys(pos) {
        if (found) return;
        if (pos === n) { enumGaps(0); return; }
        for (var i = 0; i < candidateKeys.length && !found; i++) {
          keys[pos] = candidateKeys[i];
          enumKeys(pos + 1);
        }
      })(0);
      function enumGaps(pos) {
        if (found) return;
        if (pos === n - 1) { tryScript(keys, gapList); return; }
        for (var i = 0; i < GAPS.length && !found; i++) {
          gapList[pos] = GAPS[i];
          enumGaps(pos + 1);
        }
      }
    }

    // 事件数从 1 到 MAX_EVENTS 升序（少于目标数的事件不可能触发足额命令，枚举后自然跳过）
    for (var n = 1; n <= MAX_EVENTS && !found; n++) searchN(n);

    var result = {
      ok: true,
      scope: scope,
      targetIds: targetIds,
      waitMs: engine.WAIT_MS,
      gaps: GAPS.slice(),
      maxEvents: MAX_EVENTS,
      maxKeys: MAX_KEYS,
      candidateKeys: candidateKeys,
      checked: checked
    };

    if (found) {
      result.solved = true;
      result.events = found.events;
      result.replay = { timeline: found.replay.timeline, triggered: found.replay.triggered };
    } else {
      result.solved = false;
      result.note = '未找到可行脚本 —— 该结论仅限于上述搜索范围（最多 ' + MAX_EVENTS +
        ' 个事件、候选按键为当前配置中出现的 ' + candidateKeys.length +
        ' 种规范化按键；首事件 t=0，相邻事件间隔仅取 1 或 ' + engine.WAIT_MS + 'ms）';
    }
    return result;
  }

  return {
    MAX_EVENTS: MAX_EVENTS,
    MAX_KEYS: MAX_KEYS,
    MIN_TARGETS: MIN_TARGETS,
    MAX_TARGETS: MAX_TARGETS,
    GAPS: GAPS,
    synth: synth
  };
});
