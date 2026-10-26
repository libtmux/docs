import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectNativeContext, nativeHash } from '../../scripts/native-shell-context.mjs'
import { nativeReferenceTree, type NativeShellContext } from '../src/lib/native-shell'
import { searchApi, apiTreeHref } from '../src/lib/api-search'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'native-context-'))
  directories.push(directory)
  const checkout = join(directory, 'source'), artifact = join(directory, 'artifact')
  mkdirSync(join(checkout, 'docs/api'), { recursive: true })
  mkdirSync(join(artifact, 'api/libtmux.server'), { recursive: true })
  mkdirSync(join(artifact, 'genindex'), { recursive: true })
  const source = '# Server\n\nNative source.\n'
  writeFileSync(join(checkout, 'docs/api/libtmux.server.md'), source)
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Native source fixture')
  const sourceSha = git('rev-parse', 'HEAD')
  const article = '<h1>Server</h1><dt class="sig" id="libtmux.Server"><code>Server</code></dt>\n<pre>  exact &amp; bytes\n</pre>'
  const html = `<html><head><title>Server</title></head><body><div class="sidebar-tree"><ul><li class="toctree-l1 current current-page"><a class="current reference internal" href="#">Server</a></li></ul></div><article>${article}</article><footer><div class="page-source"><code>docs/api/libtmux.server.md</code></div></footer></body></html>`
  writeFileSync(join(artifact, 'api/libtmux.server/index.html'), html)
  writeFileSync(join(artifact, 'api/libtmux.server.md'), source)
  writeFileSync(join(artifact, 'genindex/index.html'), '<html><head></head><body><div class="sidebar-tree"><ul><li class="toctree-l1"><a class="reference internal" href="../api/libtmux.server/">Server</a></li></ul></div><article>Generated index</article></body></html>')
  writeFileSync(join(artifact, 'docs.json'), JSON.stringify({ pages: [{ url: '/api/libtmux.server/', markdownUrl: '/api/libtmux.server.md' }] }))
  const options = { prefix: '/pr-42/en', sphinxPort: 'py', version: 'v0.62.0', checkout, sourceSha }
  return { artifact, checkout, options, article, html, source, sourceSha }
}

