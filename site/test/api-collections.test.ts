import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { lacksCallEdges, recordsCalls, referencedBy, sameOwnerMembers } from '../src/lib/api-collections'
import { apiRelationshipSections } from '../src/lib/api-relationships'
import { tmuxSourceModel } from '../src/lib/tmux-reference'
import { loadAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const goModel = API_MODELS.go
const capture = goModel.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === 'tmux.Pane.Capture')!

describe('what the data records', () => {
  it('says a port model records no calls, and that the tmux C source model does', () => {
    expect(recordsCalls(goModel)).toBe(false)
    expect(recordsCalls(tmuxSourceModel('latest'))).toBe(true)
  })

  it('shows the missing-edges state on a callable of a model with none, and never on a type', () => {
    expect(lacksCallEdges(goModel, capture, [])).toBe(true)
    expect(lacksCallEdges(goModel, goModel.symbols.find((symbol) => symbol.kind === 'struct')!, [])).toBe(false)
    // A symbol that does have edges keeps its neighbourhood instead.
    expect(lacksCallEdges(goModel, capture, [{ id: 'api-calls', label: 'Calls', items: [capture] }])).toBe(false)
  })

  it('names the declarations that reach a function only through a pointer, as a reference and not a call', () => {
    const model = tmuxSourceModel('latest')
    const exec = model.symbols.find((symbol) => symbol.name === 'cmd_capture_pane_exec')!
    expect(apiRelationshipSections(model, exec).some((section) => section.id === 'api-called-by')).toBe(false)
    expect(referencedBy(model, exec).map((symbol) => symbol.name)).toEqual(['cmd_capture_pane_entry', 'cmd_clear_history_entry'])
  })

  it('lists members of the same owner whose names share the stem, shortest first, and never infers from another owner', () => {
    const found = sameOwnerMembers(goModel, capture)!
    expect(found.parent.name).toBe('Pane')
    expect(found.siblings.map((symbol) => symbol.name)).toEqual(['CaptureTo', 'CaptureBytes', 'CaptureToFile', 'CaptureToBuffer'])
    expect(found.siblings.every((symbol) => symbol.parent === capture.parent)).toBe(true)
    expect(found.total).toBeGreaterThan(found.shared)
    // A type has no owner to share, and a member with a short or unique name has no siblings.
    expect(sameOwnerMembers(goModel, goModel.symbols.find((symbol) => symbol.kind === 'struct')!)).toBeUndefined()
  })
})

describe('the rendered collections of a callable', () => {
  async function render(owner: ApiSymbol, model: typeof goModel) {
    const template = await loadAstroTemplate('components/api/ApiRelationships.astro', {
      real: ['components/api/ApiBadge.astro', 'components/api/RelationshipCollection.astro'],
    })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/en/go/latest/reference/tmux-pane-capture/'),
      props: { owner, model, sections: apiRelationshipSections(model, owner), paths: [], hrefFor: (symbol: ApiSymbol) => `/${symbol.slug ?? symbol.name}/` },
    }))
    return win.document
  }

  it('names its relationship, says why each entry belongs and states the limit of the data', async () => {
    const document = await render(capture, goModel)
    const same = document.getElementById('api-same-owner')!.closest('section')!
    expect(same.querySelector('.api-collection__kind')!.textContent).toBe('containment')
    expect(same.querySelector('.api-collection__count')!.textContent).toMatch(/^4 of \d+ shown$/)
    expect(same.querySelector('.api-collection__why')!.textContent).toContain('share Capture')
    expect(same.querySelectorAll('.api-collection__row').length).toBe(4)
    expect(same.querySelector('.api-collection__limit a')!.textContent).toMatch(/^All \d+ members of Pane$/)
    const calls = document.getElementById('api-recorded-calls')!.closest('section')!
    expect(calls.querySelector('.api-collection__kind')!.textContent).toBe('source calls')
    expect(calls.querySelector('.api-collection__state strong')!.textContent).toBe('No call edges in the Go model.')
    // The call neighbourhood is not drawn from edges that do not exist.
    expect(document.getElementById('api-call-network')).toBeNull()
  })

  it('keeps the neighbourhood, with its source version, where the model records calls', async () => {
    const model = tmuxSourceModel('latest')
    const exec = model.symbols.find((symbol) => symbol.name === 'cmd_capture_pane_exec')!
    const document = await render(exec, model as never)
    const network = document.getElementById('api-call-network')!.closest('section')!
    expect(network.querySelector('.api-collection__kind')!.textContent).toBe('source calls')
    expect(network.querySelector('.api-collection__limit')!.textContent).toContain('Direct calls recorded in this source version (')
    expect(network.querySelector('.api-call-network__none')!.textContent).toContain('Reached through')
    expect(network.querySelector('.api-call-network__none')!.textContent).toContain('which reference it as a function pointer (a reference, not a call)')
    expect(document.getElementById('api-recorded-calls')).toBeNull()
  })
})
