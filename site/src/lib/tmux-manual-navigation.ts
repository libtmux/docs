import { createHash } from 'node:crypto'
import type { ApiTreeJson } from './api-search'
import { tmuxManual, tmuxManualUrl } from './tmux-manual-data'

/** Manual sections own commands; their links use the manual's existing anchors. */
export function tmuxManualNavigation(version = 'latest') {
  const manual = tmuxManual(version)
  const sections = [...new Set(manual.commands.map((command) => command.section))]
  const hrefs: Record<string, string> = {}
  const members: ApiTreeJson['members'] = {}
  const types = sections.map((section) => {
    const anchor = section.toLowerCase().replaceAll(' ', '-')
    const id = `section:${anchor}`
    hrefs[id] = `${tmuxManualUrl(version)}#${anchor}`
    members[id] = manual.commands.filter((command) => command.section === section).map((command) =>
      [command.name, command.name, command.name, 'command', 'members', command.summary, command.name])
    return { id, name: section[0] + section.slice(1).toLowerCase(), slug: '', m: 1 as const, kind: 'section' }
  })
  const json: ApiTreeJson = { port: 'tmux', buckets: [{ id: 'manual', label: 'Commands', count: types.length, slug: null, types, children: [] }], members, hrefs }
  return { json, version: `manual:${createHash('sha256').update(JSON.stringify([manual.sourceCommit, json])).digest('hex').slice(0, 20)}` }
}
