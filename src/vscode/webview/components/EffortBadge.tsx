import React from 'react'

interface EffortBadgeProps {
  effort: string
  onChange: (effort: string) => void
}

const EFFORTS = ['low', 'medium', 'high', 'max'] as const

const effortColors: Record<string, string> = {
  low: 'var(--chat-muted)',
  medium: 'var(--chat-accent)',
  high: 'var(--chat-warning)',
  max: 'var(--chat-error)',
}

export const EffortBadge: React.FC<EffortBadgeProps> = ({ effort, onChange }) => {
  const cycleEffort = () => {
    const idx = EFFORTS.indexOf(effort as (typeof EFFORTS)[number])
    const next = EFFORTS[(idx + 1) % EFFORTS.length]
    onChange(next)
  }

  return (
    <button
      className="effort-badge"
      onClick={cycleEffort}
      title={`Effort: ${effort} (click to change)`}
      style={{ borderColor: effortColors[effort] || effortColors.medium }}
    >
      ⚡ {effort}
    </button>
  )
}
