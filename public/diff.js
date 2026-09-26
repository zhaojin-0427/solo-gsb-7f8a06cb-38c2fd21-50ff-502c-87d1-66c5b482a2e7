/*
 * 配置变更影响比较（浏览器与 Node 共用，沿用 engine.js 回放引擎）
 * - 以旧/新两套命令配置分别回放同一批按键样例，找出触发结果（命令 ID 顺序或触发时间）不同的样例
 * - 搜索范围：按键取两套绑定中出现的规范化键；枚举一键与两键事件，首键 t=0，第二键 t=1 或 800ms
 * - 按（旧结果、新结果）组合分组，每组保留事件数最少的样例，同长度按按键及时间升序择一
 * - 按键排序后枚举、分组只依赖回放结果 → 命令表行顺序不影响比较结果
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShortcutDiff = factory(root.ShortcutEngine);
})(typeof self !== 'undefined' ? self : this, function (engine) {
  'use strict';

  // 第二键相对首键（t=0）的毫秒时刻：窗口内最小间隔 与 恰在截止时刻
  var SECOND_KEY_TIMES = [1, engine.WAIT_MS];

  /* 两套配置中出现过的全部规范化按键（排序去重 → 与行顺序无关） */
  function collectKeys(oldCmds, newCmds) {
    var seen = {};
    [oldCmds, newCmds].forEach(function (cmds) {
      cmds.forEach(function (c) {
        c.keys.forEach(function (k) { seen[k] = true; });
      });
    });
    return Object.keys(seen).sort();
  }

  /* 枚举事件样例：一键 [k1@0]；两键 [k1@0, k2@(1|800)] */
  function enumerateSamples(keys) {
    var samples = [];
    keys.forEach(function (k1) {
      samples.push([{ t: 0, key: k1 }]);
      keys.forEach(function (k2) {
        SECOND_KEY_TIMES.forEach(function (t2) {
          samples.push([{ t: 0, key: k1 }, { t: t2, key: k2 }]);
        });
      });
    });
    return samples;
  }

  /* 触发结果简化为按触发顺序排列的（命令 ID、时间）列表 */
  function slim(triggered) {
    return triggered.map(function (tr) { return { commandId: tr.commandId, t: tr.t }; });
  }
  function sameTriggered(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].commandId !== b[i].commandId || a[i].t !== b[i].t) return false;
    }
    return true;
  }

  /* 代表样例取舍：事件数最少；同长度按按键升序，再按时间升序 */
  function compareSamples(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    for (var i = 0; i < a.length; i++) {
      if (a[i].key !== b[i].key) return a[i].key < b[i].key ? -1 : 1;
    }
    for (var j = 0; j < a.length; j++) {
      if (a[j].t !== b[j].t) return a[j].t - b[j].t;
    }
    return 0;
  }

  /*
   * 比较两套命令配置。
   * 成功：{ ok: true, waitMs, secondKeyTimes,
   *         scopes: [{ scope, keys, checked, groups: [{ sample, oldTriggered, newTriggered }] }] }
   * 任一侧校验失败（停止搜索）：{ ok: false, errors: { old: [...], new: [...] } }
   */
  function compare(oldCommands, newCommands) {
    var vOld = engine.validateCommands(oldCommands || []);
    var vNew = engine.validateCommands(newCommands || []);
    if (!vOld.ok || !vNew.ok) {
      return {
        ok: false,
        errors: { old: vOld.ok ? [] : vOld.errors, new: vNew.ok ? [] : vNew.errors }
      };
    }

    var keys = collectKeys(vOld.commands, vNew.commands);
    var samples = enumerateSamples(keys);

    var scopes = engine.SCOPES.map(function (scope) {
      var byResult = {}; // （旧结果 + 新结果）组合 -> 差异组（保留代表样例）
      samples.forEach(function (evs) {
        var oldT = slim(engine.replay({ commands: vOld.commands }, scope, evs).triggered);
        var newT = slim(engine.replay({ commands: vNew.commands }, scope, evs).triggered);
        if (sameTriggered(oldT, newT)) return;
        var gk = JSON.stringify([oldT, newT]);
        var cur = byResult[gk];
        if (!cur || compareSamples(evs, cur.sample) < 0) {
          byResult[gk] = { sample: evs, oldTriggered: oldT, newTriggered: newT };
        }
      });
      var groups = Object.keys(byResult).map(function (k) { return byResult[k]; });
      groups.sort(function (a, b) { return compareSamples(a.sample, b.sample); });
      return { scope: scope, keys: keys, checked: samples.length, groups: groups };
    });

    return {
      ok: true,
      waitMs: engine.WAIT_MS,
      secondKeyTimes: SECOND_KEY_TIMES.slice(),
      scopes: scopes
    };
  }

  return {
    SECOND_KEY_TIMES: SECOND_KEY_TIMES,
    compare: compare
  };
});
