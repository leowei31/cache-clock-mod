import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cache-clock',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, model: 'm' }

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// One main-thread request that read the cache: what restarts its lifetime.
const request = async ($: any) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  for await (const chunk of stream) void chunk
  await stream.result
}

const setup = async ($: any, on: any, { isSubscription }: { isSubscription: boolean }) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: isSubscription ? [{ id: 'five_hour', percentUsed: 5 }] : [] },
  }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'keepwarm' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  return clock
}

test('an API key counts down five minutes, on every surface', async ($, on) => {
  await setup($, on, { isSubscription: false })
  await request($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const text = (await ui.find({ type: 'Text', text: /cache warm/ }))?.text
    expect(text).toContain('cache warm 5:00')
    expect((await ui.find({ type: 'Text', text: /API/ }))?.text).toContain('5m API')
    await ui.unmount()
  }
})

test('a subscription counts down an hour', async ($, on) => {
  await setup($, on, { isSubscription: true })
  await request($)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /cache warm/ }))?.text).toContain('cache warm 1:00:00')
  expect((await ui.find({ type: 'Text', text: /subscription/ }))?.text).toContain('1h subscription')
  await ui.unmount()
})

test('the clock runs down and the band says when the cache is cold', async ($, on) => {
  const clock = await setup($, on, { isSubscription: false })
  await request($)
  await clock.advance(61_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /cache warm/ }))?.text).toContain('cache warm 3:59')
  await clock.advance(5 * 60_000)
  await ui.unmount()

  const cold = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await cold.find({ type: 'Text', text: /cache cold/ }))?.text).toBe('cache cold')
  await cold.unmount()
})

test('keep-warm sends one request before the cache expires, and stops at the limit', { options: { keepWarm: true, maxPings: 2 } }, async ($, on) => {
  let forks = 0
  on('model.fork', () => {
    forks += 1

    return { value: { isAnswered: true, text: '.', usage: USAGE } }
  })
  const clock = await setup($, on, { isSubscription: false })
  await request($)

  await clock.advance(4.5 * 60_000)
  expect(forks).toBe(1)

  await clock.advance(4.5 * 60_000)
  expect(forks).toBe(2)

  await clock.advance(4.5 * 60_000)
  expect(forks).toBe(2)
})

test('keep-warm stays off unless asked', async ($, on) => {
  let forks = 0
  on('model.fork', () => {
    forks += 1

    return { value: { isAnswered: true, text: '.', usage: USAGE } }
  })
  const clock = await setup($, on, { isSubscription: false })
  await request($)
  await clock.advance(4.5 * 60_000)

  expect(forks).toBe(0)
})
