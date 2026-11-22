import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'
import { nativeArticleHash, nativeHash } from '../../scripts/native-shell-context.mjs'

/**
 * Native Sphinx pages for a Python tree published at `/en/py/latest/api/`, normalized as the site assembly
 * normalizes them. `paths` are page paths inside the Sphinx tree (`api/pane/`, `quickstart/`, or `` for the root).
 * Returns the normalized HTML of each page, keyed by its path, and the directory it came from for a second pass.
 * `articleOf` writes a page's article in place of the default heading and sentence.
 */
export async function normalizedNativePages(paths: readonly string[], articleOf?: (path: string) => string) {
  const directory = mkdtempSync(join(tmpdir(), 'native-fixture-'))
  try {
    const native = join(directory, 'native')
    const shell = join(directory, 'shell')
    mkdirSync(join(shell, 'api'), { recursive: true })
    writeFileSync(join(shell, 'api/tree.json'), '{"port":"py","buckets":[],"members":{}}')
    const base = '/en/py/latest/api/'
    const pages = paths.map((path) => {
      const file = `${path}index.html`
      const article = articleOf?.(path) ?? `<h1>${path || 'Home'}</h1><p>Native page text for capture.</p>`
      const html = `<html><head><title>${path || 'Home'}</title></head><body><aside class="sidebar-drawer">Old navigation</aside><article role="main">${article}</article></body></html>`
      mkdirSync(join(native, path), { recursive: true })
      writeFileSync(join(native, file), html)
      mkdirSync(join(shell, 'api', path), { recursive: true })
      writeFileSync(join(shell, 'api', file), `<html data-native-shell-export><head data-native-shell-assets></head><body><template data-native-boundary="header-start"></template><header>Header</header><template data-native-boundary="header-end"></template><template data-native-boundary="sidebar-start"></template><nav>Sidebar</nav><template data-native-boundary="sidebar-end"></template><template data-native-boundary="footer-start"></template><footer>Footer</footer><template data-native-boundary="footer-end"></template></body></html>`)
      return { file, path, url: `${base}${path}`, htmlSha256: nativeHash(html), articleSha256: nativeArticleHash(article) }
    })
    const contextFile = join(directory, 'context.json')
    writeFileSync(contextFile, JSON.stringify({ schema: 1, port: 'py', version: 'latest', root: '/en/', base, pages }))
    const options = { sphinxPort: 'py', version: 'latest', contextFile, shellDirectory: shell }
    const changed = await normalizeNativeShell(native, '/en', options)
    const html = Object.fromEntries(paths.map((path) => [path, readFileSync(join(native, `${path}index.html`), 'utf8')]))
    const again = await normalizeNativeShell(native, '/en', options)
    return { html, changed, again, urls: Object.fromEntries(paths.map((path) => [path, `${base}${path}`])) }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
