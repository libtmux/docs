import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectNativeContext, nativeHash } from '../../scripts/native-shell-context.mjs'

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
  const html = `<html><head><title>Server</title></head><body><article>${article}</article><footer><div class="page-source"><code>docs/api/libtmux.server.md</code></div></footer></body></html>`
  writeFileSync(join(artifact, 'api/libtmux.server/index.html'), html)
  writeFileSync(join(artifact, 'api/libtmux.server.md'), source)
  writeFileSync(join(artifact, 'genindex/index.html'), '<html><head></head><body><article>Generated index</article></body></html>')
  writeFileSync(join(artifact, 'docs.json'), JSON.stringify({ pages: [{ url: '/api/libtmux.server/', markdownUrl: '/api/libtmux.server.md' }] }))
  const options = { prefix: '/pr-42/en', sphinxPort: 'py', version: 'v0.62.0', checkout, sourceSha }
  return { artifact, checkout, options, article, html, source, sourceSha }
}

describe('native shell context', () => {
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
