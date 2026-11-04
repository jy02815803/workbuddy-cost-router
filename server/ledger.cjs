'use strict'

const fs = require('node:fs')
const path = require('node:path')

function resolveDataDir() {
  return process.env.COST_ROUTER_DATA_DIR
    || process.env.CODEBUDDY_PLUGIN_DATA
    || path.join(require('node:os').homedir(), '.workbuddy', 'plugins', 'data', 'workbuddy-cost-router')
}

function createLedger(options = {}) {
  const dataDir = options.dataDir || resolveDataDir()
  const file = path.join(dataDir, 'ledger.jsonl')
  let calls = []
  if (options.persist !== false) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      calls = raw.split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean).slice(-200)
    } catch {
      calls = []
    }
  }

  function track(entry) {
    const row = {
      ts: new Date().toISOString(),
      stage: String(entry.stage || 'unknown'),
      modelId: String(entry.modelId || ''),
      modelName: String(entry.modelName || ''),
      creditMultiplier: Number(entry.creditMultiplier) || 0,
      inputChars: Math.max(0, Number(entry.inputChars) || 0),
      outputChars: Math.max(0, Number(entry.outputChars) || 0),
      estimatedCredits: Number(entry.estimatedCredits) || 0,
      actualCredits: Number.isFinite(Number(entry.actualCredits)) ? Number(entry.actualCredits) : null,
      status: String(entry.status || 'ok'),
    }
    calls.push(row)
    if (options.persist !== false) {
      try {
        fs.mkdirSync(dataDir, { recursive: true })
        fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch {
        // 台账写盘失败不影响当前 MCP 会话。
      }
    }
    return row
  }

  function report() {
    const estimatedCredits = Number(calls.reduce((sum, row) => sum + (Number(row.estimatedCredits) || 0), 0).toFixed(6))
    return {
      currency: 'credits',
      calls: calls.length,
      estimatedCredits,
      note: '相对积分估算，不是 WorkBuddy 官方账单；官方账单以客户端积分明细为准。',
      entries: calls.slice(-50),
    }
  }

  function clear() {
    calls = []
    if (options.persist !== false) {
      try { fs.writeFileSync(file, '', { encoding: 'utf8', mode: 0o600 }) } catch { /* ignore */ }
    }
  }

  return { file, track, report, clear }
}

module.exports = { createLedger, resolveDataDir }
