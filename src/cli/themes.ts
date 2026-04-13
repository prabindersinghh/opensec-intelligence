/**
 * Structured theme system for cmdr.
 *
 * Defines the CmdrTheme interface, built-in themes, and a
 * global active theme that other modules can read.
 */

import chalk, { type ChalkInstance } from 'chalk'

// ---------------------------------------------------------------------------
// Theme interface
// ---------------------------------------------------------------------------

export interface CmdrTheme {
  name: string
  type: 'dark' | 'light' | 'custom'

  surface: {
    base: string
    panel: string
    elevated: string
    focus: string
  }

  text: {
    primary: string
    secondary: string
    accent: string
    muted: string
    inverse: string
  }

  syntax: {
    keyword: string
    string: string
    number: string
    comment: string
    function: string
    type: string
  }

  message: {
    user: string
    assistant: string
    system: string
    tool: string
    toolResult: string
  }

  status: {
    success: string
    error: string
    warning: string
    info: string
    thinking: string
  }

  tool: {
    name: string
    executing: string
    result: string
    border: string
    pending: string
  }

  ui: {
    border: string
    separator: string
    prompt: string
    banner: string
    bannerAccent: string
    badge: string
  }
}

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

const industrialTerminal: CmdrTheme = {
  name: 'industrial-terminal',
  type: 'dark',
  surface: {
    base: '#05080C',
    panel: '#0D141B',
    elevated: '#101B24',
    focus: '#132331',
  },
  text: {
    primary: '#D5DEE6',
    secondary: '#72808F',
    accent: '#2DD4BF',
    muted: '#51606E',
    inverse: '#051017',
  },
  syntax: {
    keyword: '#FF8A3D',
    string: '#7CFF5B',
    number: '#FBBF24',
    comment: '#5A6878',
    function: '#22D3EE',
    type: '#2DD4BF',
  },
  message: {
    user: '#7CFF5B',
    assistant: '#2DD4BF',
    system: '#22D3EE',
    tool: '#F59E0B',
    toolResult: '#9AA6B2',
  },
  status: {
    success: '#3AE374',
    error: '#FF5D5D',
    warning: '#FBBF24',
    info: '#22D3EE',
    thinking: '#2DD4BF',
  },
  tool: {
    name: '#F59E0B',
    executing: '#F59E0B',
    result: '#9AA6B2',
    border: '#2A3A46',
    pending: '#6C7A88',
  },
  ui: {
    border: '#2A3A46',
    separator: '#314656',
    prompt: '#7CFF5B',
    banner: '#7CFF5B',
    bannerAccent: '#2DD4BF',
    badge: '#FF8A3D',
  },
}

const industrialLight: CmdrTheme = {
  name: 'industrial-light',
  type: 'light',
  surface: {
    base: '#F3F7FA',
    panel: '#EAF1F6',
    elevated: '#DFE9F2',
    focus: '#D4E1ED',
  },
  text: {
    primary: '#1E2A35',
    secondary: '#5B6B7B',
    accent: '#0C7A6F',
    muted: '#7D8A97',
    inverse: '#FFFFFF',
  },
  syntax: {
    keyword: '#C25513',
    string: '#2D7A33',
    number: '#B88100',
    comment: '#728191',
    function: '#0F7C9A',
    type: '#0C7A6F',
  },
  message: {
    user: '#2D7A33',
    assistant: '#0C7A6F',
    system: '#0F7C9A',
    tool: '#BA6D00',
    toolResult: '#4F6274',
  },
  status: {
    success: '#198754',
    error: '#CC3F3F',
    warning: '#C58A00',
    info: '#0F7C9A',
    thinking: '#0C7A6F',
  },
  tool: {
    name: '#BA6D00',
    executing: '#BA6D00',
    result: '#5B6B7B',
    border: '#C8D5E0',
    pending: '#8FA0AE',
  },
  ui: {
    border: '#C8D5E0',
    separator: '#B8C8D6',
    prompt: '#2D7A33',
    banner: '#2D7A33',
    bannerAccent: '#0C7A6F',
    badge: '#C25513',
  },
}

