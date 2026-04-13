/**
 * Spinner — loading/thinking indicators for the terminal.
 *
 * Picks a rotating verb, shows elapsed time, and tracks structured phases.
 * Integrates with the progress tracker for structured phase transitions.
 */

import ora, { type Ora } from 'ora'
import * as fs from 'fs'
import * as path from 'path'
import { parse as parseToml } from 'smol-toml'
import { PURPLE, GREEN, CYAN, DIM } from './theme.js'
import {
  setPhase, startToolExecution, endToolExecution, addTokens,
  setTurn, resetProgress, getPhaseState, formatSessionSummary,
  type AgentPhase,
} from './progress.js'

// ---------------------------------------------------------------------------
// Default verb pool (150+)
// ---------------------------------------------------------------------------

const DEFAULT_VERBS: string[] = [
  // Technical
  'Computing', 'Architecting', 'Bootstrapping', 'Compiling', 'Deploying',
  'Refactoring', 'Debugging', 'Profiling', 'Indexing', 'Optimizing',
  'Transpiling', 'Serializing', 'Deserializing', 'Parallelizing', 'Vectorizing',
  'Tokenizing', 'Parsing', 'Linking', 'Resolving', 'Provisioning',
  'Instantiating', 'Iterating', 'Recursing', 'Memoizing', 'Caching',
  'Hashing', 'Encrypting', 'Decrypting', 'Benchmarking', 'Sandboxing',
  'Containerizing', 'Orchestrating', 'Sharding', 'Reticulating',
  // Whimsical
  'Noodling', 'Percolating', 'Combobulating', 'Discombobulating', 'Flummoxing',
  'Befuddling', 'Gallivanting', 'Frolicking', 'Bamboozling', 'Confabulating',
  'Discomboobling', 'Flibbertigibbeting', 'Lollygagging', 'Skedaddling',
  'Dillydallying', 'Shilly-shallying', 'Wibbling', 'Wobbling', 'Frittering',
  'Cogitating', 'Ruminating', 'Pondering', 'Musing', 'Mulling',
  'Deliberating', 'Concocting', 'Contriving', 'Devising', 'Hatching',
  'Brainstorming', 'Daydreaming', 'Wool-gathering', 'Blathering',
  // Cooking
  'Simmering', 'Marinating', 'Caramelizing', 'Sauteing', 'Fermenting',
  'Blanching', 'Julienning', 'Flambeing', 'Braising', 'Deglazing',
  'Emulsifying', 'Proofing', 'Kneading', 'Whisking', 'Folding',
  'Basting', 'Tempering', 'Infusing', 'Reducing', 'Zesting',
  'Pickling', 'Curing', 'Smoking', 'Glazing', 'Drizzling',
  // Movement
  'Moonwalking', 'Pirouetting', 'Shimmying', 'Sashaying', 'Tiptoeing',
  'Somersaulting', 'Cartwheeling', 'Leapfrogging', 'Waltzing', 'Tangoing',
  'Boogieing', 'Breakdancing', 'Sidestepping', 'Hopscotching', 'Tumbling',
  'Prancing', 'Strutting', 'Ambling', 'Meandering', 'Traipsing',
  // cmdr-themed
  'Commanding', 'Marshalling', 'Strategizing', 'Reconnoitering', 'Outflanking',
  'Maneuvering', 'Flanking', 'Advancing', 'Fortifying', 'Rallying',
  'Scouting', 'Patrolling', 'Mustering', 'Garrisoning', 'Besieging',
  'Encamping', 'Outmaneuvering', 'Spearheading', 'Mobilizing', 'Dispatching',
  // Nature / science
  'Photosynthesizing', 'Crystallizing', 'Metamorphosing', 'Germinating', 'Pollinating',
  'Hibernating', 'Migrating', 'Burrowing', 'Foraging', 'Nesting',
  'Blooming', 'Coalescing', 'Condensing', 'Evaporating', 'Precipitating',
  // Crafts / making
  'Weaving', 'Sculpting', 'Hammering', 'Welding', 'Soldering',
  'Chiseling', 'Whittling', 'Origami-ing', 'Quilting', 'Embroidering',
  'Knitting', 'Crocheting', 'Glazing', 'Lacquering', 'Gilding',
  // Misc fun
  'Spelunking', 'Stargazing', 'Beachcombing', 'Birdwatching', 'Tinkering',
  'Puttering', 'Rummaging', 'Scavenging', 'Thrift-shopping', 'Bushwhacking',
  'Trailblazing', 'Pathfinding', 'Wayfinding', 'Barnstorming', 'Swashbuckling',
  'Adventuring', 'Questing', 'Voyaging', 'Seafaring', 'Bushcrafting',
]

// ---------------------------------------------------------------------------
// Verb pool (merged with user config)
// ---------------------------------------------------------------------------

let verbPool: string[] = [...DEFAULT_VERBS]
let configLoaded = false

function loadVerbConfig(): void {
  if (configLoaded) return
  configLoaded = true

  const configPath = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.opensec',
    'config.toml',
  )

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = parseToml(raw) as Record<string, unknown>
    const spinner = config.spinner as Record<string, unknown> | undefined
    if (!spinner) return

    const userVerbs = spinner.verbs
    const mode = (spinner.mode as string) ?? 'append'

    if (Array.isArray(userVerbs) && userVerbs.length > 0) {
      const valid = userVerbs.filter((v): v is string => typeof v === 'string')
      if (mode === 'replace') {
        verbPool = valid
      } else {
        // append (default) — deduplicate
        const existing = new Set(verbPool)
        for (const v of valid) {
          if (!existing.has(v)) verbPool.push(v)
        }
      }
    }
  } catch {
    // No config file or parse error — use defaults
  }
}

