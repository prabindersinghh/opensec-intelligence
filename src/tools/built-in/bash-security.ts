/**
 * Bash command security checks.
 *
 * Derived from Claude Code's 23 security checks — blocks destructive ops,
 * data exfiltration, and shell injection vectors.
 */

// Destructive or dangerous command patterns
const BLOCKED_PATTERNS: { pattern: RegExp; label: string }[] = [
  // Destructive commands
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, label: 'rm -rf /' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, label: 'chmod 777 /' },
  { pattern: /\bmkfs\b/, label: 'filesystem format' },
  { pattern: /\bdd\s+.*of=\/dev\//, label: 'dd to device' },

  // Data exfiltration
  { pattern: /\bcurl\s+.*-d\s+.*@/, label: 'curl posting file contents' },
  { pattern: /\bwget\s+.*--post-file/, label: 'wget posting files' },

  // Sensitive file access via subshell
  { pattern: /\$\(.*\bcat\b.*\/etc\/(passwd|shadow)/, label: 'reading sensitive files' },
]

// Zsh builtins that should never come from an LLM
const BLOCKED_ZSH_BUILTINS = new Set([
  'bindkey', 'compdef', 'compadd', 'zmodload', 'autoload',
  'zle', 'zstyle', 'typeset', 'setopt', 'unsetopt',
  'functions', 'aliases', 'disable', 'enable', 'emulate',
])

// Zero-width characters (from Claude Code HackerOne finding)
const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF]/g

// Zsh equals expansion: =curl → /usr/bin/curl
const ZSH_EQUALS_REGEX = /(?:^|\s)=[a-zA-Z]/

export interface SecurityResult {
  safe: boolean
  reason?: string
  sanitized: string
}

export function sanitizeBashCommand(command: string): SecurityResult {
  // Strip zero-width characters
  const cleaned = command.replace(ZERO_WIDTH_REGEX, '')

  // Check zsh equals expansion
  if (ZSH_EQUALS_REGEX.test(cleaned)) {
    return { safe: false, reason: 'Zsh equals expansion detected', sanitized: cleaned }
  }

  // Check blocked patterns
  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { safe: false, reason: `Blocked: ${label}`, sanitized: cleaned }
    }
  }

  // Check blocked zsh builtins at start of each segment
  const segments = cleaned.split(/[;|&]/)
  for (const segment of segments) {
    const firstWord = segment.trim().split(/\s/)[0]
    if (BLOCKED_ZSH_BUILTINS.has(firstWord)) {
      return { safe: false, reason: `Blocked shell builtin: ${firstWord}`, sanitized: cleaned }
    }
  }

  return { safe: true, sanitized: cleaned }
}
