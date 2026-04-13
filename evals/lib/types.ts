/**
 * Eval type definitions — shared across the multi-tier evaluation framework.
 */

export type Tier = 'basic' | 'intermediate' | 'advanced' | 'hard' | 'expert' | 'extreme'

export type VerifyStrategy =
  | 'file_exists'
  | 'file_contains'
  | 'test_passes'
  | 'output_matches'
  | 'script_verify'
  | 'diff_check'

export type TaskCategory =
  | 'file_ops'
  | 'code_gen'
  | 'code_edit'
  | 'debugging'
  | 'refactoring'
  | 'multi_file'
  | 'testing'
  | 'architecture'
  | 'security'
  | 'performance'
  | 'skill_use'

export interface EvalTask {
  id: string
  name: string
  tier: Tier
  category: TaskCategory
  description: string
  prompt: string
  timeout: number
  expectedTools: string[]
  verify: VerificationSpec[]
  setup?: string
  tags: string[]
  points: number
  requiresSkill?: string
}

export interface VerificationSpec {
  strategy: VerifyStrategy
  target: string
  expected?: string
  script?: string
}

export interface TaskResult {
  taskId: string
  passed: boolean
  score: number
  duration: number
  tokensIn: number
  tokensOut: number
  toolsCalled: string[]
  error?: string
  agentOutput: string
  verifyDetails: string
}

export interface EvalRun {
  id: string
  model: string
  ollamaUrl: string
  startedAt: string
  completedAt: string
  tasks: TaskResult[]
  summary: EvalSummary
}

export interface EvalSummary {
  totalTasks: number
  passed: number
  failed: number
  score: number
  maxScore: number
  percentage: number
  grade: string
  byTier: Record<string, { passed: number; total: number; score: number; maxScore: number }>
  byCategory: Record<string, { passed: number; total: number }>
  totalDuration: number
  totalTokensIn: number
  totalTokensOut: number
  averageTimePerTask: number
}

export const TIER_POINTS: Record<Tier, number> = {
  basic: 1,
  intermediate: 2,
  advanced: 3,
  hard: 5,
  expert: 8,
  extreme: 13,
}

export function computeGrade(score: number, maxScore: number): string {
  const pct = maxScore > 0 ? score / maxScore : 0
  if (pct >= 0.83) return 'S'
  if (pct >= 0.65) return 'A'
  if (pct >= 0.50) return 'B'
  if (pct >= 0.35) return 'C'
  if (pct >= 0.14) return 'D'
  return 'F'
}
