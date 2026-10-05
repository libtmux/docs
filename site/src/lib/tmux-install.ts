/** Browser hints rarely identify a Linux distribution; keep the first tab then. */
export function tmuxInstallPlatform(userAgent: string, platform = ''): string {
  const hint = `${userAgent} ${platform}`
  if (/Android|iPhone|iPad|iPod/i.test(hint)) return 'debian'
  if (/Windows|Win32|Win64/i.test(hint)) return 'windows'
  if (/Macintosh|MacIntel|macOS/i.test(hint)) return 'brew'
  if (/NixOS/i.test(hint)) return 'nixos'
  if (/Arch Linux|ArchLinux/i.test(hint)) return 'arch'
  if (/Fedora|CentOS|Red Hat|RHEL/i.test(hint)) return 'fedora'
  return 'debian'
}
