import React from 'react'

interface WelcomeScreenProps {
  onSend: (text: string) => void
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSend }) => {
  const suggestions = [
    { label: '💡 Explain code', prompt: '/explain' },
    { label: '🔧 Fix errors', prompt: '/fix' },
    { label: '🧪 Write tests', prompt: '/test' },
    { label: '♻️ Refactor', prompt: '/refactor' },
  ]

  return (
    <div className="welcome-screen">
      <div className="welcome-logo">⌘ cmdr</div>
      <div className="welcome-tagline">Local AI coding assistant</div>
      <div className="welcome-subtitle">Your models, your machine, your data.</div>

      <div className="welcome-suggestions">
        {suggestions.map((s) => (
          <button key={s.prompt} className="welcome-suggestion" onClick={() => onSend(s.prompt)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="welcome-tip">
        Tip: Select code in the editor first for context-aware help.
      </div>
    </div>
  )
}
