import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installCommand, PORTS, releaseWording, type Port } from '../src/lib/ports'
import {
  composeFromParts,
  composePrompt,
  portParts,
  sharedParts,
  TOPICS,
  VERSION_SENTINEL,
  wrap,
} from '../src/lib/prompts'
import { registryFor } from '../src/lib/registry'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BUCKET_ROOT, SITE_BUILT, SKIP_REASON } from './site-root'
import { PROMPT_PAIRS, textPath, topicPath } from '../src/lib/prompt-routes'

/**
 * The prompts are the one thing on this site a reader hands to a machine
 * verbatim, so a wrong URL or a stale install line does not degrade the page,
 * it sends someone's agent down a path that cannot work. A prompt that cites a
 * 403 wastes the first thing the agent does, and one that names a package
 * version the registry does not carry produces an install failure the agent
 * then tries to "fix" by inventing an API.
 *
 * Two tiers. Everything that can be checked from source runs always. The
 * checks that need an assembled tree are gated on `SITE_BUILT`, the same way
 * `machine-readable.test.ts` gates its footer-link checks, because the
 * per-port `/en/<port>/latest/llms.txt` exists only after a port build and not
 * after a plain `pnpm build`.
 */

const DOCS_BASE = 'https://libtmux.org/en'
const ctx = { docsBase: DOCS_BASE, version: 'latest' }

function partsFor(port: Port) {
  const entry = registryFor(port)
  return portParts({
    port,
    entry,
    install: installCommand(port, entry),
    wording: releaseWording(port, entry),
    ctx,
  })
}

/**
 * Composed prompts, memoised.
 *
 * Six `it.each(MATRIX)` blocks over seventy-two pairs recompose each prompt six
 * times, and every call rebuilds both halves from scratch. It is 0.2s today and
 * grows with each assertion added, which is the shape of a suite that gets
 * quietly slower until someone raises a budget.
 */
const COMPOSED = new Map<string, string>()

function promptFor(port: Port, topicId: string, version = ctx.version): string {
  const key = `${port.slug}/${topicId}/${version}`
  const hit = COMPOSED.get(key)
  if (hit !== undefined) return hit
  const entry = registryFor(port)
  const text = composePrompt({
    port,
    entry,
    install: installCommand(port, entry),
    wording: releaseWording(port, entry),
    ctx: { ...ctx, version },
    topicId,
  })
  COMPOSED.set(key, text)
  return text
}

/** Every (port, topic) pair, as vitest table rows. */
const MATRIX = PORTS.flatMap((port) => TOPICS.map((topic) => ({ port, topic })))

describe('prompt composition', () => {
  it('covers every port and topic', () => {
    expect(MATRIX).toHaveLength(PORTS.length * TOPICS.length)
  })

  it.each(MATRIX)('$port.slug/$topic.id composes', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    expect(text.length).toBeGreaterThan(400)
  })

  it.each(MATRIX)('$port.slug/$topic.id cites the site and this port', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    // The machine-readable entry points, which are the whole reason a prompt
    // beats "go read the docs": an agent fetches these two first.
    expect(text, 'llms.txt').toContain(`${DOCS_BASE}/${port.slug}/latest/llms.txt`)
    expect(text, 'docs.json').toContain(`${DOCS_BASE}/${port.slug}/latest/docs.json`)
    expect(text, 'reference').toContain(`${DOCS_BASE}/reference/${port.slug}/`)
    expect(text, 'repository').toContain(`https://github.com/${port.repo}`)
    expect(text, 'registry page').toContain(port.registryUrl)
  })

  it.each(PORTS.filter((p) => p.ecosystemHost))('$slug cites its ecosystem host', (port) => {
    for (const topic of TOPICS) {
      expect(promptFor(port, topic.id)).toContain(port.ecosystemHost!.url)
    }
  })

  /**
   * The failure this exists for: `ports.ts` shipped `libtmux:VERSION` to
   * readers for months. A literal placeholder in a prompt is worse than in a
   * page, because the reader does not read it, the agent does.
   */
  it.each(MATRIX)('$port.slug/$topic.id leaves no placeholder', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    expect(text, 'brace placeholder').not.toMatch(/\{(version|tag|port|topic)\}/)
    // Placeholder-shaped only. A bare `VERSION` is a real CMake keyword
    // (`cmake_minimum_required(VERSION 3.24)`), so matching the word alone
    // fails the C++ prompt for being correct. What shipped as a bug was
    // `io.github.libtmux:libtmux:VERSION`, where it sits in a coordinate.
    expect(text, 'VERSION as a placeholder').not.toMatch(/[:@="']VERSION\b|\bVERSION["']/)
    expect(text, 'TODO').not.toMatch(/\bTODO\b|\bTBD\b/)
    expect(text, 'unsubstituted sentinel').not.toContain(VERSION_SENTINEL)
  })

  it.each(MATRIX)('$port.slug/$topic.id installs what the registry has', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    const entry = registryFor(port)
    // Line by line: the block is indented into the numbered step, and C++'s
    // form is a four-line CMake block, so the raw string is not a substring.
    for (const line of installCommand(port, entry).code.split('\n')) {
      expect(text, `install line: ${line}`).toContain(line.trim())
    }
    if (entry.status === 'prerelease') {
      // The pin is the point: Cargo, the Go proxy and SwiftPM all resolve
      // nothing without it.
      expect(text, 'names the prerelease').toContain(entry.version!)
    }
    if (entry.status === 'unpublished') {
      expect(text, 'names the tag it installs from').toContain(entry.tag!)
    }
  })

  it.each(MATRIX)('$port.slug/$topic.id names the language once, correctly', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    expect(text).toContain(`Language:   ${port.language}`)
    // A prompt naming another port's package is the cross-contamination this
    // composition model is meant to make impossible; check it anyway.
    for (const other of PORTS) {
      if (other.slug === port.slug || other.repo === port.repo) continue
      expect(text, `must not mention ${other.repo}`).not.toContain(`github.com/${other.repo}`)
    }
  })
})

