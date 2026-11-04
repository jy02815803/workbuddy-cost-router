'use strict'

const path = require('node:path')
const { loadCatalog } = require('./catalog.cjs')
const { createLedger } = require('./ledger.cjs')
const { createOrchestrator } = require('./orchestrator.cjs')

const DEFAULT_ROUTING = path.join(__dirname, '..', 'config', 'routing.json')

function loadJson(file) {
  return JSON.parse(require('node:fs').readFileSync(file, 'utf8'))
}

function createRuntime(options = {}) {
  const routingFile = options.routingFile || process.env.COST_ROUTER_ROUTING || DEFAULT_ROUTING
  const routing = options.routing || loadJson(routingFile)
  const catalogPath = options.catalogPath || process.env.COST_ROUTER_MODEL_CATALOG || path.join(path.dirname(routingFile), routing.catalog || 'models.json')
  const catalog = options.catalog || loadCatalog(catalogPath, routing.unknownCreditMultiplier)
  const ledger = options.ledger || createLedger({ persist: options.persist !== false, dataDir: options.dataDir })
  const orchestrator = createOrchestrator({ catalog, routing, ledger })
  return { routing, catalog, ledger, orchestrator }
}

const TOOLS = [
  {
    name: 'cost_router_plan',
    description: '用本地规则研判任务是否值得拆，按 WorkBuddy credits 倍率和能力门槛给出计划与预估积分；不调用模型、不消耗积分。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '用户任务原文' },
        budget: { type: 'number', description: '本次允许的相对积分预算；0 表示只用免积分模型' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    call: (runtime, args) => runtime.orchestrator.plan(args),
  },
  {
    name: 'cost_router_run',
    description: '按计划执行任务；默认因 WorkBuddy 官方积分模型不可由 MCP server 代调而拒绝，启用 OpenAI 兼容端点后才真正调用模型。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '用户任务原文' },
        budget: { type: 'number', description: '本次允许的相对积分预算' },
        confirmed: { type: 'boolean', description: ' decomposed 方案是否已经用户确认' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    call: (runtime, args) => runtime.orchestrator.run(args),
  },
  {
    name: 'cost_router_report',
    description: '查看本 MCP 会话的相对积分估算台账；不是 WorkBuddy 官方账单。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    call: (runtime) => runtime.orchestrator.report(),
  },
  {
    name: 'cost_router_models',
    description: '列出当前配置中的 WorkBuddy 模型、credits 倍率、免积分状态、图片/推理能力和能力评分。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    call: (runtime) => runtime.orchestrator.models(),
  },
  {
    name: 'cost_router_auto_plan',
    description: '为 UserPromptSubmit 钩子做零成本自动研判，返回应注入给模型的提示文本；不调用模型、不消耗积分。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '用户任务原文' },
        prompt: { type: 'string', description: 'UserPromptSubmit 的 prompt 字段别名' },
      },
      additionalProperties: false,
    },
    call: (runtime, args) => runtime.orchestrator.autoPlan(args),
  },
]

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false }
}

function errorResult(error) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: error?.message || String(error), code: error?.code || 'INTERNAL_ERROR' }, null, 2) }],
    isError: true,
  }
}

function createProtocolHandler(runtime) {
  return async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null
    const { id, method, params } = message
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id')
    const response = (result) => (hasId ? { jsonrpc: '2.0', id, result } : null)
    const error = (code, errorMessage, data) => (hasId ? { jsonrpc: '2.0', id, error: { code, message: errorMessage, ...(data ? { data } : {}) } } : null)

    try {
      if (method === 'initialize') {
        return response({
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'workbuddy-cost-router', version: '0.1.0' },
        })
      }
      if (method === 'notifications/initialized' || method === 'initialized') return null
      if (method === 'ping') return response({})
      if (method === 'tools/list') return response({ tools: TOOLS.map(({ call, ...tool }) => tool) })
      if (method === 'tools/call') {
        const name = String(params?.name || '')
        const tool = TOOLS.find((row) => row.name === name)
        if (!tool) return error(-32601, `未知工具：${name}`)
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
        try {
          return response(textResult(await tool.call(runtime, args)))
        } catch (callError) {
          return response(errorResult(callError))
        }
      }
      if (method === 'resources/list') return response({ resources: [] })
      if (method === 'prompts/list') return response({ prompts: [] })
      return error(-32601, `不支持的方法：${String(method || '')}`)
    } catch (error) {
      return error(-32603, error?.message || String(error))
    }
  }
}

function startStdioServer(options = {}) {
  const runtime = options.runtime || createRuntime(options)
  const handle = createProtocolHandler(runtime)
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  let buffer = ''
  input.setEncoding('utf8')
  input.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      Promise.resolve(handle(message)).then((result) => {
        if (result) output.write(`${JSON.stringify(result)}\n`)
      }).catch((error) => {
        const id = message && Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null
        if (id !== null) output.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: error?.message || String(error) } })}\n`)
      })
    }
  })
  return { runtime, handle }
}

if (require.main === module) startStdioServer()

module.exports = { TOOLS, createProtocolHandler, createRuntime, startStdioServer }
