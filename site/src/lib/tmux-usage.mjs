/**
 * tmux synopsis grammar, using gp-sphinx's CLIUsageLexer token roles.
 * Bracketed arguments are usage notation, not Bash tests or globs.
 */
export const tmuxUsage = {
  name: 'tmux-usage',
  scopeName: 'source.tmux-usage',
  patterns: [
    {
      match: '^(\\s*)(tmux)([ \\t]+)([a-z][a-z0-9-]*)(?=\\s|$)',
      captures: {
        2: { name: 'entity.name.command.tmux-usage' },
        4: { name: 'entity.name.function.tmux-usage' },
      },
    },
    { match: '\\btmux\\b', name: 'entity.name.command.tmux-usage' },
    {
      match: '(?<![\\w-])--?[A-Za-z0-9][A-Za-z0-9-]*(?=$|[\\s\\[\\]{}()=|,])',
      name: 'constant.other.option.tmux-usage',
    },
    { match: '\\.\\.\\.|[\\[\\]{}()<>|=,]', name: 'punctuation.definition.tmux-usage' },
    { match: '[A-Za-z_][A-Za-z0-9_-]*', name: 'variable.parameter.tmux-usage' },
  ],
  repository: {},
}

/**
 * gp-sphinx's CLI palette, darkened in light mode for small code text.
 * @param {boolean} dark
 */
export function tmuxUsageColors(dark) {
  return [
    ['entity.name.command', dark ? '#c678dd' : '#6d28d9', 'bold'],
    ['entity.name.function', dark ? '#98c379' : '#16713a', 'bold'],
    ['constant.other.option', dark ? '#56b6c2' : '#7e22ce', ''],
    ['variable.parameter', dark ? '#e5c07b' : '#8a5400', 'italic'],
    ['punctuation.definition', dark ? '#ccced4' : '#586579', ''],
  ].map(([scope, foreground, fontStyle]) => ({
    scope: `${scope}.tmux-usage`,
    settings: { foreground, fontStyle },
  }))
}