describe('prompt legibility', () => {
  /**
   * Prompts get pasted into chat boxes and terminals that do not agree about
   * soft wrapping. Code and URLs cannot be broken without corrupting them, so
   * they are exempt; prose is not.
   */
  it.each(MATRIX)('$port.slug/$topic.id wraps its prose', ({ port, topic }) => {
    const long = promptFor(port, topic.id)
      .split('\n')
      .filter((line) => line.length > 80)
      .filter((line) => !/https?:\/\//.test(line))
      .filter((line) => !/^\s{4,}/.test(line))
    expect(long, `over 80 columns: ${long.join(' | ')}`).toEqual([])
  })

  /**
   * WRITING.md governs prompt text the same as any other user-facing prose:
   * omit "easily", "simply", "just" and "please note", replace "robust" with
   * the failure handled, and avoid em dashes. A prompt is the text most likely
   * to be written in a hurry and least likely to be reread, so the rule is
   * enforced rather than remembered.
   */
  it.each([
    /\bsimply\b/i,
    /\bjust\b/i,
    /\beasily\b/i,
    /\bplease note\b/i,
    /\brobust\b/i,
    /\bcomprehensive\b/i,
    /\bseamless/i,
    /\bleverage\b/i,
    /\butilize\b/i,
    /\u2014/,
  ])('uses no %s anywhere in the corpus', (banned) => {
    const offenders = MATRIX.flatMap(({ port, topic }) =>
      promptFor(port, topic.id)
        .split('\n')
        .filter((line) => banned.test(line))
        .map((line) => `${port.slug}/${topic.id}: ${line.trim()}`),
    )
    expect([...new Set(offenders)]).toEqual([])
  })

  it('wraps on word boundaries and keeps every word', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve'
    const out = wrap(text, 20)
    expect(out.split('\n').every((line) => line.length <= 20)).toBe(true)
    expect(out.split(/\s+/)).toEqual(text.split(' '))
  })

  it('indents continuation lines it is given an indent for', () => {
    expect(wrap('alpha beta gamma delta', 12, '  ').split('\n').slice(1).every((l) => l.startsWith('  '))).toBe(true)
  })
})

