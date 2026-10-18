import { readFileSync } from 'node:fs'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'astro-expressive-code/hast'
import { describe, expect, it } from 'vitest'
import { rehypeTmuxKeys } from '../src/plugins/rehype-tmux-keys'
import { tmuxKeysInProse, type ProseItem } from '../src/lib/tmux-keys'

const render = (html: string) => {
  const tree = fromHtml(html, { fragment: true })
  rehypeTmuxKeys()(tree as never)
  return toHtml(tree)
}

describe('keys in rendered prose', () => {
  it('nests a sequence and caps a single key', () => {
    expect(render('<p>Detach with <code>C-b d</code>, or send <code>C-c</code>.</p>'))
      .toBe('<p>Detach with <kbd><kbd>C-b</kbd> <kbd>d</kbd></kbd>, or send <kbd>C-c</kbd>.</p>')
  })

  it('caps a list that holds a modified key, including a linked name', () => {
    expect(render('<p>key names such as <code>Enter</code>, <code>C-c</code>, and <code>Up</code>.</p>'))
      .toBe('<p>key names such as <kbd>Enter</kbd>, <kbd>C-c</kbd>, and <kbd>Up</kbd>.</p>')
    expect(render('<p>(<a href="/tmux/latest/manual/send-keys/"><code>Enter</code></a>, <code>C-c</code>) rather</p>'))
      .toBe('<p>(<a href="/tmux/latest/manual/send-keys/"><kbd>Enter</kbd></a>, <kbd>C-c</kbd>) rather</p>')
  })

  it('leaves literals, fences and code that merely looks like a key', () => {
    for (const html of [
      '<p>Typing the word <code>Enter</code> and pressing Enter are separate.</p>',
      '<p>Supplying <code>Enter</code> to <code>-l</code> would type that word.</p>',
      '<p>Run <code>new-window</code> with <code>-t</code> and <code>c</code>.</p>',
      '<p>Match <code>^a</code> and <code>#{session_name}</code>.</p>',
      '<pre><code>tmux send-keys C-c\nbind-key C-b d</code></pre>',
      '<p><kbd><code>C-b</code></kbd></p>',
    ]) expect(render(html)).toBe(html)
  })

  it('is idempotent', () => {
    const once = render('<p>Detach with <code>C-b d</code>.</p>')
    expect(render(once)).toBe(once)
  })
})

/** The inline code of a Markdown page, grouped by paragraph, outside fences. */
function paragraphs(path: string): ProseItem[][] {
  const source = readFileSync(new URL(`../src/content/docs/${path}`, import.meta.url), 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '')
  return source.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\[(`[^`]+`)\]\([^)]*\)/g, '$1').split('`')
    .map((piece, index): ProseItem => index % 2 ? { type: 'code', value: piece } : { type: 'text', value: piece }))
}
const keysIn = (path: string) => paragraphs(path).flatMap((items) => tmuxKeysInProse(items)
  .flatMap((flag, index) => flag ? [(items[index] as { value: string }).value] : []))

describe('keys in the guides', () => {
  it.each([
    ['guides/attaching-to-tmux.md', ['C-b d']],
    // The name typed into a pane and the name sent as a key are different in one guide.
    ['guides/sending-keys.md', ['Enter', 'C-c', 'Up']],
    ['topics/pane-interaction.md', ['Enter', 'C-c', 'Up', 'Enter']],
    ['examples/attach-and-send-keys.md', ['Enter', 'Enter', 'C-c', 'Up']],
    ['ports/py/topics/pane-interaction.md', ['Enter', 'C-c']],
  ])('%s marks %j', (path, keys) => {
    expect(keysIn(path)).toEqual(keys)
  })
})
