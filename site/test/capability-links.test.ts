import { describe, expect, it, vi } from 'vitest'

// PowerShell raises the C# library's exceptions and builds on its types, so
// the generated data names `LibTmux.*` ids that only the .NET model holds.
const dependency = 'LibTmux.TmuxVersionTooLowException'
const own = 'LibTmux\\Connect-TmuxControl'
const entry = (error: string, apis: string[]) => ({
  id: 'control-mode', name: 'Control mode', summary: 'Attach a control client.', since: '3.7', handling: 'refuse',
  error, apis, commands: [{ command: 'attach-session' }],
})
const port = (capability: ReturnType<typeof entry>) => ({ floor: { minimum: '3.3a' }, capabilities: [capability], workarounds: [] })

vi.mock('../src/data/capabilities.json', () => ({
  default: {
    releases: ['3.3a', '3.7'],
    ports: {
      powershell: port(entry(dependency, [own, 'LibTmux.TmuxWindowException'])),
      // Rust does not build on the .NET library, so the same id is text there.
      rs: port(entry(dependency, ['Missing'])),
    },
  },
}))

const { portRows } = await import('../src/lib/capabilities')

describe('the links of a capability row', () => {
  it('link a name the port holds to its own reference', () => {
    const [api] = portRows('powershell').capabilities[0].apis
    expect(api.label).toBe(own)
    expect(api.href).toBe('/powershell/latest/reference/libtmux-connect-tmuxcontrol/')
  })

  it('link a name only the port\'s API dependency holds to the dependency\'s reference', () => {
    const row = portRows('powershell').capabilities[0]
    expect(row.error?.href).toBe('/csharp/latest/reference/libtmux-tmuxversiontoolowexception/')
    expect(row.apis[1].href).toBe('/csharp/latest/reference/libtmux-tmuxwindowexception/')
  })

  it('leave a name text for a port with no such dependency', () => {
    const row = portRows('rs').capabilities[0]
    expect(row.error).toEqual({ label: dependency, href: undefined })
    expect(row.apis).toEqual([{ label: 'Missing', href: undefined }])
  })
})