describe('prompt parts', () => {
  /**
   * The widget ships parts and composes in the browser. If composing from
   * parts ever diverged from composing directly, the copied text would differ
   * from the `.txt` route and the tested text, which is the one thing nobody
   * would notice.
   */
  it.each(MATRIX)('$port.slug/$topic.id composes identically from parts', ({ port, topic }) => {
    expect(composeFromParts(sharedParts(ctx), partsFor(port), topic.id)).toBe(promptFor(port, topic.id))
  })

  /**
   * The widget's payload, measured rather than assumed.
   *
   * The first version of this module built every topic section per port, and
   * the landing page shipped a 97 KB island of eight identical copies. The
   * bound is here so that regression is a failing test rather than something
   * noticed while reading a build artefact.
   */
  it('ships the shared half once, not once per port', () => {
    const shared = sharedParts(ctx)
    const partsBytes =
      shared.sections ? Object.values(shared.sections).join('').length + Object.values(shared.openings).join('').length : 0
    const portBytes = PORTS.reduce((sum, port) => {
      const parts = partsFor(port)
      return sum + parts.setup.length + Object.values(parts.notes).join('').length
    }, 0)
    const wholeBytes = MATRIX.reduce((sum, { port, topic }) => sum + promptFor(port, topic.id).length, 0)
    expect(wholeBytes / (partsBytes + portBytes)).toBeGreaterThan(4)
    expect(partsBytes + portBytes).toBeLessThan(40_000)
  })

  it('rejects an unknown topic rather than composing a prompt without one', () => {
    expect(() => composeFromParts(sharedParts(ctx), partsFor(PORTS[0]!), 'no-such-topic')).toThrow(/no topic/)
  })
})

describe('registry data', () => {
  /**
   * The live check lives in scripts/test-all.sh, where contacting eight
   * registries is appropriate. These are the invariants the committed file has
   * to satisfy whatever the outside world is doing, so they run everywhere.
   */
  it('has an entry for every port', () => {
    for (const port of PORTS) expect(() => registryFor(port), port.slug).not.toThrow()
  })

  it('carries what its own status claims', () => {
    for (const port of PORTS) {
      const entry = registryFor(port)
      if (entry.status === 'stable') {
        expect(entry.stable, `${port.slug} is stable with no stable version`).toBeTruthy()
        expect(entry.version, `${port.slug} version tracks stable`).toBe(entry.stable)
      }
      if (entry.status === 'prerelease') {
        expect(entry.version, `${port.slug} is prerelease with no version`).toBeTruthy()
        expect(entry.stable, `${port.slug} is prerelease yet names a stable`).toBeNull()
      }
      if (entry.status === 'unpublished') {
        expect(entry.version, `${port.slug} is unpublished yet names a version`).toBeNull()
        // The git form is the only one left, and it needs a tag to name.
        expect(entry.tag, `${port.slug} is unpublished with no tag to install from`).toBeTruthy()
      }
    }
  })

  it('composes an install command for every port without throwing', () => {
    for (const port of PORTS) {
      const form = installCommand(port, registryFor(port))
      expect(form.code.length, port.slug).toBeGreaterThan(0)
      expect(form.lang.length, port.slug).toBeGreaterThan(0)
    }
  })
})

