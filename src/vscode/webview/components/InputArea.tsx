import React, { useState, useRef, useEffect } from 'react'
import { useVSCode } from '../hooks/useVSCode'

interface InputAreaProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
}

const SLASH_COMMANDS = [
  { name: '/explain', description: 'Explain the selected code' },
  { name: '/fix', description: 'Fix errors in the current file' },
  { name: '/test', description: 'Generate tests for the selected code' },
  { name: '/review', description: 'Review recent code changes' },
  { name: '/refactor', description: 'Refactor the selected code' },
  { name: '/docs', description: 'Generate documentation' },
  { name: '/optimize', description: 'Optimize for performance' },
]

export const InputArea: React.FC<InputAreaProps> = ({ onSend, onStop, isStreaming }) => {
  const [text, setText] = useState('')
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.startsWith(text.toLowerCase()),
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() && !isStreaming) {
        onSend(text.trim())
        setText('')
        setShowSlashMenu(false)
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    setShowSlashMenu(val.startsWith('/') && val.length > 0)

    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }

  const selectCommand = (cmd: string) => {
    setText(cmd + ' ')
    setShowSlashMenu(false)
    textareaRef.current?.focus()
  }

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="input-area">
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="slash-menu">
          {filteredCommands.map((cmd) => (
            <button
              key={cmd.name}
              className="slash-menu-item"
              onClick={() => selectCommand(cmd.name)}
            >
              <span className="slash-command-name">{cmd.name}</span>
              <span className="slash-command-desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask cmdr anything... (/ for commands)"
          rows={1}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button className="stop-button" onClick={onStop} title="Stop generation">
            ■
          </button>
        ) : (
          <button
            className="send-button"
            onClick={() => {
              if (text.trim()) {
                onSend(text.trim())
                setText('')
              }
            }}
            disabled={!text.trim()}
            title="Send message"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
