# cache-clock

A Claude Code mod that shows how long your prompt cache stays warm, as a countdown above the prompt.
It also has an optional keep-warm mode that refreshes the cache before it expires.

## Why

Claude Code resends your whole conversation on every request.
While the prompt cache is warm, the API serves most of it from cache at a fraction of the cost and latency.
Once the cache expires, your next prompt pays for the whole context again.
The mod shows how much time is left, so you know whether to reply now or accept a cold start.

## What you see

Above the prompt:

```
cache warm 4:32 ████████░░░░  5m API   [Keep warm: off]
```

- The countdown restarts whenever a request reads or writes the cache.
- The bar turns green, then yellow, then red as time runs out.
- When the cache has expired it says `cache cold`, because the next prompt re-bills your whole context.
- The button turns keep-warm on and off. `/keepwarm on` and `/keepwarm off` do the same.

## Subscription and API lifetimes

The cache lives for a different time depending on how you pay.

- On a Claude subscription the mod assumes an hour.
- With an API key it assumes five minutes.
- The mod tells them apart by whether the session reports subscription rate limits.

The setting `ttl` overrides this with `5m` or `1h`.
If you set `ENABLE_PROMPT_CACHING_1H` in your environment, `auto` uses one hour.
If you set `FORCE_PROMPT_CACHING_5M`, `auto` uses five minutes.
Check your own setup if the lifetime shown looks wrong, and set `ttl` explicitly.

## Keep warm

When keep-warm is on, the mod sends one tiny request shortly before the cache expires.
That request reads your cached context, which restarts the lifetime.

It is not free.
Each request is a cache read of your whole context, billed at the cache-read rate, and on a subscription it counts against your usage limits.
So it has guards:

- It only sends while the cache is still warm, so it never pays to rebuild a cold cache.
- It never sends while a turn is running.
- It stops after `maxPings` requests in a row with no activity from you. The default is 6.
- It stops if a request does not hit the cache.
- Your next prompt resets the count.

## Install

```
/plugin install cache-clock --marketplace leowei31/cache-clock-mod
```

Then start a new session.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `ttl` | `auto` | `auto`, `5m` or `1h` |
| `keepWarm` | off | Start each session with keep-warm on |
| `marginSeconds` | 60 | How long before expiry the request is sent |
| `maxPings` | 6 | Most keep-warm requests in a row |

## Limits

- The countdown is an estimate from the last request that touched the cache, not a reading from the server.
- A different model or a `/clear` starts a new cache, and the countdown restarts with the next request.
- It needs a Claude Code build that supports mods.

## Development

Run `claude plugin test cache-clock` to run the tests.
Run `claude plugin validate cache-clock` to validate the manifest.
