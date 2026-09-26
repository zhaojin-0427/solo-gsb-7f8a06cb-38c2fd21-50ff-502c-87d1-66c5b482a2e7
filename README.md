# 快捷键回放器

本地运行的快捷键回放网页：配置命令（命令 ID + 作用域 + 一至两步快捷键），选择当前作用域，输入按毫秒递增的按键事件，逐键回放匹配、等待、结算与未匹配原因。另提供「配置变更影响」视图：以当前命令表为旧配置、候选命令表为新配置，自动搜索两套配置触发结果不同的按键样例；「目标命令修正」视图：把已有事件的按键替换为配置中出现的按键，使指定命令至少触发一次；以及「命令宏脚本」视图：输入 2～3 个有序命令 ID（可重复），从空事件生成按键脚本，使完整回放恰好按序触发这些命令。

技术栈：Node.js + Express + 原生前端（无构建步骤）。匹配引擎为前后端共享的纯函数模块（`public/engine.js`），配置比较模块为 `public/diff.js`、目标命令修正模块为 `public/repair.js`、命令宏脚本合成模块为 `public/synth.js`（均沿用回放引擎）。

## 快速开始（Docker）

```bash
docker compose up --build
```

然后打开 **http://localhost:3000**。

## 本地开发

```bash
npm install
npm start        # http://localhost:3000
npm test         # 运行引擎单元测试（node:test）
```

## 功能与规则

**命令配置**
- 每条命令：命令 ID（唯一）、作用域（全局 / 编辑器 / 弹窗）、一至两步快捷键。
- 每步快捷键 = 修饰键（Ctrl / Alt / Shift / Meta，可组合、**顺序无关**、大小写不敏感）+ 主键（字母 / 数字 / Enter / Escape）。例如 `shift+ctrl+k` 与 `Ctrl+Shift+K` 等价。
- 同一作用域内相同序列重复绑定会报错；跨作用域允许（用于覆盖）。

**作用域**
- 仅「当前作用域」与「全局」的绑定生效；同一序列优先当前作用域。

**回放匹配**
- 不是两步前缀的单步命令：按下立即触发。
- 命中两步前缀：等待 **800ms**，期限内第二键构成两步序列则触发两步命令。
- 失配或超时先结算前缀：有单步命令则触发，否则丢弃；失配键再作新起点。
- 恰好第 800ms 到达的键：先结算前缀，再作为新键处理。
- 输入结束时结算仍待定的前缀。

**页面**
- 逐键显示时间线：等待（含截止时刻）、触发（单步 / 两步 / 结算）、超时 / 失配 / 结束结算、丢弃、未匹配原因，并汇总触发顺序。
- 内置 9 个可回放示例（两步命中、超时结算、恰在截止、失配新起点、作用域优先级、重复绑定报错等），点击即载入并回放，可修改后重新运行。
- 支持 ⌨ 按键录入与「录制按键」（自动记录毫秒时间戳）。

**配置变更影响（比较入口：页面「4 · 配置变更影响」）**
- 以「1 · 命令配置」当前命令表为**旧配置**，视图内候选命令表为可编辑的**新配置**（可用「从当前配置复制」一键同步），点击「比较配置」。
- 对全局、编辑器、弹窗三个作用域**分别**搜索：按键取两套绑定中出现的规范化键（排序去重），枚举一键与两键事件——首键 t=0，第二键 t=1 或 800ms。
- 每侧结果是按触发顺序排列的（命令 ID、时间）列表；命令 ID 顺序或触发时间不同即为差异。
- 差异按（旧结果、新结果）的组合分组，每组保留事件数最少的样例，同长度按按键及时间升序择一；比较结果与命令表的行顺序无关。
- 逐作用域列出差异组、样例事件与两侧触发结果；无差异时注明结论**仅限上述搜索范围**。
- 两套配置都按现有规则校验，任一侧有错即停止搜索，并指出侧别（旧 / 新）与错误行（命令 #N）。

