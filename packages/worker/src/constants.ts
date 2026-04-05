/**
 * Reserved slugs that cannot be used for users, agents, or capabilities.
 * Single source of truth — imported by slug-resolver.ts and capabilities.ts.
 */
export const RESERVED_SLUGS = new Set([
  'about',
  'admin',
  'api',
  'auth',
  'core',
  'docs',
  'health',
  'help',
  'hook',
  'id',
  'internal',
  'login',
  'platform',
  'register',
  'settings',
  'sigil',
  'static',
  'system',
  'test',
  'webhook',
  'well-known',
])
