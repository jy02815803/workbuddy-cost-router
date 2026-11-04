'use strict'

const KIND_RULES = [
  { kind: 'vision', re: /截图|图片|照片|扫描件|识别|图中|这张图|视频|画面|OCR/i },
  { kind: 'code', re: /代码|脚本|函数|报错|debug|python|javascript|sql|正则|爬虫/i },
  { kind: 'longdoc', re: /全文|整份|这份文件|通读|长文档|几十页|整本|论文/i },
  { kind: 'reasoning', re: /研判|评估|论证|可行性|利弊|权衡|推演|归因|决策|该不该/i },
  { kind: 'writing', re: /起草|撰写|写一份|公文|通知|请示|报告|讲话稿|汇报|总结|方案|纪要|材料|润色|措辞/i },
  { kind: 'bulk', re: /批量|重命名|整理文件|转换格式|逐个|遍历|归档|改名/i },
]

const KIND_TO_CAPABILITY = {
  vision: 'vision',
  longdoc: 'longdoc',
  reasoning: 'reasoning',
  code: 'code',
  writing: 'writing',
  text: 'text',
  bulk: 'bulk',
}

const ACTION_RE = /提取|整理|分析|写|做|生成|转成|对比|汇总|翻译|画|识别|统计/g
const STRONG_SIGNALS = /最强|务必准确|不能出错|正式上报|印发|定稿|审计|法律|医疗/

function classify(task) {
  const source = String(task || '')
  const kinds = []
  for (const rule of KIND_RULES) if (rule.re.test(source)) kinds.push(rule.kind)
  if (!kinds.length) kinds.push('text')
  return [...new Set(kinds)]
}

function shouldAutoPlan(task, options = {}) {
  const source = String(task || '').trim()
  const minChars = Number.isFinite(Number(options.minChars)) ? Math.max(1, Math.floor(Number(options.minChars))) : 12
  if (source.length < minChars) return { trigger: false, reason: '文本过短', kinds: [], willDecompose: false }
  const kinds = classify(source)
  const actions = (source.match(ACTION_RE) || []).length
  const distinct = kinds.length
  let willDecompose = false
  let reason = '任务单一，拆分会增加积分消耗和汇总成本'
  if (distinct >= 3) {
    willDecompose = true
    reason = `涉及 ${distinct} 类不同能力（${kinds.join('、')}）`
  } else if (kinds.includes('vision') && distinct >= 2) {
    willDecompose = true
    reason = '同时涉及视觉和文本，应隔离上下文'
  } else if (actions >= 3 && distinct >= 2) {
    willDecompose = true
    reason = `含 ${actions} 个动作、${distinct} 类能力`
  }
  return { trigger: true, reason, kinds, actions, willDecompose }
}

function capabilityScore(model, kind) {
  const key = KIND_TO_CAPABILITY[kind] || 'text'
  const value = Number(model?.capabilities?.[key])
  return Number.isFinite(value) ? value : 0
}

function pickModel(kind, models, routing = {}, options = {}) {
  const floors = routing.floors || {}
  const floor = Number.isFinite(Number(floors[kind])) ? Number(floors[kind]) : 3
  const pool = models.filter((model) => capabilityScore(model, kind) >= floor && (!options.requireImage || model.supportsImages))
  if (!pool.length) return null
  const forceStrong = Boolean(options.forceStrong)
  return [...pool].sort((a, b) => {
    const sa = capabilityScore(a, kind)
    const sb = capabilityScore(b, kind)
    if (forceStrong && sb !== sa) return sb - sa
    if (a.creditMultiplier !== b.creditMultiplier) return a.creditMultiplier - b.creditMultiplier
    if (sb !== sa) return sb - sa
    return a.id.localeCompare(b.id)
  })[0]
}

