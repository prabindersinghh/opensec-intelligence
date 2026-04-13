/**
 * Built-in glob tool — find files by pattern.
 */

import { readdir, stat } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const globTool = defineTool({
  name: 'glob',
  description:
    'Find files matching a glob pattern. Useful for discovering project structure. ' +
    'Skips node_modules and hidden directories by default.',

  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.js").'),
    path: z.string().optional().describe('Root directory to search from. Defaults to project root.'),
  }),

  execute: async (input, context) => {
    // Always resolve to an absolute path, preferring context.cwd (project root) over process.cwd()
    const root = resolve(input.path ?? context.cwd ?? process.cwd())
    const regex = globToRegex(input.pattern)
    const matches: string[] = []

    async function walk(dir: string): Promise<void> {
      if (matches.length > 500) return
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          const full = join(dir, entry.name)
          const rel = relative(root, full)
          if (entry.isDirectory()) {
            if (regex.test(rel + '/')) matches.push(rel + '/')
            await walk(full)
          } else if (entry.isFile() && regex.test(rel)) {
            matches.push(rel)
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    await walk(root)
    return { data: matches.slice(0, 500).join('\n') || '(no matches)' }
  },
})

function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Handle glob ? FIRST (before we generate regex ? quantifiers)
    .replace(/\?/g, '[^/]')
    // Handle **/ (match zero or more directories)
    .replace(/\*\*\//g, '(.+/)?')
    // Handle remaining ** (e.g. trailing /**)
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${pattern}$`, 'i')
}
