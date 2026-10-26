export type Plan = 'subscription' | 'api'

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': {
      lastTouch: number
      ttlMs: number
      plan: Plan
      isKeepWarm: boolean
      pings: number
      note: string
      tick: number
    }
  }
}