describe('native shell context', () => {
  it('recognizes Sphinx properties inside their class', async () => {
    const { artifact, options, html } = fixture()
    const declarations = '<dl class="py class"><dt class="sig" id="libtmux.Server"><span class="sig-name">Server</span></dt><dd><dl class="py property"><dt class="sig" id="libtmux.Server.sessions"><span class="sig-name">sessions</span></dt></dl></dd></dl>'
    writeFileSync(join(artifact, 'api/libtmux.server/index.html'), html.replace(/<dt class="sig".*?<\/dt>/, declarations))
    const context = await collectNativeContext(artifact, options)
    expect(context.pages.find((page) => page.file === 'api/libtmux.server/index.html')?.declarations).toContainEqual({
      id: 'libtmux.Server.sessions', name: 'sessions', kind: 'property', parent: 'libtmux.Server',
    })
  })
  it('keeps repeated native declarations on their own pages with nested ownership', () => {
    const context = { port: 'py', pages: ['api/server/', 'internals/server/'].map((path) => ({ path, title: 'Server',
      url: `/pr-42/en/py/stable/api/${path}`, declarations: [
        { id: 'Server', name: 'Server', kind: 'class' },
        { id: 'Server.sessions', name: 'sessions', kind: 'property', parent: 'Server' },
      ] })) } as NativeShellContext
    const json = nativeReferenceTree(context)
    const members = searchApi(json, 'sessions')
    expect(new Set(members.map((member) => member.id)).size).toBe(2)
    expect(members.map((member) => apiTreeHref('/ignored/', member, json.hrefs))).toEqual([
      '/pr-42/en/py/stable/api/api/server/#Server.sessions', '/pr-42/en/py/stable/api/internals/server/#Server.sessions',
    ])
    expect(json.members['api/server/#Server'][0][2]).toBe('api/server/#Server.sessions')
  })
  it('binds real source, exact Markdown and native article bytes, without inventing generated-index targets', async () => {
    const { artifact, options, article, source, sourceSha } = fixture()
    const context = await collectNativeContext(artifact, options)
    const server = context.pages.find((page: { file: string }) => page.file === 'api/libtmux.server/index.html')!
    expect(server.url).toBe('/pr-42/en/py/v0.62.0/api/api/libtmux.server/')
    expect(server.sourcePath).toBe('py/v0.62.0/api/api/libtmux.server/')
    expect(server.markdownHref).toBe('/pr-42/en/py/v0.62.0/api/api/libtmux.server.md')
    expect(server.source).toEqual({ repo: 'tmux-python/libtmux', ref: sourceSha, path: 'docs/api/libtmux.server.md', sha256: nativeHash(source) })
    expect(server.articleSha256).toBe(nativeHash(article))
    expect(server.signatures).toEqual(['libtmux.Server'])
    expect(server.hasTableOfContents).toBe(false)
    const index = context.pages.find((page: { file: string }) => page.file === 'genindex/index.html')!
    expect(index.source).toBeUndefined()
    expect(index.markdownHref).toBeUndefined()
    expect(await collectNativeContext(artifact, options)).toEqual(context)
  })

  it('binds the global toctree once, on published URLs, and rejects pages that disagree', async () => {
    const { artifact, options, html } = fixture()
    const context = await collectNativeContext(artifact, options)
    expect(context.toctree).toEqual([{ title: 'Server', url: '/pr-42/en/py/v0.62.0/api/api/libtmux.server/', children: [] }])
    writeFileSync(join(artifact, 'genindex/index.html'), html.replace('<code>docs/api/libtmux.server.md</code>', '').replace('>Server</a>', '>Other</a>'))
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('global toctree differs')
    writeFileSync(join(artifact, 'genindex/index.html'), '<html><body><article>Generated index</article></body></html>')
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('no global toctree')
  })

  it('offers contents only for real destinations beyond the page title', async () => {
    const { artifact, options, html } = fixture()
    const page = join(artifact, 'api/libtmux.server/index.html')
    const writeToc = (links: string) => writeFileSync(page, html.replace('</body>', `<aside><div class="toc-tree">${links}</div></aside></body>`))
    writeToc('<a href="#">Server</a><a href="#missing">Missing</a><a href="#%zz">Invalid</a>')
    expect((await collectNativeContext(artifact, options)).pages[0].hasTableOfContents).toBe(false)
    writeToc('<a href="#libtmux.Server">Server declaration</a>')
    expect((await collectNativeContext(artifact, options)).pages[0].hasTableOfContents).toBe(true)
  })

  it('rejects a different revision or uncommitted source instead of citing it as the selected revision', async () => {
    const { artifact, options, checkout } = fixture()
    await expect(collectNativeContext(artifact, { ...options, sourceSha: '0'.repeat(40) })).rejects.toThrow('revision mismatch')
    writeFileSync(join(checkout, 'docs/api/libtmux.server.md'), 'Changed source')
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('tracked changes')
  })

  it('fails when metadata or the exact Markdown target is absent', async () => {
    const { artifact, options, html } = fixture()
    writeFileSync(join(artifact, 'api/libtmux.server/index.html'), html.replace('<code>docs/api/libtmux.server.md</code>', ''))
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('no valid source path')
    writeFileSync(join(artifact, 'api/libtmux.server/index.html'), html)
    rmSync(join(artifact, 'api/libtmux.server.md'))
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('Markdown is missing')
  })

  it('rejects unknown generated routes and traversing paths in the native export inventory', async () => {
    const { artifact, options } = fixture()
    const metadata = JSON.parse(readFileSync(join(artifact, 'docs.json'), 'utf8'))
    writeFileSync(join(artifact, 'docs.json'), JSON.stringify({ pages: [{ ...metadata.pages[0], url: '/../outside/' }] }))
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('not a local absolute path')
    writeFileSync(join(artifact, 'docs.json'), JSON.stringify({ pages: [] }))
    await expect(collectNativeContext(artifact, options)).rejects.toThrow('no docs.json entry')
  })
})
