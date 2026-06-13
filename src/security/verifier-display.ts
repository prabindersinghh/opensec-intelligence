import chalk from 'chalk'
import type { Finding, ProofResult } from './types.js'

const RED   = chalk.hex('#FF4444')
const GREEN = chalk.hex('#00FF94')
const DIM   = chalk.gray
const W     = 58  // inner box width

function pad(content: string, width: number): string {
  const visible = content.replace(/\x1b\[[0-9;]*m/g, '')
  const fill = Math.max(0, width - visible.length)
  return content + ' '.repeat(fill)
}

function row(content: string, borderColor: typeof chalk): string {
  return borderColor('│') + ' ' + pad(content, W) + ' ' + borderColor('│')
}

function box(lines: string[], borderColor: typeof chalk): string {
  const top = borderColor('╭' + '─'.repeat(W + 2) + '╮')
  const bot = borderColor('╰' + '─'.repeat(W + 2) + '╯')
  const sep = borderColor('│') + DIM('─'.repeat(W + 2)) + borderColor('│')
  const rows = lines.map((l) =>
    l === '---' ? sep : row(l, borderColor)
  )
  return [top, ...rows, bot].join('\n')
}

export function displayProofResult(finding: Finding, proof: ProofResult): void {
  if (proof.skipped) {
    console.log(DIM(`  ⏭  SKIPPED: ${finding.ruleName} — ${proof.skipReason}`))
    return
  }

  const lines: string[] = []
  lines.push(chalk.bold(`PROVING: ${finding.ruleName}`))
  lines.push(DIM(`  ${finding.file}:${finding.line}`))
  lines.push('')

  let borderColor: typeof chalk = chalk.yellow

  if (proof.beforePatch.success) {
    borderColor = chalk.red
    lines.push(RED.bold('  🔴 VULNERABILITY CONFIRMED'))
    lines.push(RED(`     Input:  ${proof.beforePatch.input || '(see exploit code)'}`))
    lines.push(RED(`     Result: ${proof.beforePatch.output.split('\n')[0]}`))
  } else {
    lines.push(chalk.yellow('  ⚠️  EXPLOIT DID NOT FIRE'))
    const reason = proof.beforePatch.output.split('\n')[0] || proof.beforePatch.error || 'no output'
    lines.push(chalk.yellow(`     ${reason}`))
    lines.push(DIM('     (possible false positive, or exploit needs tuning)'))
  }

  lines.push('')
  lines.push('---')
  lines.push('')

  if (proof.verified) {
    borderColor = chalk.green
    lines.push(GREEN.bold('  ✅ PATCH VERIFIED — exploit no longer works'))
    lines.push(GREEN(`     Same input: ${proof.beforePatch.input || '(see exploit code)'}`))
    lines.push(GREEN(`     Result:     ${proof.afterPatch.output.split('\n')[0]}`))
  } else if (proof.afterPatch.success) {
    lines.push(RED.bold('  ❌ PATCH FAILED — exploit still succeeds'))
    lines.push(RED(`     ${proof.afterPatch.output.split('\n')[0]}`))
    lines.push(chalk.yellow('     → Review the generated patch and tighten it manually.'))
  } else {
    lines.push(DIM('  ℹ  Exploit did not fire before or after — cannot auto-verify.'))
  }

  console.log('\n' + box(lines, borderColor))

  if (process.env.OPENSEC_SHOW_EXPLOIT === '1') {
    console.log(DIM('\n  EXPLOIT CODE:'))
    console.log(DIM(proof.exploitCode.split('\n').map((l) => '    ' + l).join('\n')))
  }
}

export function displayProveSummary(results: ProofResult[]): void {
  const verified = results.filter((r) => r.verified).length
  const failed   = results.filter((r) => !r.verified && !r.skipped && r.beforePatch.success).length
  const noFire   = results.filter((r) => !r.skipped && !r.beforePatch.success).length
  const skipped  = results.filter((r) => r.skipped).length

  const lines: string[] = [
    chalk.bold('PROVE SUMMARY'),
    '',
    GREEN(`  ✅ ${verified} proved and patched`),
    ...(failed  > 0 ? [RED(`  ❌ ${failed} patches failed verification`)]                       : []),
    ...(noFire  > 0 ? [chalk.yellow(`  ⚠️  ${noFire} exploits did not fire (possible false positives)`)] : []),
    DIM(`  ⏭  ${skipped} skipped (manual review needed)`),
  ]

  const color = verified > 0 ? chalk.green : chalk.yellow
  console.log('\n' + box(lines, color))
}
