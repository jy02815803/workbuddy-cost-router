# workbuddy-cost-router

WorkBuddy 专用的「成本路由」插件 / MCP server，当前版本 **0.1.0**。

这是独立项目，**不是** `dsh-cost-router 0.4.1` 的另一个版本号。两者只共享规则与编排思想：

- 先判断任务是不是异构，同质任务不拆。
- 能力是门槛，积分倍率是目标：免积分/低倍率模型能力够用就优先。
- 视觉能力不可降级；汇总优先能力和上下文窗口。
- `plan` 与 `run` 分开，花钱前先看方案。
- 单任务上下文隔离，失败隔离，逐笔记账。

## 适用环境

- 已在本机核对：WorkBuddy 5.9.3（腾讯）。
- 插件清单：`.codebuddy-plugin/plugin.json`。
- MCP 入口：`.mcp.json` → `node ${CODEBUDDY_PLUGIN_ROOT}/server/index.js`。
- 钩子：`hooks/hooks.json` 的 `UserPromptSubmit` 自动研判。
- 变量沿用 WorkBuddy 程序实际识别的 `CODEBUDDY_PLUGIN_ROOT` / `CODEBUDDY_PLUGIN_DATA`。

## WorkBuddy 积分口径

`config/models.json` 来自本机 WorkBuddy 5.9.3 的产品配置快照，只保留模型元数据，不含 URL、API key 或登录态。

- `creditMultiplier: 0` 表示免积分，例如 `hy3`、`hy4free`。
- `x0.05`、`x0.29`、`x1.00` 等 WorkBuddy `credits` 值转成数字倍率。
- 空白或异常 `credits` 保守按 `1` 处理，绝不默认免费。
- 模型能力评分按倍率、推理支持、上下文窗口和模型档位推导，可在 `config/routing.json` 的 `overrides` 中手工覆盖。
- 限时免费、夜间折扣由 WorkBuddy 客户端结算；本插件只读取静态倍率，不自行重算折扣。
- 台账是「相对积分估算」，不是官方账单；真实消耗以 WorkBuddy 客户端积分明细为准。

## 工具

| 工具 | 作用 | 是否调用模型 | 是否耗积分 |
| --- | --- | --- | --- |
| `cost_router_plan` | 规则研判、拆分方案、模型分配、预估积分 | 否 | 否 |
| `cost_router_run` | 按方案执行并返回结果和相对积分台账 | 默认否；启用执行端点后是 | 默认否 |
| `cost_router_report` | 查看当前 MCP 会话台账 | 否 | 否 |
| `cost_router_models` | 列出模型、倍率、免积分状态、图片/推理能力 | 否 | 否 |
| `cost_router_auto_plan` | 给 `UserPromptSubmit` 钩子返回附加提示 | 否 | 否 |

## 重要边界：WorkBuddy 官方模型

WorkBuddy 官方模型与积分由客户端后端管理，当前版本没有公开「让独立 MCP server 代调当前会话模型并计入同一积分账户」的插件接口。

因此本插件的 `run` 默认返回 `execution-disabled`，并附带可执行的 `plan` 建议；它不会假称已调用官方模型，也不会要求用户把 WorkBuddy 登录态交给插件。用户可以：

1. 按 `cost_router_plan` 的建议，在 WorkBuddy 中手动切换模型完成各子任务；或
2. 为插件配置一个独立的 OpenAI 兼容端点（本地网关、企业网关或自有 API），再设置 `config/routing.json` 的 `execution.enabled=true` 和环境变量 `COST_ROUTER_BASE_URL` / `COST_ROUTER_API_KEY`。

只有第二种模式才会真正发生外部模型调用。拆分任务还必须显式传 `confirmed=true`，并受 `budget` 限制。

## 给同事安装

最快方式见 [INSTALL.md](./INSTALL.md)：从 GitHub 克隆或下载 Release zip，解压后运行 `node scripts/install.cjs`，再重启 WorkBuddy。安装脚本走用户级 `mcp.json`，不依赖容易变化的本地插件市场 UI。

