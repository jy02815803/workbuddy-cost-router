'use strict'

const { estimateCredits } = require('./router.cjs')

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function readExecutionConfig(routing = {}) {
  const settings = routing.execution || {}
  const baseUrl = process.env[settings.baseUrlEnv || 'COST_ROUTER_BASE_URL'] || ''
  const apiKey = process.env[settings.apiKeyEnv || 'COST_ROUTER_API_KEY'] || ''
  return {
    enabled: Boolean(settings.enabled) && Boolean(baseUrl),
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    path: String(settings.path || '/chat/completions'),
    timeoutMs: Number(settings.timeoutMs) || 120000,
  }
}

async function chat(model, messages, routing = {}, options = {}) {
  const config = readExecutionConfig(routing)
  if (!config.enabled) {
    const error = new Error('未启用 OpenAI 兼容执行端点；WorkBuddy 官方模型由客户端后端管理，MCP server 不能代扣其积分。请在插件数据目录配置环境变量后启用 execution.enabled。')
    error.code = 'EXECUTION_DISABLED'
    throw error
  }
  const fetchImpl = options.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 运行时缺少 fetch()')
  const url = `${config.baseUrl}${config.path.startsWith('/') ? '' : '/'}${config.path}`
  const headers = { 'content-type': 'application/json' }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.id,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`执行端点返回 HTTP ${response.status}: ${text.slice(0, 300)}`)
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('执行端点返回的不是 JSON') }
    const output = payload?.choices?.[0]?.message?.content
    if (typeof output !== 'string' && !Array.isArray(output)) throw new Error('执行端点响应缺少 choices[0].message.content')
    const resultText = Array.isArray(output)
      ? output.map((part) => (typeof part === 'string' ? part : String(part?.text || ''))).join('\n')
      : output
    const inputChars = messages.reduce((sum, m) => sum + String(m?.content || '').length, 0)
    return { text: resultText, estimatedCredits: estimateCredits(model, inputChars, resultText.length), raw: payload }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { chat, normalizeBaseUrl, readExecutionConfig }
