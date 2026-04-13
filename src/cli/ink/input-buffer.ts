/**
 * Lightweight multiline text buffer for terminal input.
 *
 * Supports cursor movement, insertion/deletion, and line operations.
 */

export interface BufferSnapshot {
  lines: string[]
  row: number
  col: number
}

function toCodePoints(text: string): string[] {
  return Array.from(text)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class InputBuffer {
  private lines: string[]
  private row = 0
  private col = 0

  constructor(initialText = '') {
    this.lines = initialText.length > 0 ? initialText.split('\n') : ['']
    this.row = this.lines.length - 1
    this.col = toCodePoints(this.lines[this.row]).length
  }

  snapshot(): BufferSnapshot {
    return {
      lines: [...this.lines],
      row: this.row,
      col: this.col,
    }
  }

  getText(): string {
    return this.lines.join('\n')
  }

  isEmpty(): boolean {
    return this.lines.length === 1 && this.lines[0].length === 0
  }

  setText(text: string): void {
    this.lines = text.length > 0 ? text.split('\n') : ['']
    this.row = this.lines.length - 1
    this.col = toCodePoints(this.lines[this.row]).length
  }

  clear(): void {
    this.lines = ['']
    this.row = 0
    this.col = 0
  }

  insert(text: string): void {
    if (!text) return

    const current = this.lines[this.row] ?? ''
    const cp = toCodePoints(current)
    const before = cp.slice(0, this.col).join('')
    const after = cp.slice(this.col).join('')

    const chunks = text.split('\n')
    if (chunks.length === 1) {
      this.lines[this.row] = before + text + after
      this.col += toCodePoints(text).length
      return
    }

    this.lines[this.row] = before + chunks[0]
    const middle = chunks.slice(1, -1)
    const last = chunks[chunks.length - 1] ?? ''
    this.lines.splice(this.row + 1, 0, ...middle, last + after)

    this.row += chunks.length - 1
    this.col = toCodePoints(last).length
  }

  insertNewLine(): void {
    this.insert('\n')
  }

  backspace(): void {
    const current = this.lines[this.row] ?? ''
    const cp = toCodePoints(current)

    if (this.col > 0) {
      cp.splice(this.col - 1, 1)
      this.lines[this.row] = cp.join('')
      this.col -= 1
      return
    }

    if (this.row === 0) return

    const prev = this.lines[this.row - 1] ?? ''
    const prevLen = toCodePoints(prev).length
    this.lines[this.row - 1] = prev + current
    this.lines.splice(this.row, 1)
    this.row -= 1
    this.col = prevLen
  }

  deleteForward(): void {
    const current = this.lines[this.row] ?? ''
    const cp = toCodePoints(current)

    if (this.col < cp.length) {
      cp.splice(this.col, 1)
      this.lines[this.row] = cp.join('')
      return
    }

    if (this.row >= this.lines.length - 1) return

    const next = this.lines[this.row + 1] ?? ''
    this.lines[this.row] = current + next
    this.lines.splice(this.row + 1, 1)
  }

  moveLeft(): void {
    if (this.col > 0) {
      this.col -= 1
      return
    }

    if (this.row > 0) {
      this.row -= 1
      this.col = toCodePoints(this.lines[this.row] ?? '').length
    }
  }

  moveRight(): void {
    const len = toCodePoints(this.lines[this.row] ?? '').length
    if (this.col < len) {
      this.col += 1
      return
    }

    if (this.row < this.lines.length - 1) {
      this.row += 1
      this.col = 0
    }
  }

  moveUp(): void {
    if (this.row === 0) return
    this.row -= 1
    const len = toCodePoints(this.lines[this.row] ?? '').length
    this.col = clamp(this.col, 0, len)
  }

  moveDown(): void {
    if (this.row >= this.lines.length - 1) return
    this.row += 1
    const len = toCodePoints(this.lines[this.row] ?? '').length
    this.col = clamp(this.col, 0, len)
  }

  moveLineStart(): void {
    this.col = 0
  }

  moveLineEnd(): void {
    this.col = toCodePoints(this.lines[this.row] ?? '').length
  }

  deleteToLineStart(): void {
    const current = this.lines[this.row] ?? ''
    const cp = toCodePoints(current)
    this.lines[this.row] = cp.slice(this.col).join('')
    this.col = 0
  }

  deleteToLineEnd(): void {
    const current = this.lines[this.row] ?? ''
    const cp = toCodePoints(current)
    this.lines[this.row] = cp.slice(0, this.col).join('')
  }
}
