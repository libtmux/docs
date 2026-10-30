import type { ProseBlock } from './api-prose'

/** The names one row lists, under an optional label such as `Buffers`. */
export interface DirectoryGroup { label?: string; refs: string[] }

/** A bold-led paragraph that says what a group of members is for, then the members. */
export interface DirectoryRow { title: string; guidance: string; groups: DirectoryGroup[] }

export type DirectoryBlock = ProseBlock | { kind: 'directory'; rows: DirectoryRow[] }

/**
 * A doc comment's own spelling of a reference, in each port's syntax: rustdoc's [`name`] or [`name`](target),
 * an XML doc `<see cref="…" />`, Javadoc and TSDoc's {@link …}, and a Go doc link [Name] or [Type.Method].
 */
const REFERENCE = /\[`[^`\]]+`\](?:\([^)\s]*\))?|<see\s+cref="[^"]+"\s*\/>|\{@link(?:code|plain)?\s+[^}]+\}|\[[A-Za-z_][\w.]*\](?![([])/g
const LEAD = /^\*\*([^*]+?)\*\*\s*(.*)$/
const LABEL = /^([^:[`]{1,40}):\s+(.*)$/
/** Fewer rows than this read as ordinary prose. */
const MIN_ROWS = 3

/** The references of a text made of nothing else, or undefined when it holds prose. */
function referencesOnly(text: string): string[] | undefined {
  const refs = text.match(REFERENCE) ?? []
  if (!refs.length) return undefined
  return text.replace(REFERENCE, '').replace(/\band\b/g, '').replace(/[\s,;.·]/g, '') ? undefined : refs
}

function groupsOf(block: ProseBlock | undefined): DirectoryGroup[] | undefined {
  if (block?.kind === 'p') {
    const refs = referencesOnly(block.text)
    return refs && [{ refs }]
  }
  if (block?.kind !== 'ul') return undefined
  const groups: DirectoryGroup[] = []
  for (const item of block.items) {
    const label = LABEL.exec(item.text)
    const refs = label && !item.children.length ? referencesOnly(label[2]) : undefined
    if (!label || !refs) return undefined
    groups.push({ label: label[1].replace(/^[*_]{1,2}(.*?)[*_]{1,2}$/, '$1').trim(), refs })
  }
  return groups
}

/**
 * Fold a capability directory into rows: three or more bold-led paragraphs, each followed by a paragraph or a
 * labelled list that holds only references. The source stays ordinary Markdown, so rustdoc reads it as prose and
 * links; this shell draws the guidance beside the names it covers.
 */
export function groupDirectory(blocks: ProseBlock[]): DirectoryBlock[] {
  const out: DirectoryBlock[] = []
  let rows: DirectoryRow[] = []
  let pending: ProseBlock[] = []
  const flush = () => {
    if (rows.length >= MIN_ROWS) out.push({ kind: 'directory', rows })
    else out.push(...pending)
    rows = []
    pending = []
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const lead = block.kind === 'p' ? LEAD.exec(block.text) : null
    const groups = lead ? groupsOf(blocks[i + 1]) : undefined
    if (lead && groups) {
      rows.push({ title: lead[1].trim().replace(/[.:]$/, ''), guidance: lead[2].trim(), groups })
      pending.push(block, blocks[i + 1])
      i++
      continue
    }
    // Go doc comments have no bold: a row there is a `# Heading`, its guidance, then the names.
    const guidance = block.kind === 'rubric' ? blocks[i + 1] : undefined
    const headed = guidance?.kind === 'p' && !referencesOnly(guidance.text) ? groupsOf(blocks[i + 2]) : undefined
    if (block.kind === 'rubric' && guidance?.kind === 'p' && headed) {
      rows.push({ title: block.text.replace(/[.:]$/, ''), guidance: guidance.text, groups: headed })
      pending.push(block, guidance, blocks[i + 2])
      i += 2
      continue
    }
    flush()
    out.push(block)
  }
  flush()
  return out
}