**目标命令修正（入口：页面「5 · 目标命令修正」）**
- 沿用「1 · 命令配置」「2 · 当前作用域」「3 · 按键事件」；在视图内选择目标命令 ID（下拉与命令表同步）。
- 仅允许把**已有事件的按键**替换为**当前配置中出现的规范化按键**（排序去重）；时间戳与事件数保持不变。
- 先回放原事件：目标已触发则返回**零改动**；否则搜索至多 **2** 处不同事件的替换，使目标至少触发一次。
- 按（改动处数、事件下标序列、替换键序列）依次升序取首个方案，结果唯一；替换为原键不计入改动。
- 显示改动位置（事件 #N：原键 → 新键）、修正后事件（改动处高亮）与修正后完整回放；无解时注明结论**仅限当前替换范围与现有时间戳**。
- 限制：事件 ≤ **8** 个、候选按键 ≤ **12** 种，超限报错；配置、事件或目标命令 ID 无效即停止搜索并指出错误。

**命令宏脚本（入口：页面「6 · 命令宏脚本」）**
- 沿用「1 · 命令配置」与「2 · 当前作用域」；输入 **2～3 个有序命令 ID（可重复）**，从**空事件**生成按键脚本，使完整回放触发的命令 ID 列表**恰好**等于输入顺序（逐项全等、不夹带其他命令；触发时刻不要求）。
- 候选按键只取**当前配置中出现的规范化按键**（排序去重）；**首事件 t=0**，相邻事件间隔限 **1 或 800ms**，最多 **5 个事件、5 种候选按键**，超限报错。
- 按（事件数、按键序列、时间戳序列）依次升序枚举，首个命中的脚本即唯一解；前缀失配、超时、结束结算与作用域覆盖均由现有回放引擎判定。
- 展示合成脚本与完整回放，并可一键「装入 3 · 按键事件」在现有事件表中复核（替换当前事件表内容并重新回放）；无解时注明结论**仅限上述搜索范围**。
- 配置、作用域或目标 ID 无效（为空 / 不在命令表中 / 数量不是 2～3 个）即停止搜索并指出原因。

## HTTP API

页面回放完全在浏览器本地完成；服务器同时暴露同一引擎的 API，便于脚本化使用。

### `POST /api/replay`

```bash
curl -X POST http://localhost:3000/api/replay \
  -H 'Content-Type: application/json' \
  -d '{
    "commands": [
      {"id": "mark",     "scope": "editor", "keys": ["Ctrl+K"]},
      {"id": "openFile", "scope": "editor", "keys": ["Ctrl+K", "Ctrl+F"]}
    ],
    "scope": "editor",
    "events": [
      {"t": 0,   "key": "Ctrl+K"},
      {"t": 300, "key": "Ctrl+F"}
    ]
  }'
```

- 成功返回 `200`：`{ ok, scope, waitMs, timeline, triggered }`，`timeline` 为逐条事件（`wait` / `trigger` / `timeout` / `mismatch` / `end` / `discard` / `unmatched`）。
- 配置或事件非法返回 `400`：`{ ok: false, errors: [...] }`。

### `POST /api/compare`

配置变更影响比较（与页面「配置变更影响」视图同一引擎）：

```bash
curl -X POST http://localhost:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{
    "oldCommands": [
      {"id": "mark",     "scope": "editor", "keys": ["Ctrl+K"]},
      {"id": "openFile", "scope": "editor", "keys": ["Ctrl+K", "Ctrl+F"]}
    ],
    "newCommands": [
      {"id": "openFile", "scope": "editor", "keys": ["Ctrl+K", "Ctrl+F"]}
    ]
  }'
```

- 成功返回 `200`：`{ ok, waitMs, secondKeyTimes: [1, 800], scopes: [...] }`；每个作用域含 `scope`、搜索按键 `keys`、样例数 `checked` 与差异组 `groups`；每组为 `{ sample, oldTriggered, newTriggered }`，触发列表元素形如 `{ commandId, t }`。
- 任一侧配置非法返回 `400`：`{ ok: false, errors: { old: [...], new: [...] } }`（不进行任何样例搜索）。

### `POST /api/repair-trace`

目标命令修正（与页面「目标命令修正」视图同一引擎）：

```bash
curl -X POST http://localhost:3000/api/repair-trace \
  -H 'Content-Type: application/json' \
  -d '{
    "commands": [
      {"id": "openFile", "scope": "editor", "keys": ["Ctrl+K", "Ctrl+F"]}
    ],
    "scope": "editor",
    "events": [
      {"t": 0,   "key": "Ctrl+A"},
      {"t": 300, "key": "Ctrl+B"}
    ],
    "targetId": "openFile"
  }'
```

