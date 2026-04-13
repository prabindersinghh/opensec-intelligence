/**
 * RAG / Document Indexing — semantic search over project files.
 *
 * Uses Ollama /api/embed with nomic-embed-text for embeddings.
 * Stores index as JSON (no SQLite dependency).
 * 512-token chunks with 64-token overlap.
 * Cosine similarity search.
 */

import { readFile, readdir, writeFile, stat, mkdir } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'
import { homedir } from 'node:os'

// ── Types ───────────────────────────────────────────────────────────

export interface IndexChunk {
  file: string
  startLine: number
  endLine: number
  text: string
  embedding: number[]
}

export interface IndexState {
  version: number
  model: string
  chunks: IndexChunk[]
  indexedFiles: Record<string, { mtime: number; chunkCount: number }>
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  file: string
  startLine: number
  endLine: number
  text: string
  score: number
}

// ── Chunking ────────────────────────────────────────────────────────

const CHUNK_SIZE = 80    // lines (approximation of ~512 tokens)
const CHUNK_OVERLAP = 10 // lines (~64 tokens)

/** Text file extensions to index. */
const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.php', '.lua', '.sh', '.bash', '.zsh',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.md', '.mdx', '.txt', '.rst',
  '.sql', '.graphql', '.proto',
  '.env', '.gitignore', '.dockerignore',
  '.dockerfile', 'Dockerfile',
])

/** Directories to skip. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'target',
  'coverage', '.vscode', '.idea', '__pycache__', '.tox', 'venv', '.venv',
])

function chunkText(text: string, file: string): { file: string; startLine: number; endLine: number; text: string }[] {
  const lines = text.split('\n')
  const chunks: { file: string; startLine: number; endLine: number; text: string }[] = []

  let start = 0
  while (start < lines.length) {
    const end = Math.min(start + CHUNK_SIZE, lines.length)
    const chunkLines = lines.slice(start, end)
    chunks.push({
      file,
      startLine: start + 1,
      endLine: end,
      text: chunkLines.join('\n'),
    })
    start += CHUNK_SIZE - CHUNK_OVERLAP
    if (start >= lines.length) break
  }

  return chunks
}

// ── Embedding ───────────────────────────────────────────────────────

async function getEmbedding(text: string, ollamaUrl: string, model = 'nomic-embed-text'): Promise<number[]> {
  const response = await fetch(`${ollamaUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  })

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { embeddings: number[][] }
  return data.embeddings[0]
}

// ── Similarity ──────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dotProduct / denom
}

// ── File discovery ──────────────────────────────────────────────────

async function discoverFiles(rootDir: string, paths: string[]): Promise<string[]> {
  const files: string[] = []

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
      if (SKIP_DIRS.has(entry.name)) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkDir(fullPath)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (INDEXABLE_EXTENSIONS.has(ext) || INDEXABLE_EXTENSIONS.has(entry.name)) {
          files.push(fullPath)
        }
      }
    }
  }

  for (const p of paths) {
    const fullPath = join(rootDir, p)
    const s = await stat(fullPath).catch(() => null)
    if (!s) continue
    if (s.isDirectory()) {
      await walkDir(fullPath)
    } else if (s.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

// ── IndexManager ────────────────────────────────────────────────────

export class IndexManager {
  private indexPath: string
  private state: IndexState | null = null

  constructor(
    private cwd: string,
    private ollamaUrl: string = 'http://localhost:11434',
    private embedModel: string = 'nomic-embed-text',
  ) {
    const indexDir = join(homedir(), '.cmdr', 'index')
    // Use cwd hash for unique index per project
    const { createHash } = require('node:crypto') as typeof import('node:crypto')
    const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 12)
    this.indexPath = join(indexDir, `${hash}.json`)
  }

  /** Load existing index from disk. */
  async load(): Promise<IndexState> {
    if (this.state) return this.state
    try {
      const raw = await readFile(this.indexPath, 'utf-8')
      this.state = JSON.parse(raw) as IndexState
    } catch {
      this.state = {
        version: 1,
        model: this.embedModel,
        chunks: [],
        indexedFiles: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    return this.state!
  }

  /** Save index to disk. */
  private async save(): Promise<void> {
    if (!this.state) return
    this.state.updatedAt = new Date().toISOString()
    const dir = join(homedir(), '.cmdr', 'index')
    await mkdir(dir, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(this.state))
  }

  /**
   * Index files at the given paths (relative to cwd).
   * Returns number of chunks indexed.
   */
  async index(paths: string[], onProgress?: (msg: string) => void): Promise<number> {
    const state = await this.load()
    const files = await discoverFiles(this.cwd, paths)

    let totalNew = 0

    for (const file of files) {
      const relPath = relative(this.cwd, file)
      const fileStat = await stat(file)
      const mtime = fileStat.mtimeMs

      // Skip if already indexed and not modified
      const existing = state.indexedFiles[relPath]
      if (existing && existing.mtime >= mtime) continue

      onProgress?.(`Indexing: ${relPath}`)

      // Remove old chunks for this file
      state.chunks = state.chunks.filter(c => c.file !== relPath)

      // Read and chunk
      const content = await readFile(file, 'utf-8')
      const textChunks = chunkText(content, relPath)

      // Get embeddings
      for (const chunk of textChunks) {
        try {
          const embedding = await getEmbedding(chunk.text, this.ollamaUrl, this.embedModel)
          state.chunks.push({ ...chunk, embedding })
          totalNew++
        } catch (err) {
          onProgress?.(`  ⚠ Embedding failed for ${relPath}:${chunk.startLine}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      state.indexedFiles[relPath] = { mtime, chunkCount: textChunks.length }
    }

    await this.save()
    onProgress?.(`Done: ${totalNew} new chunks indexed (${state.chunks.length} total)`)
    return totalNew
  }

  /**
   * Semantic search across indexed documents.
   * Returns top-k results sorted by similarity.
   */
  async search(query: string, topK = 5): Promise<SearchResult[]> {
    const state = await this.load()
    if (state.chunks.length === 0) {
      return []
    }

    const queryEmbedding = await getEmbedding(query, this.ollamaUrl, this.embedModel)

    const scored = state.chunks.map(chunk => ({
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  /** Get index status/stats. */
  async status(): Promise<{ fileCount: number; chunkCount: number; model: string; updatedAt: string }> {
    const state = await this.load()
    return {
      fileCount: Object.keys(state.indexedFiles).length,
      chunkCount: state.chunks.length,
      model: state.model,
      updatedAt: state.updatedAt,
    }
  }

  /** Clear the entire index. */
  async clear(): Promise<void> {
    this.state = {
      version: 1,
      model: this.embedModel,
      chunks: [],
      indexedFiles: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.save()
  }
}
