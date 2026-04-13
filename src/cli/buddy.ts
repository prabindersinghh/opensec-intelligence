/**
 * Buddy system — deterministic ASCII companion pet.
 *
 * Species is derived from a machine ID hash (hostname + user).
 * XP: sessions +5, tool calls +1, tasks +10.
 * Persisted to ~/.cmdr/buddy.json.
 */

import { createHash } from 'node:crypto'
import { homedir, hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

// ── Species database ────────────────────────────────────────────────

interface Species {
  name: string
  art: string[]
  greetings: string[]
}

const SPECIES: Species[] = [
  { name: 'Fox', art: ['  /\\_/\\', ' ( o.o )', '  > ^ <'], greetings: ['Ready to code!', 'Let\'s ship it!', 'Bugs beware!'] },
  { name: 'Cat', art: ['  /\\_/\\', ' ( =.= )', ' />   \\>'], greetings: ['Meow, let\'s debug.', 'Purring with code.', 'Nap? After this fix.'] },
  { name: 'Owl', art: ['  {o,o}', ' /)__)', '  " "'], greetings: ['Whooo\'s coding?', 'Wise choice.', 'I see all bugs.'] },
  { name: 'Bear', art: ['  ʕ•ᴥ•ʔ', '  /   \\', ' /     \\'], greetings: ['Bear with me.', 'Strong code ahead.', 'Honey, let\'s go!'] },
  { name: 'Bunny', art: ['  (\\(\\', '  (-.-)', ' o_(")(")'], greetings: ['Hop to it!', 'Quick like me!', 'Carrot-powered.'] },
  { name: 'Dog', art: ['  ∪･ω･∪', '  /|  |\\', ' (_|  |_)'], greetings: ['Woof! Let\'s go!', 'Good code!', 'Fetch the bugs!'] },
  { name: 'Penguin', art: ['   (o>', '  //\\\\', ' V_/_'], greetings: ['Chill vibes only.', 'Sliding into code.', 'Ice cold logic.'] },
  { name: 'Dragon', art: ['  /\\_/\\~', ' (⊙ω⊙)', '  /|__|\\'], greetings: ['Fire up the build!', 'Breathe code.', 'Legendary commit!'] },
  { name: 'Panda', art: ['  ʕ·͡ᴥ·ʔ', '  /   \\', ' (     )'], greetings: ['Bamboo break?', 'Zen coding time.', 'Black & white logic.'] },
  { name: 'Raccoon', art: ['  (•ᴗ•)', '  <|  |>', '  _|  |_'], greetings: ['Trash code? Fixed!', 'Sneaky bug found.', 'Night owl mode.'] },
  { name: 'Wolf', art: ['  /·.·\\', ' (  ω  )', ' /|   |\\'], greetings: ['Pack mentality.', 'Howling at bugs.', 'Alpha commit.'] },
  { name: 'Frog', art: ['  @..@', ' (----)', ' (    )'], greetings: ['Ribbit, let\'s go!', 'Leap of faith.', 'No flies here.'] },
  { name: 'Octopus', art: ['   ,_,', '  (o o)', ' /|||||\\'], greetings: ['8 arms, 0 bugs.', 'Multi-tasking!', 'Tentacle power.'] },
  { name: 'Squirrel', art: ['  /|,|\\', ' (o  o)', '  \\  /'], greetings: ['Nuts about code!', 'Stashing commits.', 'Acorn-driven dev.'] },
  { name: 'Hedgehog', art: ['  /\\^/\\', ' ( . . )', ' (  u  )'], greetings: ['Prickly problems?', 'Curled up coding.', 'Spike the bugs!'] },
  { name: 'Parrot', art: ['   _', '  (o>', ' //||'], greetings: ['Polly wants a PR!', 'Squawk! Ship it!', 'Colorful code!'] },
]

// ── Achievement definitions ─────────────────────────────────────────

interface Achievement {
  id: string
  name: string
  description: string
  requirement: (state: BuddyState) => boolean
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_session', name: 'Hello World', description: 'Complete your first session', requirement: s => s.totalSessions >= 1 },
  { id: 'ten_sessions', name: 'Regular', description: 'Complete 10 sessions', requirement: s => s.totalSessions >= 10 },
  { id: 'fifty_sessions', name: 'Veteran', description: 'Complete 50 sessions', requirement: s => s.totalSessions >= 50 },
  { id: 'hundred_tools', name: 'Tool Master', description: 'Make 100 tool calls', requirement: s => s.totalToolCalls >= 100 },
  { id: 'thousand_tools', name: 'Automation King', description: 'Make 1000 tool calls', requirement: s => s.totalToolCalls >= 1000 },
  { id: 'ten_tasks', name: 'Task Runner', description: 'Complete 10 tasks', requirement: s => s.totalTasks >= 10 },
  { id: 'level_five', name: 'Rising Star', description: 'Reach level 5', requirement: s => getLevel(s.xp) >= 5 },
  { id: 'level_ten', name: 'Seasoned Dev', description: 'Reach level 10', requirement: s => getLevel(s.xp) >= 10 },
  { id: 'level_twenty', name: 'Elite Coder', description: 'Reach level 20', requirement: s => getLevel(s.xp) >= 20 },
]

// ── State ───────────────────────────────────────────────────────────

export interface BuddyState {
  speciesIndex: number
  customName?: string
  xp: number
  totalSessions: number
  totalToolCalls: number
  totalTasks: number
  achievements: string[]
  createdAt: string
}

function getLevel(xp: number): number {
  // Each level requires level * 50 XP (triangular)
  let level = 1
  let threshold = 50
  while (xp >= threshold) {
    level++
    threshold += level * 50
  }
  return level
}

function xpForNextLevel(xp: number): { current: number; needed: number } {
  let level = 1
  let prevThreshold = 0
  let threshold = 50
  while (xp >= threshold) {
    level++
    prevThreshold = threshold
    threshold += level * 50
  }
  return { current: xp - prevThreshold, needed: threshold - prevThreshold }
}

// ── Manager ─────────────────────────────────────────────────────────

export class BuddyManager {
  private statePath: string
  private state: BuddyState | null = null

  constructor() {
    this.statePath = join(homedir(), '.cmdr', 'buddy.json')
  }

  /** Load or initialize buddy state. */
  async load(): Promise<BuddyState> {
    if (this.state) return this.state

    try {
      const raw = await readFile(this.statePath, 'utf-8')
      this.state = JSON.parse(raw) as BuddyState
    } catch {
      // Initialize with deterministic species
      const machineId = `${hostname()}-${userInfo().username}`
      const hash = createHash('sha256').update(machineId).digest()
      const speciesIndex = hash[0] % SPECIES.length

      this.state = {
        speciesIndex,
        xp: 0,
        totalSessions: 0,
        totalToolCalls: 0,
        totalTasks: 0,
        achievements: [],
        createdAt: new Date().toISOString(),
      }
      await this.save()
    }

    return this.state!
  }

  /** Save state to disk. */
  private async save(): Promise<void> {
    if (!this.state) return
    const dir = join(homedir(), '.cmdr')
    await mkdir(dir, { recursive: true })
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2))
  }

  /** Record the start of a session (+5 XP). */
  async recordSession(): Promise<string[]> {
    const state = await this.load()
    state.xp += 5
    state.totalSessions++
    const newAchievements = this.checkAchievements()
    await this.save()
    return newAchievements
  }

  /** Record a tool call (+1 XP). */
  async recordToolCall(): Promise<void> {
    const state = await this.load()
    state.xp += 1
    state.totalToolCalls++
    await this.save()
  }

  /** Record a completed task (+10 XP). */
  async recordTask(): Promise<string[]> {
    const state = await this.load()
    state.xp += 10
    state.totalTasks++
    const newAchievements = this.checkAchievements()
    await this.save()
    return newAchievements
  }

  /** Check for newly unlocked achievements. Returns names of new ones. */
  private checkAchievements(): string[] {
    if (!this.state) return []
    const newOnes: string[] = []
    for (const ach of ACHIEVEMENTS) {
      if (!this.state.achievements.includes(ach.id) && ach.requirement(this.state)) {
        this.state.achievements.push(ach.id)
        newOnes.push(ach.name)
      }
    }
    return newOnes
  }

  /** Get the species for the current buddy. */
  getSpecies(): Species {
    return SPECIES[this.state?.speciesIndex ?? 0]
  }

  /** Render startup greeting line. */
  async getGreeting(): Promise<string> {
    const state = await this.load()
    const species = SPECIES[state.speciesIndex]
    const level = getLevel(state.xp)
    const name = state.customName ?? species.name
    const greeting = species.greetings[state.totalSessions % species.greetings.length]
    const progress = xpForNextLevel(state.xp)

    const artLines = species.art
    const info = `${name} the ${species.name} (Lv.${level}, ${state.xp} XP)`
    const quote = `"${greeting}"`

    const lines: string[] = []
    for (let i = 0; i < artLines.length; i++) {
      const pad = artLines[i].padEnd(14)
      if (i === 0) lines.push(`${pad}${info}`)
      else if (i === 1) lines.push(`${pad}${quote}`)
      else lines.push(pad)
    }
    lines.push(`${''.padEnd(14)}[${progressBar(progress.current, progress.needed)}] ${progress.current}/${progress.needed} XP`)

    return lines.join('\n')
  }

  /** Set a custom name for the buddy. */
  async setName(name: string): Promise<void> {
    const state = await this.load()
    state.customName = name
    await this.save()
  }

  /** Get list of unlocked achievement names. */
  async getAchievements(): Promise<string[]> {
    const state = await this.load()
    return ACHIEVEMENTS
      .filter(a => state.achievements.includes(a.id))
      .map(a => `${a.name} — ${a.description}`)
  }
}

function progressBar(current: number, total: number, width = 20): string {
  const filled = Math.round((current / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
