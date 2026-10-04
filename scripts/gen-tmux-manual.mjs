#!/usr/bin/env node
/** Extract the pinned tmux manual and each binary's actual command catalog. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'site/src/data/tmux')
const pins = JSON.parse(readFileSync(join(dataDir, 'versions.json'), 'utf8'))
const digest = (text) => createHash('sha256').update(text).digest('hex')
const compact = (text) => text.replace(/\s+/g, ' ').trim()

/** Preserve the upstream manual, linking commands to their version's own pages. */
export function parseManual(html, commands, version) {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = html
  const base = `/tmux/${version}/manual/`
  const names = new Set(commands.map((command) => command.name))
  const aliases = new Map(commands.filter((command) => command.alias).map((command) => [command.alias, command.name]))
  const entries = new Map()
  for (const dt of document.querySelectorAll('dt')) {
    const name = dt.querySelector('code.Ic')?.textContent
    if (!names.has(name)) continue
    const dd = dt.nextElementSibling
    if (dd?.tagName !== 'DD') throw new Error(`No description for ${name}`)
    if (entries.has(name)) throw new Error(`Duplicate description for ${name}`)
    entries.set(name, { dt, dd, section: compact(dt.closest('section.Sh')?.querySelector('h1')?.textContent ?? '') })
  }
  // mandoc's page furniture contains the build date and host OS, not the
  // pinned manual's content. The site supplies its own title and provenance.
  for (const node of document.querySelectorAll('script, style, link, meta, table.head, table.foot')) node.remove()
  for (const node of document.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      if (/^on/i.test(attr.name)) throw new Error(`Unsafe manual attribute: ${attr.name}`)
    }
  }
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href')
    if (href.startsWith('#')) link.setAttribute('href', `${base}full/${href}`)
    else if (!/^https?:\/\//.test(href)) {
      // External man-page names are not files in this site.
      link.replaceWith(...link.childNodes)
    }
  }
  for (const code of document.querySelectorAll('code.Ic')) {
    if (code.closest('a')) continue
    const name = names.has(code.textContent) ? code.textContent : aliases.get(code.textContent)
    if (!name) continue
    const link = document.createElement('a')
    link.href = `${base}${name}/`
    code.replaceWith(link)
    link.append(code)
  }
  const sections = [...document.querySelectorAll('section.Sh > h1')].map((heading) => ({
    id: heading.id, title: compact(heading.textContent),
  }))
  for (const heading of document.querySelectorAll('h1, h2')) {
    const replacement = document.createElement(heading.tagName === 'H1' ? 'h2' : 'h3')
    replacement.id = heading.id
    replacement.innerHTML = heading.innerHTML
    heading.replaceWith(replacement)
  }
  const extracted = commands.map((command) => {
    const entry = entries.get(command.name)
    if (entry) {
      const body = entry.dd.cloneNode(true)
      const alias = body.firstElementChild
      if (alias?.matches('.Bd') && alias.textContent.trim().startsWith('(alias:')) {
        // Older manuals put the alias's closing parenthesis after the block.
        if (!alias.textContent.trim().endsWith(')') && alias.nextSibling?.nodeType === 3) {
          alias.nextSibling.textContent = alias.nextSibling.textContent.replace(/^\s*\)\s*/, '')
        }
        alias.remove()
      }
      const summary = compact(body.textContent).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? compact(body.textContent)
      return { ...command, section: entry.section, summary, html: body.innerHTML }
    }
    const related = { 'set-window-option': 'set-option', 'show-window-options': 'show-options' }[command.name]
    if (!related) throw new Error(`Command absent from the manual: ${command.name}`)
    return { ...command, section: 'OPTIONS', summary: `Window-scoped form of ${related}.`,
      html: `<p>Use <a href="${base}${related}/"><code>${related}</code></a> for the option semantics. This command selects window scope. Its accepted flags are listed above.</p>` }
  })
  const manual = document.body.innerHTML
  window.happyDOM.abort()
  return { commands: extracted, sections, manual }
}

function main() {
  const args = process.argv.slice(2)
  const option = (name) => args[args.indexOf(name) + 1]
  if (!args.includes('--source') || !args.includes('--binaries') || !args.includes('--mandoc')) {
    throw new Error('Usage: gen-tmux-manual.mjs --source <tmux-git> --binaries <version/bin/tmux parent> --mandoc <executable> [--check]')
  }
  const source = resolve(option('--source'))
  const binaries = resolve(option('--binaries'))
  const mandoc = option('--mandoc')
  for (const { version, revision } of pins.versions) {
    const manual = execFileSync('git', ['-C', source, 'show', `${revision}:tmux.1`], { encoding: 'utf8' })
    const binary = join(binaries, version, 'bin/tmux')
    if (execFileSync(binary, ['-V'], { encoding: 'utf8' }).trim() !== `tmux ${version}`) {
      throw new Error(`Wrong tmux binary for ${version}: ${binary}`)
    }
    const temporary = mkdtempSync(join(tmpdir(), 'tmux-manual.'))
    const socket = join(temporary, 'socket')
    const env = { ...process.env }
    delete env.TMUX
    delete env.TMUX_PANE
    let catalog
    try {
      execFileSync(binary, ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'reference', '/bin/cat'], { env })
      catalog = execFileSync(binary, ['-S', socket, '-f', '/dev/null', 'list-commands', '-F',
        '#{command_list_name}\t#{command_list_alias}\t#{command_list_usage}'], { encoding: 'utf8', env })
    } finally {
      if (existsSync(socket)) execFileSync(binary, ['-S', socket, 'kill-server'], { env })
      rmSync(temporary, { recursive: true })
    }
    const declarations = execFileSync('git', ['-C', source, 'grep', '-n', '-E', '\\.name = "', revision, '--', 'cmd-*.c'], { encoding: 'utf8' })
    const sources = new Map([...declarations.matchAll(/^[^:]+:([^:]+):(\d+):.*\.name = "([^"]+)"/gm)]
      .map((match) => [match[3], { sourceFile: match[1], sourceLine: Number(match[2]) }]))
    const commands = catalog.trimEnd().split('\n').map((line) => {
      const [name, alias, usage = ''] = line.split('\t')
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(name)) throw new Error(`Invalid command: ${name}`)
      if (!sources.has(name)) throw new Error(`Missing source declaration: ${name}`)
      return { name, alias, usage, ...sources.get(name) }
    })
    const html = execFileSync(mandoc, ['-Thtml', '-Ofragment'], { input: manual, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    const license = manual.split('\n.Dd')[0].split('\n').filter((line) => line.startsWith('.\\"')).slice(2)
      .map((line) => line.replace(/^\.\\" ?/, '')).join('\n').trim()
    const model = { version, revision, manualSha256: digest(manual), catalogSha256: digest(catalog), license,
      ...parseManual(html, commands, version) }
    const target = join(dataDir, `${version}.json`)
    const output = `${JSON.stringify(model, null, 2)}\n`
    if (args.includes('--check')) {
      if (readFileSync(target, 'utf8') !== output) throw new Error(`Stale tmux manual: ${version}`)
    } else writeFileSync(target, output)
    console.log(`tmux ${version}: ${model.commands.length} commands at ${revision}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
