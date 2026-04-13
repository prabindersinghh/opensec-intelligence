import React, { useEffect, useRef, useState } from 'react'
import { useMessages, type ChatMessage, type ToolExecution } from '../hooks/useMessages'
import { useStream } from '../hooks/useStream'
import { useVSCode } from '../hooks/useVSCode'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { ModelSelector } from './ModelSelector'
import { EffortBadge } from './EffortBadge'
import { WelcomeScreen } from './WelcomeScreen'
import { ApprovalCard, type ApprovalRequest } from './ApprovalCard'
import { TerminalOutput } from './TerminalOutput'

export const ChatPanel: React.FC = () => {
  const { messages, addMessage, updateMessage, clearMessages, loadMessages } = useMessages()
  const { isStreaming, startStream, stopStream, setStreamingDone } = useStream()
  const vscode = useVSCode()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [model, setModel] = useState('qwen3-coder')
  const [effort, setEffort] = useState('medium')
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [terminalOutputs, setTerminalOutputs] = useState<{ command: string; output: string; exitCode?: number; cwd?: string }[]>([])
  const currentStreamId = useRef<string | null>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history on mount
  useEffect(() => {
    vscode.postMessage({ type: 'getHistory' })
    vscode.postMessage({ type: 'getModels' })
  }, [])

  const handleSend = (text: string) => {
    addMessage({ role: 'user', content: text })
    const assistantMsg = addMessage({ role: 'assistant', content: '', isStreaming: true })
    currentStreamId.current = assistantMsg.id
    startStream(text)
  }

  // Listen for extension messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      switch (msg.type) {
        case 'streamStart':
          // Stream already started via handleSend
          break

        case 'streamText':
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => ({
              ...m,
              content: m.content + (msg.text || ''),
            }))
          }
          break

        case 'streamTool':
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => {
              const tools = [...m.tools]
              if (msg.status === 'start') {
                tools.push({
                  name: msg.tool || 'unknown',
                  status: 'start',
                  input: msg.input,
                })
              } else {
                const existingIdx = tools.findIndex(
                  (t) => t.name === msg.tool && t.status === 'start',
                )
                if (existingIdx >= 0) {
                  tools[existingIdx] = {
                    ...tools[existingIdx],
                    status: msg.status,
                    output: msg.output,
                    duration: msg.duration,
                  }
                }
              }
              return { ...m, tools }
            })
          }
          break

        case 'streamEnd':
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => ({ ...m, isStreaming: false }))
            currentStreamId.current = null
          }
          setStreamingDone()
          break

        case 'streamError':
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => ({
              ...m,
              content: m.content + `\n\n⚠️ Error: ${msg.error}`,
              isStreaming: false,
            }))
            currentStreamId.current = null
          }
          setStreamingDone()
          break

        case 'models':
          setModel(msg.current || msg.models[0])
          break

        case 'effort':
          setEffort(msg.level)
          break

        case 'history':
          if (msg.messages?.length > 0) {
            loadMessages(msg.messages)
          }
          break

        case 'context':
          // Could store context for display
          break

        case 'notification':
          // Show notification inline if streaming, otherwise ignore
          if (currentStreamId.current && msg.level === 'error') {
            const id = currentStreamId.current
            updateMessage(id, (m) => ({
              ...m,
              content: m.content + `\n\n⚠️ ${msg.text}`,
            }))
          }
          break

        case 'approvalRequired':
          setApprovals((prev) => [
            ...prev,
            {
              id: msg.approvalId,
              tool: msg.tool,
              input: msg.input,
              description: msg.description,
            },
          ])
          break

        case 'terminalOutput':
          setTerminalOutputs((prev) => [
            ...prev,
            {
              command: msg.command,
              output: msg.output,
              exitCode: msg.exitCode,
              cwd: msg.cwd,
            },
          ])
          // Also append to the current message as a tool record
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => {
              const tools = [...m.tools]
              tools.push({
                name: `terminal: ${msg.command}`,
                status: msg.exitCode === 0 || msg.exitCode === undefined ? 'done' : 'error',
                output: msg.output,
              })
              return { ...m, tools }
            })
          }
          break

        case 'fileEdit':
          // Show file edit notification in chat
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => {
              const tools = [...m.tools]
              tools.push({
                name: `edit: ${msg.filePath}`,
                status: msg.status === 'pending' ? 'start' : 'done',
              })
              return { ...m, tools }
            })
          }
          break

        case 'diffResult':
          // Show diff accept/reject result
          if (currentStreamId.current) {
            const id = currentStreamId.current
            updateMessage(id, (m) => {
              const tools = m.tools.map((t) =>
                t.name.startsWith('edit:') && t.status === 'start'
                  ? { ...t, status: (msg.accepted ? 'done' : 'error') as 'done' | 'error' }
                  : t,
              )
              return { ...m, tools }
            })
          }
          break
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [updateMessage, setStreamingDone, loadMessages])

  const handleModelChange = (m: string) => {
    setModel(m)
    vscode.postMessage({ type: 'setModel', model: m })
  }

  const handleEffortChange = (e: string) => {
    setEffort(e)
    vscode.postMessage({ type: 'setEffort', effort: e })
  }

  const handleClearChat = () => {
    clearMessages()
    setApprovals([])
    setTerminalOutputs([])
    vscode.postMessage({ type: 'clearHistory' })
  }

  const handleApprove = (id: string) => {
    vscode.postMessage({ type: 'approvalResponse', approvalId: id, approved: true })
    setApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDeny = (id: string) => {
    vscode.postMessage({ type: 'approvalResponse', approvalId: id, approved: false })
    setApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  const handleAlwaysApprove = (id: string, tool: string) => {
    vscode.postMessage({ type: 'approvalResponse', approvalId: id, approved: true, alwaysApprove: true, tool })
    setApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <ModelSelector model={model} onChange={handleModelChange} />
        <div className="chat-header-right">
          <EffortBadge effort={effort} onChange={handleEffortChange} />
          <button className="clear-button" onClick={handleClearChat} title="Clear chat">
            🗑
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && <WelcomeScreen onSend={handleSend} />}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Approval cards */}
        {approvals.map((req) => (
          <ApprovalCard
            key={req.id}
            request={req}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onAlwaysApprove={handleAlwaysApprove}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      <InputArea onSend={handleSend} onStop={stopStream} isStreaming={isStreaming} />
    </div>
  )
}
