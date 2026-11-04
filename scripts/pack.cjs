#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const output = path.join(root, 'workbuddy-cost-router-0.1.0.zip')
const pluginFiles = [
  '.codebuddy-plugin/plugin.json',
  '.mcp.json',
  'LICENSE',
  'README.md',
  'package.json',
  'config/models.json',
  'config/routing.json',
  'INSTALL.md',
  'hooks/hooks.json',
  'hooks/auto-plan.cjs',
  'scripts/install.cjs',
  'server/index.js',
  'server/index.cjs',
  'server/catalog.cjs',
  'server/router.cjs',
  'server/executor.cjs',
  'server/orchestrator.cjs',
  'server/ledger.cjs',
  'skills/cost-router/SKILL.md',
]
const entries = [
  { source: '.codebuddy-plugin/marketplace.json', target: '.codebuddy-plugin/marketplace.json' },
  ...pluginFiles.map((file) => ({ source: file, target: `plugins/workbuddy-cost-router/${file}` })),
]

for (const entry of entries) {
  if (!fs.existsSync(path.join(root, entry.source))) throw new Error(`打包缺少文件：${entry.source}`)
}
if (fs.existsSync(output)) fs.rmSync(output, { force: true })

if (process.platform === 'win32') {
  const pairs = entries.map((entry) => `@('${entry.source.replace(/'/g, "''")}','${entry.target.replace(/'/g, "''")}')`).join(',')
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::Open('${output.replace(/'/g, "''")}',[System.IO.Compression.ZipArchiveMode]::Create); $root='${root.replace(/'/g, "''")}'; $pairs=@(${pairs}); foreach($pair in $pairs){ $src=Join-Path $root $pair[0]; $entry=[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$src,$pair[1],[System.IO.Compression.CompressionLevel]::Optimal) }; $zip.Dispose()`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' })
} else {
  const staging = path.join(root, '.pack-staging')
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  for (const entry of entries) {
    const destination = path.join(staging, entry.target)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(root, entry.source), destination)
  }
  execFileSync('zip', ['-q', '-r', output, '.'], { cwd: staging, stdio: 'inherit' })
  fs.rmSync(staging, { recursive: true, force: true })
}

console.log(`已生成 ${output}`)