## 安装格式说明

### 方式一：本地目录插件

把整个 `workbuddy-cost-router/` 放到 WorkBuddy 可识别的本地插件/市场目录，并确保插件根目录包含：

```text
workbuddy-cost-router/
├── .codebuddy-plugin/plugin.json
├── .mcp.json
├── config/models.json
├── config/routing.json
├── hooks/hooks.json
├── hooks/auto-plan.cjs
├── server/index.js
└── skills/cost-router/SKILL.md
```

在 WorkBuddy 插件页启用 `workbuddy-cost-router`，然后重启 WorkBuddy（MCP server 和 hooks 在启动时加载）。该方式依赖 WorkBuddy 版本是否显示本地市场入口；若找不到市场，请用上面的安装脚本。

### 方式二：本地 marketplace

`scripts/pack.cjs` 生成的 zip 采用本地市场结构：

```text
.codebuddy-plugin/marketplace.json
plugins/workbuddy-cost-router/
├── .codebuddy-plugin/plugin.json
├── .mcp.json
├── config/
├── hooks/
├── server/
└── skills/
```

把 zip 解压到一个目录，在 WorkBuddy 中以「本地目录 marketplace」导入该目录，再安装 `workbuddy-cost-router`。源码目录里的 `.codebuddy-plugin/marketplace.json` 仅用于生成这个结构，不应把源码根目录本身同时当作插件和市场导入。

WorkBuddy 5.9.3 的界面未必提供「添加本地市场」入口。手工安装时还需要让以下三个本机状态文件彼此一致（都已由安装脚本/仓库检查，先备份再改）：

- `~/ .workbuddy/plugins/known_marketplaces.json`：登记市场目录。
- `~/ .workbuddy/plugins/installed_plugins.json`：登记 `workbuddy-cost-router@workbuddy-cost-router-local` 的 cache 安装路径。
- `~/ .workbuddy/settings.json`：在 `enabledPlugins` 中把该键设为 `true`。

仅新增市场登记不会让插件出现在「已安装」列表；WorkBuddy 还要按 `installed_plugins.json` 定位插件，按 `settings.json` 决定是否启用。

## 验证

```sh
cd workbuddy-cost-router
npm test
```

覆盖：模型倍率解析、免积分优先、未知倍率兜底、视觉门槛、汇总模型、异构/同质研判、预算、MCP `initialize` / `tools/list` / `tools/call`、默认 `run` 不冒充执行、自动研判提示。

还可用 stdio 直接握手：

```sh
node server/index.js
```

然后输入一行：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
```

## 打包

```sh
node scripts/pack.cjs
```

会生成 `workbuddy-cost-router-0.1.0.zip`。安装包不会包含 `test/`、日志或本机凭据。

## 与 DSH 版的差异

| 项目 | `dsh-cost-router` | `workbuddy-cost-router` |
| --- | --- | --- |
| 版本线 | `0.4.1` | `0.1.0` |
| 宿主 | DSH / Cordis | WorkBuddy 插件 + MCP |
| 模型来源 | DSH `ctx.llm` 已注册 provider | WorkBuddy 静态模型快照 + 可选 OpenAI 兼容端点 |
| 成本口径 | `creditMultiplier` 相对成本 | WorkBuddy `credits` 相对积分 |
| 设置页 | DSH `settings.plugins.tab` | 无设置页；用 MCP 工具和 hook |
| 自动研判 | `agent/pre-step` | `UserPromptSubmit` command hook |
| 官方模型执行 | DSH 可经 `ctx.llm` 调用 | MCP 默认不能代调；需独立端点 |

## 已知边界

- 静态模型快照会随 WorkBuddy 产品配置变化；请以 `config/models.json` 为可编辑基线，必要时更新 `credits` 和 `capabilities`。
- 自动研判是强提示而非硬约束；WorkBuddy 模型是否采纳工具调用取决于客户端策略。
- 多个模型分段输出再由汇总模型合并，长文仍建议人工通读。
- 相对积分估算不是账单。

## License

MIT，见 [LICENSE](./LICENSE)。
