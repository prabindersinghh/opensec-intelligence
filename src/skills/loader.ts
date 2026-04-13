/**
 * SkillsLoader — discovers and loads skills from bundled, user, and project directories.
 *
 * Skill priority: project > user > bundled (last write wins on name conflict).
 */

import { readFileSync, readdirSync, existsSync, statSync, cpSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  name: string
  description: string
  instructions: string
  scripts: string[]
  references: string[]
  source: 'bundled' | 'user' | 'project'
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BUNDLED_SKILLS_DIR = join(import.meta.dirname ?? '.', '..', '..', 'skills')
const USER_SKILLS_DIR = join(homedir(), '.cmdr', 'skills')

function projectSkillsDir(projectRoot: string): string {
  return join(projectRoot, '.cmdr', 'skills')
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal — avoids external dep)
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
// SkillsLoader
// ---------------------------------------------------------------------------

export class SkillsLoader {
  private skills = new Map<string, Skill>()

  /** Load skills from all three sources (project > user > bundled priority). */
  loadAll(projectRoot: string): void {
    this.skills.clear()

    // Load in order: bundled first, then user, then project (later overwrites earlier)
    this.loadFrom(BUNDLED_SKILLS_DIR, 'bundled')
    this.loadFrom(USER_SKILLS_DIR, 'user')
    this.loadFrom(projectSkillsDir(projectRoot), 'project')
  }

  /** Get a specific skill by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name.toLowerCase())
  }

  /** List all available skills. */
  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  /** Find skills relevant to a query (search name + description). */
  search(query: string): Skill[] {
    const lower = query.toLowerCase()
    return this.list().filter(
      s => s.name.toLowerCase().includes(lower) || s.description.toLowerCase().includes(lower),
    )
  }

  /** Install a skill from a local path into ~/.cmdr/skills/. */
  install(sourcePath: string): string {
    if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
      throw new Error(`Skill path not found or not a directory: ${sourcePath}`)
    }

    const skillName = basename(sourcePath)
    const dest = join(USER_SKILLS_DIR, skillName)
    mkdirSync(dest, { recursive: true })
    cpSync(sourcePath, dest, { recursive: true })
    return skillName
  }

  /** Scaffold a new skill in .cmdr/skills/<name>. */
  scaffold(projectRoot: string, name: string): string {
    const dir = join(projectSkillsDir(projectRoot), name)
    if (existsSync(dir)) throw new Error(`Skill already exists: ${name}`)

    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })

    const template = `---
name: ${name}
description: "TODO: describe what this skill does"
---

# ${name}

## Instructions

TODO: Write instructions for the agent here.
`
    const { writeFileSync } = require('fs') as typeof import('fs')
    writeFileSync(join(dir, 'SKILL.md'), template)
    return dir
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private loadFrom(dir: string, source: Skill['source']): void {
    if (!existsSync(dir)) return

    let entries: string[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      return
    }

    for (const entry of entries) {
      const skillDir = join(dir, entry)
      const skillMdPath = join(skillDir, 'SKILL.md')

      if (!existsSync(skillMdPath)) continue

      try {
        const raw = readFileSync(skillMdPath, 'utf-8')
        const { meta, body } = parseFrontmatter(raw)

        const scripts = this.findFiles(skillDir, 'scripts')
        const references = this.findFiles(skillDir, '').filter(
          f => f.endsWith('.md') && !f.endsWith('SKILL.md'),
        )

        this.skills.set(entry.toLowerCase(), {
          name: meta.name || entry,
          description: meta.description || '',
          instructions: body.trim(),
          scripts,
          references,
          source,
        })
      } catch {
        // Skip malformed skills
      }
    }
  }

  private findFiles(base: string, subdir: string): string[] {
    const dir = subdir ? join(base, subdir) : base
    if (!existsSync(dir)) return []

    try {
      return readdirSync(dir)
        .filter(f => !statSync(join(dir, f)).isDirectory())
        .map(f => join(dir, f))
    } catch {
      return []
    }
  }
}
