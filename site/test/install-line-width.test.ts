import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildPanels, SERVERS, SHELL_MAX_WIDTH, withDefaultCooldown, wrapShell } from '../src/lib/install-matrix'
import { PORTS, type InstallBlock } from '../src/lib/ports'
import { installsFor, installSelection } from '../src/lib/registry'

/**
 * The widest line a shell command may have where a reader pastes it.
 *
 * The install blocks are about this wide (with the `$ ` prompt) before they scroll, so a longer line
 * hides the end of a step the reader has to read before running it. A command
 * of several steps puts each on a line ended by a backslash, which a shell reads
 * as one command, so what the copy button copies still runs.
 */
const MAX_WIDTH = SHELL_MAX_WIDTH
const SHELL = new Set(['console', 'sh', 'bash', 'shell'])

/** The lines of a shell command wider than the limit. */
const tooWide = (code: string) => code.split('\n').filter((line) => line.length > MAX_WIDTH)

/** What the copy button copies from a console block: the text without its `$ ` prompts (see mcp-install.js `copyPanelCode`). */
const copied = (shown: string) => shown.replace(/^\$ /gm, '')

/** Whether a shell accepts `text` as a complete command, without running it. */
const parses = (text: string) => spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' }).status === 0

interface Command { where: string; text: string }

/** Every shell command the install pickers show for pasting, with the sentinels a cooldown slot fills replaced by a value. */
function commands(): Command[] {
  const found: Command[] = []
  const add = (where: string, block: Pick<InstallBlock, 'lang' | 'code'>) => {
    if (SHELL.has(block.lang)) found.push({ where, text: withDefaultCooldown(block.code) })
  }
  for (const port of PORTS) {
    const selection = installSelection(port, [], {})
    installsFor(port, { ...selection, version: selection.version ?? '1.2.3-alpha.1' }).forEach((install) => {
      for (const block of [install, ...(install.additionalBlocks ?? [])]) add(`${port.slug} ${install.label}`, block)
      for (const form of [install.cooldown?.code, install.cooldown?.bypass]) if (form) add(`${port.slug} ${install.label} cooldown`, { lang: install.lang, code: form })
    })
    for (const pkg of port.packages ?? []) {
      for (const install of pkg.installs ?? []) {
        for (const block of [install, ...(install.additionalBlocks ?? [])]) add(`${port.slug} ${pkg.id} ${install.label}`, block)
        for (const form of [install.cooldown?.code, install.cooldown?.bypass]) if (form) add(`${port.slug} ${pkg.id} ${install.label} cooldown`, { lang: install.lang, code: form })
      }
    }
  }
  for (const spec of Object.values(SERVERS)) {
    for (const panel of buildPanels(spec, 'a'.repeat(40))) {
      const where = `${spec.port} mcp ${panel.client.id}/${panel.method.id}/${panel.scope.id}`
      const fill = withDefaultCooldown
      if (panel.language === 'console') found.push({ where, text: copied(fill(panel.body)) })
      if (panel.pipPrereq) found.push({ where: `${where} prerequisite`, text: fill(panel.pipPrereq) })
    }
  }
  return found
}

const all = commands()

describe('shell install commands', () => {

  it('finds the commands it checks', () => {
    expect(all.length).toBeGreaterThan(100)
    expect(all.some((command) => command.where.startsWith('cxx mcp'))).toBe(true)
  })

  it('puts no line past the width a reader can see', () => {
    expect(all.flatMap((command) => tooWide(command.text).map((line) => `${command.where}: ${line}`))).toEqual([])
  })

  it('copies as a command a shell accepts, continuation lines included', () => {
    const multiline = all.filter((command) => command.text.includes('\n'))
    expect(multiline.length).toBeGreaterThan(5)
    expect(multiline.filter((command) => !parses(command.text)).map((command) => command.where)).toEqual([])
  })

  it('has a control: the one-line C++ build is flagged, its continued form is not', () => {
    const oneLine = 'cmake -S . -B build/mcp -DLIBTMUX_BUILD_MCP_SERVER=ON -DLIBTMUX_FETCH_DEPS=ON && cmake --build build/mcp && cmake --install build/mcp --prefix ~/.local'
    const continued = SERVERS.cxx!.resolve(SERVERS.cxx!.methods[0]!, SERVERS.cxx!.cooldowns[0]!).prereq!
    expect(tooWide(oneLine)).toHaveLength(1)
    expect(tooWide(continued)).toEqual([])
    expect(parses(continued)).toBe(true)
    expect(parses('cmake -S . \\\n  -B build &&')).toBe(false)
  })
})

