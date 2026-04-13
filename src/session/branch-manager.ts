/**
 * BranchManager — fork, switch, and merge conversation branches.
 *
 * Branches are persisted as JSON files under:
 *   ~/.cmdr/sessions/{sessionId}/branches/{branch-id}.json
 *
 * Each branch stores a snapshot of the conversation at fork time,
 * plus any messages added after the fork.
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { LLMMessage } from '../core/types.js'

const CMDR_DIR = join(homedir(), '.cmdr')
const SESSIONS_DIR = join(CMDR_DIR, 'sessions')

export interface Branch {
  readonly id: string
  readonly name: string
  readonly model: string
  readonly messages: LLMMessage[]
  readonly messageCount: number
  readonly createdAt: string
  readonly parentBranch?: string
  readonly forkPoint: number
}

function branchDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId, 'branches')
}

export class BranchManager {
  private sessionId: string
  private currentBranchId: string | null = null

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  get activeBranch(): string | null {
    return this.currentBranchId
  }

  /** Fork the conversation at the current point. */
  async fork(name: string, messages: LLMMessage[], model: string, parentBranch?: string): Promise<Branch> {
    const dir = branchDir(this.sessionId)
    await mkdir(dir, { recursive: true })

    const id = `br_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const branch: Branch = {
      id,
      name,
      model,
      messages: [...messages],
      messageCount: messages.length,
      createdAt: new Date().toISOString(),
      parentBranch,
      forkPoint: messages.length,
    }

    await writeFile(join(dir, `${id}.json`), JSON.stringify(branch, null, 2), 'utf-8')
    this.currentBranchId = id
    return branch
  }

  /** Switch to a branch by ID. Returns the branch data or null. */
  async switch(id: string): Promise<Branch | null> {
    const filePath = join(branchDir(this.sessionId), `${id}.json`)
    if (!existsSync(filePath)) return null

    try {
      const data = await readFile(filePath, 'utf-8')
      const branch = JSON.parse(data) as Branch
      this.currentBranchId = id
      return branch
    } catch {
      return null
    }
  }

  /** List all branches for this session, newest first. */
  async list(): Promise<Omit<Branch, 'messages'>[]> {
    const dir = branchDir(this.sessionId)
    if (!existsSync(dir)) return []

    try {
      const files = await readdir(dir)
      const branches: Omit<Branch, 'messages'>[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const data = await readFile(join(dir, file), 'utf-8')
          const br = JSON.parse(data) as Branch
          branches.push({
            id: br.id,
            name: br.name,
            model: br.model,
            messageCount: br.messageCount,
            createdAt: br.createdAt,
            parentBranch: br.parentBranch,
            forkPoint: br.forkPoint,
          })
        } catch {
          // skip malformed files
        }
      }

      return branches.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    } catch {
      return []
    }
  }

  /** Merge branch messages onto a target (appends after fork point). */
  async merge(sourceId: string, targetMessages: LLMMessage[]): Promise<LLMMessage[] | null> {
    const source = await this.switch(sourceId)
    if (!source) return null

    // Messages added after fork point
    const newMessages = source.messages.slice(source.forkPoint)
    return [...targetMessages, ...newMessages]
  }

  /** Delete a branch by ID. */
  async delete(id: string): Promise<boolean> {
    const filePath = join(branchDir(this.sessionId), `${id}.json`)
    if (!existsSync(filePath)) return false

    try {
      await unlink(filePath)
      if (this.currentBranchId === id) this.currentBranchId = null
      return true
    } catch {
      return false
    }
  }

  /** Save the current state of a branch (update messages). */
  async update(id: string, messages: LLMMessage[], model: string): Promise<boolean> {
    const filePath = join(branchDir(this.sessionId), `${id}.json`)
    if (!existsSync(filePath)) return false

    try {
      const data = await readFile(filePath, 'utf-8')
      const branch = JSON.parse(data) as Branch
      const updated: Branch = {
        ...branch,
        messages: [...messages],
        messageCount: messages.length,
        model,
      }
      await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8')
      return true
    } catch {
      return false
    }
  }
}
