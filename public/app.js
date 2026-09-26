/* 快捷键回放器 —— 前端交互（原生 JS，复用 engine.js 在本地回放） */
/* global ShortcutEngine, ShortcutDiff, ShortcutRepair, EXAMPLES */
(function () {
  'use strict';

  var engine = window.ShortcutEngine;
  var LABELS = engine.SCOPE_LABELS;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kbd(k) { return '<kbd>' + esc(k) + '</kbd>'; }

  /* ---------------- 按键录入（⌨ 捕获模式 + 录制） ---------------- */

  var MODIFIER_KEYS = { Control: 1, Shift: 1, Alt: 1, Meta: 1 };

  // 从键盘事件取主键：字母/数字/Enter/Escape；修饰键返回 null；其余返回 undefined（不支持）
  function baseFromEvent(e) {
    var k = e.key;
    if (MODIFIER_KEYS[k]) return null;
    if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
    if (/^[0-9]$/.test(k)) return k;
    if (k === 'Enter') return 'Enter';
    if (k === 'Escape') return 'Escape';
    return undefined;
  }
  function modsFromEvent(e) {
    var m = [];
    if (e.ctrlKey) m.push('Ctrl');
    if (e.altKey) m.push('Alt');
    if (e.shiftKey) m.push('Shift');
    if (e.metaKey) m.push('Meta');
    return m;
  }
  function comboFromEvent(e) {
    var base = baseFromEvent(e);
    if (base == null) return base === null ? null : undefined;
    return modsFromEvent(e).concat([base]).join('+');
  }

  function flashInvalid(input, msg) {
    input.classList.remove('shake');
    void input.offsetWidth; // 重新触发动画
    input.classList.add('invalid', 'shake');
    input.title = msg;
  }
  function markValid(input) {
    input.classList.remove('invalid');
    input.removeAttribute('title');
  }
  function stopCapture(input) { input.classList.remove('capturing'); }

  function startCapture(input) {
    Array.prototype.forEach.call(document.querySelectorAll('.key-input.capturing'), stopCapture);
    input.dataset.prev = input.value;
    input.value = '请按键…';
    input.classList.add('capturing');
    input.focus();
  }

  document.addEventListener('keydown', function (e) {
    var target = e.target;
    // 捕获模式：把下一次按键组合写进输入框
    if (target.classList && target.classList.contains('key-input') && target.classList.contains('capturing')) {
      e.preventDefault();
      var combo = comboFromEvent(e);
      if (combo === null) { target.value = modsFromEvent(e).concat(['…']).join('+'); return; }
      if (combo === undefined) { flashInvalid(target, '仅支持字母、数字、Enter、Escape（可配 Ctrl/Alt/Shift/Meta）'); return; }
      target.value = combo;
      stopCapture(target);
      markValid(target);
      return;
    }
    // 录制模式：焦点不在表单控件上时，把按键追加为事件行
    if (recording && !(target.closest && target.closest('input, select, textarea'))) {
      var c = comboFromEvent(e);
      if (c == null) return; // 仅修饰键或不支持的键，忽略
      e.preventDefault();
      addEventRow(Math.round(performance.now() - recordStart), c);
    }
  }, true);

  // 手工输入的按键在失焦时规范化（修饰键排序、大小写统一）
  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('key-input')) {
      var v = e.target.value.trim();
      if (!v) { markValid(e.target); return; }
      var n = engine.normalizeKey(v);
      if (n.ok) { e.target.value = n.key; markValid(e.target); }
      else flashInvalid(e.target, n.error);
    }
  });

  document.addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('key-input') && e.target.classList.contains('capturing')) {
      e.target.value = e.target.dataset.prev || '';
      stopCapture(e.target);
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('capture-btn')) {
      startCapture(e.target.parentElement.querySelector('.key-input'));
    } else if (e.target.classList.contains('del-row')) {
      e.target.closest('tr').remove();
    }
  });

  /* ---------------- 动态表格行 ---------------- */

  function keyCell(cls, placeholder) {
    var td = el('td');
    var wrap = el('span', 'key-wrap');
    var input = el('input', 'key-input ' + cls);
    input.type = 'text';
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = 'off';
    var btn = el('button', 'capture-btn', '⌨');
    btn.type = 'button';
    btn.title = '点击后直接按下快捷键录入';
    wrap.appendChild(input);
    wrap.appendChild(btn);
    td.appendChild(wrap);
    return td;
  }
  function delCell() {
    var td = el('td', 'del-col');
    var btn = el('button', 'del-row', '✕');
    btn.type = 'button';
    btn.title = '删除此行';
    td.appendChild(btn);
    return td;
  }

  function addCommandRow(cmd, bodySel) {
    cmd = cmd || {};
    var tr = el('tr');

    var tdId = el('td');
    var idInput = el('input', 'cmd-id');
    idInput.type = 'text';
    idInput.placeholder = '命令 ID，如 save';
    idInput.value = cmd.id || '';
    idInput.spellcheck = false;
    tdId.appendChild(idInput);
    tr.appendChild(tdId);

    var tdScope = el('td');
    var sel = el('select', 'cmd-scope');
    [['global', '全局'], ['editor', '编辑器'], ['popup', '弹窗']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      sel.appendChild(opt);
    });
    sel.value = cmd.scope || 'editor';
    tdScope.appendChild(sel);
    tr.appendChild(tdScope);

    tr.appendChild(keyCell('cmd-key1', '第 1 步，如 Ctrl+K'));
    tr.appendChild(keyCell('cmd-key2', '第 2 步（可空）'));
    if (cmd.keys && cmd.keys[0]) tr.querySelector('.cmd-key1').value = cmd.keys[0];
    if (cmd.keys && cmd.keys[1]) tr.querySelector('.cmd-key2').value = cmd.keys[1];

    tr.appendChild(delCell());
    $(bodySel || '#commands-body').appendChild(tr);
  }

  function addEventRow(t, key) {
    var tr = el('tr');

    var tdT = el('td');
    var tInput = el('input', 'ev-t');
    tInput.type = 'number';
    tInput.min = '0';
    tInput.step = '1';
    tInput.placeholder = '毫秒';
    if (t != null) tInput.value = t;
    tdT.appendChild(tInput);
    tr.appendChild(tdT);

    tr.appendChild(keyCell('ev-key', '如 Ctrl+K'));
    if (key) tr.querySelector('.ev-key').value = key;

    tr.appendChild(delCell());
    $('#events-body').appendChild(tr);
  }

  /* ---------------- 录制按键事件 ---------------- */

  var recording = false;
  var recordStart = 0;
  $('#record-btn').addEventListener('click', function () {
    recording = !recording;
    var btn = $('#record-btn');
    if (recording) {
      recordStart = performance.now();
      btn.textContent = '■ 停止录制';
      btn.classList.add('recording');
      $('#record-hint').hidden = false;
    } else {
      btn.textContent = '● 录制按键';
      btn.classList.remove('recording');
      $('#record-hint').hidden = true;
    }
  });

  /* ---------------- 收集输入并回放 ---------------- */

  function gatherCommands(bodySel) {
    var cmds = [];
    Array.prototype.forEach.call(document.querySelectorAll((bodySel || '#commands-body') + ' tr'), function (tr) {
      var id = tr.querySelector('.cmd-id').value.trim();
      var scope = tr.querySelector('.cmd-scope').value;
      var k1 = tr.querySelector('.cmd-key1').value.trim();
      var k2 = tr.querySelector('.cmd-key2').value.trim();
      if (!id && !k1 && !k2) return; // 整行空白则忽略
      var keys = [];
      if (k1 || k2) {
        keys.push(k1); // 第 1 步留空但填了第 2 步 → 交给引擎报错
        if (k2) keys.push(k2);
      }
      cmds.push({ id: id, scope: scope, keys: keys });
    });
    return cmds;
  }
  function gatherEvents() {
    var evs = [];
    Array.prototype.forEach.call(document.querySelectorAll('#events-body tr'), function (tr) {
      var t = tr.querySelector('.ev-t').value;
      var key = tr.querySelector('.ev-key').value.trim();
      if (t === '' && !key) return;
      evs.push({ t: t === '' ? NaN : Number(t), key: key });
    });
    return evs;
  }
  function currentScope() {
    return document.querySelector('input[name="scope"]:checked').value;
  }

  function run(scroll) {
    var result = engine.replay({ commands: gatherCommands() }, currentScope(), gatherEvents());
    renderResult(result, scroll);
  }
  $('#run-btn').addEventListener('click', function () { run(true); });

  /* ---------------- 结果渲染 ---------------- */

  var TYPE_META = {
    wait:      { icon: '⏳', cls: 'wait',      label: '等待' },
    trigger:   { icon: '✅', cls: 'trigger',   label: '触发' },
    timeout:   { icon: '⏰', cls: 'settle',    label: '超时结算' },
    mismatch:  { icon: '✖️', cls: 'settle',    label: '失配结算' },
    end:       { icon: '🏁', cls: 'settle',    label: '结束结算' },
    discard:   { icon: '🗑️', cls: 'discard',   label: '丢弃' },
    unmatched: { icon: '⚠️', cls: 'unmatched', label: '未匹配' }
  };

  function seqText(seq) { return seq.split(' ').join(' → '); }
  function cmdTag(en) {
    return '<b>' + esc(en.commandId) + '</b>（' + esc(LABELS[en.commandScope] || en.commandScope) +
      '，' + kbd(seqText(en.sequence)) + '）';
  }
  function entryMessage(en) {
    switch (en.type) {
      case 'wait':
        return '按下 ' + kbd(en.key) + ' — 是两步前缀，等待第二键（窗口 ' + engine.WAIT_MS +
          'ms，截止 t=' + en.deadline + 'ms）';
      case 'trigger':
        if (en.via === 'single') return '触发命令 ' + cmdTag(en) + ' — 无两步前缀的单步命令，立即触发';
        if (en.via === 'double') return '触发命令 ' + cmdTag(en) + ' — 第二键在 ' + engine.WAIT_MS + 'ms 内命中两步序列';
        return '结算前缀，触发其单步命令 ' + cmdTag(en);
      case 'timeout':
        return '前缀 ' + kbd(en.pendingKey) + '（按于 ' + en.pendingT + 'ms，截止 ' + en.deadline +
          'ms）等待超时 — 先结算前缀，当前键再作新起点';
      case 'mismatch':
        return '第二键 ' + kbd(en.key) + ' 与前缀 ' + kbd(en.pendingKey) +
          ' 不构成任何两步命令 — 结算前缀，该键再作新起点';
      case 'end':
        return '输入结束 — 结算仍待定的前缀 ' + kbd(en.pendingKey);
      case 'discard':
        return '前缀 ' + kbd(en.pendingKey) + ' 没有对应的单步命令 — 丢弃';
      case 'unmatched':
        return kbd(en.key) + ' 未匹配：' + esc(en.reason);
      default:
        return esc(JSON.stringify(en));
    }
  }

  function timelineRow(en) {
    var meta = TYPE_META[en.type];
    var row = el('div', 'tl-row ' + meta.cls);
    row.innerHTML =
      '<span class="tl-t">' + en.t + 'ms</span>' +
      '<span class="tl-badge">' + meta.icon + ' ' + meta.label + '</span>' +
      '<span class="tl-msg">' + entryMessage(en) + '</span>';
    return row;
  }
  function renderTimeline(container, timeline) {
    container.innerHTML = '';
    timeline.forEach(function (en) { container.appendChild(timelineRow(en)); });
  }
  function summaryHtml(triggered) {
    if (triggered.length) {
      return '<b>触发顺序：</b>' + triggered.map(function (tr, i) {
        return '<span class="chip">' + (i + 1) + '. ' + esc(tr.commandId) +
          ' <span class="chip-t">@ ' + tr.t + 'ms</span></span>';
      }).join('');
    }
    return '<b>触发顺序：</b><span class="chip none">（无命令被触发）</span>';
  }

  function renderResult(result, scroll) {
    var box = $('#results');
    box.hidden = false;
    var errBox = $('#errors');
    var tl = $('#timeline');
    var sum = $('#summary');
    errBox.innerHTML = '';
    tl.innerHTML = '';
    sum.innerHTML = '';

    if (!result.ok) {
      errBox.hidden = false;
      errBox.innerHTML = '<h3>配置 / 输入有误</h3><ul>' +
        result.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      $('#timeline-wrap').hidden = true;
      sum.hidden = true;
      if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    errBox.hidden = true;
    $('#timeline-wrap').hidden = false;
    sum.hidden = false;

    renderTimeline(tl, result.timeline);
    sum.innerHTML = summaryHtml(result.triggered);
    if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- 示例 ---------------- */

  function loadExample(ex, scroll) {
    $('#commands-body').innerHTML = '';
    $('#events-body').innerHTML = '';
    ex.commands.forEach(addCommandRow);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="scope"]'), function (r) {
      r.checked = r.value === ex.scope;
    });
    ex.events.forEach(function (ev) { addEventRow(ev.t, ev.key); });
    refreshRepairTargets();
    run(scroll);
  }

  EXAMPLES.forEach(function (ex) {
    var b = el('button', 'ex-btn', ex.name);
    b.type = 'button';
    b.title = ex.desc;
    b.addEventListener('click', function () { loadExample(ex, true); });
    $('#examples').appendChild(b);
  });

  $('#add-command').addEventListener('click', function () { addCommandRow(); });
  $('#add-event').addEventListener('click', function () { addEventRow(); });

  /* ---------------- 配置变更影响（旧配置 vs 候选新配置） ---------------- */

  var SEARCH_NOTE = '按键取两套绑定中出现的规范化键，枚举一键与两键事件（首键 t=0，第二键 t=1 或 ' +
    engine.WAIT_MS + 'ms）';

  function gatherCandidate() { return gatherCommands('#candidate-body'); }

  function copyToCandidate() {
    $('#candidate-body').innerHTML = '';
    gatherCommands().forEach(function (c) { addCommandRow(c, '#candidate-body'); });
  }
  $('#add-candidate').addEventListener('click', function () { addCommandRow(null, '#candidate-body'); });
  $('#copy-to-candidate').addEventListener('click', copyToCandidate);

  function fmtTriggerList(list) {
    if (!list.length) return '<span class="chip none">（无触发）</span>';
    return list.map(function (tr, i) {
      return '<span class="chip">' + (i + 1) + '. ' + esc(tr.commandId) +
        ' <span class="chip-t">@ ' + tr.t + 'ms</span></span>';
    }).join('');
  }
  function fmtSampleEvents(events) {
    return events.map(function (ev) {
      return '<span class="diff-ev"><span class="diff-t">t=' + ev.t + 'ms</span>' + kbd(ev.key) + '</span>';
    }).join('<span class="diff-arrow">→</span>');
  }

  function renderDiff(result, scroll) {
    var errBox = $('#diff-errors');
    var box = $('#diff-results');
    var html;
    errBox.innerHTML = '';
    box.innerHTML = '';

    if (!result.ok) {
      // 任一侧校验失败：指出侧别（错误信息内含「命令 #N」错误行），停止搜索
      html = '<h3>配置 / 输入有误，已停止搜索（未进行任何样例比较）</h3>';
      [['old', '旧配置（当前命令表）'], ['new', '新配置（候选命令表）']].forEach(function (side) {
        var errs = result.errors[side[0]];
        if (!errs || !errs.length) return;
        html += '<p class="diff-err-side"><b>' + side[1] + '</b></p><ul>' +
          errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      });
      errBox.innerHTML = html;
      errBox.hidden = false;
      box.hidden = true;
      if (scroll) errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    errBox.hidden = true;
    box.hidden = false;

    var total = result.scopes.reduce(function (n, sc) { return n + sc.groups.length; }, 0);
    html = '<p class="diff-summary">' + (total
      ? '共发现 <b>' + total + '</b> 个差异组（按代表样例的按键及时间排序）。'
      : '三个作用域均未发现差异 —— 结论仅以上述搜索范围为限（' + SEARCH_NOTE + '）。') + '</p>';

    result.scopes.forEach(function (sc) {
      html += '<div class="diff-scope"><h3>作用域「' + LABELS[sc.scope] + '」</h3>' +
        '<p class="hint">搜索按键 ' + sc.keys.length + ' 个' +
        (sc.keys.length ? '（' + sc.keys.map(function (k) { return kbd(k); }).join(' ') + '）' : '') +
        '，样例 ' + sc.checked + ' 个（一键与两键 × 第二键 t∈{1, ' + engine.WAIT_MS + '}ms）。</p>';
      if (!sc.groups.length) {
        html += '<p class="diff-none">✔ 未发现差异 —— 仅限上述搜索范围（' + SEARCH_NOTE + '）。</p>';
      } else {
        sc.groups.forEach(function (g, i) {
          html += '<div class="diff-group">' +
            '<div class="diff-sample">差异组 ' + (i + 1) + ' · 样例事件：' + fmtSampleEvents(g.sample) + '</div>' +
            '<div class="diff-sides">' +
              '<div class="diff-side"><div class="diff-side-title">旧配置触发（当前命令表）</div>' +
                '<div class="diff-trig">' + fmtTriggerList(g.oldTriggered) + '</div></div>' +
              '<div class="diff-side"><div class="diff-side-title">新配置触发（候选命令表）</div>' +
                '<div class="diff-trig">' + fmtTriggerList(g.newTriggered) + '</div></div>' +
            '</div></div>';
        });
      }
      html += '</div>';
    });
    box.innerHTML = html;
    if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function runCompare(scroll) {
    renderDiff(ShortcutDiff.compare(gatherCommands(), gatherCandidate()), scroll);
  }
  $('#compare-btn').addEventListener('click', function () { runCompare(true); });

  /* ---------------- 目标命令修正 ---------------- */

  // 目标命令下拉：与「命令配置」表格中的命令 ID 保持同步
  function refreshRepairTargets() {
    var sel = $('#repair-target');
    var prev = sel.value;
    var ids = [];
    gatherCommands().forEach(function (c) {
      if (c.id && ids.indexOf(c.id) === -1) ids.push(c.id);
    });
    sel.innerHTML = '';
    if (!ids.length) {
      var empty = el('option', null, '（请先在「命令配置」中填写命令 ID）');
      empty.value = '';
      sel.appendChild(empty);
      return;
    }
    ids.forEach(function (id) {
      var opt = el('option', null, id);
      opt.value = id;
      sel.appendChild(opt);
    });
    if (ids.indexOf(prev) !== -1) sel.value = prev;
  }
  $('#commands-body').addEventListener('input', refreshRepairTargets);
  $('#commands-body').addEventListener('click', function () { setTimeout(refreshRepairTargets, 0); });
  $('#add-command').addEventListener('click', refreshRepairTargets);

  // 事件列表展示；changedIdx 标记的下标高亮为改动处
  function fmtRepairEvents(events, changedIdx) {
    return events.map(function (ev, i) {
      var cls = 'diff-ev' + (changedIdx && changedIdx[i] ? ' repair-changed' : '');
      return '<span class="' + cls + '"><span class="diff-t">t=' + ev.t + 'ms</span>' + kbd(ev.key) + '</span>';
    }).join('<span class="diff-arrow">→</span>');
  }

  function renderRepair(result, scroll) {
    var errBox = $('#repair-errors');
    var box = $('#repair-results');
    errBox.innerHTML = '';
    box.innerHTML = '';

    if (!result.ok) {
      // 配置 / 事件 / 目标无效：停止搜索并指出错误
      errBox.innerHTML = '<h3>配置 / 事件 / 目标有误，已停止搜索</h3><ul>' +
        result.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      errBox.hidden = false;
      box.hidden = true;
      if (scroll) errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    errBox.hidden = true;
    box.hidden = false;

    var head = '<p class="diff-summary">原事件回放：目标命令 <b>' + esc(result.targetId) + '</b>' +
      (result.original.targetHits > 0
        ? '已触发 <b>' + result.original.targetHits + '</b> 次 —— 返回零改动。'
        : '未触发，已按（改动处数、事件下标、替换键）升序搜索至多 ' + result.maxChanges + ' 处替换。') +
      '<br><span class="hint">候选按键 ' + result.candidateKeys.length + ' 种：' +
      (result.candidateKeys.length
        ? result.candidateKeys.map(function (k) { return kbd(k); }).join(' ')
        : '（无）') + '</span></p>';

    if (!result.solved) {
      box.innerHTML = head + '<p class="repair-none">✖ ' + esc(result.note) + '</p>';
      if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    var html = head;
    var changedIdx = {};
    result.changes.forEach(function (c) { changedIdx[c.index] = true; });
    if (result.changes.length) {
      html += '<h3 class="repair-h">改动位置（' + result.changes.length + ' 处）</h3><ul class="repair-changes">' +
        result.changes.map(function (c) {
          return '<li>事件 #' + (c.index + 1) + '（t=' + result.events[c.index].t + 'ms）：' +
            kbd(c.from) + ' <span class="diff-arrow">→</span> ' + kbd(c.to) + '</li>';
        }).join('') + '</ul>';
    } else {
      html += '<p class="repair-zero">✔ 零改动 —— 无需替换任何按键。</p>';
    }
    html += '<h3 class="repair-h">修正后事件（时间戳与事件数不变）</h3>' +
      '<div class="repair-events">' + fmtRepairEvents(result.events, changedIdx) + '</div>' +
      '<h3 class="repair-h">修正后完整回放</h3>';
    box.innerHTML = html;

    var tl = el('div');
    tl.id = 'repair-timeline';
    box.appendChild(tl);
    renderTimeline(tl, result.replay.timeline);
    var sum = el('div', 'summary');
    sum.innerHTML = summaryHtml(result.replay.triggered);
    box.appendChild(sum);
    if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function runRepair(scroll) {
    refreshRepairTargets(); // 同步下拉与当前命令表（保留仍存在的选中项）
    var result = ShortcutRepair.repair({
      commands: gatherCommands(),
      scope: currentScope(),
      events: gatherEvents(),
      targetId: $('#repair-target').value
    });
    renderRepair(result, scroll);
  }
  $('#repair-btn').addEventListener('click', function () { runRepair(true); });

  // 默认载入第一个示例，打开页面即可看到一次完整回放
  loadExample(EXAMPLES[0]);

  // 候选配置初始化为当前配置副本，并先比较一次（相同配置 → 各作用域显示「搜索范围内无差异」）
  copyToCandidate();
  runCompare(false);
})();
