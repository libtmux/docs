import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'

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

it('normalizes a native artifact in the reusable publisher without a docs checkout', async () => {
  const { execFileSync } = await import('node:child_process')
  const workflow = readFileSync(new URL('../../.github/workflows/reusable-deploy.yml', import.meta.url), 'utf8')
  const inline = /python3 - <<'PY'\n([\s\S]*?)\n\s+PY/.exec(workflow)?.[1]
  expect(inline, 'publisher includes native URL normalization').toBeTruthy()
  const lines = inline!.split('\n')
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => /^ */.exec(line)![0].length))
  const script = lines.map((line) => line.slice(indent)).join('\n')
  const directory = mkdtempSync(join(tmpdir(), 'native-publish-'))
  try {
    mkdirSync(join(directory, 'dist'))
    const html = join(directory, 'dist/index.html')
    const css = join(directory, 'dist/theme.css')
    writeFileSync(html, '<script src="/_shell/shell.js"></script>')
    writeFileSync(css, "@import url('https://libtmux.org/_shell/tokens.css');")
    execFileSync('python3', ['-'], { input: script, cwd: directory, env: { ...process.env, PREFIX: 'en/py/latest' } })
    expect(readFileSync(html, 'utf8')).toBe('<script src="/en/_shell/shell.js"></script>')
    expect(readFileSync(css, 'utf8')).toBe("@import url('/en/_shell/tokens.css');")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
