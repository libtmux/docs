import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { stagedRoutesFor } from '../../scripts/stage-port-docs.mjs'
import { PORTS } from '../src/lib/ports.ts'

const root = new URL('../../', import.meta.url).pathname
const cachedRevision = 'a'.repeat(40)
const files = ['scripts/stage-port-docs.mjs', 'site/src/lib/ports.ts',
  'site/src/lib/site-root.ts', 'site/src/lib/cooldown.ts', 'site/src/lib/port-documentation.ts',
  'site/src/lib/versions.ts']
const stagedPorts = ['ruby', 'lua', 'kotlin', 'scala', 'fsharp']

function fixture(slug: 'ruby' | 'lua' | 'kotlin', run: (fixture: {
  directory: string; checkout: string; revision: string;
  write: (path: string, value: string) => void;
  artifact: (port: string, revision: string, label: string) => string;
  invoke: (...args: string[]) => ReturnType<typeof invokeGenerator>;
}) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-staged-publication-'))
  const checkout = join(directory, 'source')
  const write = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
  const artifact = (port: string, revision: string, label: string) => JSON.stringify({
    source: { repository: PORTS.find((entry) => entry.slug === port)!.repo, revision },
    guides: Object.keys(stagedRoutesFor(port)).map((path) => ({ path, content: `# Guide\n\n${label}-${port}\n` })),
  })
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      copyFileSync(join(root, file), join(directory, file))
    }
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
    write(join(directory, 'package.json'), '{"type":"module"}')
    for (const port of stagedPorts) {
      write(join(directory, `site/src/data/port-guides/${port}.json`), artifact(port, cachedRevision, 'cached'))
      write(join(directory, `site/src/data/api/${port}.json`), JSON.stringify({ revision: cachedRevision, symbols: [] }))
    }
    let revision = 'b'.repeat(40)
    if (slug === 'kotlin') {
      for (const path of Object.keys(stagedRoutesFor(slug))) write(join(checkout, path), '# Guide\n\nfresh-kotlin\n')
      const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
      git('init', '-q')
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Selected source')
      revision = git('rev-parse', 'HEAD')
    }
    const env = { ...process.env, LIBTMUX_DOCS_PORT: slug, LIBTMUX_DOCS_SOURCE_SHA: revision,
      [`LIBTMUX_DOCS_CHECKOUT_${slug.toUpperCase()}`]: checkout }
    run({ directory, checkout, revision, write, artifact,
      invoke: (...args) => invokeGenerator(directory, env, args) })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function invokeGenerator(directory: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [join(directory, 'scripts/stage-port-docs.mjs'), ...args],
    { encoding: 'utf8', env, timeout: 10000 })
}

it('leaves the preview mount to Markdown while selecting the parent API version', () => {
  fixture('lua', ({ directory, artifact, write }) => {
    const guides = JSON.parse(artifact('fsharp', cachedRevision, 'cached'))
    guides.guides.find((guide: { path: string }) => guide.path === 'docs/fsharp/supported-query-fields.md').content
      += '\n- Required depth: `Windows`\n'
    write(join(directory, 'site/src/data/port-guides/fsharp.json'), JSON.stringify(guides))
    write(join(directory, 'site/src/data/api/dotnet.json'), JSON.stringify({ symbols: [{
      id: 'LibTmux.SnapshotDepth.Windows', parent: 'LibTmux.SnapshotDepth', kind: 'constant',
      product: 'core', slug: 'libtmux-snapshotdepth-windows',
    }] }))
    const run = invokeGenerator(directory, { ...process.env, LIBTMUX_DOCS_ROOT: '/pr-93/en/',
      LIBTMUX_DOCS_PORT_ROOT: '/pr-93/en/', LIBTMUX_DOCS_PORT_DEFAULTS: '{"dotnet":"v0.0.0-alpha.18"}',
    }, ['--wrappers'])
    expect(run.status, run.stderr).toBe(0)
    const guide = readFileSync(join(directory,
      'site/src/content/docs/_staged/fsharp/guides/supported-query-fields/index.md'), 'utf8')
    expect(guide).toContain('[`Windows`](/dotnet/v0.0.0-alpha.18/reference/libtmux-snapshotdepth-windows/)')
    expect(guide).not.toContain('/pr-93/')
  })
})

