import { describe, expect, it } from 'vitest'
import { tmuxInstallPlatform } from '../src/lib/tmux-install'

describe('tmux installer browser hints', () => {
  it.each([
    ['Mozilla Windows NT 10.0', 'Win32', 'windows'],
    ['Mozilla Macintosh Intel Mac OS X', 'MacIntel', 'brew'],
    ['Mozilla Linux', 'Windows', 'windows'],
    ['Mozilla Fedora Linux', 'Linux x86_64', 'fedora'],
    ['Mozilla NixOS Linux', '', 'nixos'],
    ['Mozilla Arch Linux', '', 'arch'],
    ['Mozilla Linux', 'Linux x86_64', 'debian'],
    ['Mozilla iPad like Mac OS X', 'MacIntel', 'debian'],
    ['Mozilla Android Linux', 'Linux armv8l', 'debian'],
    ['', '', 'debian'],
  ])('selects a useful tab for %s / %s', (agent, platform, expected) => {
    expect(tmuxInstallPlatform(agent, platform)).toBe(expected)
  })
})
