/**
 * PromptBuilder — modular prompt construction pipeline.
 *
 * Each module has a priority (lower = earlier) and a static flag.
 * Static modules are identical across turns, enabling Ollama KV cache reuse.
 */

import type { ProjectContext } from '../core/types.js'
import { PromptCache, type CacheStats } from './prompt-cache.js'

/* ── Module interface ──────────────────────────────────────────────── */

export interface PromptModule {
  id: string
  content: string
  priority: number       // lower = earlier in prompt
  isStatic: boolean      // static modules never change (better for KV cache)
}

/* ── Priority constants ────────────────────────────────────────────── */

export const PROMPT_PRIORITIES = {
  ROLE: 10,
  TOOL_POLICY: 20,
  PROJECT_INSTRUCTIONS: 30,
  SKILLS: 40,
  PROJECT_CONTEXT: 50,
  RUNTIME_CONTEXT: 60,
  CONVERSATION_STATE: 70,
} as const

/* ── PromptBuilder class ───────────────────────────────────────────── */

export class PromptBuilder {
  private modules = new Map<string, PromptModule>()
  private readonly cache = new PromptCache()

  addModule(mod: PromptModule): void {
    this.modules.set(mod.id, mod)
  }

  updateModule(id: string, content: string): void {
    const existing = this.modules.get(id)
    if (existing) {
      existing.content = content
    }
  }

  removeModule(id: string): void {
    this.modules.delete(id)
  }

  build(): string {
    const sorted = [...this.modules.values()]
      .sort((a, b) => a.priority - b.priority)

    // Track static prefix for KV cache hit detection
    const staticPrefix = sorted.filter(m => m.isStatic).map(m => m.content).filter(c => c.length > 0).join('\n\n')
    this.cache.checkPrefix(staticPrefix)

    return sorted
      .map(m => m.content)
      .filter(c => c.length > 0)
      .join('\n\n')
  }

  /** Returns only static modules — for KV cache prefix estimation. */
  getStaticPrefix(): string {
    return [...this.modules.values()]
      .filter(m => m.isStatic)
      .sort((a, b) => a.priority - b.priority)
      .map(m => m.content)
      .filter(c => c.length > 0)
      .join('\n\n')
  }

  /** Get prompt cache hit/miss statistics. */
  getCacheStats(): CacheStats {
    return this.cache.getStats()
  }
}

/* ── Convenience: backward-compatible buildSystemPrompt ────────────── */

export interface PromptBuildOptions {
  basePrompt: string
  projectContext: ProjectContext
  model: string
  /** Persistent memory content (from MemoryManager). */
  memoryPrompt?: string
}

export function buildSystemPrompt(options: PromptBuildOptions): string {
  const builder = new PromptBuilder()
  const ctx = options.projectContext

  // 10: Role — base system prompt (STATIC)
  builder.addModule({
    id: 'role',
    content: options.basePrompt,
    priority: PROMPT_PRIORITIES.ROLE,
    isStatic: true,
  })

  // 30: Project instructions — CMDR.md (STATIC per session)
  if (ctx.cmdrInstructions) {
    builder.addModule({
      id: 'project_instructions',
      content: `<project_instructions>\nThe user has provided the following instructions for this project. Follow them unless they conflict with safety:\n\n${ctx.cmdrInstructions}\n</project_instructions>`,
      priority: PROMPT_PRIORITIES.PROJECT_INSTRUCTIONS,
      isStatic: true,
    })
  }

  // 40: Skills (STATIC per turn)
  if (ctx.activeSkills && ctx.activeSkills.length > 0) {
    const skillBlocks = ctx.activeSkills.map(skill => {
      const scriptNote = skill.scripts.length > 0
        ? `\n\nHelper scripts available at:\n${skill.scripts.map(s => `  - ${s}`).join('\n')}`
        : ''
      return `<skill name="${skill.name}">\n${skill.instructions}${scriptNote}\n</skill>`
    })
    builder.addModule({
      id: 'skills',
      content: skillBlocks.join('\n\n'),
      priority: PROMPT_PRIORITIES.SKILLS,
      isStatic: true,
    })
  }

  // 50: Project context (STATIC per session)
  const contextParts: string[] = []
  if (ctx.language !== 'unknown') contextParts.push(`Language: ${ctx.language}`)
  if (ctx.framework) contextParts.push(`Framework: ${ctx.framework}`)
  if (ctx.packageManager) contextParts.push(`Package manager: ${ctx.packageManager}`)

  if (contextParts.length > 0) {
    builder.addModule({
      id: 'project_context',
      content: `Project context:\n${contextParts.join('\n')}\nRoot: ${ctx.rootDir}`,
      priority: PROMPT_PRIORITIES.PROJECT_CONTEXT,
      isStatic: true,
    })
  }

  // 60: Runtime context — dynamic per turn (git branch, etc.)
  const runtimeParts: string[] = []
  if (ctx.gitBranch) runtimeParts.push(`Git branch: ${ctx.gitBranch}`)

  if (runtimeParts.length > 0) {
    builder.addModule({
      id: 'runtime_context',
      content: `Runtime:\n${runtimeParts.join('\n')}`,
      priority: PROMPT_PRIORITIES.RUNTIME_CONTEXT,
      isStatic: false,
    })
  }

  // 25: Persistent memory — cross-session learned context (STATIC per session)
  if (options.memoryPrompt) {
    builder.addModule({
      id: 'memory',
      content: `<persistent_memory>\nThese are your saved notes from previous sessions. Use them to inform your work. Update memory with memory_write when you learn something new about this project.\n\n${options.memoryPrompt}\n</persistent_memory>`,
      priority: 25,  // After role, before project instructions
      isStatic: true,
    })
  }

  return builder.build()
}
