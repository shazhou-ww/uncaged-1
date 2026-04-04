// Self-evolution tool: create_capability
// Allows the LLM to write and deploy new Sigil capabilities

import type { SigilClient } from '../sigil.js'

export interface CreateCapabilityTool {
  type: 'function'
  function: {
    name: 'create_capability'
    description: string
    parameters: {
      type: 'object'
      properties: {
        name: { type: 'string'; description: string }
        description: { type: 'string'; description: string }
        schema: { type: 'object'; description: string }
        code: { type: 'string'; description: string }
      }
      required: ['name', 'description', 'schema', 'code']
    }
  }
}

export const createCapabilityTool: CreateCapabilityTool = {
  type: 'function',
  function: {
    name: 'create_capability',
    description: 'Create and deploy a new Sigil capability. Use this when you identify a recurring need that could be served by a reusable function. The capability will be available as a tool in future conversations.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Capability name (lowercase, hyphens ok). E.g. \'weather-forecast\', \'unit-converter\''
        },
        description: {
          type: 'string',
          description: 'What this capability does, in one sentence'
        },
        schema: {
          type: 'object',
          description: 'JSON Schema for the capability\'s input parameters'
        },
        code: {
          type: 'string',
          description: 'JavaScript code that implements the capability. Must export a default function that takes (input, env) and returns a result. Has access to fetch() for HTTP calls.'
        }
      },
      required: ['name', 'description', 'schema', 'code']
    }
  }
}

export interface CreateCapabilityArgs {
  name: string
  description: string
  schema: Record<string, any>
  code: string
}

export async function handleCreateCapability(
  args: CreateCapabilityArgs,
  sigil: SigilClient
): Promise<string> {
  console.log('[Self-Evolve] Creating capability:', args.name)
  
  try {
    // Validate name format (lowercase, hyphens)
    if (!/^[a-z][a-z0-9-]*$/.test(args.name)) {
      return JSON.stringify({ 
        error: 'Invalid name format. Use lowercase letters, numbers, and hyphens only (e.g. \'weather-forecast\')' 
      })
    }

    // Validate code is not empty
    if (!args.code.trim()) {
      return JSON.stringify({ error: 'Code cannot be empty' })
    }

    // Validate description is provided
    if (!args.description.trim()) {
      return JSON.stringify({ error: 'Description cannot be empty' })
    }

    console.log('[Self-Evolve] Deploying to Sigil...')
    
    // Deploy using the 'execute' mode (schema + function body)
    const result = await sigil.deploy({
      name: args.name,
      description: args.description,
      schema: args.schema,
      execute: args.code,
      tags: ['self-evolution', 'auto-created'],
    })

    console.log('[Self-Evolve] Deploy successful:', result.capability)
    
    return JSON.stringify({
      success: true,
      capability: result.capability,
      url: result.url,
      message: `✨ Created capability '${result.capability}' — it's now available as a tool in future conversations!`
    })

  } catch (error: any) {
    console.error('[Self-Evolve] Deploy failed:', error.message)
    return JSON.stringify({
      error: `Failed to deploy capability: ${error.message}`,
      name: args.name
    })
  }
}