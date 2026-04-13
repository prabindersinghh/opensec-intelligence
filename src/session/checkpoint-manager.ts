/**
 * CheckpointManager — save and restore conversation snapshots.
 *
 * Checkpoints are persisted as JSON files under:
 *   ~/.cmdr/sessions/{sessionId}/checkpoints/{checkpoint-id}.json
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { LLMMessage } from '../core/types.js'

const CMDR_DIR = join(homedir(), '.cmdr')
const SESSIONS_DIR = join(CMDR_DIR, 'sessions')

export interface Checkpoint {
  readonly id: string
  readonly label: string
  readonly model: string
  readonly messages: LLMMessage[]
  readonly messageCount: number
  readonly createdAt: string
}

function checkpointDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId, 'checkpoints')
}

export class CheckpointManager {
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  /** Save a checkpoint with an optional label. */
  async save(label: string, messages: LLMMessage[], model: string): Promise<Checkpoint> {
    const dir = checkpointDir(this.sessionId)
    await mkdir(dir, { recursive: true })

    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const checkpoint: Checkpoint = {
      id,
      label,
      model,
      messages: [...messages],
      messageCount: messages.length,
      createdAt: new Date().toISOString(),
    }

    await writeFile(join(dir, `${id}.json`), JSON.stringify(checkpoint, null, 2), 'utf-8')
    return checkpoint
  }

  /** Restore a checkpoint by ID. Returns null if not found. */
  async restore(id: string): Promise<Checkpoint | null> {
    const filePath = join(checkpointDir(this.sessionId), `${id}.json`)
    if (!existsSync(filePath)) return null

    try {
      const data = await readFile(filePath, 'utf-8')
      return JSON.parse(data) as Checkpoint
    } catch {
      return null
    }
  }

  /** List all checkpoints for this session, newest first. */
  async list(): Promise<Omit<Checkpoint, 'messages'>[]> {
    const dir = checkpointDir(this.sessionId)
    if (!existsSync(dir)) return []

    try {
      const files = await readdir(dir)
      const checkpoints: Omit<Checkpoint, 'messages'>[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const data = await readFile(join(dir, file), 'utf-8')
          const cp = JSON.parse(data) as Checkpoint
          checkpoints.push({
            id: cp.id,
            label: cp.label,
            model: cp.model,
            messageCount: cp.messageCount,
            createdAt: cp.createdAt,
          })
        } catch {
          // skip malformed files
        }
      }

      return checkpoints.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    } catch {
      return []
    }
  }

  /** Delete a checkpoint by ID. Returns true if deleted. */
  async delete(id: string): Promise<boolean> {
    const filePath = join(checkpointDir(this.sessionId), `${id}.json`)
    if (!existsSync(filePath)) return false

    try {
      await unlink(filePath)
      return true
    } catch {
      return false
    }
  }
}
