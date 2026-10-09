import { select } from 'astro-expressive-code/hast'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { tmuxUsageColors } from '../lib/tmux-usage.mjs'
import { tmuxShellColors } from '../lib/tmux-shell.mjs'
import { tmuxConfigColors } from '../lib/tmux-config.mjs'

/**
 * Shell session prompts: coloured, unselectable, and left out of copied text.
 *
 * gp-sphinx renders a `console` block with Pygments' BashSessionLexer, which
 * marks `$ ` as a prompt and highlights the command after it as Bash, and
 * sphinx-copybutton copies only the command lines. Shiki's `console` grammar
 * returns each line as a single token, so the same blocks here rendered as
 * flat text and copied with their prompts.
 *
 * Both highlighters use this module: `highlight.ts` for the install widgets,
 * and `shellPrompt` below for fenced blocks and `<Code>`.
 */

/** Languages whose blocks are sessions, prompts and output, not scripts. */
export const SESSION_LANGS = new Set(['console', 'shellsession'])

export const PROMPT = '$ '

/**
 * Keep open quotes across lines and distinguish shell operators from literal text.
 * @param {string} text
 * @param {string} quote
 * @param {boolean} inWord
 */
function commandContinuation(text, quote, inWord) {
  let escaped = false
  let syntax = quote || inWord ? 'x' : ''
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (escaped) {
      escaped = false
      syntax += 'x'
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      else if (character === '\\' && quote !== "'") escaped = true
      continue
    }
    if (character === '\\') {
      escaped = true
      syntax += 'x'
    } else if (['"', "'", '`'].includes(character)) {
      quote = character
      syntax += 'x'
    } else if (character === '#' && (!syntax || /[\s;&|()]$/.test(syntax))) {
      break
    } else {
      syntax += character
    }
  }
  const continuation = quote ? 'quote'
    : escaped ? 'backslash'
      : /(?:&&|\|\||\|)\s*$/.test(syntax) ? 'operator' : ''
  // Backslash-newline joins the next line without creating a word boundary.
  const joinedWord = escaped && /[^\s;&|()]$/.test(syntax.slice(0, -1))
  return { quote, continuation, inWord: joinedWord }
}

/**
 * Classify each line of a session.
 *
 * A line that starts with the prompt is a command, and so is each line after
 * one with an open quote, trailing `\`, or unquoted `&&`, `||`, or `|`.
 * Anything else is output. A block with no prompt is a bare command list, like the MCP
 * widget's CLI bodies, so every line is a command.
 *
 * @param {string[]} lines
 * @returns {{ kind: 'prompt' | 'command' | 'output', text: string }[]} `text`
 *   is the line without its prompt.
 */
