import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { COOLDOWN_MARKERS, COOLDOWN_SLOTS, formatCooldown, hasCooldownSlot, type CooldownUnit } from '../src/lib/cooldown'
import { highlightWithCooldownSlots } from '../src/lib/highlight'
import { PORTS, type InstallCommand } from '../src/lib/ports'

/** Every install command that carries a cooldown, with the package it installs. */
const cooldownCommands = PORTS.flatMap((port) => [
  ...port.installs.map((cmd) => ({ port: port.slug, pkg: port.packageName, cmd })),
  ...(port.packages ?? []).flatMap((pkg) => (pkg.installs ?? []).map((cmd) => ({ port: port.slug, pkg: pkg.name, cmd }))),
]).filter((entry): entry is { port: string; pkg: string; cmd: InstallCommand & { cooldown: NonNullable<InstallCommand['cooldown']> } } =>
  Boolean(entry.cmd.cooldown),
)

/** A form with every placeholder written out, as the reader would copy it. */
const spelled = (code: string, days = 7) =>
  (Object.entries(COOLDOWN_SLOTS) as [CooldownUnit, string][]).reduce(
    (text, [unit, token]) => text.replaceAll(token, formatCooldown(unit, days)),
    code,
  )

describe('dependency cooldowns', () => {
  it('spells a day count in each unit a tool reads', () => {
    expect(formatCooldown('days', 7)).toBe('7')
    expect(formatCooldown('minutes', 7)).toBe('10080')
    expect(formatCooldown('seconds', 7)).toBe('604800')
    expect(formatCooldown('duration', 7)).toBe('P7D')
  })

  it('leaves each placeholder as a slot the widget scripts rewrite', async () => {
    const html = await highlightWithCooldownSlots(`$ pnpm_config_minimum_release_age=${COOLDOWN_SLOTS.minutes} pnpm add libtmux`, 'console', 7)
    expect(html).toContain('data-cooldown-scale="1440"')
    expect(html).toContain('>10080</span>')
    for (const marker of Object.values(COOLDOWN_MARKERS)) expect(html).not.toContain(marker)
    expect(html).not.toContain('COOLDOWN_')
  })

  it('offers Python and TypeScript commands a cooldown, and no other port', () => {
    expect([...new Set(cooldownCommands.map(({ port }) => port))]).toEqual(['py', 'ts'])
  })

  it('carries the day count and exempts the package it installs', () => {
    for (const { pkg, cmd } of cooldownCommands.filter(({ cmd }) => cmd.cooldown.code)) {
      const code = cmd.cooldown.code!
      expect(hasCooldownSlot(code), `${cmd.label}: ${code}`).toBe(true)
      // Once as the exemption, once as what is installed.
      expect(code.split(pkg).length - 1, `${cmd.label} exempts ${pkg}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('explains every mode a tool cannot express', () => {
    for (const { cmd } of cooldownCommands) {
      if (!cmd.cooldown.code || !cmd.cooldown.bypass) expect(cmd.cooldown.note, cmd.label).toBeTruthy()
    }
  })

  it('writes every form as a command bash can parse', () => {
    for (const { cmd } of cooldownCommands) {
      for (const form of [cmd.cooldown.code, cmd.cooldown.bypass]) {
        if (form) execFileSync('bash', ['-n', '-c', spelled(form)])
      }
    }
  })
})
