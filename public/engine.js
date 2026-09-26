/*
 * 快捷键匹配引擎（浏览器与 Node 共用）
 * - 每步快捷键：修饰键（Ctrl/Alt/Shift/Meta，可组合、顺序无关）+ 主键（字母/数字/Enter/Escape）
 * - 仅当前作用域与全局绑定生效，同序列优先当前作用域
 * - 两步前缀等待 800ms；失配/超时/结束时结算前缀；恰在截止的键先结算再处理
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShortcutEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WAIT_MS = 800;
  var SCOPES = ['global', 'editor', 'popup'];
  var SCOPE_LABELS = { global: '全局', editor: '编辑器', popup: '弹窗' };
  var MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  var MOD_ALIASES = {
    ctrl: 'Ctrl', control: 'Ctrl',
    alt: 'Alt', option: 'Alt',
    shift: 'Shift',
    meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta', super: 'Meta'
  };
  var BASE_ALIASES = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape' };

  /* 把 "shift+ctrl+k" 之类的输入规范化为 "Ctrl+Shift+K"（修饰键固定顺序，顺序等价） */
  function normalizeKey(input) {
    if (typeof input !== 'string') return { ok: false, error: '按键必须是字符串' };
    var raw = input.trim();
    if (!raw) return { ok: false, error: '按键为空' };
    var parts = raw.split('+').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    var mods = {};
    var base = null;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var lower = p.toLowerCase();
      if (MOD_ALIASES[lower]) {
        var m = MOD_ALIASES[lower];
        if (mods[m]) return { ok: false, error: '修饰键重复: ' + m };
        mods[m] = true;
      } else if (BASE_ALIASES[lower]) {
        if (base) return { ok: false, error: '每步只能有一个主键' };
        base = BASE_ALIASES[lower];
      } else if (/^[a-z]$/i.test(p)) {
        if (base) return { ok: false, error: '每步只能有一个主键' };
        base = p.toUpperCase();
      } else if (/^[0-9]$/.test(p)) {
        if (base) return { ok: false, error: '每步只能有一个主键' };
        base = p;
      } else {
        return { ok: false, error: '不支持的按键 "' + p + '"（仅允许 Ctrl/Alt/Shift/Meta 与字母、数字、Enter、Escape）' };
      }
    }
    if (!base) return { ok: false, error: '缺少主键（字母、数字、Enter 或 Escape）' };
    var ordered = MOD_ORDER.filter(function (m) { return mods[m]; });
    return { ok: true, key: ordered.concat([base]).join('+') };
  }

  /* 校验命令配置：ID 唯一、作用域合法、一至两步、同作用域序列不重复 */
  function validateCommands(commands) {
    var errors = [];
    if (!Array.isArray(commands)) return { ok: false, errors: ['命令配置必须是数组'], commands: [] };
    var normalized = [];
    var seenIds = {};
    var seenSeq = {}; // scope -> seq -> id
    commands.forEach(function (cmd, i) {
      cmd = cmd || {};
      var label = '命令 #' + (i + 1);
      var id = typeof cmd.id === 'string' ? cmd.id.trim() : '';
      if (!id) { errors.push(label + '：命令 ID 不能为空'); id = '(未命名 ' + (i + 1) + ')'; }
      else if (seenIds[id]) errors.push(label + '：命令 ID "' + id + '" 重复');
      seenIds[id] = true;

      var scopeOk = SCOPES.indexOf(cmd.scope) !== -1;
      if (!scopeOk) errors.push(label + '（' + id + '）：作用域必须是 global / editor / popup');

      var rawKeys = Array.isArray(cmd.keys) ? cmd.keys.slice() : [];
      while (rawKeys.length && (rawKeys[rawKeys.length - 1] == null || String(rawKeys[rawKeys.length - 1]).trim() === '')) rawKeys.pop();
      if (rawKeys.length < 1) errors.push(label + '（' + id + '）：至少需要一步快捷键');
      if (rawKeys.length > 2) errors.push(label + '（' + id + '）：最多支持两步快捷键');

      var keys = [];
      var keysOk = rawKeys.length >= 1 && rawKeys.length <= 2;
      rawKeys.slice(0, 2).forEach(function (k, j) {
        var n = normalizeKey(k == null ? '' : String(k));
        if (!n.ok) { errors.push(label + '（' + id + '）第 ' + (j + 1) + ' 步：' + n.error); keysOk = false; }
        else keys.push(n.key);
      });

      if (scopeOk && keysOk) {
        var seq = keys.join(' ');
        var bucket = seenSeq[cmd.scope] || (seenSeq[cmd.scope] = {});
        if (bucket[seq]) {
          errors.push('作用域「' + SCOPE_LABELS[cmd.scope] + '」中序列 "' + keys.join(' → ') +
            '" 被重复绑定（命令 "' + bucket[seq] + '" 与 "' + id + '"）');
        } else {
          bucket[seq] = id;
        }
        normalized.push({ id: id, scope: cmd.scope, keys: keys });
      }
    });
    return { ok: errors.length === 0, errors: errors, commands: normalized };
  }

  /* 当前作用域生效的绑定：全局 + 当前作用域，同序列当前作用域覆盖全局 */
  function buildActive(commands, scope) {
    var single = new Map();
    var two = new Map();
    var prefixes = new Set();
    function add(cmd) {
      var seq = cmd.keys.join(' ');
      if (cmd.keys.length === 1) single.set(seq, cmd);
      else { two.set(seq, cmd); prefixes.add(cmd.keys[0]); }
    }
    commands.forEach(function (cmd) { if (cmd.scope === 'global') add(cmd); });
    commands.forEach(function (cmd) { if (cmd.scope === scope) add(cmd); });
    return { single: single, two: two, prefixes: prefixes };
  }

  /* 校验并规范化按键事件：时间戳为不小于 0 的递增数字，按键经 normalizeKey 规范化 */
  function validateEvents(rawEvents) {
    var errors = [];
    var events = [];
    (Array.isArray(rawEvents) ? rawEvents : []).forEach(function (e, i) {
      e = e || {};
      var t = Number(e.t);
      if (!isFinite(t) || t < 0) { errors.push('事件 #' + (i + 1) + '：时间戳必须是不小于 0 的数字（毫秒）'); t = 0; }
      var n = normalizeKey(e.key == null ? '' : String(e.key));
      if (!n.ok) { errors.push('事件 #' + (i + 1) + '：' + n.error); n = { key: '?' }; }
      events.push({ t: t, key: n.key });
    });
    for (var i = 1; i < events.length; i++) {
      if (events[i].t < events[i - 1].t) {
        errors.push('事件 #' + (i + 1) + '：时间必须按毫秒递增（' + events[i].t + ' < ' + events[i - 1].t + '）');
      }
    }
    return { ok: errors.length === 0, errors: errors, events: events };
  }

  /*
   * 回放按键事件。
   * config: { commands: [{ id, scope, keys: [step1, step2?] }] }
   * scope: 当前作用域（global / editor / popup）
   * rawEvents: [{ t: 毫秒时间戳（递增）, key: 'Ctrl+K' }]
   * 返回 { ok, errors?, timeline?, triggered? }
   */
  function replay(config, scope, rawEvents) {
    config = config || {};
    if (SCOPES.indexOf(scope) === -1) {
      return { ok: false, errors: ['当前作用域必须是 global / editor / popup'] };
    }
    var v = validateCommands(config.commands || []);
    if (!v.ok) return { ok: false, errors: v.errors };

    var ev = validateEvents(rawEvents);
    if (!ev.ok) return { ok: false, errors: ev.errors };
    var events = ev.events;

    var active = buildActive(v.commands, scope);
    var timeline = [];
    var triggered = [];
    var pending = null; // { key, t }

    function fire(cmd, t, via, seq) {
      timeline.push({ type: 'trigger', t: t, commandId: cmd.id, commandScope: cmd.scope, sequence: seq, via: via });
      triggered.push({ commandId: cmd.id, t: t, sequence: seq });
    }
    /* 结算待定前缀：有单步命令则触发，否则丢弃 */
    function settle(t, cause, key) {
      var p = pending;
      pending = null;
      if (cause === 'timeout') {
        timeline.push({ type: 'timeout', t: t, pendingKey: p.key, pendingT: p.t, deadline: p.t + WAIT_MS });
      } else if (cause === 'mismatch') {
        timeline.push({ type: 'mismatch', t: t, key: key, pendingKey: p.key, pendingT: p.t });
      } else {
        timeline.push({ type: 'end', t: t, pendingKey: p.key, pendingT: p.t });
      }
      var single = active.single.get(p.key);
      if (single) fire(single, t, cause, p.key);
      else timeline.push({ type: 'discard', t: t, pendingKey: p.key });
    }
    /* 把按键当作新起点处理 */
    function startKey(key, t) {
      if (active.prefixes.has(key)) {
        pending = { key: key, t: t };
        timeline.push({ type: 'wait', t: t, key: key, deadline: t + WAIT_MS });
      } else if (active.single.has(key)) {
        fire(active.single.get(key), t, 'single', key);
      } else {
        timeline.push({
          type: 'unmatched', t: t, key: key,
          reason: '当前作用域（' + SCOPE_LABELS[scope] + '）与全局均无此绑定，也不是任何两步命令的前缀'
        });
      }
    }

    events.forEach(function (ev) {
      if (pending) {
        if (ev.t - pending.t >= WAIT_MS) {
          // 超时（含恰在截止时刻）：先结算前缀，再把当前键作新起点
          settle(ev.t, 'timeout');
          startKey(ev.key, ev.t);
        } else {
          var seq = pending.key + ' ' + ev.key;
          var cmd = active.two.get(seq);
          if (cmd) {
            pending = null;
            fire(cmd, ev.t, 'double', seq);
          } else {
            // 失配：结算前缀，失配键再作新起点
            settle(ev.t, 'mismatch', ev.key);
            startKey(ev.key, ev.t);
          }
        }
      } else {
        startKey(ev.key, ev.t);
      }
    });
    // 输入结束：结算仍待定的前缀
    if (pending) settle(events.length ? events[events.length - 1].t : 0, 'end');

    return { ok: true, scope: scope, waitMs: WAIT_MS, timeline: timeline, triggered: triggered };
  }

  return {
    WAIT_MS: WAIT_MS,
    SCOPES: SCOPES,
    SCOPE_LABELS: SCOPE_LABELS,
    normalizeKey: normalizeKey,
    validateCommands: validateCommands,
    validateEvents: validateEvents,
    replay: replay
  };
});
