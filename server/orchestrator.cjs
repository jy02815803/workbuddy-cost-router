'use strict'

const { buildRulePlan, estimateCredits, pickSynthesisModel, shouldAutoPlan } = require('./router.cjs')
const { chat, readExecutionConfig } = require('./executor.cjs')

function createOrchestrator({ catalog, routing, ledger }) {
  const { listModels } = require('./catalog.cjs')
  function models() { return listModels(catalog, routing) }

  function budgetFor(args = {}) {
    const value = Number(args.budget ?? args.maxCredits ?? routing.defaultBudgetCredits)
    return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY
  }

  function assertBudget(estimated, budget) {
    if (estimated > budget) {
      const error = new Error(`预估积分 ${estimated.toFixed(4)} 超过本次预算 ${budget.toFixed(4)}；请提高 budget 或缩小任务范围。`)
      error.code = 'BUDGET_EXCEEDED'
      throw error
    }
  }

  async function plan(args = {}) {
    const task = String(args.task || '').trim()
    if (!task) throw new Error('task 不能为空')
    const budget = budgetFor(args)
    const result = buildRulePlan(task, models(), routing)
    assertBudget(result.estimatedCredits, budget)
    return {
      ...result,
      budgetCredits: Number.isFinite(budget) ? budget : null,
      currency: 'credits',
      executionEnabled: readExecutionConfig(routing).enabled,
      note: 'plan 是本地规则计算，不调用模型、不消耗积分。预估积分是相对口径，不是官方账单。',
    }
  }

  async function run(args = {}) {
    const task = String(args.task || '').trim()
    if (!task) throw new Error('task 不能为空')
    if (!readExecutionConfig(routing).enabled) {
      const preview = await plan(args)
      return {
        status: 'execution-disabled',
        message: 'WorkBuddy 官方积分模型不能由独立 MCP server 直接调用；未配置 OpenAI 兼容端点，因此没有执行、没有消耗积分。',
        plan: preview,
        next: '可在 WorkBuddy 中按 plan 的模型建议手动切换模型，或为插件配置独立的 OpenAI 兼容端点并启用 execution.enabled。',
      }
    }

    const budget = budgetFor(args)
    const result = buildRulePlan(task, models(), routing)
    assertBudget(result.estimatedCredits, budget)
    if (result.requiresConfirmation && args.confirmed !== true) {
      return {
        status: 'confirmation-required',
        message: `该任务预估消耗 ${result.estimatedCredits.toFixed(4)} 相对积分，请确认后再带 confirmed=true 调用 run。`,
        plan: result,
      }
    }
    const allModels = models()
    const outputs = []
    let spent = 0

    if (result.mode === 'single') {
      const model = result.assignment?.model
      if (!model) throw new Error('没有满足能力门槛的模型')
      const execution = await chat(model, [{ role: 'user', content: task }], routing)
      spent += execution.estimatedCredits
      ledger.track({ stage: 'single', modelId: model.id, modelName: model.name, creditMultiplier: model.creditMultiplier, inputChars: task.length, outputChars: execution.text.length, estimatedCredits: execution.estimatedCredits })
      outputs.push({ id: 'single', kind: result.assignment.kind, model: model.id, text: execution.text })
    } else {
      for (const subtask of result.subtasks) {
        const execution = await chat(subtask.model, [
          { role: 'system', content: `你是任务执行器，只完成 ${subtask.kind} 子任务，输出直接可用的结果，不要解释过程。` },
          { role: 'user', content: `整体目标：${task}\n\n子任务：${subtask.instruction}\n\n所需材料：${subtask.needs}` },
        ], routing)
        spent += execution.estimatedCredits
        ledger.track({ stage: subtask.id, modelId: subtask.model.id, modelName: subtask.model.name, creditMultiplier: subtask.model.creditMultiplier, inputChars: task.length, outputChars: execution.text.length, estimatedCredits: execution.estimatedCredits })
        outputs.push({ id: subtask.id, kind: subtask.kind, model: subtask.model.id, text: execution.text })
      }
      const synthesisModel = result.synthesis?.model || pickSynthesisModel(allModels, routing)
      if (!synthesisModel) throw new Error('没有可用的汇总模型')
      const parts = outputs.map((row) => `【${row.id} / ${row.kind}】\n${row.text}`).join('\n\n---\n\n')
      const execution = await chat(synthesisModel, [
        { role: 'system', content: '把多个模型分别完成的片段合并成完整成果；统一口径和文风，去掉重复，直接输出成品。' },
        { role: 'user', content: `原始任务：${task}\n\n各部分产出：\n\n${parts}` },
      ], routing)
      spent += execution.estimatedCredits
      ledger.track({ stage: 'synthesize', modelId: synthesisModel.id, modelName: synthesisModel.name, creditMultiplier: synthesisModel.creditMultiplier, inputChars: parts.length, outputChars: execution.text.length, estimatedCredits: execution.estimatedCredits })
      return {
        status: 'ok',
        mode: result.mode,
        output: execution.text,
        assignment: outputs.map(({ id, kind, model }) => ({ id, kind, model })),
        currency: 'credits',
        estimatedCredits: Number(spent.toFixed(6)),
        budgetCredits: Number.isFinite(budget) ? budget : null,
        note: '相对积分估算，不是 WorkBuddy 官方账单。',
      }
    }

    return {
      status: 'ok',
      mode: result.mode,
      output: outputs[0].text,
      assignment: outputs.map(({ id, kind, model }) => ({ id, kind, model })),
      currency: 'credits',
      estimatedCredits: Number(spent.toFixed(6)),
      budgetCredits: Number.isFinite(budget) ? budget : null,
      note: '相对积分估算，不是 WorkBuddy 官方账单。',
    }
  }

  function report() { return ledger.report() }
  function listCatalog() {
    return {
      currency: 'credits',
      models: models().map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        creditMultiplier: model.creditMultiplier,
        free: model.free,
        supportsImages: model.supportsImages,
        supportsReasoning: model.supportsReasoning,
        contextWindow: model.contextWindow,
        capability: model.capability,
      })),
      note: 'creditMultiplier=0 表示免积分；未知或空白 credits 按 1 处理。限时折扣以 WorkBuddy 客户端显示为准。',
    }
  }
  function autoPlan(args = {}) {
    const task = String(args.task || args.prompt || '').trim()
    const verdict = shouldAutoPlan(task, { minChars: routing.minChars })
    if (!verdict.trigger) return { enabled: true, inject: false, reason: verdict.reason }
    const result = buildRulePlan(task, models(), routing)
    const { renderAutoPlanHint } = require('./router.cjs')
    return {
      enabled: true,
      inject: true,
      reason: verdict.reason,
      hint: renderAutoPlanHint(task, result),
      plan: result,
      currency: 'credits',
      note: '本地规则计算，不调用模型、不消耗积分。',
    }
  }

  return { plan, run, report, models: listCatalog, autoPlan, estimateCredits }
}

module.exports = { createOrchestrator }
