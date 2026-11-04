# favicon-resolver

Finds a website's best icon and serves it from your own Cloudflare Worker.

```html
<img src="https://favicon-resolver.<you>.workers.dev/github.com" width="24" height="24" alt="" />
```

It reads the icons the site itself declares, so it finds icons that Google's favicon service
misses (SVG-only sites, small or new sites) and usually returns them at a better size. Google is
the fallback. Results are cached in Workers KV, so each site is looked up about once a month.

Built with [Void](https://void.cloud) and [Vite+](https://viteplus.dev). Runs on the Cloudflare
Workers free plan.

## API

`GET /<hostname>`, for example `/github.com` or `/docs.example.com`.

| Status | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| 200    | The icon, as the site serves it: SVG, PNG, ICO, GIF, JPEG, or WebP              |
| 404    | No icon found. Show your own fallback (`<img onerror>`)                         |
| 400    | Not a public hostname (IP addresses, `localhost`, `.local`, `.internal`, …)     |
| 403    | `ALLOWED_REFERRERS` is set and the request came from another site               |

The `X-Favicon-Source` header says where the icon came from: `site` or `google`.

## How an icon is chosen

1. Fetch the home page (`https://`, then `http://`, then `https://www.`), following redirects. If
   none answers successfully, use the first error page: apps behind a login often still send
   their usual HTML, icon links included, with a 401 or 403.
2. Read `<link rel="icon">`, `<link rel="apple-touch-icon">`, and `<base href>` from `<head>`,
   resolving relative URLs against the final page URL.
3. If nothing large or scalable is declared, read the web app manifest's icons.
4. Rank them: a raster of 64px or more (smallest first), then SVG, then apple-touch and manifest
   icons, then icons with no declared size, then smaller rasters. Try them best first, giving up on
   a kind after two failures (some apps list icons that do not exist).
5. Try `/favicon.ico`. If it answers with an HTML page instead of an image (often the app's 404
   page), read the icons that page declares. TeamCity behind a login works this way: its home page
   is a bare 401, but its 404 page names its icon.
6. Accept a response only if it succeeded and its bytes are a real image. Many sites answer a
   missing icon with an HTML page and status 200.
7. If the site gives nothing, ask Google's favicon service, ignoring its 16px placeholder globe.

Found icons are cached for 30 days, misses for 7. Browsers cache icons for 7 days and misses for 1.

## Safety

The Worker fetches URLs that websites choose, so it is built to refuse being pointed somewhere it
should not go:

- Only `http`/`https`, default ports, no credentials in the URL.
- Hostnames only: IP addresses (`127.0.0.1`, `169.254.169.254`, `0x7f000001`, `[::1]`, …),
  `localhost`, and private-use suffixes (`.local`, `.internal`, `.lan`, `.home.arpa`, …) are refused.
- Redirects are followed by hand, at most 5, and every hop is checked again.
- Each request times out after 4 seconds and a lookup after 10. Pages are read up to 512 KB,
  icons up to 512 KB.
- Icons are served from the Worker's own domain with
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and
  `X-Content-Type-Options: nosniff`, so an SVG with a script in it cannot run anything, even when
  opened directly. Inside `<img>`, browsers never run SVG scripts.

A Worker runs on Cloudflare's network, not next to your servers, so there is no private network
behind it to reach.

## Self-hosting

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

1. Your account needs a `workers.dev` subdomain. If you have never deployed a Worker, open
   **Workers & Pages** in the Cloudflare dashboard and deploy the **Hello World** starter once; that
   registers it (you can delete that Worker afterwards). The subdomain is public and shared by all
   your Workers.
2. Connect and deploy:

```sh
pnpm install
pnpm exec void connect --platform cloudflare   # once: opens the browser to sign in
pnpm exec void deploy                          # creates the KV store and publishes
```

The deploy prints your URL, `https://favicon-resolver.<subdomain>.workers.dev`. Use
`pnpm exec void deploy`, not `pnpm deploy`, which is a built-in pnpm command.

To stop other sites from using your Worker (and your free quota), list the sites that may embed it:

```sh
pnpm exec void secret put ALLOWED_REFERRERS   # e.g. example.com,localhost
```

Requests from listed hosts and their subdomains are served. Requests from other sites get 403.
Requests without a `Referer` header are still served, because some browsers and privacy settings
send none.

### Free plan limits

Workers Free includes 100,000 requests a day, and KV includes 100,000 reads and 1,000 writes a day
(check [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/) for current
numbers). Each new site costs one write. Over 1,000 new sites in a day, icons still load but are not
cached until the next day.

## Development

```sh
pnpm dev           # local Worker with local KV at http://localhost:5173 (or the port shown)
pnpm test          # unit tests, no network
pnpm lint:check
pnpm typecheck
```

`src/resolver/` has no Cloudflare dependency. `resolveFavicon(hostname, { fetch })` runs in any
runtime with `fetch` (Node, Bun, Deno, Workers).

## Limits

- Pages behind a login (SSO intranets, Jira, Confluence) cannot be read from outside. Only the
  browser that is signed in can see their icons.
- Sites that block bots or need JavaScript to render their `<head>` fall back to Google.

## License

MIT
