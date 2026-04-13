/**
 * Content Replacement — prevents context overflow from large tool outputs.
 *
 * When a tool result exceeds the configured threshold, the system:
 *   1. Truncates the content to the limit
 *   2. Appends a notice with the total size
 *   3. Tracks replacements so downstream systems can reference the full content
 *
 * This is critical for tools like file_read and grep that can return huge outputs.
 */

export interface ContentReplacementOptions {
  /** Maximum characters per tool result before truncation. Default: 16KB. */
  maxToolResultSize?: number
  /** Lines to keep from the start of truncated content. Default: 200. */
  headLines?: number
  /** Lines to keep from the end of truncated content. Default: 100. */
  tailLines?: number
}

export interface ReplacedContent {
  readonly toolName: string
  readonly toolUseId: string
  readonly originalSize: number
  readonly truncatedSize: number
  readonly timestamp: number
}

const DEFAULT_MAX_SIZE = 16_384      // 16 KB
const DEFAULT_HEAD_LINES = 200
const DEFAULT_TAIL_LINES = 100

export class ContentReplacer {
  private readonly maxSize: number
  private readonly headLines: number
  private readonly tailLines: number
  private history: ReplacedContent[] = []

  constructor(options: ContentReplacementOptions = {}) {
    this.maxSize = options.maxToolResultSize ?? DEFAULT_MAX_SIZE
    this.headLines = options.headLines ?? DEFAULT_HEAD_LINES
    this.tailLines = options.tailLines ?? DEFAULT_TAIL_LINES
  }

  /**
   * If the content exceeds the limit, truncate with head/tail preservation.
   * Returns the (possibly truncated) content string.
   */
  truncateIfNeeded(content: string, toolName: string, toolUseId: string): string {
    if (content.length <= this.maxSize) return content

    const lines = content.split('\n')
    const totalLines = lines.length

    // If line count is small enough, just character-truncate
    if (totalLines <= this.headLines + this.tailLines + 5) {
      const truncated = content.slice(0, this.maxSize)
      this.recordReplacement(toolName, toolUseId, content.length, truncated.length)
      return truncated +
        `\n\n[Content truncated: ${content.length.toLocaleString()} chars total, showing first ${this.maxSize.toLocaleString()} chars]`
    }

    // Head + tail line preservation
    const head = lines.slice(0, this.headLines).join('\n')
    const tail = lines.slice(-this.tailLines).join('\n')
    const omitted = totalLines - this.headLines - this.tailLines
    const result = `${head}\n\n... [${omitted} lines omitted — ${content.length.toLocaleString()} chars total] ...\n\n${tail}`

    this.recordReplacement(toolName, toolUseId, content.length, result.length)
    return result
  }

  private recordReplacement(
    toolName: string,
    toolUseId: string,
    originalSize: number,
    truncatedSize: number,
  ): void {
    this.history.push({
      toolName,
      toolUseId,
      originalSize,
      truncatedSize,
      timestamp: Date.now(),
    })
    // Keep only last 50 replacements
    if (this.history.length > 50) {
      this.history = this.history.slice(-50)
    }
  }

  /** Get statistics about recent truncations. */
  getStats(): { count: number; totalSaved: number } {
    const totalSaved = this.history.reduce(
      (sum, r) => sum + (r.originalSize - r.truncatedSize),
      0,
    )
    return { count: this.history.length, totalSaved }
  }
}
