/**
 * Scorer — computes summary metrics from task results.
 */

import type { TaskResult, EvalTask, EvalSummary, Tier } from './types.js'
import { computeGrade } from './types.js'

export function computeSummary(tasks: EvalTask[], results: TaskResult[]): EvalSummary {
  const byTier: Record<string, { passed: number; total: number; score: number; maxScore: number }> = {}
  const byCategory: Record<string, { passed: number; total: number }> = {}

  let totalScore = 0
  let maxScore = 0
  let totalDuration = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let passed = 0

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const result = results[i]

    // By tier
    if (!byTier[task.tier]) byTier[task.tier] = { passed: 0, total: 0, score: 0, maxScore: 0 }
    byTier[task.tier].total++
    byTier[task.tier].maxScore += task.points

    // By category
    if (!byCategory[task.category]) byCategory[task.category] = { passed: 0, total: 0 }
    byCategory[task.category].total++

    maxScore += task.points

    if (result) {
      totalDuration += result.duration
      totalTokensIn += result.tokensIn
      totalTokensOut += result.tokensOut

      if (result.passed) {
        passed++
        totalScore += result.score
        byTier[task.tier].passed++
        byTier[task.tier].score += result.score
        byCategory[task.category].passed++
      }
    }
  }

  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 1000) / 10 : 0
  const grade = computeGrade(totalScore, maxScore)

  return {
    totalTasks: tasks.length,
    passed,
    failed: tasks.length - passed,
    score: totalScore,
    maxScore,
    percentage,
    grade,
    byTier,
    byCategory,
    totalDuration: Math.round(totalDuration),
    totalTokensIn,
    totalTokensOut,
    averageTimePerTask: tasks.length > 0 ? Math.round(totalDuration / tasks.length) : 0,
  }
}
