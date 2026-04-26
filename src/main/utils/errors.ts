export class AuthError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthError'
  }
}

export function isAuthError(e: unknown): boolean {
  if (e instanceof AuthError) return true
  if (e instanceof Error) {
    const msg = e.message.toLowerCase()
    return msg.includes('unauthorized') || msg.includes('login') || msg.includes('auth') || msg.includes('401') || msg.includes('302')
  }
  return false
}

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.reason === 'string') {
      const extra = typeof obj.extra === 'string' ? ` (${obj.extra})` : ''
      return obj.reason + extra
    }
    if (typeof obj.message === 'string') return obj.message
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return String(err)
}
