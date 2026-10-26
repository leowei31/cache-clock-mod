import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Plan } from '../types'

const MINUTE = 60_000
const TTL_5M = 5 * MINUTE
const TTL_1H = 60 * MINUTE
const BAR_WIDTH = 12
const PING_PROMPT = 'Reply with a single period and nothing else.'

const lastTouch = atom({ plugin: 'cache-clock', key: 'lastTouch' } as const, 0)
const ttlMs = atom({ plugin: 'cache-clock', key: 'ttlMs' } as const, TTL_5M)
const plan = atom({ plugin: 'cache-clock', key: 'plan' } as const, 'api' as Plan)
const isKeepWarm = atom({ plugin: 'cache-clock', key: 'isKeepWarm' } as const, false)
const pings = atom({ plugin: 'cache-clock', key: 'pings' } as const, 0)
const note = atom({ plugin: 'cache-clock', key: 'note' } as const, '')
const tick = atom({ plugin: 'cache-clock', key: 'tick' } as const, 0)

// auto: a subscription caches for an hour, an API key for five minutes, unless the environment says otherwise.
const resolveTtl = (mode: string, force1h: boolean, force5m: boolean, isSubscription: boolean) => {
  if (mode === '5m') {
    return TTL_5M
  }

  if (mode === '1h') {
    return TTL_1H
  }

  if (force5m) {
    return TTL_5M
  }

  return force1h || isSubscription ? TTL_1H : TTL_5M
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

const bar = (fraction: number) => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_WIDTH)

  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const ttlLabel = (ms: number) => (ms >= TTL_1H ? '1h' : '5m')

export const register: Register = (on, options) => {
  const mode = String(options.ttl ?? 'auto')
  const margin = Math.max(5, Number(options.marginSeconds ?? 60)) * 1000
  const maxPings = Math.max(1, Number(options.maxPings ?? 6))
  let isBusy = false
  let isPinging = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keepwarm',
      description: 'Turn keep-warm on or off for the prompt cache',
      argumentHint: '[on | off]',
    })
    await update($, isKeepWarm, () => options.keepWarm === true)

    $.clock.every(1000, async () => {
      const now = await $.clock.now()
      const touched = await read($, lastTouch)

      if (touched === 0) {
        return
      }

      const ttl = await read($, ttlMs)
      const left = touched + ttl - now

      if (left > -2000) {
        await update($, tick, n => n + 1)
      }

      const wantsPing = (await read($, isKeepWarm)) && !isBusy && !isPinging
      const count = await read($, pings)

      if (!wantsPing || left <= 0 || left > margin) {
        return
      }

      if (count >= maxPings) {
        await update($, isKeepWarm, () => false)
        await update($, note, () => `keep-warm stopped after ${maxPings} requests`)

        return
      }

      isPinging = true
      const reply = await $.model.fork({ prompt: PING_PROMPT })
      isPinging = false

      if (reply.isAnswered && reply.usage.cache_read_input_tokens > 0) {
        const done = await $.clock.now()
        await update($, lastTouch, () => done)
        await update($, pings, n => n + 1)
        await update($, note, () => '')

        return
      }

      await update($, isKeepWarm, () => false)
      await update($, note, () => 'keep-warm stopped: the request did not hit the cache')
    })

    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isKeepWarm))
    await update($, isKeepWarm, () => isOn)
    await update($, pings, () => 0)
    await update($, note, () => '')

    return { text: isOn ? 'Keep-warm on.' : 'Keep-warm off.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = false
    }

    return next(e)
  })

  // Every main-thread request that reads or writes the cache restarts its lifetime.
  on('turn.step', async function* ($, e, next) {
    const out = yield* next(e)
    const usage = out.usage

    if (e.agentId === undefined && usage && (usage.cache_read_input_tokens > 0 || usage.cache_creation_input_tokens > 0)) {
      const now = await $.clock.now()
      const limits = await $.session.usage()
      const isSubscription = limits.rateLimits.length > 0
      const force1h = (await $.env.get('ENABLE_PROMPT_CACHING_1H')) !== undefined
      const force5m = (await $.env.get('FORCE_PROMPT_CACHING_5M')) !== undefined

      await update($, lastTouch, () => now)
      await update($, ttlMs, () => resolveTtl(mode, force1h, force5m, isSubscription))
      await update($, plan, () => (isSubscription ? 'subscription' : 'api'))
      await update($, pings, () => 0)
      await update($, note, () => '')
    }

    return out
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const touched = await read($, lastTouch)

    if (e.props.hasSurvey || touched === 0) {
      return next(e)
    }

    await read($, tick)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const ttl = await read($, ttlMs)
    const left = touched + ttl - now
    const kind = await read($, plan)
    const warm = await read($, isKeepWarm)
    const count = await read($, pings)
    const message = await read($, note)
    const toggle = (
      <Button
        key="keepwarm"
        label={warm ? 'Keep warm: on' : 'Keep warm: off'}
        onPress={() => {
          void update($, isKeepWarm, () => !warm)
          void update($, pings, () => 0)
          void update($, note, () => '')
        }}
      />
    )

    if (left <= 0) {
      return (
        <Box gap={1}>
          <Text color="red">cache cold</Text>
          <Text dimColor>the next prompt re-bills your whole context</Text>
          {toggle}
        </Box>
      )
    }

    const fraction = left / ttl
    const color = fraction > 0.5 ? 'green' : fraction > 0.2 ? 'yellow' : 'red'

    return (
      <Box gap={1}>
        <Text color={color}>
          cache warm {clock(left)} {bar(fraction)}
        </Text>
        <Text dimColor>
          {ttlLabel(ttl)} {kind === 'subscription' ? 'subscription' : 'API'}
          {warm ? ` pings ${count}/${maxPings}` : ''}
        </Text>
        {message !== '' && <Text color="yellow">{message}</Text>}
        {toggle}
      </Box>
    )
  })
}