function pickSynthesisModel(models, routing = {}) {
  const settings = routing.synthesis || {}
  const minCapability = Number.isFinite(Number(settings.minCapability)) ? Number(settings.minCapability) : 4
  const maxCredit = Number.isFinite(Number(settings.maxCreditMultiplier)) ? Number(settings.maxCreditMultiplier) : 0.8
  const pool = models.filter((model) => capabilityScore(model, 'writing') >= minCapability && model.creditMultiplier <= maxCredit)
  const candidates = pool.length ? pool : models.filter((model) => capabilityScore(model, 'writing') >= minCapability)
  if (!candidates.length) return pickModel('writing', models, routing, { forceStrong: true })
  return [...candidates].sort((a, b) => {
    const sa = capabilityScore(a, 'writing')
    const sb = capabilityScore(b, 'writing')
    if (sb !== sa) return sb - sa
    if (b.contextWindow !== a.contextWindow) return b.contextWindow - a.contextWindow
    if (a.creditMultiplier !== b.creditMultiplier) return a.creditMultiplier - b.creditMultiplier
    return a.id.localeCompare(b.id)
  })[0]
}

function estimateCredits(model, inputChars, outputChars = 1200) {
  const multiplier = Number(model?.creditMultiplier)
  if (!Number.isFinite(multiplier) || multiplier < 0) return 0
  const units = (Math.max(0, inputChars) / 4000 + Math.max(0, outputChars) / 1000) / 2
  return Number((units * multiplier).toFixed(6))
}

function buildRulePlan(task, models, routing = {}) {
  const verdict = shouldAutoPlan(task, { minChars: routing.minChars })
  if (!verdict.trigger || !verdict.willDecompose) {
    const kind = verdict.kinds[0] || 'text'
    const model = pickModel(kind, models, routing, { forceStrong: STRONG_SIGNALS.test(task) })
    return {
      mode: 'single',
      verdict: '不拆',
      reason: verdict.reason,
      detectedKinds: verdict.kinds,
      assignment: model ? { kind, model, estimatedCredits: estimateCredits(model, String(task || '').length) } : null,
      estimatedCredits: model ? estimateCredits(model, String(task || '').length) : 0,
      requiresConfirmation: false,
      explanation: '同质任务直接交给能力够用且积分倍率最低的模型。',
    }
  }

  const subtasks = verdict.kinds.map((kind, index) => {
    const model = pickModel(kind, models, routing, { requireImage: kind === 'vision' })
    const estimatedCredits = model ? estimateCredits(model, String(task || '').length / verdict.kinds.length) : 0
    return {
      id: `t${index + 1}`,
      kind,
      instruction: `只处理「${kind}」这一能力对应的部分；不要重复处理其他子任务。`,
      needs: '整体任务描述及与该能力相关的输入',
      depends_on: [],
      model: model || null,
      estimatedCredits,
    }
  }).filter((row) => row.model)

  const synthesis = pickSynthesisModel(models, routing)
  const synthesisCredits = synthesis ? estimateCredits(synthesis, String(task || '').length / 2) : 0
  const estimatedCredits = Number((subtasks.reduce((sum, row) => sum + row.estimatedCredits, 0) + synthesisCredits).toFixed(6))
  return {
    mode: 'decomposed',
    verdict: '拆',
    reason: verdict.reason,
    detectedKinds: verdict.kinds,
    subtasks,
    synthesis: synthesis ? { model: synthesis, estimatedCredits: synthesisCredits } : null,
    estimatedCredits,
    requiresConfirmation: true,
    explanation: '按能力门槛筛选候选模型，再按 WorkBuddy credits 倍率升序选；汇总优先能力和上下文窗口。',
  }
}

function renderAutoPlanHint(task, plan) {
  const marker = '<workbuddy-cost-router-autoplan>'
  if (!plan || plan.mode === 'single') {
    return [marker, '规则研判：这个任务不需要拆分。请直接使用常规 WorkBuddy 模型完成，不要调用 cost_router_run。', '</workbuddy-cost-router-autoplan>'].join('\n')
  }
  const lines = [
    marker,
    `规则研判：这个任务可能值得拆分（${plan.reason}）。`,
    '开始前先调用 MCP 工具 cost_router_plan，把子任务、模型积分倍率和预估积分给用户看。',
    '用户确认后才可调用 cost_router_run；若未配置 OpenAI 兼容执行端点，run 会拒绝执行并只返回可操作建议。',
    '</workbuddy-cost-router-autoplan>',
  ]
  return lines.join('\n')
}

module.exports = {
  ACTION_RE,
  KIND_RULES,
  KIND_TO_CAPABILITY,
  STRONG_SIGNALS,
  buildRulePlan,
  capabilityScore,
  classify,
  estimateCredits,
  pickModel,
  pickSynthesisModel,
  renderAutoPlanHint,
  shouldAutoPlan,
}
