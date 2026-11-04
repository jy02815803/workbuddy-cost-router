---
name: cost-router
description: WorkBuddy 成本路由。用于复杂、多能力、需要省积分的任务：先研判是否值得拆，再按 credits 倍率和能力门槛给出方案；只有用户明确确认且配置了 OpenAI 兼容执行端点后才可执行 run。
---

# WorkBuddy Cost Router

这个 Skill 只适用于 WorkBuddy 插件/MCP 版本，与 DSH 原生插件 `dsh-cost-router` 是不同项目、不同版本线。

## 何时使用

- 任务同时涉及看图、长文档、代码、深度推理、写作、批量处理等两类以上能力。
- 用户明确说“省积分”“别用贵模型”“先给方案再执行”“拆开做”。
- 需要先知道哪些模型免积分、哪些模型 credits 倍率更高。

## 红线

1. `cost_router_plan` 和 `cost_router_auto_plan` 是本地规则，不调用模型、不消耗积分。
2. `cost_router_run` 默认不会调用 WorkBuddy 官方积分模型，因为独立 MCP server 没有权限代替 WorkBuddy 客户端扣积分。
3. 只有启用并配置了独立的 OpenAI 兼容端点后，`run` 才会实际调用模型；拆分方案还必须带 `confirmed=true`。
4. `creditMultiplier=0` 表示免积分；空白或异常 `credits` 按 `1` 处理，绝不默认免费。
5. 相对积分估算不是官方账单；官方结算以 WorkBuddy 客户端积分明细为准。
6. 不要调用 DSH 的 `ctx.llm`、设置页或 `webServer` 接口；本插件没有这些宿主服务。

## 推荐流程

1. 调 `cost_router_models` 查看免积分模型、credits 倍率和能力评分。
2. 调 `cost_router_plan` 给出拆分方案与预估积分。
3. 把方案展示给用户；若 `requiresConfirmation=true`，等待确认。
4. 未启用执行端点时，建议用户按方案在 WorkBuddy 中手动切换模型；不要谎称已执行。
5. 启用执行端点后，才带 `confirmed=true` 调 `cost_router_run`。
6. 用 `cost_router_report` 查看相对积分台账。

## 路由原则

- 能力是门槛，credits 倍率是目标：先筛掉能力不达标的模型，再选倍率最低的。
- 视觉门槛不可降：不支持图片的模型不能承接 `vision` 子任务。
- 汇总优先能力和上下文窗口，再考虑倍率；汇总决定最终交付质量。
- 同质任务不要拆，拆分会增加积分消耗、汇总成本和文风断裂风险。
