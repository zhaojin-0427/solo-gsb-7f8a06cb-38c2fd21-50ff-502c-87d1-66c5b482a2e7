'use strict';

const path = require('path');
const express = require('express');
const engine = require('./public/engine.js');
const diff = require('./public/diff.js');
const repair = require('./public/repair.js');
const synthesize = require('./public/synthesize.js');
const examples = require('./public/examples.js');

const app = express();
app.use(express.json({ limit: '256kb' }));

// 静态页面（原生前端）
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 可回放示例
app.get('/api/examples', (req, res) => {
  res.json(examples);
});

// 回放接口：{ commands: [{id, scope, keys:[...]}], scope: 'editor', events: [{t, key}] }
app.post('/api/replay', (req, res) => {
  const body = req.body || {};
  const result = engine.replay({ commands: body.commands }, body.scope, body.events);
  res.status(result.ok ? 200 : 400).json(result);
});

// 配置变更影响比较：{ oldCommands: [...], newCommands: [...] }
app.post('/api/compare', (req, res) => {
  const body = req.body || {};
  const result = diff.compare(body.oldCommands, body.newCommands);
  res.status(result.ok ? 200 : 400).json(result);
});

// 目标命令修正：{ commands: [...], scope: 'editor', events: [{t, key}], targetId: 'openFile' }
app.post('/api/repair-trace', (req, res) => {
  const result = repair.repair(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

// 命令宏脚本生成：{ commands: [...], scope: 'editor', targetIds: ['a', 'b'] }
app.post('/api/synthesize-trace', (req, res) => {
  const result = synthesize.synthesize(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`快捷键回放器已启动: http://localhost:${PORT}`);
});
