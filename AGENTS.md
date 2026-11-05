# favicon-resolver

A Cloudflare Worker (Void + Vite+) that finds a site's best icon. `GET /<hostname>` returns the icon
or 404. See `README.md` for behavior and the safety rules.

## Layout

- `routes/[...target].ts` — the endpoint; a thin wrapper that hands the request and bindings to
  `serveIcon`
- `routes/index.ts` — plain-text usage
- `src/resolver/` — the library: finds a site's icon. Runtime-agnostic, no Cloudflare or Void
  imports. `resolveFavicon` takes an injectable `fetch`
- `src/worker/` — what the Worker adds around the library
  - `serve.ts` — `serveIcon`: referrer check, hostname parsing, `?size=`, KV cache, resolve,
    ETag/304. Takes the KV store as a parameter, so it is tested without Cloudflare
  - `cache.ts` — KV read/write (`icon:v3:<size>:<hostname>`; bump the prefix whenever a change
    should invalidate what is already cached)
  - `http.ts` — response headers, ETags, and the referrer allow-list
- `env.ts` — `ALLOWED_REFERRERS`
- Tests live in a `__tests__/` folder next to the code they test, together with their test-only
  helpers (`resolver/__tests__/fake-fetch.ts`, `worker/__tests__/fake-kv.ts`). Nothing in a
  `__tests__/` folder is used at runtime

## Deployment

- Deploy with `pnpm exec void deploy` (not `pnpm deploy`, a built-in pnpm command). Changes reach
  Cloudflare only when deployed; pushing to GitHub does not deploy
- `.void-wrangler.jsonc` (account ID) and `void.lock.json` (account and KV namespace IDs) are
  git-ignored so the public repo carries no account details. The KV store is only a cache; a fresh
  clone creates a new one on its first deploy
- Owner-specific details (live URL, who uses it, open decisions) are in `NOTES.local.md`, which is
  git-ignored. Read it if it exists; never commit it

## Dependencies and CI

- Install with `vp install` (Vite+ runs pnpm underneath; also `vp add`, `vp update`, `vp outdated`). Node comes from `.node-version`
- CI (`.github/workflows/ci.yml`) sets up with `voidzero-dev/setup-vp` and runs lint, typecheck, tests, and build on every push and PR to `main`. It needs no secrets
- Renovate (`renovate.json`) opens grouped PRs every Monday morning and merges minor and patch updates by itself once CI passes; major versions wait for a manual merge. The Dependency Dashboard issue lists everything pending
- Merged updates reach Cloudflare only on the next `pnpm exec void deploy`

## Git

Commits use the maintainer's personal email, set in this repo's `.git/config`. The machine's global
git email is a work address; never commit with it here.

## Rules

- Every URL the Worker fetches goes through `fetchLimited`, which checks `isFetchableUrl` on each
  hop. Never call `fetch` on a site-provided URL directly.
- Pages (home page, `/favicon.ico`) are fetched with `sameSiteAs`, so they are only ever read from
  the requested site; icon files may live anywhere (CDNs).
- Serve only bytes that `sniffImage` recognises, with the headers from `src/http.ts`. Keep the
  `Accept` header for icons limited to formats `sniffImage` knows.
- A miss is cached in KV only when the site answered (`reason: 'none'`); an unanswered lookup is
  returned with a short browser cache and resolved again next time.
- Keep `src/resolver/` free of Cloudflare and Void imports.

## Conventions

- Types only, no interfaces; no enums (`as const` + `keyof typeof`); arrow functions only
- Parameters `(props: Type)` then destructure inside, for functions with several named options
- Tests in `__tests__/` next to the code (`<module>.test.ts`), `vp test`

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
