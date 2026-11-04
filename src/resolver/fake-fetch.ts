import { type FetchFn } from './fetch-limited'

type Route = { status?: number; body?: BodyInit | null; headers?: Record<string, string> }

/** A fetch stand-in for tests: URL → canned response. Records every URL it was asked for. */
export const fakeFetch = (routes: Record<string, Route>) => {
  const requested: string[] = []
  const fetch: FetchFn = async input => {
    const url = input instanceof Request ? input.url : String(input)
    requested.push(url)
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body ?? null, {
      status: route.status ?? 200,
      headers: route.headers,
    })
  }
  return { fetch, requested }
}

export const pngBytes = (width: number, height: number) => {
  const data = new Uint8Array(32)
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(data.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return data
}
