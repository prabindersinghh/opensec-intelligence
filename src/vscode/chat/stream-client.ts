export interface StreamEvent {
  type: 'text' | 'tool_start' | 'tool_done' | 'tool_error' | 'tool_approval' | 'terminal' | 'file_edit' | 'done' | 'error'
  text?: string
  tool?: string
  input?: unknown
  output?: string
  duration?: number
  error?: string
  tokens?: { input: number; output: number }
  // approval fields
  approvalId?: string
  description?: string
  // terminal fields
  command?: string
  exitCode?: number
  cwd?: string
  // file_edit fields
  filePath?: string
  newContent?: string
}

/**
 * Deferred mode state.
 *
 * When deferred mode is enabled, the stream pauses at tool_approval events
 * and waits for explicit resume. This supports headless/CI workflows where
 * a human reviews tool decisions asynchronously.
 */
export interface DeferredState {
  enabled: boolean
  pausedAt: StreamEvent | null
  pendingApprovals: StreamEvent[]
  resumeCallback: ((approved: boolean) => void) | null
}

export class StreamClient {
  private controller: AbortController | null = null
  private deferred: DeferredState = {
    enabled: false,
    pausedAt: null,
    pendingApprovals: [],
    resumeCallback: null,
  }

  /** Enable or disable deferred/headless mode. */
  setDeferredMode(enabled: boolean): void {
    this.deferred.enabled = enabled
  }

  /** Check if currently paused on a deferred approval. */
  isPaused(): boolean {
    return this.deferred.pausedAt !== null
  }

  /** Get pending deferred approvals. */
  getPendingApprovals(): StreamEvent[] {
    return [...this.deferred.pendingApprovals]
  }

  /**
   * Resume a deferred approval.
   * @param approved Whether to approve or deny the pending tool use.
   */
  resumeDeferred(approved: boolean): void {
    if (this.deferred.resumeCallback) {
      this.deferred.resumeCallback(approved)
      this.deferred.resumeCallback = null
      this.deferred.pausedAt = null
    }
  }

  async stream(
    baseUrl: string,
    prompt: string,
    options: { model?: string; effort?: string; images?: string[]; deferred?: boolean },
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController()
    this.deferred.pendingApprovals = []
    this.deferred.pausedAt = null

    const response = await fetch(`${baseUrl}/v1/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, ...options }),
      signal: this.controller.signal,
    })

    if (!response.ok) {
      onEvent({ type: 'error', error: `Server error: ${response.status} ${response.statusText}` })
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      onEvent({ type: 'error', error: 'No response body' })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            onEvent({ type: 'done' })
            return
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'text' || parsed.content || parsed.data) {
              onEvent({ type: 'text', text: parsed.data || parsed.content || parsed.text || '' })
            } else if (parsed.type === 'tool_start' || parsed.type === 'tool_use') {
              onEvent({ type: 'tool_start', tool: parsed.tool, input: parsed.input })
            } else if (parsed.type === 'tool_done' || parsed.type === 'tool_result') {
              onEvent({
                type: parsed.is_error ? 'tool_error' : 'tool_done',
                tool: parsed.tool,
                output: parsed.output,
                duration: parsed.duration,
                error: parsed.is_error ? parsed.output : undefined,
              })
            } else if (parsed.type === 'tool_error') {
              onEvent({ type: 'tool_error', tool: parsed.tool, error: parsed.error })
            } else if (parsed.type === 'tool_approval' || parsed.type === 'approval_required') {
              const approvalEvent: StreamEvent = {
                type: 'tool_approval',
                approvalId: parsed.approval_id || parsed.id,
                tool: parsed.tool,
                input: parsed.input,
                description: parsed.description,
              }

              // In deferred mode, pause and wait for explicit resume
              if (this.deferred.enabled) {
                this.deferred.pausedAt = approvalEvent
                this.deferred.pendingApprovals.push(approvalEvent)
                onEvent(approvalEvent)

                // Wait for resume
                await new Promise<void>((resolve) => {
                  this.deferred.resumeCallback = (approved: boolean) => {
                    // Send approval/denial to server
                    if (approvalEvent.approvalId) {
                      fetch(`${baseUrl}/v1/approval`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approval_id: approvalEvent.approvalId,
                          approved,
                        }),
                      }).catch(() => {})
                    }
                    resolve()
                  }
                })
              } else {
                onEvent(approvalEvent)
              }
            } else if (parsed.type === 'terminal' || parsed.type === 'terminal_output') {
              onEvent({
                type: 'terminal',
                command: parsed.command,
                output: parsed.output || parsed.data || '',
                exitCode: parsed.exit_code ?? parsed.exitCode,
                cwd: parsed.cwd,
              })
            } else if (parsed.type === 'file_edit' || parsed.type === 'file_change') {
              onEvent({
                type: 'file_edit',
                filePath: parsed.file_path || parsed.filePath || parsed.path,
                newContent: parsed.new_content || parsed.newContent || parsed.content,
              })
            } else if (parsed.type === 'error') {
              onEvent({ type: 'error', error: parsed.error || parsed.message })
            } else if (parsed.type === 'done') {
              onEvent({ type: 'done', tokens: parsed.tokens })
            } else if (typeof parsed.response === 'string') {
              // Ollama-style response
              onEvent({ type: 'text', text: parsed.response })
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
      onEvent({ type: 'done' })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  stop(): void {
    this.controller?.abort()
    this.controller = null
  }
}
