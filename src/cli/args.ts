/**
 * CLI argument parsing.
 */

import chalk from 'chalk'
import type { EffortLevel } from '../core/types.js'

export interface CliArgs {
  model?: string
  ollamaUrl?: string
  provider?: string
  help?: boolean
  version?: boolean
  prompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  continue?: boolean
  verbose?: boolean
  cwd?: string
  team?: string
  maxTurns?: number
  outputFormat?: 'text' | 'json' | 'stream-json'
  effort?: EffortLevel
  fast?: boolean
  image?: string
  // serve subcommand
  serve?: boolean
  port?: number
  host?: string
  // buddy
  noBuddy?: boolean
  // daemon subcommand
  daemon?: string  // 'start' | 'status' | 'stop'
  watch?: string[]
  onChange?: string
  // browser
  browser?: boolean
  // opensec subcommands
  scanPath?: string   // 'scan [path]' — triggers security team preset
  scanQuick?: boolean // --quick: scanner agent only
  scanCloud?: boolean // --cloud: use cloud provider for analyst/consensus
  fix?: boolean       // 'fix' — run fixer agent on last scan results
  report?: boolean    // 'report' — output HTML report of last findings
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]

    switch (arg) {
      case '--model':
      case '-m':
        args.model = argv[++i]
        break
      case '--ollama-url':
      case '-u':
        args.ollamaUrl = argv[++i]
        break
      case '--provider':
        args.provider = argv[++i]
        break
      case '--help':
      case '-h':
        args.help = true
        break
      case '--version':
      case '-v':
        args.version = true
        break
      case '--prompt':
      case '-p':
        args.prompt = argv[++i]
        break
      case '--dangerously-skip-permissions':
        args.dangerouslySkipPermissions = true
        break
      case '--resume':
      case '-r':
        args.resume = argv[++i]
        break
      case '--continue':
      case '-c':
        args.continue = true
        break
      case '--cwd':
        args.cwd = argv[++i]
        break
      case '--verbose':
        args.verbose = true
        break
      case '--max-turns':
        args.maxTurns = parseInt(argv[++i], 10)
        break
      case '--team':
      case '-t':
        args.team = argv[++i]
        break
      case '--output-format':
        args.outputFormat = argv[++i] as 'text' | 'json' | 'stream-json'
        break
      case '--effort':
      case '-e':
        args.effort = argv[++i] as EffortLevel
        break
      case '--fast':
        args.fast = true
        break
      case '--image':
      case '-i':
        args.image = argv[++i]
        break
      case 'scan':
        // opensec scan [path] [--quick] [--cloud]
        args.scanPath = (argv[i + 1] && !argv[i + 1].startsWith('-')) ? argv[++i] : './'
        break
      case 'fix':
        args.fix = true
        break
      case 'report':
        args.report = true
        break
      case '--quick':
        args.scanQuick = true
        break
      case '--cloud':
        args.scanCloud = true
        break
      case 'serve':
        args.serve = true
        break
      case 'daemon':
        args.daemon = argv[++i] // start|status|stop
        break
      case '--watch':
        if (!args.watch) args.watch = []
        args.watch.push(argv[++i])
        break
      case '--on-change':
        args.onChange = argv[++i]
        break
      case '--port':
        args.port = parseInt(argv[++i], 10)
        break
      case '--host':
        args.host = argv[++i]
        break
      case '--no-buddy':
        args.noBuddy = true
        break
      case '--browser':
        args.browser = true
        break
      default:
        // If no flag prefix, treat as inline prompt
        if (!arg.startsWith('-') && !args.prompt) {
          args.prompt = argv.slice(i).join(' ')
          i = argv.length
        }
        break
    }

    i++
  }

  return args
}

export function printHelp(): void {
  const GREEN = chalk.hex('#00FF94').bold
  const PINK = chalk.hex('#FF2D78').bold
  const DIM = chalk.gray
  const SEP = chalk.hex('#FF2D78').dim('─'.repeat(41))

  console.log(`
  ${chalk.white.bold('OpenSec Intelligence')} ${DIM('— local-first AI security engine')}

  ${GREEN('SCAN COMMANDS')}
    opensec scan [path]          Full 4-agent security scan (default: ./)
    opensec scan [path] --quick  Scanner only, fast sweep
    opensec scan [path] --cloud  Cloud models for analyst + consensus

  ${GREEN('FIX & REPORT')}
    opensec fix                  Apply fixes from last scan
    opensec report               Generate HTML security report

  ${GREEN('GENERAL')}
    opensec -m <model>           Set Ollama model
    opensec serve                Start HTTP API server
    opensec --help               Show this help
    opensec --version            Show version

  ${GREEN('RECOMMENDED MODELS')}
    qwen2.5-coder:14b            Best for security analysis
    deepseek-r1:14b              Best for consensus reasoning
    llama3.2:3b                  Fast scanner (low resource)

  ${SEP}
  ${GREEN('OpenSec Intelligence')} ${PINK('by Prabinder Singh')}
  ${DIM('github.com/prabindersinghh/opensec-intelligence')}
  ${SEP}
`)
}
