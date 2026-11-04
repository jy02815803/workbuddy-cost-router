#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')

const server = path.join(__dirname, '..', 'server', 'index.js')
const child = spawn(process.execPath, [server], { cwd: path.dirname(server), stdio: ['pipe', 'pipe', 'pipe'] })
let output = ''
let stderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cost_router_plan', arguments: { task: '看这五张扫描件提取表格数据，再写一份分析报告' } } },
]

child.stdin.write(`${requests.map((row) => JSON.stringify(row)).join('\n')}\n`)
child.stdin.end()

child.on('close', (code) => {
  assert.equal(code, 0, `server 非零退出：${stderr}`)
  const lines = output.split(/\r?\n/).filter(Boolean)
  assert.equal(lines.length, requests.length, `响应行数应为 ${requests.length}，实际 ${lines.length}；stderr=${stderr}`)
  const responses = lines.map((line) => JSON.parse(line))
  assert.equal(responses[0].result.serverInfo.name, 'workbuddy-cost-router')
  assert.equal(responses[0].result.serverInfo.version, '0.1.0')
  assert.equal(responses[1].result.tools.length, 5)
  const plan = JSON.parse(responses[2].result.content[0].text)
  assert.equal(plan.mode, 'decomposed')
  assert.equal(plan.executionEnabled, false)
  console.log('WorkBuddy MCP stdio 子进程握手测试通过')
})
