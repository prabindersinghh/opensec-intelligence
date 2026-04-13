/**
 * ProjectContext — auto-discover project language, framework, and structure.
 */

import { readFile, stat, readdir } from 'fs/promises'
import { join } from 'path'
import { spawn } from 'child_process'
import { homedir } from 'os'
import type { ProjectContext } from '../core/types.js'

export async function discoverProject(rootDir: string): Promise<ProjectContext> {
  const context: ProjectContext = {
    rootDir,
    language: 'unknown',
    relevantFiles: [],
  }

  const checks = await Promise.allSettled([
    fileExists(join(rootDir, 'package.json')),
    fileExists(join(rootDir, 'tsconfig.json')),
    fileExists(join(rootDir, 'Cargo.toml')),
    fileExists(join(rootDir, 'pyproject.toml')),
    fileExists(join(rootDir, 'requirements.txt')),
    fileExists(join(rootDir, 'go.mod')),
    fileExists(join(rootDir, 'pom.xml')),
    fileExists(join(rootDir, 'build.gradle')),
    fileExists(join(rootDir, '.git')),
    fileExists(join(rootDir, 'Dockerfile')),
  ])

  const exists = checks.map(c => c.status === 'fulfilled' && c.value)

  // Language detection
  if (exists[1]) {
    context.language = 'typescript'
    context.packageManager = 'npm'
  } else if (exists[0]) {
    context.language = 'javascript'
    context.packageManager = 'npm'
  }
  if (exists[2]) { context.language = 'rust'; context.packageManager = 'cargo' }
  if (exists[3] || exists[4]) { context.language = 'python'; context.packageManager = 'pip' }
  if (exists[5]) { context.language = 'go'; context.packageManager = 'go' }
  if (exists[6] || exists[7]) { context.language = 'java'; context.packageManager = 'maven' }

  // Framework detection from package.json
  if (exists[0]) {
    try {
      const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['next']) context.framework = 'next.js'
      else if (deps['nuxt']) context.framework = 'nuxt'
      else if (deps['@angular/core']) context.framework = 'angular'
      else if (deps['vue']) context.framework = 'vue'
      else if (deps['react']) context.framework = 'react'
      else if (deps['express']) context.framework = 'express'
      else if (deps['fastify']) context.framework = 'fastify'
      else if (deps['hono']) context.framework = 'hono'

      // Detect package manager
      if (await fileExists(join(rootDir, 'pnpm-lock.yaml'))) context.packageManager = 'pnpm'
      else if (await fileExists(join(rootDir, 'yarn.lock'))) context.packageManager = 'yarn'
      else if (await fileExists(join(rootDir, 'bun.lockb'))) context.packageManager = 'bun'
    } catch {
      // ignore parse errors
    }
  }

  // Git branch
  if (exists[8]) {
    try {
      context.gitBranch = await getGitBranch(rootDir)
    } catch {
      // not a git repo or git not available
    }
  }

  // CMDR.md — hierarchical context files
  // Priority: global (~/.cmdr/CMDR.md) < project root < subdirectories (deeper = higher)
  const instructionParts: string[] = []

  // 1. Global user-level CMDR.md
  try {
    const globalMd = await readFile(join(homedir(), '.cmdr', 'CMDR.md'), 'utf-8')
    if (globalMd.trim()) instructionParts.push(`<!-- ~/.cmdr/CMDR.md -->\n${globalMd.trim()}`)
  } catch { /* no global CMDR.md */ }

  // 2. Project root CMDR.md and .cmdr/instructions.md
  try {
    const cmdrMd = await readFile(join(rootDir, 'CMDR.md'), 'utf-8')
    if (cmdrMd.trim()) instructionParts.push(`<!-- CMDR.md -->\n${cmdrMd.trim()}`)
  } catch { /* no CMDR.md */ }
  try {
    const dotCmdrMd = await readFile(join(rootDir, '.cmdr', 'instructions.md'), 'utf-8')
    if (dotCmdrMd.trim()) instructionParts.push(dotCmdrMd.trim())
  } catch { /* no .cmdr/instructions.md */ }

  // 3. Scan top-level subdirectories for scoped CMDR.md files
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      try {
        const subMd = await readFile(join(rootDir, entry.name, 'CMDR.md'), 'utf-8')
        if (subMd.trim()) instructionParts.push(`<!-- ${entry.name}/CMDR.md -->\n${subMd.trim()}`)
      } catch { /* no sub CMDR.md */ }
    }
  } catch { /* ignore readdir errors */ }

  // Process @import syntax: lines like "@shared/standards.md"
  const processed = await resolveImports(instructionParts.join('\n\n'), rootDir)
  if (processed.trim()) {
    context.cmdrInstructions = processed
  }

  // Key files
  try {
    const entries = await readdir(rootDir)
    const keyFiles = entries.filter(f =>
      /^(readme|license|changelog|makefile|dockerfile|docker-compose)/i.test(f) ||
      /\.(md|toml|yaml|yml|json)$/i.test(f)
    ).slice(0, 20)
    context.relevantFiles = keyFiles
  } catch {
    // ignore
  }

  return context
}

/** Resolve @path import directives in CMDR.md content. */
async function resolveImports(content: string, rootDir: string): Promise<string> {
  const lines = content.split('\n')
  const result: string[] = []

  for (const line of lines) {
    const importMatch = line.match(/^@(\S+\.md)\s*$/)
    if (importMatch) {
      const importPath = join(rootDir, importMatch[1])
      try {
        const imported = await readFile(importPath, 'utf-8')
        result.push(`<!-- @${importMatch[1]} -->`)
        result.push(imported.trim())
      } catch {
        result.push(`<!-- @${importMatch[1]} (not found) -->`)
      }
    } else {
      result.push(line)
    }
  }

  return result.join('\n')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function getGitBranch(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['branch', '--show-current'], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf-8').trim())
      else reject(new Error('git failed'))
    })
    child.on('error', reject)
  })
}
