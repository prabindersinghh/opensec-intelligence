/**
 * MemoryManager — persistent cross-session learning for cmdr.
 *
 * Manages MEMORY.md files at two scopes:
 *   - Project: .cmdr/MEMORY.md (per-repo knowledge)
 *   - User:    ~/.cmdr/MEMORY.md (global patterns, preferences)
 *
 * Memory is injected into the system prompt each session so the agent
 * retains learned patterns, project conventions, and user preferences.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'

export interface MemoryScope {
  readonly scope: 'project' | 'user'
  readonly path: string
  content: string
}

const MAX_MEMORY_SIZE = 8192  // chars — prevent context bloat

export class MemoryManager {
  private projectDir: string
  private caches: Map<string, string> = new Map()

  constructor(projectDir: string) {
    this.projectDir = projectDir
  }

  /** Path to the project-level memory file. */
  get projectMemoryPath(): string {
    return join(this.projectDir, '.opensec', 'MEMORY.md')
  }

  /** Path to the user-level memory file. */
  get userMemoryPath(): string {
    return join(homedir(), '.opensec', 'MEMORY.md')
  }

  /** Read a memory file, returning empty string if not found. */
  private async readMemoryFile(path: string): Promise<string> {
    try {
      const content = await readFile(path, 'utf-8')
      this.caches.set(path, content)
      return content
    } catch {
      return ''
    }
  }

  /** Write content to a memory file, creating directories as needed. */
  private async writeMemoryFile(path: string, content: string): Promise<void> {
    // Enforce size limit
    const trimmed = content.length > MAX_MEMORY_SIZE
      ? content.slice(0, MAX_MEMORY_SIZE) + '\n\n<!-- Memory truncated at 8KB limit -->\n'
      : content
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, trimmed, 'utf-8')
    this.caches.set(path, trimmed)
  }

  /** Load all memory scopes. */
  async loadAll(): Promise<MemoryScope[]> {
    const [project, user] = await Promise.all([
      this.readMemoryFile(this.projectMemoryPath),
      this.readMemoryFile(this.userMemoryPath),
    ])

    const scopes: MemoryScope[] = []
    if (user) scopes.push({ scope: 'user', path: this.userMemoryPath, content: user })
    if (project) scopes.push({ scope: 'project', path: this.projectMemoryPath, content: project })
    return scopes
  }

  /** Get combined memory as a prompt-injectable string. */
  async getMemoryPrompt(): Promise<string> {
    const scopes = await this.loadAll()
    if (scopes.length === 0) return ''

    const parts: string[] = []
    for (const scope of scopes) {
      if (scope.content.trim()) {
        parts.push(`<memory scope="${scope.scope}">\n${scope.content.trim()}\n</memory>`)
      }
    }
    return parts.join('\n\n')
  }

  /** Read memory for a given scope. */
  async read(scope: 'project' | 'user'): Promise<string> {
    const path = scope === 'project' ? this.projectMemoryPath : this.userMemoryPath
    return this.readMemoryFile(path)
  }

  /** Write (overwrite) memory for a given scope. */
  async write(scope: 'project' | 'user', content: string): Promise<void> {
    const path = scope === 'project' ? this.projectMemoryPath : this.userMemoryPath
    await this.writeMemoryFile(path, content)
  }

  /** Append to memory for a given scope (most common operation). */
  async append(scope: 'project' | 'user', entry: string): Promise<void> {
    const existing = await this.read(scope)
    const timestamp = new Date().toISOString().split('T')[0]
    const newContent = existing
      ? `${existing.trimEnd()}\n\n## ${timestamp}\n${entry.trim()}\n`
      : `# OpenSec Memory\n\n## ${timestamp}\n${entry.trim()}\n`
    await this.write(scope, newContent)
  }
}
