#!/usr/bin/env node
'use strict'

/**
 * 把 workbuddy-cost-router 安装为 WorkBuddy 用户级 MCP server。
 *
 * 这个安装器不依赖本地 marketplace UI，因为 WorkBuddy 5.9.3 的“添加本地市场”
 * 入口并不稳定，且手工写入 installed_plugins.json 会在产品配置刷新时被清理。
 * 用户级 ~/.workbuddy/mcp.json 是本机已验证可靠的 MCP 入口。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const pluginRoot = path.resolve(__dirname, '..')
const configDir = process.env.WORKBUDDY_CONFIG_DIR?.trim()
  || process.env.CODEBUDDY_CONFIG_DIR?.trim()
  || path.join(os.homedir(), '.workbuddy')
const installDir = path.join(configDir, 'plugins', 'workbuddy-cost-router')
const mcpFile = path.join(configDir, 'mcp.json')
const approvalFile = path.join(configDir, 'mcp-approvals.json')
const serverName = 'workbuddy-cost-router'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function backup(file) {
  if (!fs.existsSync(file)) return null
  const destination = `${file}.bak-workbuddy-cost-router-${stamp}`
  fs.copyFileSync(file, destination)
  return destination
}

function copyPlugin() {
  const entries = [
    '.codebuddy-plugin/plugin.json',
    '.mcp.json',
    'LICENSE',
    'README.md',
    'package.json',
    'config/models.json',
    'config/routing.json',
    'hooks/hooks.json',
    'hooks/auto-plan.cjs',
    'server/index.js',
    'server/index.cjs',
    'server/catalog.cjs',
    'server/router.cjs',
    'server/executor.cjs',
    'server/orchestrator.cjs',
    'server/ledger.cjs',
    'skills/cost-router/SKILL.md',
  ]
  for (const entry of entries) {
    const source = path.join(pluginRoot, entry)
    if (!fs.existsSync(source)) throw new Error(`插件目录缺少文件：${entry}`)
    const destination = path.join(installDir, entry)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
}

function trustMaterial(entry) {
  const args = (entry.args || []).map(String).sort().join(',')
  const envKeys = Object.keys(entry.env || {}).sort().join(',')
  return [entry.command, args, envKeys, ...(entry.cwd ? [entry.cwd] : [])].join('|')
}

function configHash(entry) {
  return crypto.createHash('sha256').update(trustMaterial(entry), 'utf8').digest('hex')
}

function main() {
  const serverEntry = {
    command: process.platform === 'win32' ? 'node.exe' : 'node',
    args: [path.join(installDir, 'server', 'index.js')],
    cwd: installDir,
    env: {
      COST_ROUTER_MODEL_CATALOG: path.join(installDir, 'config', 'models.json'),
      COST_ROUTER_ROUTING: path.join(installDir, 'config', 'routing.json'),
      COST_ROUTER_DATA_DIR: path.join(configDir, 'plugins', 'data', serverName),
    },
  }

  copyPlugin()
  const mcpBackup = backup(mcpFile)
  const approvalBackup = backup(approvalFile)
  const mcp = readJson(mcpFile, { mcpServers: {} })
  if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object' || Array.isArray(mcp.mcpServers)) mcp.mcpServers = {}
  mcp.mcpServers[serverName] = serverEntry
  writeJson(mcpFile, mcp)

  const approvals = readJson(approvalFile, {})
  approvals[`${configHash(serverEntry)}::${serverName}`] = Date.now()
  writeJson(approvalFile, approvals)

  console.log(`已安装到：${installDir}`)
  console.log(`MCP 配置：${mcpFile}`)
  console.log(`信任记录：${approvalFile}`)
  if (mcpBackup) console.log(`mcp.json 备份：${mcpBackup}`)
  if (approvalBackup) console.log(`mcp-approvals.json 备份：${approvalBackup}`)
  console.log('请完全退出并重新启动 WorkBuddy，然后在 /mcp 或连接器列表查看 workbuddy-cost-router。')
}

main()
