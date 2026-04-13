import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { PluginManager } from '../../src/plugins/plugin-manager.js'

const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tmpDirs.length = 0
})

describe('PluginManager.load', () => {
  it('loads a relative plugin source using the provided base directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmdr-plugin-manager-'))
    tmpDirs.push(dir)

    const pluginFile = join(dir, 'demo-plugin.mjs')
    await writeFile(
      pluginFile,
      "export default { name: 'demo-plugin', version: '1.0.0', tools: [] }\n",
      'utf8',
    )

    const manager = new PluginManager()
    await manager.load('./demo-plugin.mjs', dir)

    expect(manager.list()).toHaveLength(1)
    expect(manager.list()[0].name).toBe('demo-plugin')
  })
})
