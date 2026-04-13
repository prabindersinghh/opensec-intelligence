/**
 * Agent Registry — discovers and manages subagent definitions from markdown files.
 *
 * Loading priority (project overrides user overrides bundled):
 *   .cmdr/agents/*.md          — project-level (shared with team)
 *   ~/.cmdr/agents/*.md        — user-level (personal agents)
 *   src/agents/bundled/*.md    — bundled with cmdr (shipped defaults)
 */

import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string
  description: string
  kind: 'local' | 'remote'
  tools: string[]
  model: string | null       // null = inherit from main agent
  temperature: number
  maxTurns: number
  systemPrompt: string       // The markdown body after frontmatter
  source: 'bundled' | 'user' | 'project'
  filePath: string
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (lightweight, no external deps)
// ---------------------------------------------------------------------------

interface RawFrontmatter {
  name?: string
  description?: string
  kind?: string
  tools?: string[]
  model?: string | null
  temperature?: number
  max_turns?: number
}

function parseFrontmatter(content: string): { frontmatter: RawFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlBlock = match[1]
  const body = match[2].trim()
  const frontmatter: Record<string, unknown> = {}

  let currentKey = ''
  let inArray = false
  let arrayItems: string[] = []

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Array item
    if (inArray && trimmed.startsWith('- ')) {
      arrayItems.push(trimmed.slice(2).trim())
      continue
    }

    // End previous array
    if (inArray) {
      frontmatter[currentKey] = arrayItems
      inArray = false
      arrayItems = []
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const rawValue = trimmed.slice(colonIdx + 1).trim()

    if (rawValue === '' || rawValue === '[]') {
      // Could be start of an array or empty value
      currentKey = key
      if (rawValue === '[]') {
        frontmatter[key] = []
      } else {
        inArray = true
        arrayItems = []
      }
      continue
    }

    // Parse value
    if (rawValue === 'null' || rawValue === '~') {
      frontmatter[key] = null
    } else if (rawValue === 'true') {
      frontmatter[key] = true
    } else if (rawValue === 'false') {
      frontmatter[key] = false
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      frontmatter[key] = Number(rawValue)
    } else {
      // Strip quotes
      frontmatter[key] = rawValue.replace(/^["']|["']$/g, '')
    }
  }

  // Flush last array
  if (inArray) {
    frontmatter[currentKey] = arrayItems
  }

  return { frontmatter: frontmatter as RawFrontmatter, body }
}

// ---------------------------------------------------------------------------
// Agent file parser
// ---------------------------------------------------------------------------

function parseAgentFile(
  content: string,
  filePath: string,
  source: 'bundled' | 'user' | 'project',
): AgentDefinition | null {
  const { frontmatter, body } = parseFrontmatter(content)

  if (!frontmatter.name || !frontmatter.description) {
    return null
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    kind: (frontmatter.kind as 'local' | 'remote') ?? 'local',
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    model: frontmatter.model === undefined ? null : frontmatter.model,
    temperature: frontmatter.temperature ?? 0.3,
    maxTurns: frontmatter.max_turns ?? 15,
    systemPrompt: body,
    source,
    filePath,
  }
}

// ---------------------------------------------------------------------------
// Directory loader
// ---------------------------------------------------------------------------

async function loadAgentsFromDir(
  dir: string,
  source: 'bundled' | 'user' | 'project',
): Promise<AgentDefinition[]> {
  if (!existsSync(dir)) return []

  const agents: AgentDefinition[] = []
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const filePath = join(dir, entry)
      const content = await readFile(filePath, 'utf-8')
      const def = parseAgentFile(content, filePath, source)
      if (def) agents.push(def)
    }
  } catch {
    // Directory not readable — skip silently
  }
  return agents
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>()

  /** Load all agent definitions from all three source directories. */
  async loadAll(projectRoot: string): Promise<void> {
    const __dirname = dirname(fileURLToPath(import.meta.url))

    // Load in priority order: bundled first, then user, then project
    // Later sources override earlier ones (project > user > bundled)
    const bundledDir = join(__dirname, 'bundled')
    const userDir = join(homedir(), '.opensec', 'agents')
    const projectDir = join(projectRoot, '.opensec', 'agents')

    const bundled = await loadAgentsFromDir(bundledDir, 'bundled')
    const user = await loadAgentsFromDir(userDir, 'user')
    const project = await loadAgentsFromDir(projectDir, 'project')

    // Register in priority order — later registrations override
    for (const def of [...bundled, ...user, ...project]) {
      this.agents.set(def.name, def)
    }
  }

  /** Get a specific agent by name. */
  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name)
  }

  /** List all registered agents. */
  list(): AgentDefinition[] {
    return Array.from(this.agents.values())
  }

  /** Check if an agent exists. */
  has(name: string): boolean {
    return this.agents.has(name)
  }

  /** Register a runtime-defined agent (for programmatic use). */
  register(def: AgentDefinition): void {
    this.agents.set(def.name, def)
  }

  /** Unregister an agent. */
  unregister(name: string): void {
    this.agents.delete(name)
  }
}
