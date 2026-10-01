# 0005: models.dev as the Model Catalog

## Status

Accepted

## Context

ViCode shipped with exactly one provider, OpenRouter, and a hardcoded pricing table in `src/core/cost-calculator.ts` — eight model ids (`anthropic/claude-sonnet-4`, `openai/gpt-4o`, …) frozen into source. The table was already wrong when it was written: the app's own default model, `nvidia/nemotron-3-ultra-550b-a55b:free`, is not in it, so `getModelPricing` returned `null` and the Usage Panel showed `$0.00` for a session that was genuinely spending money. `README.md` documents this as a known gap rather than a bug.

Adding four more providers makes the table untenable, and — the deciding factor — the providers do not offer a uniform alternative. Of the five model-listing endpoints we would need, only one carries prices:

| Endpoint | Response shape | Pricing | Context length |
| --- | --- | --- | --- |
| `openrouter.ai/api/v1/models` | snake_case (`context_length`, `pricing.prompt`) | yes | yes |
| `opencode.ai/zen/v1/models` | OpenAI-style `data[]` | no | no |
| `opencode.ai/zen/go/v1/models` | OpenAI-style `data[]` | no | no |
| `api.openai.com/v1/models` | OpenAI-style `data[]` | no | no |
| `platform.claude.com/v1/models` | Anthropic `data[]` | no | no |

`getModelInfo().contextLength` — which the Compaction threshold depends on — was likewise enriched only from OpenRouter's response, so it has no meaning on any other provider.

`https://models.dev/api.json` is a public dataset published by the OpenCode team that describes 225 providers in one schema, including all five of ours (`openrouter`, `openai`, `anthropic`, `opencode` = Zen, `opencode-go` = Go). Per model it carries `cost` (input, output, cache_read, cache_write, reasoning, and a `context_over_200k` object for tiered pricing), `limit.context`, `reasoning`, `tool_call`, and a `provider.npm` field naming the SDK and wire protocol that model requires.

## Decision

Fetch `https://models.dev/api.json` once, cache it under `~/.vicode/`, and treat it as the single source for pricing and context length across every provider. Delete the hardcoded `MODEL_PRICING` table.

- The app boots on whatever cache exists and refreshes in the background, so a cold or stale cache never blocks startup.
- `getModelPricing(modelId)` becomes a catalog lookup rather than a record index. When the catalog has no entry — offline, first run, or an unlisted model — cost degrades to `0` exactly as today, so this never introduces a new failure mode.
- Each provider implementation reads its own per-model protocol from the catalog's `provider.npm`, so adding a wire protocol later is a data change plus one adapter, not a registry edit.
- Models whose required protocol ViCode does not implement are **not listed** in the model picker. A row that looks selectable and then fails at call time is worse than an absent row.

## Considered Options

- **Keep the hardcoded table and extend it per provider.** No network dependency and no cold-start cost, but it ships a table we already know is wrong, and every vendor price change becomes a manual edit that will drift again.
- **Query each provider's `/models` endpoint at runtime.** Correct-by-construction where it works, but three of five endpoints carry no pricing and no context length, so it reproduces the `$0.00` bug for every new provider.
- **Fetch models.dev on every model-picker open.** Always fresh, but 5.26 MB per open with no cache is unusable in a TUI.
- **Use OpenRouter as a proxy for everything**, since it resells every model we care about. Rejected: it forfeits direct vendor billing, the OpenAI/Anthropic first-party paths (including prompt-cache economics and rate-limit headroom), and OpenCode Go's subscription plan.

## Consequences

- **Positive**: the `$0.00` cost-display bug is fixed as a side effect rather than carried forward.
- **Positive**: context length, and therefore the Compaction threshold, becomes correct on every provider.
- **Positive**: the provider registry and each model's wire protocol become data, so adding a provider is a descriptor plus a transport, not a new code path.
- **Negative**: ViCode now depends on a third-party dataset at runtime. If models.dev is unreachable or changes shape, we degrade to zero cost and unknown context length — never to a crash.
- **Negative**: the first run on a clean machine pays a ~5.26 MB download.
- **Negative**: the cache is machine-local, so it can go stale until its TTL expires; pricing shown may lag a vendor's actual price by up to the TTL.
- **Negative**: a protocol we do not implement is now invisible rather than merely unsupported, which will read as "that model does not exist" to anyone who knows better.