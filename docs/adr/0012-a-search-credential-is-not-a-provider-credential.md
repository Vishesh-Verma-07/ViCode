# 0012: A Search Credential Is Not a Provider Credential

## Status

Accepted

## Context

Issue #93 asked for `web_search`: a Tool that asks a search backend a real question and returns ranked results. Every search API that is worth calling is keyed, and an unauthenticated endpoint is exactly what made the previous attempt at this feature return nothing for most queries — so the Tool needed a credential.

The codebase already had a credential mechanism. `apiKeys` is a map in the Global Config, keyed by Provider id, and `keyForProvider` resolves one through the Global Config, then a `VICODE_`-namespaced variable, then the Provider's own native name (ADR-0010). Adding `searchApiKey` to that map would have been one line and no new mechanism at all.

That line would have been wrong. `apiKeys` is `Record<ProviderId, string>`, and `web_search` is not a Provider: it is not a route ViCode chats through, it consumes no model tokens, and it is never selected as a route. Worse, the map is not a passive store. It is what the Provider picker, the API Key Entry Screen and the Route Label iterate, and it is how a Turn's cost is attributed to the route that served it. A search credential placed there would inherit all of it — appearing as a choosable Provider, holding a `/key` screen for a service that is not an LLM, and carrying a cost of zero that reads as free rather than as unbillable.

There was a third option: skip the credential entirely and call an unauthenticated endpoint. The parent issue records what that produced before — a tool that returned nothing for most queries and read as a successful answer, which is worse than no tool at all.

So the credential was needed, and it could not be a Provider key. That left the question of where a *non-Provider* credential lives, which the config schema had never had to answer — and the Namespaced API Key rule, which ADR-0010 had written for a Provider's API Key, now had a second caller.

## Decision

A search credential is its own thing, with its own field, resolving by its own rule that follows the Namespaced API Key pattern exactly.

- **Its own Global Config field, `searchApiKeys`, keyed by backend id.** Not an entry in `apiKeys`. The key map is typed `Record<ProviderId, string>` and is read by every Provider surface, so an entry there is a search credential that has agreed to impersonate a Provider. A separate field cannot drift into that map, and it cannot be iterated by anything that iterates Providers. Keyed by backend because there is one credential per backend: whichever backend `searchBackend` names reads its own entry, and an entry for a backend not selected is simply never read.
- **Not a Provider key, so it reaches no Provider surface.** Absent by construction rather than by filter: not the picker, not the API Key Entry Screen's Provider list, not the Route Label, not the Usage Panel, not cost accounting. Each of these is a test that renders the surface with a credential genuinely configured, because a surface that merely has nothing to show proves nothing.
- **Resolution follows the Namespaced API Key rule, extended past Providers.** The backend's entry under the Global Config field, then `VICODE_<NATIVE>`, then the backend's own native name. The namespaced name is *derived* from the native one by the same `namespacedEnvVar` helper a Provider uses, so the override cannot drift from the name it shadows. ADR-0010's ordering argument is unchanged by the new caller: a credential scoped to this tool outranks one scoped to every other program in the shell, and the native name still authenticates on its own so the override stays an option rather than a second copy to maintain.
- **A Project Config refuses it by name**, on the same grounds as an API Key and through the same `ConfigError` advice — that file is meant to be committed, so a credential written there is a leaked one whatever kind it is.
- **A missing one is not a pre-chat gate.** A missing Provider key blocks the chat because there is no route to chat through. A missing search credential leaves every route working, so it is reported at the moment of use, naming the credential and how to set it. Gating startup on a Tool the user may never call would make the app depend on a feature it does not need.
- **Absence, failure, and an unexpected shape are three different answers.** A search that matched nothing says so; a transport failure says so; a response that was not shaped as expected says so. None of them is an empty string, which a model reads as a successful answer and concludes from that there is nothing on the web. The third has its own error type, because a body that is not JSON is a fact about the wire while a well-formed answer of the wrong shape means the schema moved — not something a retry clears.
- **The Tool is written against a `SearchBackend` interface, not a vendor.** A query in, ranked results out. Each backend's response shape, header and credential names live in one file, so a second backend is an entry in a registry rather than an unwiring of the Tool — which is how `serper` shipped.
- **Which backend runs is a config choice, not a Tool one.** `searchBackend` is an ordinary layerable config field naming an entry in the registry. The Tool resolves it through the registry and names no backend id of its own, so the selection can be tested by asserting which host the request left for, without the Tool ever saying a vendor's name.

## Consequences

- **Positive**: adding a second search API is one registry entry plus its implementation and a fixture in the Tool's tests. The Tool, the credential resolution rule, `--help`, and every "no Provider surface" test are untouched by it — `serper` shipped this way.
- **Positive**: the credential cannot be mistaken for a route, because there is no code path from the field to anything that reads routes or costs.
- **Positive**: the namespaced-override rule now has one implementation. ADR-0010's guarantee — that the documented order is the real one — extends to search credentials for free, because both render `--help` from the same derivation.
- **Negative**: there are now two kinds of credential, and "API key" is ambiguous in a codebase that used to have one. `ConfigError` carries `refusedCredentialFields` and the startup advice names the field it refused, precisely so a user who hits the Project Config refusal learns *which* credential to move rather than being handed provider-specific advice for a search key.
- **Negative**: the search credential has no interactive way to be set. `/key` collects a Provider key by design, and adding a second, differently-shaped flow to a picker built around picking a Provider would be the Provider coupling this decision exists to avoid. It is set by editing the Global Config or exporting a variable, and `--help` says so.
- **Negative**: `web_search`'s description tells the model to fetch a result's URL when it needs the page rather than the snippet, and no `web_fetch` Tool exists yet — that is issue #92. Until it lands, the instruction names a capability the model does not have.
- **Negative**: the field name has a home in the config schema and is consumed by the search module by importing that constant. The selection field and the credential record need the registry's ids too, so the configuration layer imports `SEARCH_BACKEND_IDS` from the search module's leaf `types.ts` — a dependency in the config→search direction only. The cycle the original formulation warned of forms the other way: `search/credential.ts` imports the config module, so the config module must never import anything that reaches back (the credential module, the backend implementations). The rule is one-way, and `types.ts` being a leaf is what keeps it that way.