import type { Rect } from './tmux-layout'

/**
 * Pane rectangles from the layout a tmux server reported, so a drawing can use
 * the geometry the server states instead of one a name implies.
 *
 * Two spellings occur in the MCP servers' answers: tmux's own `window_layout`
 * (`ba5d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}`) and the JSON form some servers
 * return for it (`{"V":2,"L":{"t":"h",...,"c":[{"t":"p","I":"%0",...}]}}`).
 */
export interface ParsedLayout {
  width: number
  height: number
  /** Each pane, in tmux's order, with the id it carries and its rectangle in cells. */
  panes: (Rect & { id: string })[]
}

type JsonNode = { t?: string; w?: number; h?: number; x?: number; y?: number; I?: string; i?: number; c?: JsonNode[] }

function fromJson(text: string): ParsedLayout | undefined {
  let root: unknown
  try { root = JSON.parse(text) } catch { return undefined }
  const node = (root as { L?: JsonNode } | null)?.L
  if (!node || typeof node.w !== 'number' || typeof node.h !== 'number') return undefined
  const panes: ParsedLayout['panes'] = []
  const walk = (item: JsonNode): boolean => {
    if (item.c?.length) return item.c.every(walk)
    if (typeof item.I !== 'string' || ![item.x, item.y, item.w, item.h].every((value) => typeof value === 'number')) return false
    panes.push({ id: item.I, x: item.x!, y: item.y!, w: item.w!, h: item.h! })
    return true
  }
  return walk(node) && panes.length > 0 ? { width: node.w, height: node.h, panes } : undefined
}

function fromTmux(text: string): ParsedLayout | undefined {
  const body = text.replace(/^[0-9a-f]{4},/, '')
  let at = 0
  const number = () => {
    const match = /^\d+/.exec(body.slice(at))
    if (!match) throw new Error('digits expected')
    at += match[0].length
    return Number(match[0])
  }
  const expect = (char: string) => { if (body[at] !== char) throw new Error(`${char} expected`); at += 1 }
  const panes: ParsedLayout['panes'] = []
  function cell(): void {
    const w = number(); expect('x'); const h = number(); expect(','); const x = number(); expect(','); const y = number()
    if (body[at] === '{' || body[at] === '[') {
      const close = body[at] === '{' ? '}' : ']'
      at += 1
      for (;;) {
        cell()
        if (body[at] === ',') { at += 1; continue }
        break
      }
      expect(close)
    } else {
      expect(',')
      panes.push({ id: `%${number()}`, x, y, w, h })
    }
  }
  try {
    const start = at
    const w = number(); expect('x'); const h = number()
    at = start
    cell()
    return at === body.length && panes.length > 0 ? { width: w, height: h, panes } : undefined
  } catch {
    return undefined
  }
}

/** The rectangles a recorded layout states, or nothing when the text is neither spelling. */
export function parseLayout(text: string): ParsedLayout | undefined {
  const trimmed = text.trim()
  return trimmed.startsWith('{') ? fromJson(trimmed) : fromTmux(trimmed)
}
