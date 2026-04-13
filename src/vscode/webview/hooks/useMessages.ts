import { useState, useCallback } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools: ToolExecution[]
  context?: { file?: string; selection?: string }
  isStreaming?: boolean
}

export interface ToolExecution {
  name: string
  status: 'start' | 'done' | 'error'
  input?: unknown
  output?: string
  duration?: number
}

let counter = 0
function genId(): string {
  return Date.now().toString(36) + (counter++).toString(36)
}

export function useMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const addMessage = useCallback(
    (partial: Omit<ChatMessage, 'id' | 'timestamp' | 'tools'> & { tools?: ToolExecution[] }): ChatMessage => {
      const msg: ChatMessage = {
        id: genId(),
        timestamp: Date.now(),
        tools: [],
        ...partial,
      }
      setMessages((prev) => [...prev, msg])
      return msg
    },
    [],
  )

  const updateMessage = useCallback((id: string, updater: (msg: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(
      msgs.map((m) => ({
        ...m,
        tools: m.tools || [],
      })),
    )
  }, [])

  return { messages, addMessage, updateMessage, clearMessages, loadMessages }
}
