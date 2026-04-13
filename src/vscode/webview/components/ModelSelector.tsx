import React, { useState, useEffect } from 'react'
import { useVSCode } from '../hooks/useVSCode'

interface ModelSelectorProps {
  model: string
  onChange: (model: string) => void
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ model, onChange }) => {
  const [models, setModels] = useState<string[]>([model])
  const [open, setOpen] = useState(false)
  const vscode = useVSCode()

  useEffect(() => {
    vscode.postMessage({ type: 'getModels' })

    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === 'models') {
        setModels(msg.models)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div className="model-selector">
      <button className="model-selector-button" onClick={() => setOpen(!open)}>
        🤖 {model}
      </button>
      {open && (
        <div className="model-dropdown">
          {models.map((m) => (
            <button
              key={m}
              className={`model-option ${m === model ? 'active' : ''}`}
              onClick={() => {
                onChange(m)
                setOpen(false)
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