- 成功返回 `200`：`{ ok, scope, targetId, waitMs, maxEvents, maxKeys, maxChanges, candidateKeys, original, solved, alreadyTriggered, changes, events, replay, note? }`。
  - `original`：原事件回放（`timeline` / `triggered` / `targetHits`）；目标已触发时 `alreadyTriggered: true`、`changes: []`（零改动）。
  - `changes`：改动位置 `[{ index, from, to }]`（`index` 为 0 起事件下标）；`events` 为修正后事件（时间戳与事件数不变）；`replay` 为修正后完整回放。
  - `solved: false` 时附 `note`：结论仅限当前替换范围（至多 2 处替换、候选按键限配置中出现的规范化键）与现有时间戳。
- 配置、事件或目标 ID 非法，或超过限制（事件 > 8、候选按键 > 12）返回 `400`：`{ ok: false, errors: [...] }`（不进行任何搜索）。

### `POST /api/synthesize-trace`

命令宏脚本合成（与页面「命令宏脚本」视图共用生成逻辑）：

```bash
curl -X POST http://localhost:3000/api/synthesize-trace \
  -H 'Content-Type: application/json' \
  -d '{
    "commands": [
      {"id": "mark",     "scope": "editor", "keys": ["Ctrl+K"]},
      {"id": "openFile", "scope": "editor", "keys": ["Ctrl+K", "Ctrl+F"]},
      {"id": "save",     "scope": "editor", "keys": ["Ctrl+S"]}
    ],
    "scope": "editor",
    "targetIds": ["mark", "openFile"]
  }'
```

- 成功返回 `200`：`{ ok, scope, targetIds, waitMs, gaps: [1, 800], maxEvents, maxKeys, candidateKeys, checked, solved, events?, replay?, note? }`。
  - `events` 为合成脚本（首事件 t=0，相邻间隔 ∈ {1, 800}ms，≤ 5 个事件）；`replay` 为完整回放（`timeline` / `triggered`），其命令 ID 序列恰好等于 `targetIds`；`checked` 为枚举过的脚本数。
  - `solved: false` 时附 `note`：结论仅限上述搜索范围（最多 5 个事件、候选按键限配置中出现的规范化键、间隔仅取 1 或 800ms）。
- 配置、作用域或目标 ID 非法（为空、不在命令表中、数量不是 2～3 个），或候选按键超过 5 种返回 `400`：`{ ok: false, errors: [...] }`（不进行任何搜索）。

其他接口：`GET /api/health`、`GET /api/examples`。

## 项目结构

```
├── server.js            # Express：静态页面 + /api/replay、/api/compare、/api/repair-trace、/api/synthesize-trace 等接口
├── public/
│   ├── index.html       # 页面结构（含「配置变更影响」「目标命令修正」「命令宏脚本」视图）
│   ├── styles.css       # 样式
│   ├── app.js           # 前端交互（表格、按键录入、录制、时间线、差异、修正与宏脚本视图渲染）
│   ├── engine.js        # 匹配引擎（浏览器与 Node 共用）
│   ├── diff.js          # 新旧配置差异搜索（复用 engine 回放，浏览器与 Node 共用）
│   ├── repair.js        # 目标命令修正搜索（复用 engine 回放，浏览器与 Node 共用）
│   ├── synth.js         # 命令宏脚本合成搜索（复用 engine 回放，浏览器与 Node 共用）
│   └── examples.js      # 可回放示例
├── test/engine.test.js  # 引擎单元测试（node:test）
├── test/diff.test.js    # 配置比较单元测试（node:test）
├── test/repair.test.js  # 目标命令修正单元测试（node:test）
├── test/synth.test.js   # 命令宏脚本合成单元测试（node:test）
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 说明与限制

- 每步仅允许 Ctrl/Alt/Shift/Meta 与字母、数字、Enter、Escape；其他键（如 Tab、F5）会被拒绝并提示。
- 事件时间需按毫秒递增，否则报错。
- 目标命令修正：事件限 8 个、候选按键（配置中出现的规范化键）限 12 种；仅替换已有事件的按键，不增删事件、不改时间戳，最多替换 2 处。
- 命令宏脚本：目标命令 ID 限 2～3 个（可重复）；脚本限 5 个事件、候选按键（配置中出现的规范化键）限 5 种；首事件 t=0，相邻事件间隔仅取 1 或 800ms；从空事件生成，触发列表必须恰好等于目标顺序（不夹带其他命令）。
- 浏览器无法捕获部分系统 / 浏览器保留快捷键（如 Ctrl+W），录制时请避开。
