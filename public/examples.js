/* 可回放示例（浏览器与 Node 共用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EXAMPLES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHORD_COMMANDS = [
    { id: 'mark', scope: 'editor', keys: ['Ctrl+K'] },
    { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] },
    { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
  ];

  return [
    {
      name: '两步命中',
      desc: 'Ctrl+K 是两步前缀进入等待，300ms 内按下 Ctrl+F 命中两步命令 openFile',
      commands: [
        { id: 'openFile', scope: 'global', keys: ['Ctrl+K', 'Ctrl+F'] }
      ],
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' },
        { t: 300, key: 'Ctrl+F' }
      ]
    },
    {
      name: '单步立即触发',
      desc: 'Ctrl+S 不是任何两步序列的前缀，按下立即触发 save',
      commands: [
        { id: 'save', scope: 'editor', keys: ['Ctrl+S'] }
      ],
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+S' }
      ]
    },
    {
      name: '超时结算',
      desc: 'Ctrl+K 等待超过 800ms：先结算前缀触发单步命令 mark，Ctrl+S 再作新起点触发 save',
      commands: CHORD_COMMANDS,
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' },
        { t: 900, key: 'Ctrl+S' }
      ]
    },
    {
      name: '恰在截止先结算',
      desc: '第二键正好在第 800ms 到达：先按超时结算前缀（触发 mark），Ctrl+F 再作新起点（未匹配）',
      commands: CHORD_COMMANDS,
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' },
        { t: 800, key: 'Ctrl+F' }
      ]
    },
    {
      name: '失配结算 + 新起点',
      desc: 'Ctrl+S 与前缀 Ctrl+K 不构成两步序列：结算前缀触发 mark，Ctrl+S 作为新起点触发 save',
      commands: CHORD_COMMANDS,
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' },
        { t: 300, key: 'Ctrl+S' }
      ]
    },
    {
      name: '前缀无单步丢弃',
      desc: '前缀 Ctrl+K 没有对应单步命令，失配时直接丢弃；失配键 Ctrl+X 也未匹配',
      commands: [
        { id: 'openFile', scope: 'editor', keys: ['Ctrl+K', 'Ctrl+F'] }
      ],
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' },
        { t: 200, key: 'Ctrl+X' }
      ]
    },
    {
      name: '作用域优先级',
      desc: '同一序列当前作用域优先于全局；把当前作用域切到「弹窗」再运行，可看到全局绑定生效',
      commands: [
        { id: 'globalPalette', scope: 'global', keys: ['Ctrl+P'] },
        { id: 'editorPalette', scope: 'editor', keys: ['Ctrl+P'] }
      ],
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+P' }
      ]
    },
    {
      name: '结束结算',
      desc: '输入结束时仍有待定前缀 Ctrl+K，结算并触发其单步命令 mark',
      commands: CHORD_COMMANDS,
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+K' }
      ]
    },
    {
      name: '重复绑定报错',
      desc: '同一作用域内相同序列被两个命令绑定，校验直接报错',
      commands: [
        { id: 'saveA', scope: 'editor', keys: ['Ctrl+S'] },
        { id: 'saveB', scope: 'editor', keys: ['Ctrl+S'] }
      ],
      scope: 'editor',
      events: [
        { t: 0, key: 'Ctrl+S' }
      ]
    }
  ];
});
