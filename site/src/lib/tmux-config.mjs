import older from '../data/tmux/3.2a.json' with { type: 'json' }
import current from '../data/tmux/3.7c.json' with { type: 'json' }

const commands = [
  ...new Set([...older.commands, ...current.commands].flatMap(({ name, alias }) => [name, alias]).filter(Boolean)),
].join('|')

/** tmux configuration has directives and recursive formats that Bash does not. */
export const tmuxConfig = {
  name: 'tmux-config',
  scopeName: 'source.tmux-config',
  patterns: [
    { include: '#format' },
    { include: '#style' },
    { include: '#job' },
    { match: '(?<!\\S)#(?![\\[{(]).*$', name: 'comment.line.number-sign.tmux-config' },
    { match: '%(?:if|elif|else|endif|hidden)\\b', name: 'keyword.control.tmux-config' },
    { include: '#escape' },
    {
      begin: '"',
      end: '"',
      name: 'string.quoted.double.tmux-config',
      patterns: [
        { include: '#escape' },
        { include: '#format' },
        { include: '#style' },
        { include: '#job' },
        { include: '#variable' },
      ],
    },
    {
      begin: "'",
      end: "'",
      name: 'string.quoted.single.tmux-config',
      patterns: [{ include: '#format' }, { include: '#style' }, { include: '#job' }, { include: '#format-variable' }],
    },
    { include: '#variable' },
    { match: `(?<![\\w/-])(?:${commands})(?=$|[\\s;{}])`, name: 'entity.name.function.tmux-config' },
    { match: '(?<![\\w-])-[A-Za-z0-9]+', name: 'constant.other.option.tmux-config' },
    { match: '(?<![\\w-])[A-Za-z_][\\w-]*(?==)', name: 'variable.other.assignment.tmux-config' },
    { match: '\\b[0-9]+\\b', name: 'constant.numeric.tmux-config' },
    { match: '[;{}=]', name: 'keyword.operator.tmux-config' },
  ],
  repository: {
    escape: { match: '\\\\.', name: 'constant.character.escape.tmux-config' },
    variable: {
      patterns: [
        { match: '\\$[A-Za-z_][A-Za-z0-9_]*|\\$\\{[^}]*\\}', name: 'variable.other.tmux-config' },
        { include: '#format-variable' },
      ],
    },
    'format-variable': { match: '#[A-Z0-9]', name: 'variable.other.tmux-config' },
    format: {
      begin: '#\\{',
      end: '\\}',
      name: 'meta.interpolation.tmux-config',
      beginCaptures: { 0: { name: 'punctuation.definition.interpolation.tmux-config' } },
      endCaptures: { 0: { name: 'punctuation.definition.interpolation.tmux-config' } },
      patterns: [
        { include: '#format' },
        { include: '#style' },
        { include: '#job' },
        { match: '#[,}]', name: 'constant.character.escape.tmux-config' },
        { match: '[?:,=<>!+*/|&;-]+', name: 'keyword.operator.tmux-config' },
        { match: '[A-Za-z_][A-Za-z0-9_]*', name: 'variable.other.tmux-config' },
        { match: '\\d+', name: 'constant.numeric.tmux-config' },
      ],
    },
    style: {
      begin: '#\\[',
      end: '\\]',
      name: 'meta.style.tmux-config',
      patterns: [{ include: '#format' }, { match: '[A-Za-z][\\w-]*', name: 'constant.other.style.tmux-config' }],
    },
    job: {
      begin: '#\\(',
      end: '\\)',
      name: 'meta.job.tmux-config',
      patterns: [{ include: '#escape' }, { include: '#format' }, { include: '#variable' }],
    },
  },
}

/** @param {boolean} dark */
export function tmuxConfigColors(dark) {
  return [
    ['keyword.control', dark ? '#c678dd' : '#6d28d9'],
    ['entity.name.function', dark ? '#98c379' : '#16713a'],
    ['constant.other.option', dark ? '#56b6c2' : '#7e22ce'],
    ['variable.other', dark ? '#e5c07b' : '#8a5400'],
    ['constant.other.style', dark ? '#e5c07b' : '#8a5400'],
  ].map(([scope, foreground]) => ({ scope: `${scope}.tmux-config`, settings: { foreground } }))
}
