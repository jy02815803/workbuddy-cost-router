'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { finiteMultiplier, loadCatalog, listModels } = require('../server/catalog.cjs')
const {
  buildRulePlan,
  classify,
  estimateCredits,
  pickModel,
  pickSynthesisModel,
  shouldAutoPlan,
} = require('../server/router.cjs')

const routingPath = path.join(__dirname, '..', 'config', 'routing.json')
const routing = JSON.parse(require('node:fs').readFileSync(routingPath, 'utf8'))
const catalogPath = process.env.COST_ROUTER_MODEL_CATALOG || path.join(__dirname, '..', 'config', 'models.json')
const catalog = loadCatalog(catalogPath, routing.unknownCreditMultiplier)
const models = listModels(catalog, routing)

assert.ok(models.length >= 50, '本机 WorkBuddy 模型快照应包含至少 50 个模型')
assert.ok(models.some((model) => model.creditMultiplier === 0), '应存在免积分模型')
assert.equal(finiteMultiplier('x0.00', 1), 0, 'x0.00 应解析为免积分')
assert.equal(finiteMultiplier(undefined, 1), 1, '未知倍率应按 1 兜底')
assert.equal(finiteMultiplier(-3, 1), 1, '负倍率不能当作免费')

const unknown = loadCatalog(catalogPath).models.find((model) => !model.creditsKnown)
if (unknown) assert.equal(unknown.creditMultiplier, 1, '空白 credits 必须保守按 1 处理')

assert.deepEqual(classify('看这五张扫描件提取表格数据，再写一份分析报告').includes('vision'), true)
assert.equal(shouldAutoPlan('好的', { minChars: 12 }).trigger, false, '短文本不触发')
assert.equal(shouldAutoPlan('帮我起草一份放假通知，语气正式一点', { minChars: 12 }).willDecompose, false, '同质写作不拆')
assert.equal(shouldAutoPlan('看这五张扫描件提取表格数据，再写一份分析报告', { minChars: 12 }).willDecompose, true, '视觉+文本任务应拆')

const freeVision = pickModel('vision', models, routing, { requireImage: true })
assert.ok(freeVision, '应能选出视觉模型')
assert.equal(freeVision.supportsImages, true, '视觉模型必须支持图片')
assert.equal(freeVision.creditMultiplier, 0, '能力够用时免积分模型应优先')

const synthesis = pickSynthesisModel(models, routing)
assert.ok(synthesis, '应能选出汇总模型')
assert.ok(synthesis.capabilities.writing >= (routing.synthesis.minCapability || 4), '汇总模型写作能力应达门槛')
assert.ok(synthesis.creditMultiplier <= (routing.synthesis.maxCreditMultiplier || 0.8), '汇总模型不应超过积分倍率上限')

assert.equal(estimateCredits({ creditMultiplier: 0 }, 10000, 1000), 0, '免积分模型估算应为零')
assert.ok(estimateCredits({ creditMultiplier: 1 }, 4000, 1000) > 0, '收费模型估算应大于零')

const single = buildRulePlan('帮我起草一份放假通知，语气正式一点', models, routing)
assert.equal(single.mode, 'single')
assert.equal(single.requiresConfirmation, false)

const decomposed = buildRulePlan('看这五张扫描件提取表格数据，再写一份分析报告', models, routing)
assert.equal(decomposed.mode, 'decomposed')
assert.equal(decomposed.requiresConfirmation, true)
assert.ok(decomposed.detectedKinds.includes('vision'))
assert.ok(decomposed.subtasks.every((row) => row.model.creditMultiplier >= 0))
assert.ok(decomposed.subtasks.every((row) => row.kind !== 'vision' || row.model.supportsImages))
assert.ok(decomposed.estimatedCredits >= 0)

console.log('WorkBuddy 路由规则测试通过')