describe('wrapping a one-line command', () => {
  const source = 'git clone --branch v0.1.0-alpha.1 https://github.com/libtmux/libtmux-java && (cd libtmux-java && ./gradlew :libtmux:publishToMavenLocal :libtmux-kotlin:publishToMavenLocal)'

  it('breaks it with backslashes into lines that fit, and the lines run as the one did', () => {
    const wrapped = wrapShell(source)
    expect(wrapped.split('\n').length).toBeGreaterThan(1)
    expect(tooWide(wrapped)).toEqual([])
    expect(wrapped.split('\n').slice(0, -1).every((line) => line.endsWith(' \\'))).toBe(true)
    expect(parses(wrapped)).toBe(true)
    expect(wrapped.replaceAll(' \\\n    ', ' ')).toBe(source)
  })

  it('leaves a command that fits, and one already broken by hand, as it is', () => {
    expect(wrapShell('cargo install tmux-mcp')).toBe('cargo install tmux-mcp')
    const manual = 'cmake \\\n    -S . \\\n    -B build/mcp'
    expect(wrapShell(manual)).toBe(manual)
  })

  it('keeps a flag with its value and never splits a quoted word', () => {
    const wrapped = wrapShell('claude mcp add tmux --scope user -- bundle exec libtmux-mcp --socket-name "a socket name" --endpoint local --timeout 30')
    for (const line of wrapped.split('\n')) expect(line).not.toMatch(/ --(?:socket-name|endpoint|timeout)(?: \\)?$/)
    expect(wrapped).toContain('"a socket name"')
    expect(parses(wrapped)).toBe(true)
  })
})

describe('a continued command runs as the one line did', () => {
  /** Runs `text` in bash with a `pnpm` that prints the cooldown variables it receives, and returns what it printed. */
  function environmentSeenByPnpm(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'pnpm-stub-'))
    try {
      writeFileSync(join(dir, 'pnpm'), '#!/bin/sh\nprintf "%s|%s|%s\\n" "$pnpm_config_minimum_release_age" "$pnpm_config_minimum_release_age_exclude" "$*"\n')
      chmodSync(join(dir, 'pnpm'), 0o755)
      const run = spawnSync('bash', ['-c', text], { encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin` } })
      return run.stdout.trim() + (run.stderr ? ` [stderr: ${run.stderr.trim()}]` : '')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('hands pnpm the minimum release age, the exclusion list and the arguments', () => {
    const cooldown = all.filter((command) => command.where.endsWith('cooldown') && command.text.includes('pnpm_config_minimum_release_age_exclude') && command.text.includes('workspace-cli'))
    expect(cooldown.length).toBeGreaterThan(1)
    for (const command of cooldown) {
      const seen = environmentSeenByPnpm(command.text)
      expect(seen, command.where).toMatch(/^10080\|\["@libtmux\/workspace-cli","libtmux"\]\|(dlx|add -g) @libtmux\/workspace-cli/)
    }
  })

  it('has a control: an assignment cut after its equals sign loses its value', () => {
    const broken = 'pnpm_config_minimum_release_age_exclude=\\\n    \'["a"]\' \\\n    pnpm dlx a'
    expect(parses(broken)).toBe(true)
    expect(environmentSeenByPnpm(broken)).not.toContain('["a"]|')
  })
})
