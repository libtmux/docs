/**
 * Copy for the installers: take the code a Copy button names, put it on the
 * clipboard, and show the result on the button and in a polite live region.
 *
 * The prompt is drawn, never copied. A header's Copy sits outside the code it
 * takes and names it by `data-copy-key`; a strip's Copy sits inside its own.
 * A copy shows a checked clipboard for 1.5s (`data-copied`); a refusal marks
 * the button `data-failed` instead and says so, since the icon cannot.
 */

const FEEDBACK_MS = 1500

/** The code a Copy button takes, as written: no prompt, placeholders and all. */
export function codeOf(button: HTMLElement): string | undefined {
  const key = button.getAttribute('data-copy-key')
  const scope = button.closest('[data-copy-scope]')
  const wrap = key && scope ? scope.querySelector(`[data-code-key="${key}"]`) : button.closest('[data-install-code]')
  const code = wrap?.querySelector('code')
  if (!wrap || !code) return undefined
  const text = code.textContent ?? ''
  const prompt = wrap.getAttribute('data-prompt') ?? (wrap.getAttribute('data-language') === 'console' ? '$' : '')
  return prompt ? text.replace(new RegExp(`^${prompt.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')} `, 'gm'), '') : text
}

/** Copy what `button` names, and say how it went. */
export function copyInstallCode(button: HTMLElement): void {
  const text = codeOf(button)
  if (text === undefined) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => announce(button, true), () => fallbackCopy(text, button))
  } else {
    fallbackCopy(text, button)
  }
}

function fallbackCopy(text: string, button: HTMLElement): void {
  const focused = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  }
  announce(button, copied)
}

/** "Copy command" is announced as "Copied command."; a button that only says "Copy to clipboard" as "Copied to clipboard." */
function announce(button: HTMLElement, copied: boolean): void {
  const status = button.closest('.lm-pkg-install, .lm-mcp-install')?.querySelector('[data-copy-status]')
  const label = button.getAttribute('aria-label') ?? 'Copy to clipboard'
  status?.replaceChildren(document.createTextNode(copied ? `${label.replace(/^Copy /, 'Copied ')}.` : 'Copy failed. Select and copy the text manually.'))
  button.toggleAttribute('data-copied', copied)
  button.toggleAttribute('data-failed', !copied)
  button.title = copied ? 'Copied' : 'Copy failed'
  const timed = button as HTMLElement & { _lmCopyResetTimer?: number }
  window.clearTimeout(timed._lmCopyResetTimer)
  timed._lmCopyResetTimer = window.setTimeout(() => {
    button.removeAttribute('data-copied')
    button.removeAttribute('data-failed')
    button.title = 'Copy'
  }, FEEDBACK_MS)
}
