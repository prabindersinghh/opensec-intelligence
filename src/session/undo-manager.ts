/**
 * UndoManager — tracks file changes made by the agent and supports reverting them.
 *
 * Stores snapshots of files before they are modified by file_write or file_edit tools.
 */

import { readFile, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'

export interface FileChange {
  readonly path: string
  readonly type: 'create' | 'edit' | 'write'
  readonly originalContent: string | null  // null = file didn't exist before
  readonly timestamp: Date
}

export class UndoManager {
  private changes: FileChange[] = []

  /**
   * Record a file's state before modification.
   * Call this BEFORE the tool writes to the file.
   */
  async recordBefore(filePath: string, type: 'create' | 'edit' | 'write'): Promise<void> {
    let originalContent: string | null = null

    if (existsSync(filePath)) {
      try {
        originalContent = await readFile(filePath, 'utf-8')
      } catch {
        originalContent = null
      }
    }

    this.changes.push({
      path: filePath,
      type,
      originalContent,
      timestamp: new Date(),
    })
  }

  /**
   * Undo the last file change.
   * Returns the change that was undone, or null if nothing to undo.
   */
  async undoLast(): Promise<FileChange | null> {
    const change = this.changes.pop()
    if (!change) return null

    if (change.originalContent === null) {
      // File was newly created — delete it
      try {
        await unlink(change.path)
      } catch {
        // File may have been deleted already
      }
    } else {
      // Restore original content
      await writeFile(change.path, change.originalContent, 'utf-8')
    }

    return change
  }

  /**
   * Undo ALL changes (most recent first).
   */
  async undoAll(): Promise<FileChange[]> {
    const undone: FileChange[] = []
    while (this.changes.length > 0) {
      const change = await this.undoLast()
      if (change) undone.push(change)
    }
    return undone
  }

  /** Get the list of recorded changes (oldest first). */
  getChanges(): FileChange[] {
    return [...this.changes]
  }

  /** Number of undoable changes. */
  get count(): number {
    return this.changes.length
  }

  /** Clear change history without undoing. */
  clear(): void {
    this.changes = []
  }
}
