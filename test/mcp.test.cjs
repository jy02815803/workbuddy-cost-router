'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { createRuntime, createProtocolHandler, TOOLS } = require('../server/index.cjs')

async function main() {
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-cost-router-'))
try {
  const runtime = createRuntime({ persist: false, dataDir: sandbox })
  const handle = createProtocolHandler(runtime)

  assert.deepEqual(TOOLS.map((tool) => tool.name).sort(), [
    'cost_router_auto_plan',
    'cost_router_models',
    'cost_router_plan',
    'cost_router_report',
    'cost_router_run',
  ], '四个用户工具加一个钩子辅助工具')

  const initialized = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  assert.equal(initialized.result.serverInfo.name, 'workbuddy-cost-router')
  assert.equal(initialized.result.serverInfo.version, '0.1.0')
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)

  const listed = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), TOOLS.map((tool) => tool.name).sort())

  const models = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cost_router_models', arguments: {} } })
  const modelPayload = JSON.parse(models.result.content[0].text)
  assert.equal(modelPayload.currency, 'credits')
  assert.ok(modelPayload.models.some((model) => model.free))

  const plan = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cost_router_plan', arguments: { task: '看这五张扫描件提取表格数据，再写一份分析报告' } } })
  const planPayload = JSON.parse(plan.result.content[0].text)
  assert.equal(planPayload.mode, 'decomposed')
  assert.equal(planPayload.requiresConfirmation, true)
  assert.equal(planPayload.executionEnabled, false)

  const run = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'cost_router_run', arguments: { task: '看这五张扫描件提取表格数据，再写一份分析报告', confirmed: true } } })
  const runPayload = JSON.parse(run.result.content[0].text)
  assert.equal(runPayload.status, 'execution-disabled', '未配置执行端点时不能假称已执行')
  assert.ok(runPayload.message.includes('WorkBuddy'))

  const report = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'cost_router_report', arguments: {} } })
  const reportPayload = JSON.parse(report.result.content[0].text)
  assert.equal(reportPayload.calls, 0, 'plan/run 默认不记账、不耗积分')

  const auto = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'cost_router_auto_plan', arguments: { task: '看这五张扫描件提取表格数据，再写一份分析报告' } } })
  const autoPayload = JSON.parse(auto.result.content[0].text)
  assert.equal(autoPayload.inject, true)
  assert.match(autoPayload.hint, /cost_router_plan/)

  const short = await handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'cost_router_auto_plan', arguments: { task: '好的' } } })
  assert.equal(JSON.parse(short.result.content[0].text).inject, false)

  const unknownTool = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } })
  assert.equal(unknownTool.error.code, -32601)
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true })
}
  console.log('WorkBuddy MCP 协议测试通过')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
