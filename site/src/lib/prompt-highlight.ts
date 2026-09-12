/**
 * Colour a composed prompt.
 *
 * A prompt is plain text by design, so there is no language for Shiki to
 * highlight and no grammar to lean on. What it does have is a small, known
 * shape: URLs the agent is told to read, commands it is told to run, the
 * `Key: value` facts at the top, numbered steps, and bullet constraints.
 * Marking those is the difference between a wall of monospace and something a
 * reader can find the install line in.
 *
 * NO IMPORTS, for the same reason `prompts.ts` has none: the widget's client
 * script calls this after every recompose, so it is bundled for the browser.
 * A value import of anything reaching `site-root.ts` would put `process.env`
 * in that bundle.
 *
 * Returns HTML. Everything is escaped before a single tag is added, and the
 * tokens are matched in one pass per line so an inserted `<span>` can never be
 * re-matched by a later rule.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/**
 * Inline tokens, in one pass.
 *
 * Alternation with a single replacer rather than successive `.replace` calls:
 * a second pass would happily match `https` inside the `class="..."` of a span
 * the first pass just inserted.
 */
const INLINE = /(`[^`]+`)|(https?:\/\/[^\s<>()]+)/g

function inline(escaped: string): string {
  return escaped.replace(INLINE, (match, code: string | undefined) =>
    code
      ? `<span class="lm-ph-code">${code}</span>`
      : `<span class="lm-ph-url">${match}</span>`,
  )
}

/** An indented block is a command or a manifest line, not prose. */
const COMMAND = /^\s{4,}\S/
/** `Language:   Python`, and the other facts in the header block. */
const FIELD = /^([A-Z][A-Za-z ]*:)(\s+)(.*)$/
/** `Read these before writing code:` and the other section openers. */
const HEADING = /^[A-Z][^.!?]*:$/
/** `1. Report the tmux version …` */
const STEP = /^(\d+\.)(\s)(.*)$/
/** `- Keep a task's output attributable …` */
const BULLET = /^(-)(\s)(.*)$/

/** One prompt, as HTML with token spans. */
export function highlightPrompt(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line)

      if (COMMAND.test(line)) {
        return `<span class="lm-ph-cmd">${inline(escaped)}</span>`
      }

      const field = FIELD.exec(escaped)
      if (field) {
        return `<span class="lm-ph-key">${field[1]}</span>${field[2]}${inline(field[3]!)}`
      }

      if (HEADING.test(line)) {
        return `<span class="lm-ph-heading">${escaped}</span>`
      }

      const step = STEP.exec(escaped)
      if (step) {
        return `<span class="lm-ph-marker">${step[1]}</span>${step[2]}${inline(step[3]!)}`
      }

      const bullet = BULLET.exec(escaped)
      if (bullet) {
        return `<span class="lm-ph-marker">${bullet[1]}</span>${bullet[2]}${inline(bullet[3]!)}`
      }

      return inline(escaped)
    })
    .join('\n')
}
