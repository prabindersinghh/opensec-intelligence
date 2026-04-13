#!/usr/bin/env node

/**
 * cmdr — CLI entry point.
 *
 * Open-source multi-agent coding tool for your terminal.
 * Powered by local LLMs via Ollama.
 */

import { parseArgs, printHelp } from '../src/cli/args.js'
import { startRepl } from '../src/cli/repl.js'
import { startServer } from '../src/server/index.js'
import { CmdrDaemon } from '../src/cli/daemon.js'
import { GREEN, PURPLE, DIM, renderError, CYAN } from '../src/cli/theme.js'
import { OllamaAdapter } from '../src/llm/ollama.js'
import { checkForUpdate } from '../src/cli/update-checker.js'
import * as readline from 'readline'
import chalk from 'chalk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { version: VERSION } = require('../../package.json')

function isRecommendedModel(modelName: string): boolean {
  const name = modelName.toLowerCase()
  return name.includes('coder') || name.includes('code') || name.includes('deepseek')
}

function defaultModelIndex(models: string[]): number {
  const recommended = models.findIndex(isRecommendedModel)
  return recommended >= 0 ? recommended : 0
}

/** Prompt user to pick a model from the list. */
function promptModelSelection(models: string[]): Promise<string> {
  const fallbackIndex = defaultModelIndex(models)

  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof (process.stdin as NodeJS.ReadStream).setRawMode !== 'function'
  ) {
    console.log(`  ${DIM('Non-interactive terminal detected, using:')} ${GREEN(models[fallbackIndex])}`)
    return Promise.resolve(models[fallbackIndex])
  }

  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream
    const stdout = process.stdout
    const wasRaw = Boolean(stdin.isRaw)
    let selected = fallbackIndex
    let renderedLines = 0

    const clearRendered = (): void => {
      if (renderedLines <= 0) return
      readline.moveCursor(stdout, 0, -renderedLines)
      readline.clearScreenDown(stdout)
      renderedLines = 0
    }

    const renderMenu = (): void => {
      clearRendered()
      const menuWidth = process.stdout.columns || 80
      const maxModelWidth = Math.max(14, menuWidth - 24)
      const compact = (value: string): string => {
        if (value.length <= maxModelWidth) return value
        return `${value.slice(0, Math.max(1, maxModelWidth - 3))}...`
      }

      const lines: string[] = [
        '',
        `  ${PURPLE.bold('Model Matrix')}`,
        `  ${DIM('Use ↑/↓ to target, Enter to initialize')}`,
        '',
      ]

      for (let i = 0; i < models.length; i++) {
        const isActive = i === selected
        const isRecommended = isRecommendedModel(models[i])
        const pointer = isActive ? CYAN.bold('▶') : DIM('·')
        const ordinal = DIM(`${String(i + 1).padStart(2, ' ')}.`)
        const modelName = compact(models[i])
        const modelLabel = isActive
          ? chalk.bgHex('#11303A').hex('#B7FFE3').bold(` ${modelName} `)
          : DIM(modelName)
        const recommendation = isRecommended
          ? isActive
            ? ` ${GREEN('●')} ${DIM('recommended')}`
            : ` ${DIM('· recommended')}`
          : ''
        lines.push(`  ${pointer} ${ordinal} ${modelLabel}${recommendation}`)
      }

      lines.push('')
      lines.push(`  ${DIM('Esc picks default:')} ${GREEN(models[fallbackIndex])}`)

      stdout.write(lines.join('\n'))
      renderedLines = lines.length - 1
    }

    const cleanup = (): void => {
      stdin.off('keypress', onKeypress)
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(wasRaw)
      }
      stdin.pause()
      stdout.write('\x1B[?25h')
    }

    const finish = (chosenModel: string, statusLine: string): void => {
      cleanup()
      clearRendered()
      console.log(statusLine)
      resolve(chosenModel)
    }

    const onKeypress = (input: string, key: readline.Key): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup()
        clearRendered()
        stdout.write('\n')
        process.exit(130)
      }

      if (key.name === 'up') {
        selected = (selected - 1 + models.length) % models.length
        renderMenu()
        return
      }

      if (key.name === 'down') {
        selected = (selected + 1) % models.length
        renderMenu()
        return
      }

      if (key.name === 'return') {
        finish(models[selected], `  ${DIM('Selected model:')} ${GREEN(models[selected])}`)
        return
      }

      if (key.name === 'escape') {
        finish(models[fallbackIndex], `  ${DIM('Using default model:')} ${GREEN(models[fallbackIndex])}`)
        return
      }

      if (input && /^\d$/.test(input)) {
        const idx = parseInt(input, 10) - 1
        if (idx >= 0 && idx < models.length) {
          selected = idx
          renderMenu()
        }
      }
    }

    readline.emitKeypressEvents(stdin)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdout.write('\x1B[?25l')
    stdin.on('keypress', onKeypress)

    renderMenu()
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.version) {
    console.log(`${PURPLE.bold('OpenSec Intelligence')} ${GREEN(`v${VERSION}`)}  ${DIM('by Prabinder Singh')}`)
    process.exit(0)
  }

  const ollamaUrl = args.ollamaUrl ?? process.env.OPENSEC_OLLAMA_URL ?? process.env.CMDR_OLLAMA_URL ?? 'http://localhost:11434'

  // Handle 'serve' subcommand: cmdr serve [--port N] [--host H] [-m model]
  if (args.serve) {
    const model = args.model ?? process.env.CMDR_MODEL ?? 'qwen2.5-coder:14b'
    await startServer({
      port: args.port ?? 4141,
      host: args.host ?? '127.0.0.1',
      model,
      ollamaUrl,
      provider: args.provider,
    })
    return
  }

  // Handle 'daemon' subcommand: cmdr daemon start|status|stop
  if (args.daemon) {
    const cwd = args.cwd ? (await import('path')).resolve(args.cwd) : process.cwd()
    switch (args.daemon) {
      case 'start': {
        if (!args.watch || args.watch.length === 0) {
          console.error(renderError('--watch <path> required for daemon start'))
          process.exit(1)
        }
        if (!args.onChange) {
          console.error(renderError('--on-change <command> required for daemon start'))
          process.exit(1)
        }
        const daemon = new CmdrDaemon({ watchPaths: args.watch, onChange: args.onChange, cwd })
        await daemon.start()
        break
      }
      case 'status': {
        const info = await CmdrDaemon.status(cwd)
        if (info) {
          console.log(`${GREEN('●')} Daemon running (PID ${info.pid})`)
          console.log(`  Watching: ${info.watchPaths.join(', ')}`)
          console.log(`  On change: ${info.onChange}`)
          console.log(`  Started: ${info.startedAt}`)
        } else {
          console.log(`${DIM('○')} No daemon running for this directory`)
        }
        break
      }
      case 'stop': {
        const stopped = await CmdrDaemon.stopByPid(cwd)
        if (stopped) {
          console.log(`${GREEN('✓')} Daemon stopped`)
        } else {
          console.log(`${DIM('○')} No daemon running to stop`)
        }
        break
      }
      default:
        console.error(renderError(`Unknown daemon command: ${args.daemon}. Use: start, status, stop`))
        process.exit(1)
    }
    return
  }

  // Auto-detect model if not specified
  let model = args.model ?? process.env.OPENSEC_MODEL ?? process.env.CMDR_MODEL
  if (!model) {
    try {
      const adapter = new OllamaAdapter(ollamaUrl)
      const models = await adapter.listModels()
      if (models.length === 0) {
        console.error(renderError(
          'No models found in Ollama.\n' +
          '  Pull a model first: ollama pull qwen2.5-coder:14b',
        ))
        process.exit(1)
      }
      model = await promptModelSelection(models)
    } catch {
      console.error(renderError(
        `Cannot connect to Ollama at ${ollamaUrl}\n` +
        '  Make sure Ollama is running: ollama serve',
      ))
      process.exit(1)
    }
  }

  // Override working directory if --cwd is specified
  if (args.cwd) {
    const { resolve } = await import('path')
    const target = resolve(args.cwd)
    process.chdir(target)
  }

  // Handle 'scan' subcommand: opensec scan [path] [--quick] [--cloud]
  if (args.scanPath !== undefined) {
    const { resolve } = await import('path')
    const scanTarget = resolve(args.scanPath)

    // Change to scan target directory so agents work relative to it
    try {
      process.chdir(scanTarget)
    } catch {
      console.error(renderError(`Cannot access scan path: ${scanTarget}`))
      process.exit(1)
    }

    // --cloud: switch provider to anthropic or openai for analyst/consensus
    let scanProvider = args.provider
    if (args.scanCloud) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENSEC_ANTHROPIC_API_KEY
      const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENSEC_OPENAI_API_KEY
      if (anthropicKey) {
        scanProvider = 'anthropic'
        model = model ?? 'claude-opus-4-5'
        console.log(`  ${CYAN('☁')}  ${DIM('Cloud mode: Anthropic')}`)
      } else if (openaiKey) {
        scanProvider = 'openai'
        model = model ?? 'gpt-4o'
        console.log(`  ${CYAN('☁')}  ${DIM('Cloud mode: OpenAI')}`)
      } else {
        console.error(renderError(
          'Cloud mode requires ANTHROPIC_API_KEY or OPENAI_API_KEY.\n' +
          '  Falling back to local Ollama model.',
        ))
      }
    }

    // --quick: scanner agent only (single-agent, no full team pipeline)
    const teamMode = args.scanQuick ? undefined : 'security'
    const quickPrompt = args.scanQuick
      ? 'Run a quick security surface scan of this codebase. Use glob and grep to find all code, config, secret, and infra files. Output a structured JSON attack surface map.'
      : undefined

    checkForUpdate(VERSION).catch(() => {})

    try {
      await startRepl({
        model: model!,
        ollamaUrl,
        provider: scanProvider,
        version: VERSION,
        initialPrompt: quickPrompt,
        dangerouslySkipPermissions: args.dangerouslySkipPermissions,
        verbose: args.verbose,
        team: teamMode,
        maxTurns: args.maxTurns,
        outputFormat: args.outputFormat,
        effort: args.fast ? 'low' : args.effort,
        noBuddy: args.noBuddy,
      })
      console.log(`\n  ${GREEN('✦')} ${chalk.white.bold('Scan complete')} ${DIM('—')} ${DIM('OpenSec Intelligence by Prabinder Singh')}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(renderError(msg))
      process.exit(1)
    }
    return
  }

  // Handle 'fix' subcommand: run fixer agent on last scan results
  if (args.fix) {
    checkForUpdate(VERSION).catch(() => {})
    try {
      await startRepl({
        model: model!,
        ollamaUrl,
        provider: args.provider,
        version: VERSION,
        initialPrompt: 'You are the OpenSec fixer agent. Review the most recent security findings in this session and apply fixes. For each validated HIGH or CRITICAL finding: show the before/after diff, explain why the fix closes the vulnerability, then ask for approval before writing. After all fixes, run git diff and summarize all changes.',
        dangerouslySkipPermissions: args.dangerouslySkipPermissions,
        verbose: args.verbose,
        maxTurns: args.maxTurns,
        outputFormat: args.outputFormat,
        noBuddy: args.noBuddy,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(renderError(msg))
      process.exit(1)
    }
    return
  }

  // Handle 'report' subcommand: output HTML report of last findings
  if (args.report) {
    checkForUpdate(VERSION).catch(() => {})
    try {
      await startRepl({
        model: model!,
        ollamaUrl,
        provider: args.provider,
        version: VERSION,
        initialPrompt: 'Generate an HTML security report from the findings in this session. Include: executive summary, findings table (severity/file/line/description), CVSS estimates, remediation recommendations. Write the report to opensec-report.html in the current directory.',
        dangerouslySkipPermissions: args.dangerouslySkipPermissions,
        verbose: args.verbose,
        maxTurns: args.maxTurns,
        outputFormat: args.outputFormat,
        noBuddy: args.noBuddy,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(renderError(msg))
      process.exit(1)
    }
    return
  }

  // Non-blocking update check (fire-and-forget, prints after welcome banner)
  checkForUpdate(VERSION).catch(() => {})

  try {
    await startRepl({
      model,
      ollamaUrl,
      provider: args.provider,
      version: VERSION,
      initialPrompt: args.prompt,
      dangerouslySkipPermissions: args.dangerouslySkipPermissions,
      resume: args.resume,
      continue: args.continue,
      verbose: args.verbose,
      team: args.team,
      maxTurns: args.maxTurns,
      outputFormat: args.outputFormat,
      effort: args.fast ? 'low' : args.effort,
      image: args.image,
      noBuddy: args.noBuddy,
      browser: args.browser,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(renderError(msg))
    process.exit(1)
  }
}

main()
