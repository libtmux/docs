import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'
import { recordBuild, verifyBuild } from '../../scripts/publication-provenance.mjs'

describe('native shell URL normalization', () => {
  it('normalizes nested HTML/CSS for previews without changing other URLs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-shell-'))
    try {
      mkdirSync(join(directory, '_static'))
      writeFileSync(join(directory, 'index.html'), '<script src="/_shell/shell.js"></script><a href="/unchanged/">Guide</a>')
      writeFileSync(join(directory, '_static/theme.css'), "@import url('https://libtmux.org/_shell/tokens.css'); .logo{background:url(https://other.example/_shell/logo.svg)}")
      normalizeNativeShell(directory, '/pr-42/en/')
      normalizeNativeShell(directory, '/pr-42/en')
      expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('<script src="/pr-42/en/_shell/shell.js"></script><a href="/unchanged/">Guide</a>')
      expect(readFileSync(join(directory, '_static/theme.css'), 'utf8')).toBe("@import url('/pr-42/en/_shell/tokens.css'); .logo{background:url(https://other.example/_shell/logo.svg)}")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

it('normalizes native HTML and CSS before hashing and preserves those bytes when publishing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-publish-'))
  try {
    mkdirSync(join(directory, 'dist'))
    const html = join(directory, 'dist/index.html')
    const css = join(directory, 'dist/theme.css')
    writeFileSync(html, '<script src="/_shell/shell.js"></script>')
    writeFileSync(css, "@import url('https://libtmux.org/_shell/tokens.css');")
    const sourceSha = 'a'.repeat(40), docsSha = 'b'.repeat(40)
    recordBuild(join(directory, 'dist'), {
      schema: 1, port: 'go', version: 'latest', locale: 'en',
      docs: { repository: 'libtmux/docs', sha: docsSha, dirty: false },
      sources: [{ product: 'core', repository: 'libtmux/libtmux-go', sha: sourceSha, dirty: false }],
    })
    expect(readFileSync(html, 'utf8')).toContain('<script src="/en/_shell/shell.js"></script>')
    expect(readFileSync(css, 'utf8')).toBe("@import url('/en/_shell/tokens.css');")
    const before = [readFileSync(html, 'utf8'), readFileSync(css, 'utf8')]
    verifyBuild(join(directory, 'dist'), {
      port: 'go', version: 'latest', locale: 'en', prefix: 'en/go/latest',
      publisherRepository: 'libtmux/docs', publisherSha: docsSha, repository: 'libtmux/libtmux-go', sourceSha,
    })
    expect([readFileSync(html, 'utf8'), readFileSync(css, 'utf8')]).toEqual(before)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
