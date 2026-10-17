import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SCHEMA,
  capabilityState,
  compareTmuxVersions,
  validateManifest,
  workaroundState,
  type CapabilityEntry,
  type Workaround,
} from '../src/capabilities.ts'

const control: CapabilityEntry = {
  id: 'control-mode',
  name: 'Control mode',
  summary: 'Attach a library-managed control client.',
  since: '3.7',
  handling: 'fallback',
  apis: ['libtmux.Server.observe'],
  commands: [{ command: 'attach-session', flags: ['-C'] }],
}

const runShell: CapabilityEntry = {
  id: 'run-shell-capture',
  name: 'Captured run-shell output',
  summary: 'Read the standard output of run-shell.',
  since: '3.3a',
  except: ['3.4'],
  handling: 'refuse',
  error: 'libtmux.CapabilityUnavailable',
  apis: ['libtmux.Server.run_shell'],
  commands: [{ command: 'run-shell' }],
}

const breakPane: Workaround = {
  id: 'break-pane-exact-3-7',
  name: 'break-pane on 3.7',
  summary: 'Exact 3.7 ignores the name given to break-pane; a rename follows.',
  releases: ['3.7'],
  handling: 'repair',
  apis: ['libtmux.Pane.break_out'],
  commands: [{ command: 'break-pane', flags: ['-n'] }],
}

const manifest = {
  schema: CAPABILITY_SCHEMA,
  port: 'py',
  floor: { minimum: '3.3a' },
  capabilities: [control, runShell],
  workarounds: [breakPane],
}

describe('tmux version order', () => {
  it('ranks development builds and candidates below the release they name', () => {
    const ordered = ['next-3.7', '3.7-rc', '3.7-rc3', '3.7', '3.7a', '3.8', 'next-3.9', '3.10']
    expect([...ordered].reverse().sort(compareTmuxVersions)).toEqual(ordered)
  })

  it('refuses forms tmux never prints', () => {
    for (const v of ['master', '3.3a-master', 'next-3.3a', '3.3a-rc1', '03.3a', 'openbsd-7.6']) {
      expect(() => compareTmuxVersions(v, '3.3a'), v).toThrow(TypeError)
    }
  })
})

describe('cells', () => {
  it('follows since, except and handling', () => {
    expect(capabilityState(control, '3.6')).toBe('fallback')
    expect(capabilityState(control, '3.7')).toBe('supported')
    expect(capabilityState(control, '3.7-rc')).toBe('fallback')
    expect(capabilityState(runShell, '3.3a')).toBe('supported')
    expect(capabilityState(runShell, '3.4')).toBe('refused')
    expect(capabilityState(runShell, '3.5')).toBe('supported')
  })

  it('marks only the releases a workaround names', () => {
    expect(workaroundState(breakPane, '3.7')).toBe('workaround')
    expect(workaroundState(breakPane, '3.7a')).toBe('supported')
  })
})

describe('validateManifest', () => {
  it('accepts a complete manifest', () => {
    const { manifest: m, errors } = validateManifest(manifest)
    expect(errors).toEqual([])
    expect(m?.capabilities.map((c) => c.id)).toEqual(['control-mode', 'run-shell-capture'])
  })

  const broken: [string, unknown, string][] = [
    ['wrong schema', { ...manifest, schema: 'libtmux-capabilities/0' }, 'schema'],
    ['unprintable floor', { ...manifest, floor: { minimum: 'master' } }, 'floor.minimum'],
    ['duplicate id', { ...manifest, workarounds: [{ ...breakPane, id: 'control-mode' }] }, 'appears twice'],
    ['refusal without an error type', { ...manifest, capabilities: [{ ...runShell, error: undefined }] }, 'names its error type'],
    ['non-kebab id', { ...manifest, capabilities: [{ ...control, id: 'ControlMode' }] }, 'kebab-case'],
    ['bad since', { ...manifest, capabilities: [{ ...control, since: '3.7-dev' }] }, 'since'],
    ['bad flag', { ...manifest, capabilities: [{ ...control, commands: [{ command: 'attach-session', flags: ['C'] }] }] }, 'flags'],
    ['empty workaround', { ...manifest, workarounds: [{ ...breakPane, releases: [] }] }, 'releases'],
  ]
  it.each(broken)('rejects a manifest with %s', (_label, value, message) => {
    const { manifest: m, errors } = validateManifest(value)
    expect(m).toBeUndefined()
    expect(errors.join('\n')).toContain(message)
  })
})
