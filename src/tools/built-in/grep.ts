/**
 * Built-in grep tool — search files with regex, ripgrep-first with Node fallback.
 */

import { spawn } from 'child_process'
import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const grepTool = defineTool({
  name: 'grep',
  description:
    'Search for a regex pattern in files. Uses ripgrep (rg) if available, ' +
    'otherwise falls back to a Node.js implementation. Returns matching lines with file paths.',

  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for.'),
    path: z.string().optional().describe('Directory or file to search in. Defaults to cwd.'),
    include: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts").'),
  }),

  execute: async (input, context) => {
    const searchPath = input.path ?? context.cwd ?? process.cwd()

    try {
      const result = await tryRipgrep(input.pattern, searchPath, input.include)
      return { data: result || '(no matches)' }
    } catch {
      // ripgrep not available, use Node fallback
      try {
        const result = await nodeGrep(input.pattern, searchPath, input.include)
        return { data: result || '(no matches)' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { data: msg, isError: true }
      }
    }
  },
})

function tryRipgrep(pattern: string, searchPath: string, include?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--no-heading', '--line-number', '--color', 'never', '-e', pattern]
    if (include) args.push('--glob', include)
    args.push(searchPath)

    const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(Buffer.concat(chunks).toString('utf-8').trim())
      } else {
        reject(new Error(`rg exited with code ${code}`))
      }
    })
    child.on('error', reject)
  })
}

async function nodeGrep(pattern: string, searchPath: string, include?: string): Promise<string> {
  const regex = new RegExp(pattern, 'gi')
  const includeRegex = include ? globToRegex(include) : null
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (includeRegex && !includeRegex.test(entry.name)) continue
        try {
          const content = await readFile(full, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = relative(searchPath, full)
              results.push(`${rel}:${i + 1}:${lines[i]}`)
            }
            regex.lastIndex = 0
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
    if (results.length > 200) return
  }

  const info = await stat(searchPath)
  if (info.isFile()) {
    const content = await readFile(searchPath, 'utf-8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push(`${searchPath}:${i + 1}:${lines[i]}`)
      }
      regex.lastIndex = 0
    }
  } else {
    await walk(searchPath)
  }

  return results.slice(0, 200).join('\n')
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}
