'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CATALOG = path.join(__dirname, '..', 'config', 'models.json')
const DEFAULT_UNKNOWN_MULTIPLIER = 1

function finiteMultiplier(value, fallback = DEFAULT_UNKNOWN_MULTIPLIER) {
  const number = typeof value === 'string' ? Number.parseFloat(value.replace(/^x/i, '')) : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function normalizeModel(raw, unknownMultiplier) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null
  const known = typeof raw.creditsKnown === 'boolean' ? raw.creditsKnown : true
  const multiplier = known ? finiteMultiplier(raw.creditMultiplier, unknownMultiplier) : unknownMultiplier
  const capability = Number.isFinite(Number(raw.capability)) ? Math.max(0, Math.min(5, Number(raw.capability))) : 3
  const supportsImages = Boolean(raw.supportsImages)
  const contextWindow = Number.isFinite(Number(raw.contextWindow)) ? Number(raw.contextWindow) : 0
  const capabilities = { ...(raw.capabilities || {}) }
  for (const kind of ['vision', 'longdoc', 'reasoning', 'code', 'writing', 'text', 'bulk']) {
    const value = Number(capabilities[kind])
    capabilities[kind] = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : capability
  }
  if (!supportsImages) capabilities.vision = 0
  if (contextWindow < 100000) capabilities.longdoc = Math.min(capabilities.longdoc, 2)

  return {
    id: raw.id,
    name: String(raw.name || raw.id),
    provider: String(raw.provider || 'workbuddy'),
    creditMultiplier: multiplier,
    creditsKnown: known,
    free: multiplier === 0,
    supportsImages,
    supportsReasoning: Boolean(raw.supportsReasoning),
    supportsToolCall: Boolean(raw.supportsToolCall),
    contextWindow,
    capability,
    capabilities,
  }
}

function loadCatalog(filePath, unknownMultiplier = DEFAULT_UNKNOWN_MULTIPLIER) {
  const file = filePath || process.env.COST_ROUTER_MODEL_CATALOG || DEFAULT_CATALOG
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 WorkBuddy 模型目录 ${file}: ${error.message}`)
  }
  const rows = Array.isArray(parsed) ? parsed : parsed.models
  if (!Array.isArray(rows)) throw new Error(`模型目录 ${file} 缺少 models 数组`)
  const fallback = finiteMultiplier(unknownMultiplier ?? parsed.unknownCreditMultiplier, DEFAULT_UNKNOWN_MULTIPLIER)
  const models = rows.map((row) => normalizeModel(row, fallback)).filter(Boolean)
  if (!models.length) throw new Error(`模型目录 ${file} 没有可用模型`)
  return { file, unknownCreditMultiplier: fallback, models }
}

function listModels(catalog, routing = {}) {
  const only = Array.isArray(routing.onlyProviders) ? routing.onlyProviders.filter(Boolean) : []
  const overrides = routing.overrides && typeof routing.overrides === 'object' ? routing.overrides : {}
  return catalog.models
    .filter((model) => only.length === 0 || only.includes(model.provider))
    .map((model) => {
      const patch = overrides[model.id] || overrides[model.name] || {}
      const capabilities = { ...model.capabilities, ...(patch.capabilities || {}) }
      const multiplier = Number.isFinite(Number(patch.creditMultiplier))
        ? finiteMultiplier(patch.creditMultiplier, model.creditMultiplier)
        : model.creditMultiplier
      return {
        ...model,
        ...(patch.name ? { name: String(patch.name) } : {}),
        ...(patch.provider ? { provider: String(patch.provider) } : {}),
        capabilities,
        creditMultiplier: multiplier,
        free: multiplier === 0,
        freeReason: multiplier === 0 ? 'creditMultiplier=0' : undefined,
      }
    })
    .sort((a, b) => a.creditMultiplier - b.creditMultiplier || b.capability - a.capability || a.id.localeCompare(b.id))
}

module.exports = { DEFAULT_CATALOG, DEFAULT_UNKNOWN_MULTIPLIER, finiteMultiplier, loadCatalog, listModels }
