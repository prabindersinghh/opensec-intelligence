/**
 * Config loader — loads configuration from multiple sources.
 *
 * Priority (highest to lowest):
 * 1. Environment variables (OPENSEC_*)
 * 2. Project-local .opensec.toml
 * 3. User-level ~/.opensec/config.toml
 * 4. Defaults
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml } from 'smol-toml'
import type { CmdrConfig, McpServerConfig } from '../core/types.js'
import { CmdrConfigSchema } from './schema.js'
import { DEFAULT_CONFIG } from './defaults.js'

async function tryReadToml(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, 'utf-8')
    return parseToml(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function getEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {}

  if (process.env.OPENSEC_MODEL) overrides.defaultModel = process.env.OPENSEC_MODEL
  if (process.env.OPENSEC_OLLAMA_URL) overrides.ollamaUrl = process.env.OPENSEC_OLLAMA_URL
  if (process.env.OPENSEC_PROVIDER) overrides.defaultProvider = process.env.OPENSEC_PROVIDER
  if (process.env.OPENSEC_MAX_CONCURRENCY) overrides.maxConcurrency = parseInt(process.env.OPENSEC_MAX_CONCURRENCY, 10)
  if (process.env.OPENSEC_MAX_TURNS) overrides.maxTurns = parseInt(process.env.OPENSEC_MAX_TURNS, 10)
  if (process.env.OPENSEC_CONTEXT_BUDGET) overrides.contextBudget = parseInt(process.env.OPENSEC_CONTEXT_BUDGET, 10)
  if (process.env.OPENSEC_TELEMETRY) overrides.telemetry = process.env.OPENSEC_TELEMETRY === 'true'

  return overrides
}

/**
 * Load and merge configuration from all sources.
 */
export async function loadConfig(cwd?: string): Promise<CmdrConfig> {
  const projectRoot = cwd ?? process.cwd()

  // Load config files
  const userConfig = await tryReadToml(join(homedir(), '.opensec', 'config.toml'))
  const projectConfig = await tryReadToml(join(projectRoot, '.opensec.toml'))
  const envOverrides = getEnvOverrides()

  // Merge: defaults < user < project < env
  const merged = {
    ...DEFAULT_CONFIG,
    ...(userConfig ?? {}),
    ...(projectConfig ?? {}),
    ...envOverrides,
  }

  // If nested objects, merge them individually
  if (userConfig?.permissions || projectConfig?.permissions) {
    merged.permissions = {
      ...DEFAULT_CONFIG.permissions,
      ...(userConfig?.permissions as Record<string, unknown> ?? {}),
      ...(projectConfig?.permissions as Record<string, unknown> ?? {}),
    }
  }

  if (userConfig?.mcp || projectConfig?.mcp) {
    const userServers = ((userConfig?.mcp as Record<string, unknown>)?.servers ?? []) as McpServerConfig[]
    const projectServers = ((projectConfig?.mcp as Record<string, unknown>)?.servers ?? []) as McpServerConfig[]
    merged.mcp = { servers: [...userServers, ...projectServers] }
  }

  // Validate with Zod
  const result = CmdrConfigSchema.safeParse(merged)
  if (!result.success) {
    // Return default if validation fails, log warning
    console.warn(`[opensec] Config validation warning: ${result.error.issues.map(i => i.message).join(', ')}`)
    return DEFAULT_CONFIG
  }

  return result.data as CmdrConfig
}

/**
 * Get the path to the user-level config file.
 */
export function getUserConfigPath(): string {
  return join(homedir(), '.opensec', 'config.toml')
}

/**
 * Get the path to the project-level config file.
 */
export function getProjectConfigPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), '.opensec.toml')
}
