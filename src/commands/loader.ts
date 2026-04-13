/**
 * Custom command loader and executor.
 *
 * Custom commands are markdown files in .cmdr/commands/ or ~/.cmdr/commands/
 * with YAML frontmatter (name, description) and template body.
 *
 * Template variables:
 *   {{args}}     — user arguments passed after the command name
 *   @{path}      — inlined file contents
 *   !{command}   — inlined shell output
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomCommand {
  name: string
  description: string
  template: string
  source: 'user' | 'project'
  filePath: string
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const USER_COMMANDS_DIR = join(homedir(), '.opensec', 'commands')

function projectCommandsDir(projectRoot: string): string {
  return join(projectRoot, '.opensec', 'commands')
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).trim()
      const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
      meta[key] = val
    }
  }
  return { meta, body: match[2] }
}

// ---------------------------------------------------------------------------
// CommandLoader
// ---------------------------------------------------------------------------

export class CommandLoader {
  private commands = new Map<string, CustomCommand>()

  /** Load commands from user and project directories. Project overrides user. */
  loadAll(projectRoot: string): void {
    this.commands.clear()
    this.loadDir(USER_COMMANDS_DIR, 'user')
    this.loadDir(projectCommandsDir(projectRoot), 'project')
  }

  private loadDir(dir: string, source: 'user' | 'project'): void {
    if (!existsSync(dir)) return

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue

      const filePath = join(dir, file)
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const { meta, body } = parseFrontmatter(raw)

        const name = meta.name || basename(file, '.md')
        const description = meta.description || ''

        this.commands.set(name, {
          name,
          description,
          template: body.trim(),
          source,
          filePath,
        })
      } catch {
        // Skip unparseable files
      }
    }
  }

  /** Get a custom command by name. */
  get(name: string): CustomCommand | undefined {
    return this.commands.get(name)
  }

  /** Check if a custom command exists. */
  has(name: string): boolean {
    return this.commands.has(name)
  }

  /** List all commands. */
  list(): CustomCommand[] {
    return Array.from(this.commands.values())
  }

  /** Resolve template variables and return the expanded prompt. */
  resolve(command: CustomCommand, args: string, cwd: string): string {
    let result = command.template

    // {{args}} — user arguments
    result = result.replace(/\{\{args\}\}/g, args)

    // @{path} — inline file contents
    result = result.replace(/@\{([^}]+)\}/g, (_match, filePath: string) => {
      const resolved = join(cwd, filePath.trim())
      try {
        return readFileSync(resolved, 'utf-8')
      } catch {
        return `[Error: could not read ${filePath}]`
      }
    })

    // !{command} — inline shell output
    result = result.replace(/!\{([^}]+)\}/g, (_match, cmd: string) => {
      try {
        return execSync(cmd.trim(), { cwd, timeout: 10_000, encoding: 'utf-8' }).trim()
      } catch {
        return `[Error: command failed: ${cmd}]`
      }
    })

    return result
  }

  /** Create a new command scaffold. */
  scaffold(name: string, projectRoot: string): string {
    const dir = projectCommandsDir(projectRoot)
    mkdirSync(dir, { recursive: true })

    const filePath = join(dir, `${name}.md`)
    const content = `---
name: ${name}
description: Describe what this command does
---

You are helping the user with: {{args}}

Context:
@{src/main.ts}
`
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  }
}
