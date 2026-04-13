/**
 * web_search — search the web using DuckDuckGo HTML scraping (no API key required).
 * Falls back to Brave Search API if BRAVE_SEARCH_API_KEY is set.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query)
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; cmdr-agent/1.0)',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${response.status}`)
  }

  const html = await response.text()
  const results: SearchResult[] = []

  // Parse result entries from DuckDuckGo HTML
  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1]
    const title = match[2].replace(/<[^>]*>/g, '').trim()
    const snippet = match[3].replace(/<[^>]*>/g, '').trim()

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    let finalUrl = rawUrl
    try {
      const parsed = new URL(rawUrl, 'https://duckduckgo.com')
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) finalUrl = decodeURIComponent(uddg)
    } catch { /* use raw */ }

    if (title && finalUrl) {
      results.push({ title, url: finalUrl, snippet })
    }
  }

  return results
}

async function searchBrave(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query)
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Brave Search returned ${response.status}`)
  }

  const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } }
  return (data.web?.results ?? []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }))
}

export const webSearchTool = defineTool({
  name: 'web_search',
  description: 'Search the web for information. Returns titles, URLs, and snippets of top results. Use this when you need current information not in your training data.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().min(1).max(20).default(5).describe('Maximum number of results to return (default: 5)'),
  }),
  execute: async (input) => {
    const braveKey = process.env.BRAVE_SEARCH_API_KEY
    const maxResults = input.maxResults ?? 5

    try {
      const results = braveKey
        ? await searchBrave(input.query, maxResults, braveKey)
        : await searchDuckDuckGo(input.query, maxResults)

      if (results.length === 0) {
        return { data: `No results found for: "${input.query}"` }
      }

      const formatted = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
      ).join('\n\n')

      return { data: `Search results for "${input.query}":\n\n${formatted}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `Search failed: ${msg}`, isError: true }
    }
  },
})
