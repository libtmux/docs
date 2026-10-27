import { describe, expect, it, vi } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { apiTmuxSections } from '../src/lib/api-tmux-sections'
import { tmuxManualUrl } from '../src/lib/tmux-manual-data'

// The recorded usage never names a command a symbol only has an equivalent for today, so the case is made here:
// the concept data says pane.Pane.sendKeys also has an equivalent for kill-pane.
vi.mock('../src/lib/tmux-manual-data', async (original) => ({
  ...(await original<typeof import('../src/lib/tmux-manual-data')>()),
  tmuxCommandsFor: (port: string, id: string) => port === 'ts' && id === 'pane.Pane.sendKeys' ? [{ name: 'send-keys' }, { name: 'kill-pane' }] : [],
}))

describe('a command a symbol only has an equivalent for', () => {
  const symbol = API_MODELS.ts.symbols.find((entry) => (entry.publicId ?? entry.id) === 'pane.Pane.sendKeys')!
  const list = apiTmuxSections('ts', symbol)

  it('is a row of the tmux command section', () => {
    const commands = list.find((section) => section.type === 'commands')
    expect(commands?.type === 'commands' && commands.items.map((item) => [item.command, item.href])).toContainEqual(['kill-pane', tmuxManualUrl('latest', 'kill-pane')])
  })

  it('contributes no C declaration to the tmux C API', () => {
    const cApi = list.find((section) => section.type === 'c-api')
    expect(cApi?.type === 'c-api' && cApi.direct.map((item) => item.name)).toEqual(['cmd_send_keys_entry', 'cmd_send_keys_exec'])
  })
})
