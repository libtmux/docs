import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../infra/cloudfront-function.js', import.meta.url), 'utf8')
const handler = runInNewContext(`${source.replace("import cf from 'cloudfront'", '')}\nhandler`, {
  cf: { kvs: () => ({ get: async () => { throw new Error('No port default') } }) },
}) as (event: { request: { uri: string; querystring?: Record<string, unknown> } }) => Promise<{
  statusCode?: number; uri?: string; headers?: { location: { value: string } }
}>

describe('tmux prose redirects at the edge', () => {
  it.each(['guides', 'topics', 'concepts', 'examples'])('redirects %s indexes and descendants in one hop', async (section) => {
    for (const root of ['/en', '/ja', '/pr-42/en']) for (const [suffix, target] of [
      ['', '/'], ['/', '/'], ['/index.html', '/'],
      ['/nested/page', '/nested/page/'], ['/nested/page/', '/nested/page/'],
      ['/nested/page/index.html', '/nested/page/'], ['/nested/page.md', '/nested/page.md'],
      ['/index.md', '/index.md'], ['.md', '.md'],
      ['/json', '/json/'], ['/constructor', '/constructor/'],
    ]) {
      const result = await handler({ request: { uri: `${root}/${section}${suffix}` } })
      expect(result.statusCode).toBe(301)
      expect(result.headers?.location.value).toBe(`${root}/tmux/${section}${target}`)
    }
  })

  it('preserves encoded query values, repeated parameters and empty values', async () => {
    const result = await handler({ request: { uri: '/en/guides/getting-started/', querystring: {
      prompt: { value: 'session%20switcher' },
      tag: { multiValue: [{ value: 'a%2Fb' }, { value: 'a%26b' }] },
      empty: { value: '' },
    } } })
    expect(result.headers?.location.value).toBe('/en/tmux/guides/getting-started/?prompt=session%20switcher&tag=a%2Fb&tag=a%26b&empty=')
  })

  it.each(['/en/tmux/guides/', '/en/go/latest/guides/', '/en/topics-extra/', '/en/prompts/', '/guides/'])('does not redirect unrelated or already canonical path %s', async (uri) => {
    const result = await handler({ request: { uri } })
    expect(result.statusCode).toBeUndefined()
    expect(result.uri).toBe(`${uri}index.html`)
  })

  it('keeps the complete function below the CloudFront source limit', () => {
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(10_240)
  })
})
