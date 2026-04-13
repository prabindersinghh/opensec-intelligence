/**
 * Tool definition framework for cmdr.
 *
 * Provides defineTool(), ToolRegistry, and zodToJsonSchema utilities.
 */

import { type ZodSchema } from 'zod'
import type { ToolDefinition, ToolResult, ToolUseContext, LLMToolDef } from '../core/types.js'

export type { ToolDefinition, ToolResult, ToolUseContext }

// ---------------------------------------------------------------------------
// defineTool
// ---------------------------------------------------------------------------

export function defineTool<TInput>(config: {
  name: string
  description: string
  inputSchema: ZodSchema<TInput>
  execute: (input: TInput, context: ToolUseContext) => Promise<ToolResult>
}): ToolDefinition<TInput> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute,
  }
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools = new Map<string, ToolDefinition<any>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(tool: ToolDefinition<any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: tool "${tool.name}" is already registered.`)
    }
    this.tools.set(tool.name, tool)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(name: string): ToolDefinition<any> | undefined {
    return this.tools.get(name)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(): ToolDefinition<any>[] {
    return Array.from(this.tools.values())
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  toToolDefs(): LLMToolDef[] {
    return Array.from(this.tools.values()).map((tool) => {
      const schema = zodToJsonSchema(tool.inputSchema)
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: schema,
      } satisfies LLMToolDef
    })
  }
}

// ---------------------------------------------------------------------------
// zodToJsonSchema
// ---------------------------------------------------------------------------

export function zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
  return convertZodType(schema)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertZodType(schema: ZodSchema): Record<string, unknown> {
  const def = (schema as any)._def
  const description: string | undefined = def.description

  const withDesc = (result: Record<string, unknown>): Record<string, unknown> =>
    description !== undefined ? { ...result, description } : result

  const typeName: string = def.typeName

  switch (typeName) {
    case 'ZodString':
      return withDesc({ type: 'string' })
    case 'ZodNumber':
      return withDesc({ type: 'number' })
    case 'ZodBigInt':
      return withDesc({ type: 'integer' })
    case 'ZodBoolean':
      return withDesc({ type: 'boolean' })
    case 'ZodNull':
      return withDesc({ type: 'null' })
    case 'ZodUndefined':
      return withDesc({ type: 'null' })

    case 'ZodEnum': {
      const values: string[] = def.values
      return withDesc({ type: 'string', enum: values })
    }

    case 'ZodLiteral': {
      return withDesc({ const: def.value })
    }

    case 'ZodArray': {
      const items = convertZodType(def.type)
      return withDesc({ type: 'array', items })
    }

    case 'ZodObject': {
      const shape = def.shape()
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convertZodType(value as ZodSchema)
        if ((value as any)._def.typeName !== 'ZodOptional') {
          required.push(key)
        }
      }

      const result: Record<string, unknown> = { type: 'object', properties }
      if (required.length > 0) result.required = required
      return withDesc(result)
    }

    case 'ZodOptional': {
      return convertZodType(def.innerType)
    }

    case 'ZodDefault': {
      return convertZodType(def.innerType)
    }

    case 'ZodNullable': {
      const inner = convertZodType(def.innerType)
      return withDesc({ anyOf: [inner, { type: 'null' }] })
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options || []).map((o: ZodSchema) => convertZodType(o))
      return withDesc({ anyOf: options })
    }

    case 'ZodRecord': {
      const valueSchema = convertZodType(def.valueType)
      return withDesc({ type: 'object', additionalProperties: valueSchema })
    }

    case 'ZodEffects': {
      return convertZodType(def.schema)
    }

    case 'ZodAny':
    case 'ZodUnknown':
      return withDesc({})

    default:
      return withDesc({})
  }
}
