import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const checker = fileURLToPath(new URL('../../scripts/check-links.mjs', import.meta.url))

it('resolves query-only links against the current document and checks their fragments', () => {
  const root = mkdtempSync(join(tmpdir(), 'libtmux-link-query-'))
  const directory = join(root, 'pr-102/en')
  const document = '<h1 id="example">Example</h1><a href="?port=rs&amp;errors=1#example">Choose</a>'
  const check = () => spawnSync(process.execPath, [checker, root, '--all'], { encoding: 'utf8' })
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'index.html'), `${document}<a href="?prompt=eval-sweep">Task</a>`)
    writeFileSync(join(directory, 'example.html'), document)
    const valid = check()
    expect(valid.status, valid.stderr).toBe(0)
    expect(valid.stdout).toContain('2 pages, 3 links checked, 0 broken')

    writeFileSync(join(directory, 'example.html'), '<a href="?cleanup=1#missing">Missing</a>')
    const invalid = check()
    expect(invalid.status, invalid.stderr).toBe(1)
    expect(invalid.stdout).toContain('2 pages, 3 links checked, 1 broken')
    expect(invalid.stdout).toContain('no anchor')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('checks a large corpus in a small heap and still rejects missing pages and anchors', () => {
  const root = mkdtempSync(join(tmpdir(), 'libtmux-link-heap-'))
  const anchor = 'long-anchor-for-memory-regression'
  const target = 'long-target-for-memory-regression'
  const padding = 'x'.repeat(2 * 1024 * 1024)
  const check = () =>
    spawnSync(process.execPath, ['--max-old-space-size=64', checker, root, '--all'], {
      encoding: 'utf8',
      timeout: 10_000,
    })
  try {
    for (let i = 0; i < 48; i++)
      writeFileSync(
        join(root, `large-corpus-page-${i}.html`),
        `<h1 id="${anchor}">${padding}</h1><a href="/large-corpus-page-${(i + 1) % 48}.html#${anchor}">Next</a><a href="/${target}/#${anchor}">There</a>`,
      )
    const missingPage = check()
    expect(missingPage.status, missingPage.stderr).toBe(1)
    expect(missingPage.stdout).toContain('48 pages, 96 links checked, 48 broken')
    expect(missingPage.stdout).toContain('no page')

    mkdirSync(join(root, target))
    writeFileSync(join(root, target, 'index.html'), '<p>Missing the target anchor.</p>')
    const missingAnchor = check()
    expect(missingAnchor.status, missingAnchor.stderr).toBe(1)
    expect(missingAnchor.stdout).toContain('49 pages, 96 links checked, 48 broken')
    expect(missingAnchor.stdout).toContain('no anchor')

    writeFileSync(join(root, target, 'index.html'), `<p id="${anchor}">Target.</p>`)
    const valid = check()
    expect(valid.status, valid.stderr).toBe(0)
    expect(valid.stdout).toContain('49 pages, 96 links checked, 0 broken')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
