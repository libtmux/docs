import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const checker = fileURLToPath(new URL('../../scripts/check-links.mjs', import.meta.url))

it.each([{ mode: 'mentions', flags: [] }, { mode: 'all', flags: ['--all'] }])('resolves encoded fragments without excusing missing targets ($mode)', ({ flags }) => {
  const root = mkdtempSync(join(tmpdir(), 'libtmux-link-fragment-'))
  const anchors = [
    ['LibTmux%5CGet-TmuxWindow.parameter.Server', 'LibTmux\\Get-TmuxWindow.parameter.Server'],
    ['libtmux%3A%3AServer.parameter.name', 'libtmux::Server.parameter.name'],
    ['mcp.tool.send_keys.input%2Fproperties%2Fkeys', 'mcp.tool.send_keys.input/properties/keys'],
    ['%E6%97%A5%E6%9C%AC%E8%AA%9E', '日本語'],
    ['literal%3A', 'literal%3A'],
    ['once%252F', 'once%2F'],
    ['C%2B+', 'C++'],
    ['invalid%FF%61', 'invalid�a'],
    ['partial%2G%3A', 'partial%2G:'],
    ['日%FF', '日�'],
    ['日%2G%3A', '日%2G:'],
    ['Expr.%26%26.parameter.other', 'Expr.&amp;&amp;.parameter.other'],
    ['const%20vector%3CItem%3E%20%26', 'const vector&lt;Item&gt; &amp;'],
    ['literal&amp;amp;', 'literal&amp;amp;'],
    ['numeric%26%22%27', 'numeric&#38;&#x22;&#39;'],
  ]
  const check = () => spawnSync(process.execPath, [checker, root, ...flags], { encoding: 'utf8' })
  const links = (path: string) => anchors.map(([fragment]) =>
    `<a href="${path}#${fragment}" class="api-mention">Target</a>`).join('')
  try {
    writeFileSync(join(root, 'target.html'), anchors.map(([, id]) => `<p id="${id}">Target</p>`).join('') + links(''))
    writeFileSync(join(root, 'index.html'), links('/target.html'))
    const valid = check()
    expect(valid.status, valid.stderr).toBe(0)
    expect(valid.stdout).toContain('2 pages, 30 links checked, 0 broken')

    writeFileSync(join(root, 'index.html'), [
      '<a href="/target.html#missing%3Aanchor" class="api-mention">Missing anchor</a>',
      '<a href="/missing.html#C++" class="api-mention">Missing page</a>',
      '<a href="/target.html#once%25252F" class="api-mention">Must not decode twice</a>',
      '<a href="/target.html#C+%2B+" class="api-mention">Plus is not a space</a>',
      '<a href="#missing%3Aanchor" class="api-mention">Missing local anchor</a>',
      '<a href="/target.html#日%FF%FF" class="api-mention">Must retain Unicode</a>',
    ].join(''))
    const invalid = check()
    expect(invalid.status, invalid.stderr).toBe(1)
    expect(invalid.stdout).toContain('2 pages, 21 links checked, 6 broken')
    expect(invalid.stdout).toContain('no anchor')
    expect(invalid.stdout).toContain('no page')

    writeFileSync(join(root, 'target.html'), '<p id="��">Wrong Unicode</p><a href="#日%FF" class="api-mention">Missing</a>')
    writeFileSync(join(root, 'index.html'), '<a href="/target.html#日%FF" class="api-mention">Missing</a>')
    const wrongUnicode = check()
    expect(wrongUnicode.status, wrongUnicode.stderr).toBe(1)
    expect(wrongUnicode.stdout).toContain('2 pages, 2 links checked, 2 broken')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
  const check = () => spawnSync(process.execPath, ['--max-old-space-size=64', checker, root, '--all'], {
    encoding: 'utf8', timeout: 10_000,
  })
  try {
    for (let i = 0; i < 48; i++) writeFileSync(join(root, `large-corpus-page-${i}.html`),
      `<h1 id="${anchor}">${padding}</h1><a href="/large-corpus-page-${(i + 1) % 48}.html#${anchor}">Next</a><a href="/${target}/#${anchor}">There</a>`)
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
