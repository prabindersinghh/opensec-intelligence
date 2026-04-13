/**
 * Default configuration values for cmdr.
 */

import type { CmdrConfig } from '../core/types.js'

export const DEFAULT_CONFIG: CmdrConfig = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'qwen2.5-coder:14b',
  defaultProvider: 'ollama',
  maxConcurrency: 2,
  maxTurns: 30,
  contextBudget: 32768,
  autoCompact: true,
  permissions: {
    allowBash: true,
    allowFileWrite: true,
    allowNetwork: false,
  },
  mcp: {
    servers: [],
  },
  plugins: [],
}
