// Knowledge distillation tool: distill_knowledge
// Allows the LLM to extract and store structured knowledge from conversations

import type { Memory } from '../memory.js'

export interface DistillKnowledgeTool {
  type: 'function'
  function: {
    name: 'distill_knowledge'
    description: string
    parameters: {
      type: 'object'
      properties: {
        type: { type: 'string'; enum: ['profile', 'event', 'preference', 'fact']; description: string }
        subject: { type: 'string'; description: string }
        content: { type: 'string'; description: string }
        confidence: { type: 'number'; description: string }
      }
      required: ['type', 'subject', 'content']
    }
  }
}

export const distillKnowledgeTool: DistillKnowledgeTool = {
  type: 'function',
  function: {
    name: 'distill_knowledge',
    description: 'Extract and store a piece of structured knowledge from the current conversation. Use this when you learn something important about a person, event, preference, or fact that should be remembered long-term.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['profile', 'event', 'preference', 'fact'],
          description: 'Knowledge type: profile (about a person), event (something that happened), preference (likes/dislikes), fact (objective information)'
        },
        subject: {
          type: 'string',
          description: 'Who or what this knowledge is about (e.g. person name, team name, project name)'
        },
        content: {
          type: 'string',
          description: 'The distilled knowledge in a clear, concise sentence'
        },
        confidence: {
          type: 'number',
          description: 'How confident you are (0-1). Use 0.9+ for explicitly stated facts, 0.5-0.8 for inferences'
        }
      },
      required: ['type', 'subject', 'content']
    }
  }
}

export interface RecallKnowledgeTool {
  type: 'function'
  function: {
    name: 'recall_knowledge'
    description: string
    parameters: {
      type: 'object'
      properties: {
        subject: { type: 'string'; description: string }
        type: { type: 'string'; enum: ['profile', 'event', 'preference', 'fact']; description: string }
        query: { type: 'string'; description: string }
      }
    }
  }
}

export const recallKnowledgeTool: RecallKnowledgeTool = {
  type: 'function',
  function: {
    name: 'recall_knowledge',
    description: 'Search your structured knowledge base for information about a person, topic, or event. More accurate than raw memory search for known facts.',
    parameters: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Who or what to look up (optional, omit for broad search)'
        },
        type: {
          type: 'string',
          enum: ['profile', 'event', 'preference', 'fact'],
          description: 'Filter by knowledge type (optional)'
        },
        query: {
          type: 'string',
          description: 'Free-text search query (optional, searches content field)'
        }
      }
    }
  }
}

export interface DistillKnowledgeArgs {
  type: 'profile' | 'event' | 'preference' | 'fact'
  subject: string
  content: string
  confidence?: number
}

export interface RecallKnowledgeArgs {
  subject?: string
  type?: 'profile' | 'event' | 'preference' | 'fact'
  query?: string
}

export async function handleDistillKnowledge(
  args: DistillKnowledgeArgs,
  memory: Memory
): Promise<string> {
  console.log('[Knowledge] Handling distill_knowledge:', args)
  
  try {
    const result = await memory.distillKnowledge(
      args.type,
      args.subject,
      args.content,
      args.confidence || 0.8
    )

    return JSON.stringify({
      success: true,
      id: result.id,
      updated: result.updated,
      type: args.type,
      subject: args.subject,
      message: result.updated 
        ? `Updated existing ${args.type} knowledge about "${args.subject}"` 
        : `Stored new ${args.type} knowledge about "${args.subject}"`
    })

  } catch (error: any) {
    console.error('[Knowledge] Distillation failed:', error.message)
    return JSON.stringify({
      error: `Knowledge distillation failed: ${error.message}`
    })
  }
}

export async function handleRecallKnowledge(
  args: RecallKnowledgeArgs,
  memory: Memory
): Promise<string> {
  console.log('[Knowledge] Handling recall_knowledge:', args)
  
  try {
    const results = await memory.recallKnowledge(args)

    return JSON.stringify({
      entries: results,
      total: results.length,
      query: args
    })

  } catch (error: any) {
    console.error('[Knowledge] Recall failed:', error.message)
    return JSON.stringify({
      error: `Knowledge recall failed: ${error.message}`
    })
  }
}