/**
 * Update checker — non-blocking check against npm registry.
 *
 * Runs in the background when cmdr starts. If a newer version exists,
 * prints a one-line notice after the welcome banner.
 */

import { YELLOW, GREEN, DIM } from './theme.js'

const PACKAGE_NAME = 'cmdr-agent'

/**
 * Fetch the latest published version from the npm registry.
 * Returns null on any failure (network, timeout, parse error).
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
    clearTimeout(timeout)

    if (!res.ok) return null

    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 */
function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [cMaj, cMin, cPat] = parse(current)
  const [lMaj, lMin, lPat] = parse(latest)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

/**
 * Check for updates and print a notice if one is available.
 * This is fire-and-forget — never throws, never blocks startup.
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  const latest = await fetchLatestVersion()
  if (!latest) return
  if (!isNewer(currentVersion, latest)) return

  console.log('')
  console.log(
    `  ${YELLOW('⬆')}  Update available: ${DIM(`v${currentVersion}`)} → ${GREEN(`v${latest}`)}`,
  )
  console.log(
    `     Run ${GREEN(`npm install -g ${PACKAGE_NAME}`)} to update`,
  )
}