const monokai: CmdrTheme = {
  name: 'monokai',
  type: 'dark',
  surface: { base: '#1F1F1F', panel: '#272822', elevated: '#2D2E28', focus: '#343630' },
  text: { primary: '#F8F8F2', secondary: '#75715E', accent: '#AE81FF', muted: '#49483E', inverse: '#1F1F1F' },
  syntax: { keyword: '#F92672', string: '#E6DB74', number: '#AE81FF', comment: '#75715E', function: '#A6E22E', type: '#66D9EF' },
  message: { user: '#A6E22E', assistant: '#66D9EF', system: '#AE81FF', tool: '#E6DB74', toolResult: '#75715E' },
  status: { success: '#A6E22E', error: '#F92672', warning: '#E6DB74', info: '#66D9EF', thinking: '#AE81FF' },
  tool: { name: '#66D9EF', executing: '#E6DB74', result: '#75715E', border: '#49483E', pending: '#75715E' },
  ui: { border: '#49483E', separator: '#5A594F', prompt: '#A6E22E', banner: '#A6E22E', bannerAccent: '#AE81FF', badge: '#F92672' },
}

const nord: CmdrTheme = {
  name: 'nord',
  type: 'dark',
  surface: { base: '#2B303B', panel: '#323A47', elevated: '#3A4454', focus: '#434E60' },
  text: { primary: '#ECEFF4', secondary: '#4C566A', accent: '#B48EAD', muted: '#3B4252', inverse: '#2B303B' },
  syntax: { keyword: '#81A1C1', string: '#A3BE8C', number: '#B48EAD', comment: '#616E88', function: '#88C0D0', type: '#EBCB8B' },
  message: { user: '#A3BE8C', assistant: '#88C0D0', system: '#B48EAD', tool: '#EBCB8B', toolResult: '#4C566A' },
  status: { success: '#A3BE8C', error: '#BF616A', warning: '#EBCB8B', info: '#88C0D0', thinking: '#B48EAD' },
  tool: { name: '#88C0D0', executing: '#EBCB8B', result: '#4C566A', border: '#3B4252', pending: '#616E88' },
  ui: { border: '#3B4252', separator: '#4C566A', prompt: '#A3BE8C', banner: '#88C0D0', bannerAccent: '#B48EAD', badge: '#BF616A' },
}

const solarizedDark: CmdrTheme = {
  name: 'solarized-dark',
  type: 'dark',
  surface: { base: '#002B36', panel: '#073642', elevated: '#0A3D4C', focus: '#114A59' },
  text: { primary: '#839496', secondary: '#586E75', accent: '#6C71C4', muted: '#073642', inverse: '#FDF6E3' },
  syntax: { keyword: '#859900', string: '#2AA198', number: '#D33682', comment: '#586E75', function: '#268BD2', type: '#B58900' },
  message: { user: '#859900', assistant: '#2AA198', system: '#268BD2', tool: '#B58900', toolResult: '#586E75' },
  status: { success: '#859900', error: '#DC322F', warning: '#B58900', info: '#2AA198', thinking: '#6C71C4' },
  tool: { name: '#268BD2', executing: '#B58900', result: '#586E75', border: '#073642', pending: '#586E75' },
  ui: { border: '#073642', separator: '#114A59', prompt: '#859900', banner: '#268BD2', bannerAccent: '#6C71C4', badge: '#D33682' },
}

// ---------------------------------------------------------------------------
// Theme registry
// ---------------------------------------------------------------------------

export const BUILT_IN_THEMES: Record<string, CmdrTheme> = {
  'industrial-terminal': industrialTerminal,
  'industrial-light': industrialLight,
  'opensec-dark': industrialTerminal,
  'opensec-light': industrialLight,
  'monokai': monokai,
  'nord': nord,
  'solarized-dark': solarizedDark,
}

let activeTheme: CmdrTheme = industrialTerminal

/** Get the currently active theme. */
export function getActiveTheme(): CmdrTheme {
  return activeTheme
}

/** Switch the active theme by name (returns false if not found). */
export function setActiveTheme(name: string): boolean {
  const theme = BUILT_IN_THEMES[name]
  if (!theme) return false
  activeTheme = theme
  return true
}

/** Register a custom theme. */
export function registerTheme(theme: CmdrTheme): void {
  BUILT_IN_THEMES[theme.name] = theme
}

/** List all available theme names. */
export function listThemeNames(): string[] {
  return Object.keys(BUILT_IN_THEMES)
}

// ---------------------------------------------------------------------------
// Theme-aware chalk helpers
// ---------------------------------------------------------------------------

/** Create a chalk function from the active theme. */
export function t(category: keyof CmdrTheme, key: string): ChalkInstance {
  const cat = activeTheme[category]
  if (cat && typeof cat === 'object' && key in cat) {
    return chalk.hex((cat as Record<string, string>)[key])
  }
  return chalk.white
}
