import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'

export const nativeHash = (value) => createHash('sha256').update(value).digest('hex')

/** Native article bytes are opaque to the owned shell. */
export function nativeArticle(html) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
  if (articles.length !== 1) throw new Error(`Native page must contain one article; found ${articles.length}`)
  return articles[0][1]
}

function artifactFiles(directory, path = '') {
  return readdirSync(join(directory, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) return artifactFiles(directory, name)
      if (!entry.isFile()) throw new Error(`Native artifact contains a non-file: ${name}`)
      return [name]
    })
}

function localPath(value, field) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      /[?#\\]/.test(value) || value.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part)))) {
    throw new Error(`Native ${field} is not a local absolute path: ${value}`)
  }
  return value
}

/** Bind native routes, exported Markdown and source files before Astro renders their shell. */
export async function collectNativeContext(directory, { prefix, sphinxPort, version, checkout, sourceSha }) {
  const port = PORT_BY_SLUG[sphinxPort]
  if (port?.renderer !== 'sphinx') throw new Error(`Not a Sphinx port: ${sphinxPort}`)
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
  const sha = git('rev-parse', 'HEAD')
  if (sourceSha && sourceSha !== sha) throw new Error(`Native source revision mismatch: ${sourceSha} != ${sha}`)
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`Native source has tracked changes: ${checkout}`)
  const root = localPath(`${prefix.replace(/\/+$/, '')}/`, 'prefix')
  if (!/^[\w.-]+$/.test(version)) throw new Error(`Invalid native version: ${version}`)
  const locale = root.split('/').filter(Boolean).at(-1)
  const base = `${root}${port.slug}/${version}/api/`
  const files = artifactFiles(directory)
  const hashes = Object.fromEntries(files.map((path) => [path, nativeHash(readFileSync(join(directory, path)))]))
  const docs = JSON.parse(readFileSync(join(directory, 'docs.json'), 'utf8'))
  const metadata = new Map()
  for (const entry of docs.pages) {
    const url = localPath(entry.url, 'page URL')
    if (metadata.has(url)) throw new Error(`Duplicate native docs.json URL: ${url}`)
    metadata.set(url, entry)
  }
  const pages = []
  const redirects = []
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
  try {
    for (const file of files.filter((path) => path.endsWith('.html') && !path.startsWith('_sources/'))) {
      const html = readFileSync(join(directory, file), 'utf8')
      if (/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html) || /^search(?:\.html|\/index\.html)$/.test(file)) {
        redirects.push(file)
        continue
      }
      if (!/(^|\/)index\.html$/.test(file)) throw new Error(`Native page is not a directory route: ${file}`)
      const path = file.replace(/index\.html$/, '')
      const entry = metadata.get(`/${path}`)
      window.document.body.innerHTML = html
      const sourcePath = window.document.querySelector('.page-source code')?.textContent?.trim()
      let source
      let markdownHref
      let markdownSha256
      if (entry) {
        if (!sourcePath || sourcePath.startsWith('/') || /[\\\r\n]/.test(sourcePath) || sourcePath.split('/').some((part) => part === '..')) {
          throw new Error(`Native page has no valid source path: ${file}`)
        }
        const committed = execFileSync('git', ['-C', checkout, 'show', `${sha}:${sourcePath}`])
        const sourceBytes = readFileSync(join(checkout, sourcePath))
        if (!sourceBytes.equals(committed)) throw new Error(`Native source bytes differ from ${sha}: ${sourcePath}`)
        source = { repo: port.repo, ref: sha, path: sourcePath, sha256: nativeHash(sourceBytes) }
        const markdownPath = localPath(entry.markdownUrl, 'Markdown URL').slice(1)
        markdownSha256 = hashes[markdownPath]
        if (!markdownSha256) throw new Error(`Native Markdown is missing: ${file} -> ${markdownPath}`)
        markdownHref = `${base}${markdownPath}`
        metadata.delete(`/${path}`)
      } else if (!['genindex/index.html', 'py-modindex/index.html'].includes(file) || sourcePath) {
        throw new Error(`Native page has no docs.json entry: ${file}`)
      }
      pages.push({
        file, path, url: `${base}${path}`, sourcePath: `${port.slug}/${version}/api/${path}`,
        source, markdownHref, markdownSha256,
        htmlSha256: hashes[file], articleSha256: nativeHash(nativeArticle(html)),
        hasTableOfContents: [...window.document.querySelectorAll('.toc-tree a[href^="#"]')].some((link) => {
          let id
          try { id = decodeURIComponent(link.getAttribute('href').slice(1)) } catch { return false }
          const target = id ? window.document.getElementById(id) : null
          return Boolean(target?.closest('article') && !target.matches('h1') && !target.querySelector(':scope > h1'))
        }),
        signatures: [...window.document.querySelectorAll('dt.sig[id]')].map((element) => element.id),
      })
    }
  } finally {
    await window.happyDOM.close()
  }
  if (metadata.size) throw new Error(`Native docs.json names missing pages: ${[...metadata.keys()].join(', ')}`)
  return {
    schema: 1, port: port.slug, version, locale, root, base,
    source: { repository: port.repo, sha },
    artifactSha256: nativeHash(JSON.stringify(hashes)), pages, redirects,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, prefix, sphinxPort, version, checkout, output, sourceSha] = process.argv.slice(2)
  if (!output) throw new Error('Usage: native-shell-context.mjs DIRECTORY PREFIX PORT VERSION CHECKOUT OUTPUT [SOURCE_SHA]')
  const manifest = await collectNativeContext(directory, { prefix, sphinxPort, version, checkout, sourceSha })
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Native context: ${manifest.pages.length} pages at ${manifest.base} from ${manifest.source.sha}`)
}
