# favicon-resolver

A Cloudflare Worker (Void + Vite+) that finds a site's best icon. `GET /<hostname>` returns the icon
or 404. See `README.md` for behavior and the safety rules.

## Layout

- `routes/[hostname].ts` — the endpoint: referrer check, KV cache, resolve
- `routes/index.ts` — plain-text usage
- `src/resolver/` — runtime-agnostic logic (no Cloudflare imports). `resolveFavicon` takes an
  injectable `fetch`; tests use `fake-fetch.ts` and never touch the network
- `src/cache.ts` — KV read/write (`icon:v1:` prefix; bump it to drop old entries)
- `src/http.ts` — response headers and the referrer allow-list
- `env.ts` — `ALLOWED_REFERRERS`
- `src/resolver/fake-fetch.ts` — test helper (fake `fetch` and PNG bytes), not used at runtime

## Deployment

- Deploy with `pnpm exec void deploy` (not `pnpm deploy`, a built-in pnpm command). Changes reach
  Cloudflare only when deployed; pushing to GitHub does not deploy
- `.void-wrangler.jsonc` (account ID) and `void.lock.json` (account and KV namespace IDs) are
  git-ignored so the public repo carries no account details. The KV store is only a cache; a fresh
  clone creates a new one on its first deploy
- Owner-specific details (live URL, who uses it, open decisions) are in `NOTES.local.md`, which is
  git-ignored. Read it if it exists; never commit it

## Git

Commits use the maintainer's personal email, set in this repo's `.git/config`. The machine's global
git email is a work address; never commit with it here.

## Rules

- Every URL the Worker fetches goes through `fetchLimited`, which checks `isFetchableUrl` on each
  hop. Never call `fetch` on a site-provided URL directly.
- Serve only bytes that `sniffImage` recognises, with the headers from `src/http.ts`.
- Keep `src/resolver/` free of Cloudflare and Void imports.

## Conventions

- Types only, no interfaces; no enums (`as const` + `keyof typeof`); arrow functions only
- Parameters `(props: Type)` then destructure inside, for functions with several named options
- Tests next to the code (`*.test.ts`), `vp test`

## Commands

```sh
pnpm dev | pnpm test | pnpm lint:check | pnpm lint:fix | pnpm typecheck
pnpm exec void deploy   # not `pnpm deploy`, which is a built-in pnpm command
```

<!--injected-by-void-v1.5.0-->
## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->