it.each(['ruby', 'lua', 'kotlin'] as const)('stages other caches before accepting only the selected %s source', (slug) => {
  fixture(slug, ({ directory, checkout, revision, write, artifact, invoke }) => {
    const staged = join(directory, 'site/src/content/docs/_staged')
    const cache = join(directory, `site/src/data/port-guides/${slug}.json`)
    const cachedBytes = readFileSync(cache, 'utf8')
    const otherCaches = Object.fromEntries(stagedPorts.filter((port) => port !== slug)
      .map((port) => [port, readFileSync(join(directory, `site/src/data/port-guides/${port}.json`), 'utf8')]))
    const baseline = invoke('--cached')
    expect(baseline.status, baseline.stderr).toBe(0)
    expect(existsSync(join(staged, slug))).toBe(false)
    expect(readFileSync(cache, 'utf8')).toBe(cachedBytes)
    for (const port of stagedPorts.filter((port) => port !== slug)) {
      const route = Object.values(stagedRoutesFor(port))[0].route
      expect(readFileSync(join(staged, port, route, 'index.md'), 'utf8')).toContain(`cached-${port}`)
    }

    const explicit = invoke('--cached', '--port', slug)
    expect(explicit.status).not.toBe(0)
    expect(explicit.stderr).toContain(`--cached cannot stage selected publication port ${slug}`)
    expect(readFileSync(cache, 'utf8')).toBe(cachedBytes)

    if (slug !== 'kotlin') {
      write(join(directory, `site/src/data/api/${slug}.json`), JSON.stringify({ revision }))
      write(join(checkout, 'docs/_build/api.json'), artifact(slug, revision, 'fresh'))
    }
    const fresh = invoke('--port', slug, ...(slug === 'kotlin' ? ['--from-source'] : []))
    expect(fresh.status, fresh.stderr).toBe(0)
    const route = Object.values(stagedRoutesFor(slug))[0].route
    const rendered = join(staged, slug, route, 'index.md')
    expect(readFileSync(rendered, 'utf8')).toContain(`fresh-${slug}`)
    expect(readFileSync(rendered, 'utf8')).toContain(revision)
    expect(JSON.parse(readFileSync(cache, 'utf8')).source.revision).toBe(revision)
    const wrappers = invoke('--wrappers')
    expect(wrappers.status, wrappers.stderr).toBe(0)
    const renderedBytes = readFileSync(rendered, 'utf8')
    expect(renderedBytes).toContain(`fresh-${slug}`)
    expect(renderedBytes).toContain(revision)
    for (const [port, bytes] of Object.entries(otherCaches)) {
      expect(readFileSync(join(directory, `site/src/data/port-guides/${port}.json`), 'utf8')).toBe(bytes)
    }

    const wrong = 'c'.repeat(40)
    if (slug === 'kotlin') {
      execFileSync('git', ['-C', checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '--allow-empty', '-qm', 'Different source'], { stdio: 'pipe' })
    } else {
      write(join(directory, `site/src/data/api/${slug}.json`), JSON.stringify({ revision: wrong }))
      write(join(checkout, 'docs/_build/api.json'), artifact(slug, wrong, 'wrong'))
    }
    const rejected = invoke('--port', slug, ...(slug === 'kotlin' ? ['--from-source'] : []))
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain(`${slug}: expected source ${revision}, artifact records`)
    expect(readFileSync(rendered, 'utf8')).toBe(renderedBytes)
    expect(JSON.parse(readFileSync(cache, 'utf8')).source.revision).toBe(revision)
  })
})
