/**
 * What the installer's one code surface draws around a command.
 *
 * Both installers (`PackageInstall`, `McpInstall`) draw a header with the
 * place the code goes, an options bar, strips and the code itself. The pieces
 * that are facts about the data, rather than markup, are here so a test can
 * read them without rendering a page.
 */
import { formTarget, type InstallForm, type Port, type RegistryEntry } from './ports'

/** The prompt of the place the code runs: `$` in a terminal, `PS>` in PowerShell, `PM>` in the Package Manager Console. */
export function promptFor(target: string, lang: string): string {
  if (lang === 'console') return '$'
  if (target === 'PowerShell') return 'PS>'
  if (target === 'Package Manager Console') return 'PM>'
  return ''
}

/**
 * A target split at its last folder, so a long path cuts its folder and never
 * its file name: `~/.gemini/co…mcp_config.json`.
 */
export function targetParts(target: string): { dir: string; base: string } {
  const cut = target.lastIndexOf('/') + 1
  return { dir: target.slice(0, cut), base: target.slice(cut) }
}

/** The mark a prompt carries, the one `lm-shell-prompt` gives the grammar's own `$`. */
const PROMPT_STYLE = '--shiki-light:var(--lm-shell-prompt);--shiki-dark:var(--lm-shell-prompt)'

/** Highlighted code with `prompt` drawn before its first line; the install blocks copy it off again. */
export function withPrompt(html: string, prompt: string): string {
  const mark = `<span class="lm-shell-prompt" style="${PROMPT_STYLE}">${prompt.replace(/>/g, '&gt;')} </span>`
  return html.replace('<span class="line">', `<span class="line">${mark}`)
}

/**
 * The lines of `changed` that `plain` does not contain: what a cooldown adds
 * to the command. A line is compared without its trailing backslash, so a line
 * that only gained or lost a continuation is not an addition.
 */
export function addedLines(plain: string, changed: string): number[] {
  return changed.split('\n')
    .map((line, index) => {
      const text = line.replace(/\\\s*$/, '').trim()
      return text && !plain.includes(text) ? index : -1
    })
    .filter((index) => index >= 0)
}

/** Highlighted code with each listed line marked, as a diff marks an insertion. */
export function markAddedLines(html: string, lines: readonly number[]): string {
  if (!lines.length) return html
  let index = -1
  return html.replace(/<span class="line">/g, (open) => (lines.includes(++index) ? '<span class="line is-added">' : open))
}

export type Channel = 'prerelease' | 'git'

export interface ChannelForm extends InstallForm {
  id: Channel
  label: string
  /** Where the code goes. */
  target: string
}

/**
 * The release channels beside a port's package-manager installs, each with its
 * own form filled from the registry.
 *
 * Pre-release is offered when the newest version the registry carries is one:
 * the form pins that version because the resolvers skip a pre-release
 * otherwise, and beside a final release there is no pre-release to name. From
 * Git is offered where the form can be filled, which is every port with a tag
 * and any port whose form names a fixed ref.
 */
export function channelForms(port: Port, entry: RegistryEntry): ChannelForm[] {
  const channels: ChannelForm[] = []
  const { prerelease, git } = port.installForms
  if (entry.status === 'prerelease' && entry.version) {
    const form = { ...prerelease, code: prerelease.code.replaceAll('{version}', entry.version) }
    channels.push({ ...form, id: 'prerelease', label: 'Pre-release', target: formTarget(form) })
  }
  if (!git.code.includes('{tag}') || entry.tag) {
    const form = { ...git, code: git.code.replaceAll('{tag}', entry.tag ?? '') }
    channels.push({ ...form, id: 'git', label: 'From Git', target: formTarget(form) })
  }
  return channels
}