describe('topic definitions', () => {
  it('has unique ids and URL-safe slugs', () => {
    const ids = TOPICS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('starts with setup, which every other topic builds on', () => {
    expect(TOPICS[0]!.id).toBe('setup')
  })

  it('anchors every non-setup topic on pages that exist in the content tree', () => {
    const root = join(BUCKET_ROOT, '..', 'site', 'src', 'content', 'docs')
    for (const topic of TOPICS) {
      expect(topic.pages.length, `${topic.id} cites no pages`).toBeGreaterThan(0)
      for (const page of topic.pages) {
        const md = join(root, `${page}.md`)
        const mdx = join(root, `${page}.mdx`)
        const index = join(root, page, 'index.md')
        expect(
          existsSync(md) || existsSync(mdx) || existsSync(index),
          `${topic.id} cites /${page}/, which has no source under site/src/content/docs/`,
        ).toBe(true)
      }
    }
  })

  it('only writes a port note for a port that exists', () => {
    const slugs = new Set(PORTS.map((p) => p.slug))
    for (const topic of TOPICS) {
      for (const slug of Object.keys(topic.portNotes ?? {})) {
        expect(slugs.has(slug), `${topic.id} has a note for unknown port "${slug}"`).toBe(true)
      }
    }
  })
})

/**
 * Only the assembled tree can answer whether a cited URL is a file that will
 * be published. Skipped without one, for the same reason and in the same shape
 * as the other output suites.
 */
describe.skipIf(!SITE_BUILT)(`cited URLs resolve in the assembled tree${SITE_BUILT ? '' : ` (${SKIP_REASON})`}`, () => {
  const resolves = (href: string): boolean => {
    const url = new URL(href)
    if (url.origin !== 'https://libtmux.org') return true
    const path = decodeURIComponent(url.pathname).replace(/^\//, '')
    const file = join(BUCKET_ROOT, path)
    if (existsSync(file) && statSync(file).isFile()) return true
    // Directory URLs are published as index.html.
    const index = join(BUCKET_ROOT, path, 'index.html')
    return existsSync(index) && statSync(index).isFile()
  }

  it.each(MATRIX)('$port.slug/$topic.id cites only published URLs', ({ port, topic }) => {
    const urls = [...promptFor(port, topic.id).matchAll(/https:\/\/libtmux\.org\/\S*[^\s.,)]/g)].map((m) => m[0])
    expect(urls.length).toBeGreaterThan(0)
    const dead = urls.filter((url) => !resolves(url))
    expect(dead, `not published: ${dead.join(', ')}`).toEqual([])
  })
})

/**
 * What the routes promise, checked against what the build wrote.
 *
 * `prompts.json` exists so a runner can enumerate and fetch prompts without a
 * browser. A manifest that names a file the build did not write, or a hash that
 * does not match the bytes behind it, is worse than no manifest: it fails in
 * the consumer rather than here.
 */
describe.skipIf(!SITE_BUILT)(`published prompt routes${SITE_BUILT ? '' : ` (${SKIP_REASON})`}`, () => {
  const published = (path: string) => join(BUCKET_ROOT, 'en', path)
  const manifest = () => JSON.parse(readFileSync(published('prompts.json'), 'utf8'))

  it('writes a text file for every port and topic', () => {
    const missing = PROMPT_PAIRS
      .map(({ port, topic }) => textPath(port.slug, topic.id))
      .filter((path) => !existsSync(published(path)))
    expect(missing, `absent: ${missing.join(', ')}`).toEqual([])
  })

  it('writes a page for the index and every topic', () => {
    const pages = ['prompts', ...TOPICS.map((t) => topicPath(t.id))]
    const missing = pages.filter((path) => !existsSync(published(join(path, 'index.html'))))
    expect(missing, `absent: ${missing.join(', ')}`).toEqual([])
  })

  it('lists every prompt in the manifest', () => {
    expect(manifest().prompts).toHaveLength(PROMPT_PAIRS.length)
  })

  it('names only files it wrote, with hashes that match their bytes', () => {
    for (const entry of manifest().prompts) {
      const path = new URL(entry.text).pathname.replace(/^\/en\//, '')
      const file = published(path)
      expect(existsSync(file), `${entry.text} is named by prompts.json`).toBe(true)
      const bytes = readFileSync(file)
      expect(bytes.length, `${entry.text} length`).toBe(entry.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), `${entry.text} sha256`).toBe(entry.sha256)
    }
  })

  /**
   * Composed at the version the manifest records, not at a version this file
   * picked. `build-site.sh` gives each port its own default and Python's is
   * `stable` while the rest are `latest`, so a hard-coded version here tests
   * the suite's assumption rather than the build's output.
   */
  it('publishes the same bytes the widget composes', () => {
    const versions = new Map<string, string>(
      manifest().prompts.map((p: { port: string; topic: string; version: string }) => [
        `${p.port}/${p.topic}`,
        p.version,
      ]),
    )
    for (const { port, topic } of PROMPT_PAIRS) {
      const key = `${port.slug}/${topic.id}`
      const version = versions.get(key)
      expect(version, `${key} is absent from prompts.json`).toBeTruthy()
      const file = readFileSync(published(textPath(port.slug, topic.id)), 'utf8')
      expect(file, key).toBe(`${promptFor(port, topic.id, version)}\n`)
    }
  })

  it('offers the prompts in llms.txt, where an agent will look', () => {
    const body = readFileSync(published('llms.txt'), 'utf8')
    expect(body).toContain('## Prompts')
    for (const topic of TOPICS) expect(body, topic.id).toContain(`/${topicPath(topic.id)}/`)
  })

  /**
   * Prompts are a root-build concern. Every port+version build renders the same
   * routes, so without the guard in prompt-routes.ts each of the fourteen trees
   * carries its own copy under a prefix nothing links to.
   */
  it('does not repeat itself under a port and version prefix', () => {
    const strays = PORTS
      .map((port) => join('en', port.slug, 'latest', 'prompts'))
      .filter((path) => existsSync(join(BUCKET_ROOT, path)))
    expect(strays, `prompts published under a port prefix: ${strays.join(', ')}`).toEqual([])
  })
})
