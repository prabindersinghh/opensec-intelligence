#!/usr/bin/env node
/**
 * Generate README screenshot assets (Phase 3).
 *
 * Runs the deterministic scanner on the bundled vulnerable app and renders
 * crisp SVG "screenshots" (table + diffs + demo banner) into docs/screenshots/.
 * SVGs need no headless browser and render natively on GitHub.
 *
 * If `puppeteer` is installed, it also rasterizes PNGs alongside the SVGs.
 *
 * Usage:  npm run build && node scripts/generate-readme-assets.js
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'screenshots')

async function load(mod) {
  try {
    return await import(pathToFileURL(path.join(root, 'dist', 'src', 'security', mod)).href)
  } catch (e) {
    console.error(`\n  ✗ Could not import dist/src/security/${mod}. Run \`npm run build\` first.\n`)
    throw e
  }
}

// Illustrative deterministic fixes for the demo's signature findings, so the
// diff assets are reproducible without requiring a running LLM.
const DEMO_FIXES = {
  'Command Injection': ["  execFile('ping', ['-c', '1', req.query.host], (err, stdout) => {"],
  'Hardcoded Password': ['  password: process.env.DB_PASSWORD,'],
  'SQL Injection Risk': ['    db.query(\'SELECT * FROM users WHERE id = ?\', [id], (err, rows) => {'],
  'CORS Wildcard': ["    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS)"],
}

async function main() {
  const { runScanner } = await load('scanner.js')
  const { renderTableSvg, renderDiffSvg, renderDemoBannerSvg } = await load('svg.js')
  const { buildDiff } = await load('screenshot.js')

  const target = path.join(root, 'demo', 'vulnerable-app')
  const result = await runScanner({ targetPath: target, version: '3.1.0', persist: false })
  console.log(`  Scanned demo app: ${result.findings.length} findings`)

  await fs.mkdir(outDir, { recursive: true })

  // 1. Findings table.
  await write('scan-results.svg', renderTableSvg(result.findings))

  // 2. Demo banner.
  await write('demo-banner.svg', renderDemoBannerSvg(result.findings.length, 1))

  // 3. Diff assets for the most illustrative findings.
  const pick = (rule) => result.findings.find((f) => f.ruleName === rule)
  const targets = [
    { finding: pick('Command Injection'), name: 'diff-critical.svg' },
    { finding: pick('Hardcoded Password'), name: 'diff-high.svg' },
  ]
  for (const { finding, name } of targets) {
    if (!finding) continue
    const fileLines = (await fs.readFile(path.join(target, finding.file), 'utf8')).split(/\r?\n/)
    const fixed = DEMO_FIXES[finding.ruleName] ?? ['  /* fixed */']
    const diff = buildDiff(fileLines, finding.line, 1, fixed)
    await write(name, renderDiffSvg(finding, diff))
  }

  // 4. Optional PNGs via puppeteer if installed.
  await maybePngs()

  console.log(`\n  ✓ Assets written to ${path.relative(root, outDir)}/\n`)
}

async function write(name, content) {
  await fs.writeFile(path.join(outDir, name), content, 'utf8')
  console.log(`    + ${name}`)
}

async function maybePngs() {
  let puppeteer
  try {
    puppeteer = (await import('puppeteer')).default
  } catch {
    console.log('    (puppeteer not installed — skipping PNG rasterization, SVGs are enough for the README)')
    return
  }
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  for (const svg of ['scan-results', 'diff-critical', 'diff-high', 'demo-banner']) {
    const svgPath = path.join(outDir, `${svg}.svg`)
    let data
    try {
      data = await fs.readFile(svgPath, 'utf8')
    } catch {
      continue
    }
    const page = await browser.newPage()
    await page.setContent(`<body style="margin:0">${data}</body>`, { waitUntil: 'load' })
    const el = await page.$('svg')
    if (el) await el.screenshot({ path: path.join(outDir, `${svg}.png`) })
    await page.close()
    console.log(`    + ${svg}.png`)
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
