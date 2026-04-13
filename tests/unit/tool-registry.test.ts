import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, zodToJsonSchema, defineTool } from '../../src/tools/registry.js'

describe('ToolRegistry', () => {
  const makeTool = (name: string) =>
    defineTool({
      name,
      description: `Tool ${name}`,
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ data: 'ok' }),
    })

  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry()
    reg.register(makeTool('file_read'))
    expect(reg.has('file_read')).toBe(true)
    expect(reg.get('file_read')?.name).toBe('file_read')
  })

  it('rejects duplicate registration', () => {
    const reg = new ToolRegistry()
    reg.register(makeTool('grep'))
    expect(() => reg.register(makeTool('grep'))).toThrow('already registered')
  })

  it('lists all tools', () => {
    const reg = new ToolRegistry()
    reg.register(makeTool('a'))
    reg.register(makeTool('b'))
    reg.register(makeTool('c'))
    expect(reg.list()).toHaveLength(3)
  })

  it('unregisters tools', () => {
    const reg = new ToolRegistry()
    reg.register(makeTool('x'))
    reg.unregister('x')
    expect(reg.has('x')).toBe(false)
  })

  it('toToolDefs produces LLM-compatible definitions', () => {
    const reg = new ToolRegistry()
    reg.register(makeTool('file_read'))
    const defs = reg.toToolDefs()
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('file_read')
    expect(defs[0].description).toBe('Tool file_read')
    expect(defs[0].inputSchema).toHaveProperty('type', 'object')
    expect(defs[0].inputSchema).toHaveProperty('properties')
  })
})

describe('zodToJsonSchema', () => {
  it('converts ZodString', () => {
    const result = zodToJsonSchema(z.string())
    expect(result).toEqual({ type: 'string' })
  })

  it('converts ZodNumber', () => {
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
  })

  it('converts ZodBoolean', () => {
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
  })

  it('converts ZodEnum', () => {
    const result = zodToJsonSchema(z.enum(['a', 'b', 'c']))
    expect(result).toEqual({ type: 'string', enum: ['a', 'b', 'c'] })
  })

  it('converts ZodObject with required and optional fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    })
    const result = zodToJsonSchema(schema)
    expect(result.type).toBe('object')
    expect(result.properties).toBeDefined()
    expect((result as any).required).toEqual(['name'])
  })

  it('converts ZodArray', () => {
    const result = zodToJsonSchema(z.array(z.string()))
    expect(result).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('converts ZodNullable', () => {
    const result = zodToJsonSchema(z.string().nullable())
    expect(result).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] })
  })

  it('preserves descriptions', () => {
    const result = zodToJsonSchema(z.string().describe('A file path'))
    expect(result).toEqual({ type: 'string', description: 'A file path' })
  })

  it('converts ZodLiteral', () => {
    const result = zodToJsonSchema(z.literal('fixed'))
    expect(result).toEqual({ const: 'fixed' })
  })

  it('converts nested objects', () => {
    const schema = z.object({
      config: z.object({
        key: z.string(),
      }),
    })
    const result = zodToJsonSchema(schema) as any
    expect(result.properties.config.type).toBe('object')
    expect(result.properties.config.properties.key.type).toBe('string')
  })
})