// ---------------------------------------------------------------------------
// Past-tense conversion
// ---------------------------------------------------------------------------

function toPastTense(verb: string): string {
  // "Computing" → "Computed", "Simmering" → "Simmered", etc.
  if (!verb.endsWith('ing')) return verb
  const stem = verb.slice(0, -3) // strip "ing"

  // Handle special patterns
  if (stem.endsWith('tt') || stem.endsWith('nn') || stem.endsWith('ll') ||
      stem.endsWith('mm') || stem.endsWith('rr') || stem.endsWith('pp') ||
      stem.endsWith('dd') || stem.endsWith('gg') || stem.endsWith('bb') ||
      stem.endsWith('ss') || stem.endsWith('zz')) {
    return stem + 'ed'
  }
  // "e" was dropped: Compil(e) + ing → Compil + ed → Compiled
  // Heuristic: if stem ends in a consonant cluster that looks like "e" was dropped
  const lastChar = stem[stem.length - 1]
  if (lastChar && 'bcdfghjklmnpqrstvwxyz'.includes(lastChar.toLowerCase())) {
    // Check if adding "e" back makes sense: simmer→simmered, not simmer→simmered
    // Simple heuristic: if the stem itself looks like a word root ending in
    // a single consonant after a vowel, double-check
    const secondLast = stem[stem.length - 2]
    if (secondLast && 'aeiou'.includes(secondLast.toLowerCase())) {
      // consonant-vowel-consonant at end: likely "e" was dropped
      // e.g., "Comput" → "Computed" (stem="Comput", add "ed")
      return stem + 'ed'
    }
    // Otherwise just add "ed"
    return stem + 'ed'
  }

  return stem + 'ed'
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const CMDR_SPINNER = {
  frames: ['◇ ', '◈ ', '◆ ', '◈ '],
  interval: 120,
}

let activeSpinner: Ora | null = null
let rotateTimer: ReturnType<typeof setInterval> | null = null
let startTime = 0
let currentVerb = 'Thinking'
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let lastToolName = ''

function pickVerb(): string {
  loadVerbConfig()
  return verbPool[Math.floor(Math.random() * verbPool.length)]
}

function updateText(): void {
  if (!activeSpinner) return
  const elapsed = Math.round((Date.now() - startTime) / 1000)
  activeSpinner.text = PURPLE(`${currentVerb}...`) + DIM(` (${elapsed}s)`)
}

function rotateVerb(): void {
  currentVerb = pickVerb()
  updateText()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startThinking(_message?: string): void {
  stopSpinner()
  setPhase('thinking')
  startTime = Date.now()
  currentVerb = pickVerb()

  activeSpinner = ora({
    text: PURPLE(`${currentVerb}...`) + DIM(' (0s)'),
    spinner: CMDR_SPINNER,
    color: 'magenta',
    prefixText: '  ',
  }).start()

  // Update elapsed every second
  elapsedTimer = setInterval(updateText, 1000)
  // Rotate verb every 2-3s
  const rotateMs = 2000 + Math.random() * 1000
  rotateTimer = setInterval(rotateVerb, rotateMs)
}

export function startWaitingApproval(toolName?: string): void {
  stopSpinner()
  setPhase('waiting_approval')
  activeSpinner = ora({
    text: toolName
      ? `${CYAN(toolName)} ${DIM('awaiting approval...')}`
      : `${CYAN('action')} ${DIM('awaiting approval...')}`,
    spinner: {
      frames: ['◐', '◓', '◑', '◒'],
      interval: 160,
    },
    color: 'yellow',
    prefixText: '  ',
  }).start()
}

export function startToolExec(toolName: string): void {
  stopSpinner()
  startToolExecution(toolName)
  lastToolName = toolName
  activeSpinner = ora({
    text: `${CYAN(toolName)} ${DIM('executing...')}`,
    spinner: {
      frames: ['⚡', '⚡', '⚡', ' '],
      interval: 200,
    },
    color: 'cyan',
    prefixText: '  ',
  }).start()
}

export function spinnerSuccess(message?: string): void {
  if (activeSpinner) {
    activeSpinner.succeed(message ? GREEN(message) : undefined)
    activeSpinner = null
  }
  if (lastToolName) {
    endToolExecution(lastToolName, 'success')
    lastToolName = ''
  }
  clearTimers()
}

export function spinnerFail(message?: string): void {
  if (activeSpinner) {
    activeSpinner.fail(message)
    activeSpinner = null
  }
  if (lastToolName) {
    endToolExecution(lastToolName, 'error')
    lastToolName = ''
  }
  clearTimers()
}

export function stopSpinner(): void {
  if (activeSpinner) {
    activeSpinner.stop()
    activeSpinner = null
  }
  clearTimers()
}

export function updateSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.text = text
  }
}

/** Returns elapsed seconds since the last startThinking() call. */
export function getElapsedSeconds(): number {
  return Math.round((Date.now() - startTime) / 1000)
}

/** Returns "Percolated for 12s" style summary using the last verb in past tense. */
export function getCompletionSummary(): string {
  const elapsed = getElapsedSeconds()
  return `${toPastTense(currentVerb)} for ${elapsed}s`
}

function clearTimers(): void {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
}

// ---------------------------------------------------------------------------
// Re-export progress tracker functions for convenience
// ---------------------------------------------------------------------------

export {
  setPhase, setTurn, addTokens, resetProgress,
  getPhaseState, formatSessionSummary,
  type AgentPhase,
} from './progress.js'
