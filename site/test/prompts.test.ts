import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installCommand, isReleaseSeries, PORT_BY_SLUG, PORTS, releaseMaturity, releaseWording, type Port, type RegistryEntry } from '../src/lib/ports'
import {
  composeFromParts,
  composePrompt,
  portParts,
  sharedParts,
  TOPICS,
  VERSION_SENTINEL,
  wrap,
} from '../src/lib/prompts'
import { promptInputs, promptPartsFor, REGISTRY, registryFor } from '../src/lib/registry'
import { highlightPrompt } from '../src/lib/prompt-highlight'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BUCKET_ROOT, SITE_BUILT, SITE_PREFIX, REPO_ROOT, sitePath, publishedPath, SKIP_REASON } from './site-root'
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
    released: isReleaseSeries(releaseMaturity(entry)),
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

function promptFor(port: Port, topicId: string, version = ctx.version, docsBase = ctx.docsBase): string {
  const key = `${port.slug}/${topicId}/${version}/${docsBase}`
  const hit = COMPOSED.get(key)
  if (hit !== undefined) return hit
  const entry = registryFor(port)
  const text = composePrompt({
    port,
    released: isReleaseSeries(releaseMaturity(entry)),
    install: installCommand(port, entry),
    wording: releaseWording(port, entry),
    ctx: { docsBase, version },
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

  it.each(['ruby', 'lua'])('%s does not advertise unsupported freeze or reconciliation products', (slug) => {
    const port = PORTS.find((entry) => entry.slug === slug)!
    for (const topic of ['session-freezer', 'session-supervisor']) {
      const text = promptFor(port, topic)
      expect(text).toContain('Availability')
      expect(text).not.toContain('What it does:')
    }
  })

  it.each(MATRIX)('$port.slug/$topic.id cites the site and this port', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    // The machine-readable entry points, which are the whole reason a prompt
    // beats "go read the docs": an agent fetches these two first.
    expect(text, 'llms.txt').toContain(`${DOCS_BASE}/${port.slug}/latest/llms.txt`)
    expect(text, 'docs.json').toContain(`${DOCS_BASE}/${port.slug}/latest/docs.json`)
    expect(text, 'reference').toContain(`${DOCS_BASE}/${port.slug}/latest/reference/`)
    expect(text, 'repository').toContain(`https://github.com/${port.repo}`)
    expect(text, 'registry page').toContain((port.registry?.url ?? `https://github.com/${port.repo}`))
  })

  it.each([DOCS_BASE, 'https://libtmux.org/pr-42/ja'])('cites shared tmux guides beneath %s', (docsBase) => {
    const { sections } = sharedParts({ ...ctx, docsBase })
    for (const topic of TOPICS.filter((entry) => entry.id !== 'setup')) {
      for (const page of topic.pages) {
        expect(sections[topic.id], `${topic.id}: ${page}`).toContain(`${docsBase}/tmux/${page}/`)
      }
    }
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
      expect(text, 'names the ref it installs from').toContain(entry.tag ?? 'default branch')
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

describe('prompt highlighting', () => {
  /**
   * The widget renders highlighted HTML and the copy button reads
   * `textContent`, so whatever the highlighter does has to survive having its
   * tags stripped and its entities decoded. If it does not, the reader copies
   * something other than the prompt and no test elsewhere would notice: the
   * `.txt` routes and the published-bytes check never go through this path.
   */
  const asTextContent = (html: string): string =>
    html
      .replace(/<[^>]+>/g, '')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")

  it.each(MATRIX)('$port.slug/$topic.id survives highlighting byte for byte', ({ port, topic }) => {
    const text = promptFor(port, topic.id)
    expect(asTextContent(highlightPrompt(text))).toBe(text)
  })

  it('escapes markup rather than emitting it', () => {
    const html = highlightPrompt('a <script>alert(1)</script> & "quoted"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(asTextContent(html)).toBe('a <script>alert(1)</script> & "quoted"')
  })

  it('marks the things a reader looks for', () => {
    const html = highlightPrompt('Package:    libtmux (PyPI)\n- https://libtmux.org/en/\n    uv add libtmux')
    expect(html, 'field name').toContain('lm-ph-key')
    expect(html, 'url').toContain('lm-ph-url')
    expect(html, 'indented command').toContain('lm-ph-cmd')
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
   * shared and per-port bounds catch that duplication without treating a new
   * port as duplicated content. Measure serialized UTF-8, including unavailable
   * topic messages and JSON overhead, rather than only some of the strings.
   */
  it('ships the shared half once, not once per port', () => {
    const shared = sharedParts(ctx)
    const partsBytes = Buffer.byteLength(JSON.stringify(shared))
    expect(partsBytes, 'shared topic text').toBeLessThan(10_000)
    const portBytes = PORTS.reduce((sum, port) => {
      const bytes = Buffer.byteLength(JSON.stringify(partsFor(port)))
      expect(bytes, `${port.slug} setup, notes and availability`).toBeLessThan(3_200)
      return sum + bytes
    }, 0)
    const wholeBytes = MATRIX.reduce((sum, { port, topic }) => sum + Buffer.byteLength(promptFor(port, topic.id)), 0)
    expect(wholeBytes / (partsBytes + portBytes)).toBeGreaterThan(4)
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
      if (entry.status === 'release') {
        expect(entry.release, `${port.slug} is released with no release version`).toBeTruthy()
        expect(entry.version, `${port.slug} version tracks its release`).toBe(entry.release)
      }
      if (entry.status === 'prerelease') {
        expect(entry.version, `${port.slug} is prerelease with no version`).toBeTruthy()
        expect(entry.release, `${port.slug} is prerelease yet names a release`).toBeNull()
      }
      if (entry.status === 'unpublished') {
        expect(entry.version, `${port.slug} is unpublished yet names a version`).toBeNull()
        // The git form is the only one left. It names a release tag, or fixes
        // its own ref when the repository has none.
        const names = entry.tag ?? (port.installForms.git.code.includes('{tag}') ? null : 'fixed ref')
        expect(names, `${port.slug} is unpublished with no ref to install from`).toBeTruthy()
      }
    }
  })

  it('refuses a tag-less entry whose git form needs a tag', () => {
    const base = PORT_BY_SLUG.py!
    const withGit = (code: string): Port => ({ ...base, installForms: { ...base.installForms, git: { code, lang: 'console' } } })
    const tagless: RegistryEntry = { status: 'unpublished', version: null, release: null, tag: null }
    expect(() => installCommand(withGit('git clone --branch {tag} repo'), tagless)).toThrow(/no release tag/)
    const fixed = withGit('git clone --branch main repo')
    expect(installCommand(fixed, tagless).code).toBe('git clone --branch main repo')
    expect(releaseWording(fixed, tagless)).toContain('default branch')
    expect(installCommand(withGit('git clone --branch {tag} repo'), { ...tagless, tag: 'v1' }).code).toBe('git clone --branch v1 repo')
  })

  it('names the tag only where the git form installs it', () => {
    // Julia installs the default branch, so a release tag beside the command is not what runs.
    const julia = PORT_BY_SLUG.julia!
    const tagged: RegistryEntry = { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }
    expect(installCommand(julia, tagged).code).toContain('rev="master"')
    expect(releaseWording(julia, tagged)).toContain('default branch')
    expect(releaseWording(julia, tagged)).toContain('v0.1.0')
    expect(releaseWording(julia, tagged)).not.toContain('at tag')
    const cxx = PORT_BY_SLUG.cxx!
    const alpha: RegistryEntry = { ...tagged, tag: 'v0.1.0-alpha.12' }
    expect(installCommand(cxx, alpha).code).toContain('GIT_TAG v0.1.0-alpha.12')
    expect(releaseWording(cxx, alpha)).toContain('at tag v0.1.0-alpha.12')
  })

  it('sends an agent looking for a final release only where the newest tag is not already one', () => {
    const julia = PORT_BY_SLUG.julia!
    const prompt = (entry: RegistryEntry) => composePrompt({
      port: julia, released: isReleaseSeries(releaseMaturity(entry)), install: installCommand(julia, entry),
      wording: releaseWording(julia, entry), ctx, topicId: 'setup',
    }).replace(/\s+/g, ' ')
    const finalTag: RegistryEntry = { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }
    expect(prompt(finalTag)).toContain('if you need a different version.')
    expect(prompt(finalTag)).not.toContain('prefer a final release')
    expect(prompt({ ...finalTag, tag: 'v0.1.0-alpha.2' })).toContain('prefer a final release over this prerelease if there now is one.')
  })

  it('composes the site’s prompt from the entry the registry holds', () => {
    const julia = PORT_BY_SLUG.julia!
    const recorded = REGISTRY.ports.julia!
    // What the deploy's resolver wrote once v0.1.0 was tagged and General did not carry it.
    REGISTRY.ports.julia = { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }
    try {
      expect(promptInputs(julia, ctx).released).toBe(true)
      expect(promptPartsFor(julia, ctx).setup.replace(/\s+/g, ' ')).toContain('if you need a different version.')
    } finally {
      REGISTRY.ports.julia = recorded
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
    const root = join(REPO_ROOT, 'site', 'src', 'content', 'docs')
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
    const urls = [...promptFor(port, topic.id, ctx.version, `https://libtmux.org/${SITE_PREFIX.replace(/\/$/, '')}`).matchAll(/https:\/\/libtmux\.org\/\S*[^\s.,)]/g)].map((m) => m[0])
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
  const published = sitePath
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
      const file = publishedPath(new URL(entry.text).pathname)
      expect(existsSync(file), `${entry.text} is named by prompts.json`).toBe(true)
      const bytes = readFileSync(file)
      expect(bytes.length, `${entry.text} length`).toBe(entry.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), `${entry.text} sha256`).toBe(entry.sha256)
    }
  })

  /**
   * Composed at the version the manifest records, not at a version this file
   * picked. `build-site.sh` gives each port its own default version, so a
   * hard-coded version here tests
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
      expect(file, key).toBe(`${promptFor(port, topic.id, version, `https://libtmux.org/${SITE_PREFIX.replace(/\/$/, '')}`)}\n`)
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
      .map((port) => join(SITE_PREFIX, port.slug, 'latest', 'prompts'))
      .filter((path) => existsSync(join(BUCKET_ROOT, path)))
    expect(strays, `prompts published under a port prefix: ${strays.join(', ')}`).toEqual([])
  })
})
