/**
 * Intent classifier — determines what tools the model should receive
 * based on the user's message.
 *
 * Inspired by claw-code's `simple_mode` pattern: don't tell the model
 * about tools it doesn't need. When someone says "hi", the model gets
 * zero tools, so it physically cannot start running glob/git_log.
 *
 * Three tiers:
 *   conversational → no tools (just chat)
 *   exploratory    → read-only tools (file_read, grep, glob, git_diff, git_log)
 *   actionable     → full tool suite
 */

import type { LLMToolDef } from './types.js'

export type UserIntent = 'conversational' | 'exploratory' | 'actionable'

// ---------------------------------------------------------------------------
// Read-only tool set (exploratory tier)
// ---------------------------------------------------------------------------

const EXPLORATORY_TOOLS = new Set([
  'file_read',
  'grep',
  'glob',
  'git_diff',
  'git_log',
  'think',
  'graph_impact',
  'graph_query',
  'graph_review',
])

// ---------------------------------------------------------------------------
// Intent detection heuristics
// ---------------------------------------------------------------------------

/** Words/phrases that signal the user wants the model to *do* something. */
const ACTION_SIGNALS = /\b(fix|create|write|edit|add|remove|delete|refactor|implement|build|update|change|modify|rename|move|install|run|execute|deploy|migrate|convert|replace|rewrite|debug|patch|test|commit|push|merge|undo)\b/i

/** Words/phrases that signal the user wants to understand something. */
const EXPLORE_SIGNALS = /\b(what is|what are|explain|describe|show me|how does|how do|where is|where are|find|search|look at|read|list|check|can you show|tell me about|look for|walk me through|overview)\b/i

/** Very short messages that are almost certainly conversational. */
const GREETING_PATTERNS = /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|great|good|sure|yep|nope|no|yes|bye|goodbye|cheers|what'?s up|how are you|how'?s it going|hm+|ah+)\b/i

/** Questions about the assistant itself — conversational, not actionable. */
const META_PATTERNS = /\b(who are you|what are you|which model|what model|your name|what can you do|are you|tell me about yourself)\b/i

/**
 * Classify the user's latest message to determine tool availability.
 *
 * The classifier is intentionally conservative — when in doubt it
 * escalates to a higher tier (more tools). False negatives (giving
 * tools when not needed) are less harmful than false positives
 * (withholding tools when the user needs them).
 */
export function classifyIntent(message: string): UserIntent {
  const trimmed = message.trim()

  // Empty or very short greetings → conversational
  if (trimmed.length === 0) return 'conversational'
  if (GREETING_PATTERNS.test(trimmed)) return 'conversational'
  if (META_PATTERNS.test(trimmed)) return 'conversational'

  // Short messages (< 15 chars) with no action/explore signals → conversational
  if (trimmed.length < 15 && !ACTION_SIGNALS.test(trimmed) && !EXPLORE_SIGNALS.test(trimmed)) {
    return 'conversational'
  }

  // Clear action verbs → full tool suite
  if (ACTION_SIGNALS.test(trimmed)) return 'actionable'

  // Exploration language → read-only tools
  if (EXPLORE_SIGNALS.test(trimmed)) return 'exploratory'

  // Messages mentioning file paths or code constructs → actionable
  if (/\.(ts|js|py|rs|go|java|c|cpp|h|json|yaml|yml|toml|md|html|css|sql)\b/.test(trimmed)) {
    return 'actionable'
  }

  // Longer messages without clear signals → default to actionable
  // (conservative: don't withhold tools on ambiguous requests)
  if (trimmed.length >= 40) return 'actionable'

  // Medium-length messages that don't match anything → exploratory
  return 'exploratory'
}

// ---------------------------------------------------------------------------
// Frustration detection
// ---------------------------------------------------------------------------

const FRUSTRATION_REGEX = /\b(wtf|wth|ffs|omfg|shit(?:ty|tiest)?|horrible|awful|piece\s*of\s*(?:shit|crap|junk)|what\s*the\s*(?:fuck|hell)|fuck(?:ing)?\s*(?:broken|useless|terrible|awful|horrible)|screw\s*(?:this|you)|so\s+frustrating|this\s+sucks|damn\s*it|ugh{2,}|argh{2,})\b/i

export function detectFrustration(message: string): boolean {
  return FRUSTRATION_REGEX.test(message)
}

export const FRUSTRATION_NUDGE = `[The user seems frustrated. Be extra careful with your next actions:
- Explain your reasoning briefly before each tool call
- Verify every change by running tests
- Offer to undo recent changes if something went wrong
- Take it one step at a time, do not batch multiple changes]`

/**
 * Filter tool definitions based on intent.
 *
 * - conversational: returns empty array (no tools)
 * - exploratory: returns only read-only tools
 * - actionable: returns all tools
 */
export function filterToolsByIntent(
  intent: UserIntent,
  allTools: readonly LLMToolDef[],
): LLMToolDef[] {
  switch (intent) {
    case 'conversational':
      return []
    case 'exploratory':
      return allTools.filter(t => EXPLORATORY_TOOLS.has(t.name))
    case 'actionable':
      return [...allTools]
  }
}
