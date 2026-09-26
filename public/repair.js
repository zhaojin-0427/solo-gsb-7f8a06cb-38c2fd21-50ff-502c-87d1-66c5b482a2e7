/*
 * 目标命令修正（浏览器与 Node 共用，沿用 engine.js 回放引擎）
 * - 沿用当前命令表、当前作用域与已输入事件；仅允许把已有事件的按键替换为
 *   当前配置中出现的规范化按键，时间戳与事件数保持不变
 * - 先回放原事件：目标已触发 → 返回零改动；否则搜索至多 2 处不同事件的替换，
 *   使目标命令至少触发一次（替换为原键不计入改动）
 * - 按（改动处数、事件下标序列、替换键序列）依次升序取首个方案，保证唯一
 * - 限制：事件 ≤ 8 个、候选按键 ≤ 12 种；配置 / 事件 / 目标 ID 无效即停止搜索并报错
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShortcutRepair = factory(root.ShortcutEngine);
})(typeof self !== 'undefined' ? self : this, function (engine) {
  'use strict';

  var MAX_EVENTS = 8;   // 事件数上限
  var MAX_KEYS = 12;    // 候选按键种数上限
  var MAX_CHANGES = 2;  // 最多替换的事件处数

  /* 当前配置中出现过的规范化按键（排序去重 → 与命令表行顺序无关） */
  function collectKeys(commands) {
    var seen = {};
    commands.forEach(function (c) {
      c.keys.forEach(function (k) { seen[k] = true; });
    });
    return Object.keys(seen).sort();
  }

  function countHits(triggered, targetId) {
    var n = 0;
    triggered.forEach(function (tr) { if (tr.commandId === targetId) n++; });
    return n;
  }

  /*
   * 修正按键事件，使目标命令至少触发一次。
   * input: { commands, scope, events, targetId }
   * 校验失败（停止搜索）：{ ok: false, errors: [...] }
   * 成功：{ ok: true, scope, targetId, waitMs, maxEvents, maxKeys, maxChanges, candidateKeys,
   *        original: { timeline, triggered, targetHits },
   *        solved, alreadyTriggered, changes: [{ index, from, to }], events,
   *        replay: { timeline, triggered }, note? }
   */
  function repair(input) {
    input = input || {};
    var errors = [];

    if (engine.SCOPES.indexOf(input.scope) === -1) {
      errors.push('当前作用域必须是 global / editor / popup');
    }

    var v = engine.validateCommands(input.commands || []);
    if (!v.ok) v.errors.forEach(function (e) { errors.push(e); });

    var ev = engine.validateEvents(input.events);
    if (!ev.ok) ev.errors.forEach(function (e) { errors.push(e); });

    // 目标命令 ID：必填且存在于命令配置中（配置有效时才查存在性，避免误报）
    var targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    if (!targetId) {
      errors.push('目标命令 ID 不能为空');
    } else if (v.ok && !v.commands.some(function (c) { return c.id === targetId; })) {
      errors.push('目标命令 ID "' + targetId + '" 不在命令配置中');
    }

    // 限制：事件 ≤ 8 个、候选按键 ≤ 12 种
    if (Array.isArray(input.events) && input.events.length > MAX_EVENTS) {
      errors.push('事件数 ' + input.events.length + ' 超过上限 ' + MAX_EVENTS +
        '（目标命令修正最多支持 ' + MAX_EVENTS + ' 个事件）');
    }
    var candidateKeys = collectKeys(v.commands);
    if (v.ok && candidateKeys.length > MAX_KEYS) {
      errors.push('候选按键 ' + candidateKeys.length + ' 种超过上限 ' + MAX_KEYS +
        '（当前配置中出现的规范化按键最多 ' + MAX_KEYS + ' 种）');
    }

    if (errors.length) return { ok: false, errors: errors };

    // 先回放原事件
    var original = engine.replay({ commands: v.commands }, input.scope, ev.events);
    var result = {
      ok: true,
      scope: input.scope,
      targetId: targetId,
      waitMs: engine.WAIT_MS,
      maxEvents: MAX_EVENTS,
      maxKeys: MAX_KEYS,
      maxChanges: MAX_CHANGES,
      candidateKeys: candidateKeys,
      original: {
        timeline: original.timeline,
        triggered: original.triggered,
        targetHits: countHits(original.triggered, targetId)
      }
    };

    // 目标已触发 → 零改动
    if (result.original.targetHits > 0) {
      result.solved = true;
      result.alreadyTriggered = true;
      result.changes = [];
      result.events = ev.events;
      result.replay = { timeline: original.timeline, triggered: original.triggered };
      return result;
    }
    result.alreadyTriggered = false;

    // 搜索至多 MAX_CHANGES 处替换；按（改动处数、事件下标序列、替换键序列）升序取首个命中
    var events = ev.events;
    var solution = null;

    function tryReplace(idxs, keys) {
      var evs = events.map(function (e) { return { t: e.t, key: e.key }; });
      idxs.forEach(function (ix, j) { evs[ix] = { t: evs[ix].t, key: keys[j] }; });
      var r = engine.replay({ commands: v.commands }, input.scope, evs);
      if (countHits(r.triggered, targetId) > 0) {
        solution = { idxs: idxs.slice(), keys: keys.slice(), events: evs, replay: r };
      }
    }

    function search(k) {
      var idxs = [];
      // 替换键元组：按候选键升序；替换为原键不计改动 → 跳过
      function enumKeys(keys) {
        if (solution) return;
        var j = keys.length;
        if (j === k) { tryReplace(idxs, keys); return; }
        var orig = events[idxs[j]].key;
        for (var x = 0; x < candidateKeys.length; x++) {
          var key = candidateKeys[x];
          if (key === orig) continue;
          keys.push(key);
          enumKeys(keys);
          keys.pop();
          if (solution) return;
        }
      }
      // 事件下标组合：字典序升序
      (function enumIdx(start) {
        if (solution) return;
        if (idxs.length === k) { enumKeys([]); return; }
        for (var i = start; i <= events.length - (k - idxs.length); i++) {
          idxs.push(i);
          enumIdx(i + 1);
          idxs.pop();
          if (solution) return;
        }
      })(0);
    }

    for (var k = 1; k <= MAX_CHANGES && !solution; k++) {
      if (events.length >= k) search(k);
    }

    if (solution) {
      result.solved = true;
      result.changes = solution.idxs.map(function (ix, j) {
        return { index: ix, from: events[ix].key, to: solution.keys[j] };
      });
      result.events = solution.events;
      result.replay = { timeline: solution.replay.timeline, triggered: solution.replay.triggered };
    } else {
      result.solved = false;
      result.changes = [];
      result.events = events;
      result.note = '未找到可行修正 —— 该结论仅限于当前替换范围（最多替换 ' + MAX_CHANGES +
        ' 处事件按键，候选按键为当前配置中出现的 ' + candidateKeys.length +
        ' 种规范化按键）与现有时间戳（时间戳与事件数不变）';
    }
    return result;
  }

  return {
    MAX_EVENTS: MAX_EVENTS,
    MAX_KEYS: MAX_KEYS,
    MAX_CHANGES: MAX_CHANGES,
    repair: repair
  };
});
