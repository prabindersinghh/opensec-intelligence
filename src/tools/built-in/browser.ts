/**
 * Browser tools — optional Playwright-based browser automation.
 *
 * These tools are only registered when `--browser` is passed and
 * playwright-core is available. Each tool dynamically imports
 * playwright-core to avoid hard dependency.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import type { ToolDefinition } from '../../core/types.js'

/** Dynamically load playwright-core. Returns null if not installed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPlaywright(): Promise<any | null> {
  try {
    // Dynamic import with variable to prevent TS from resolving the module at compile time
    const moduleName = 'playwright-core'
    return await import(/* @vite-ignore */ moduleName)
  } catch {
    return null
  }
}

/** Shared browser instance (lazy, singleton per process). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserPromise: Promise<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBrowser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = await loadPlaywright()
      if (!pw) throw new Error('playwright-core is not installed. Run: npm install -D playwright-core')
      return pw.chromium.launch({ headless: true })
    })()
  }
  return browserPromise
}

/** Shared page (reuses single tab). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePage: any | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPage(): Promise<any> {
  if (!activePage || activePage.isClosed()) {
    const browser = await getBrowser()
    activePage = await browser.newPage()
  }
  return activePage
}

// ── Tools ───────────────────────────────────────────────────────────

export const browserOpenTool = defineTool({
  name: 'browser_open',
  description: 'Open a URL in the headless browser. Returns the page title and a text snapshot.',
  inputSchema: z.object({
    url: z.string().describe('The URL to navigate to'),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded')
      .describe('When to consider navigation complete'),
  }),
  execute: async (input) => {
    try {
      const page = await getPage()
      await page.goto(input.url, { waitUntil: input.waitUntil, timeout: 30_000 })
      const title = await page.title()
      const text = await page.innerText('body').catch(() => '')
      const truncated = text.slice(0, 8000)
      return { data: `Title: ${title}\n\n${truncated}` }
    } catch (err) {
      return { data: `Failed to open ${input.url}: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const browserScreenshotTool = defineTool({
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current browser page. Returns the file path of the saved screenshot.',
  inputSchema: z.object({
    path: z.string().default('screenshot.png').describe('File path to save the screenshot'),
    fullPage: z.boolean().default(false).describe('Capture the full scrollable page'),
  }),
  execute: async (input) => {
    try {
      const page = await getPage()
      await page.screenshot({ path: input.path, fullPage: input.fullPage })
      return { data: `Screenshot saved to ${input.path}` }
    } catch (err) {
      return { data: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const browserClickTool = defineTool({
  name: 'browser_click',
  description: 'Click an element on the current page by CSS selector.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the element to click'),
  }),
  execute: async (input) => {
    try {
      const page = await getPage()
      await page.click(input.selector, { timeout: 10_000 })
      return { data: `Clicked: ${input.selector}` }
    } catch (err) {
      return { data: `Click failed on "${input.selector}": ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const browserFillTool = defineTool({
  name: 'browser_fill',
  description: 'Fill a text input field on the current page.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the input element'),
    value: z.string().describe('Text value to fill'),
  }),
  execute: async (input) => {
    try {
      const page = await getPage()
      await page.fill(input.selector, input.value, { timeout: 10_000 })
      return { data: `Filled "${input.selector}" with value` }
    } catch (err) {
      return { data: `Fill failed on "${input.selector}": ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const browserTextTool = defineTool({
  name: 'browser_text',
  description: 'Extract text content from an element on the current page.',
  inputSchema: z.object({
    selector: z.string().default('body').describe('CSS selector to extract text from'),
  }),
  execute: async (input) => {
    try {
      const page = await getPage()
      const text = await page.innerText(input.selector, { timeout: 10_000 })
      const truncated = text.slice(0, 8000)
      return { data: truncated }
    } catch (err) {
      return { data: `Text extraction failed on "${input.selector}": ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

// ── Conditional registration ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BROWSER_TOOLS: ToolDefinition<any>[] = [
  browserOpenTool,
  browserScreenshotTool,
  browserClickTool,
  browserFillTool,
  browserTextTool,
]

/** Check if playwright-core is available. */
export async function isPlaywrightAvailable(): Promise<boolean> {
  const pw = await loadPlaywright()
  return pw !== null
}

/** Close the browser if open (for cleanup). */
export async function closeBrowser(): Promise<void> {
  if (activePage && !activePage.isClosed()) {
    await activePage.close().catch(() => {})
    activePage = null
  }
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null)
    await browser?.close().catch(() => {})
    browserPromise = null
  }
}
