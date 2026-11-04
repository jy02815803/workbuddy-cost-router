#!/usr/bin/env node
'use strict'

// UserPromptSubmit command hook：stdin 是 JSON，stdout 输出 JSON。
// 任何异常都输出空对象并 exit 0，绝不阻断用户提交。
const path = require('node:path')
const { createRuntime, TOOLS } = require('../server/index.cjs')

let runtime
try {
  runtime = createRuntime({
    persist: false,
    routingFile: process.env.COST_ROUTER_ROUTING || path.join(__dirname, '..', 'config', 'routing.json'),
  })
} catch (error) {
  process.stdout.write(`${JSON.stringify({ systemMessage: `workbuddy-cost-router 自动研判未启用：${error.message}` })}\n`)
  process.exit(0)
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', async () => {
  let payload = {}
  try { payload = JSON.parse(raw || '{}') } catch { payload = {} }
  const task = String(payload.prompt || payload.user_prompt || payload.message || payload.task || '')
  try {
    const tool = TOOLS.find((row) => row.name === 'cost_router_auto_plan')
    const result = await tool.call(runtime, { task })
    if (!result.inject) {
      process.stdout.write('{}\n')
    } else {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: result.hint } })}\n`)
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ systemMessage: `workbuddy-cost-router 自动研判已跳过：${error.message}` })}\n`)
  }
  process.exit(0)
})
