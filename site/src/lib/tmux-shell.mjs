/** Bash owns quoting, expansion and command boundaries in runnable examples. */
export const tmuxShell = {
  name: 'tmux-shell',
  scopeName: 'source.tmux-shell',
  embeddedLangs: ['shellscript'],
  patterns: [{ include: 'source.shell' }],
  repository: {},
}

/** @param {boolean} dark */
export function tmuxShellColors(dark) {
  return [
    ['entity.name.command', dark ? '#c678dd' : '#6d28d9', 'bold'],
    ['string.unquoted.argument', dark ? '#98c379' : '#16713a', ''],
    ['constant.other.option', dark ? '#56b6c2' : '#7e22ce', ''],
    ['variable.other', dark ? '#e5c07b' : '#8a5400', ''],
  ].map(([scope, foreground, fontStyle]) => ({
    scope: `source.tmux-shell ${scope}`,
    settings: { foreground, fontStyle },
  }))
}
