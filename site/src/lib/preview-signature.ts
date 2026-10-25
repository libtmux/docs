/**
 * How much of a declaration a preview card shows.
 *
 * A card is a glance before a reader decides to open the page, so it shows the head of a declaration and not all of it.
 * One declaration in tmux's source, an anonymous enum of the key codes, is a single signature of hundreds of
 * thousands of characters; a payload that carried it was most of a megabyte, and a card that rendered it laid out a
 * wall of text. The page the card links to has the whole declaration.
 *
 * The payload is built with the limit and the browser applies it again, so a payload from any producer, or one written
 * before the limit, cannot make a card heavy.
 */
export const PREVIEW_SIGNATURE_LINES = 12
export const PREVIEW_SIGNATURE_CHARS = 1200

/** `signature` as it is shown: whole when it fits, otherwise its first lines and characters followed by a line that says so. */
export function limitPreviewSignature(signature: string): string {
  const lines = signature.split('\n')
  let text = lines.slice(0, PREVIEW_SIGNATURE_LINES).join('\n')
  let cut = lines.length > PREVIEW_SIGNATURE_LINES
  if (text.length > PREVIEW_SIGNATURE_CHARS) { text = text.slice(0, PREVIEW_SIGNATURE_CHARS); cut = true }
  return cut ? `${text.trimEnd()}\n…` : text
}