export function sessionLines(lines) {
  if (!lines.some((line) => line.startsWith(PROMPT))) {
    return lines.map((text) => ({ kind: 'command', text }))
  }
  let continuation = ''
  let quote = ''
  let inWord = false
  return lines.map((line) => {
    /** @type {'prompt' | 'command' | 'output'} */
    const kind = continuation ? 'command' : line.startsWith(PROMPT) ? 'prompt' : 'output'
    const text = kind === 'prompt' ? line.slice(PROMPT.length) : line
    const awaitingOperand = continuation === 'operator' && /^\s*(?:#.*)?$/.test(text)
    if (!awaitingOperand) {
      ({ quote, continuation, inWord } = kind !== 'output'
        ? commandContinuation(text, quote, inWord)
        : { quote: '', continuation: '', inWord: false })
    }
    return { kind, text }
  })
}

/**
 * The prompt as a HAST element.
 *
 * `.lm-shell-prompt` in `global.css` colours it, makes it bold and keeps it
 * out of a selection. The Shiki variables point at the same colour, because
 * the install widgets colour every span from `--shiki-light`/`--shiki-dark`.
 */
export function promptElement() {
  return {
    type: /** @type {const} */ ('element'),
    tagName: 'span',
    properties: {
      className: ['lm-shell-prompt'],
      style: '--shiki-light:var(--lm-shell-prompt);--shiki-dark:var(--lm-shell-prompt)',
    },
    children: [{ type: /** @type {const} */ ('text'), value: PROMPT }],
  }
}

/**
 * GitHub's themes, with Bash commands and their bare arguments in plain text.
 *
 * GitHub's themes draw a command as a function and every bare argument as a
 * string, so a whole install line turned purple and blue and its prompt no
 * longer stood out. Pygments reads those words as plain `Text`, which
 * gp-sphinx draws in the body colour. Quoted strings, comments and escapes
 * keep GitHub's colours, and the rules name `source.shell`, so no other
 * language changes.
 *
 * `highlight.ts` and `ec.config.mjs` both use these, dark first. The names
 * stay `github-dark` and `github-light`, which `themeCssSelector` reads.
 */
export function shellThemes() {
  return [githubDark, githubLight].map((theme) => ({
    ...theme,
    tokenColors: [
      ...theme.tokenColors,
      ...tmuxUsageColors(theme.type === 'dark'),
      ...tmuxShellColors(theme.type === 'dark'),
      ...tmuxConfigColors(theme.type === 'dark'),
      {
        scope: [
          'source.shell entity.name.command',
          'source.shell string.unquoted.argument',
          'source.shell constant.other.option',
        ],
        settings: { foreground: theme.colors['editor.foreground'] },
      },
    ],
  }))
}

/**
 * Expressive Code plugin: highlight sessions as Bash, with prompts drawn
 * outside the code.
 *
 * The prompts leave the code before highlighting, so the copy button, which
 * frames builds from the code, never has them. They come back as elements on
 * each rendered line. Output lines lose their Bash colours, and copy drops
 * them, as sphinx-copybutton does when a block has prompts.
 */
export function shellPrompt() {
  /** @type {WeakMap<object, ReturnType<typeof sessionLines>>} */
  const sessions = new WeakMap()
  return {
    name: 'shell-prompt',
    hooks: {
      // The only hook in which a block's language can still change.
      preprocessLanguage: ({ codeBlock }) => {
        if (!SESSION_LANGS.has(codeBlock.language)) return
        sessions.set(codeBlock, [])
        codeBlock.language = 'bash'
      },
      preprocessCode: ({ codeBlock }) => {
        if (!sessions.has(codeBlock)) return
        const lines = codeBlock.getLines()
        const session = sessionLines(lines.map((line) => line.text))
        // Output reaches the grammar blank, so the apostrophe in `can't` cannot
        // open a string that runs on into the next command. Its text comes
        // back when the line renders.
        session.forEach(({ kind }, index) => {
          const line = lines[index]
          if (kind === 'prompt') line.editText(0, PROMPT.length, '')
          else if (kind === 'output') line.editText(0, line.text.length, '')
        })
        sessions.set(codeBlock, session)
      },
      postprocessRenderedLine: ({ codeBlock, lineIndex, renderData }) => {
        const { kind, text } = sessions.get(codeBlock)?.[lineIndex] ?? {}
        if (kind !== 'prompt' && kind !== 'output') return
        const code = select('.code', renderData.lineAst)
        if (!code) return
        if (kind === 'prompt') code.children.unshift(promptElement())
        else code.children = [{ type: 'text', value: text }]
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const session = sessions.get(codeBlock)
        if (!session?.some(({ kind }) => kind === 'prompt')) return
        const copy = select('[data-code]', renderData.blockAst)
        if (!copy) return
        // Comment-looking lines can be quoted program input. Preserve every
        // command line while omitting session output and encoding newlines.
        copy.properties.dataCode = session
          .filter(({ kind }) => kind !== 'output')
          .map(({ text }) => text)
          .join('\n')
          .trim()
          .replace(/\n/g, '\x7f')
      },
    },
  }
}
