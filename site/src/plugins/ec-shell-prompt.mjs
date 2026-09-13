import { select } from 'astro-expressive-code/hast'

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
 * Classify each line of a session.
 *
 * A line that starts with the prompt is a command, and so is each line after
 * one that ends in `\`. Anything else is output. A block with no prompt at
 * all is a bare command list, like the MCP widget's CLI bodies, so every line
 * is a command.
 *
 * @param {string[]} lines
 * @returns {{ kind: 'prompt' | 'command' | 'output', text: string }[]} `text`
 *   is the line without its prompt.
 */
export function sessionLines(lines) {
  if (!lines.some((line) => line.startsWith(PROMPT))) {
    return lines.map((text) => ({ kind: 'command', text }))
  }
  let continued = false
  return lines.map((line) => {
    /** @type {'prompt' | 'command' | 'output'} */
    const kind = continued ? 'command' : line.startsWith(PROMPT) ? 'prompt' : 'output'
    const text = kind === 'prompt' ? line.slice(PROMPT.length) : line
    continued = kind !== 'output' && text.endsWith('\\')
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
        if (!session?.some(({ kind }) => kind === 'output')) return
        const copy = select('[data-code]', renderData.blockAst)
        if (!copy) return
        // Frames' own terminal copy text, from the command lines only: it
        // drops comment lines and joins lines with DEL.
        copy.properties.dataCode = session
          .filter(({ kind }) => kind !== 'output')
          .map(({ text }) => text)
          .join('\n')
          .replace(/(?<=^|\n)\s*#.*($|\n+)/g, '')
          .trim()
          .replace(/\n/g, '\x7f')
      },
    },
  }
}
