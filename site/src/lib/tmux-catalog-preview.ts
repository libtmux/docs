import type { LinkPreview } from './link-preview'
import { CATALOG_KINDS, OPTION_TYPES, tmuxCatalogDefault, tmuxCatalogSourceUrl, tmuxCatalogUrl, tmuxCatalogValues, type CatalogEntry } from './tmux-catalog'

/** Preview an entry from the same record as its page. */
export function tmuxCatalogPreview(version: string, entry: CatalogEntry): LinkPreview {
  const scope = entry.scope?.join(', ')
  const defaultText = tmuxCatalogDefault(entry)
  const values = tmuxCatalogValues(entry)
  const detail = entry.kind === 'option'
    ? [`${scope} option, ${(OPTION_TYPES[entry.type!] ?? entry.type!).toLowerCase()}`, defaultText !== undefined && defaultText.length < 80 ? `default ${defaultText}` : '', values && values.length < 80 ? `values ${values}` : '']
    : entry.kind === 'hook'
      ? [`${scope} hook`, entry.after ? `after ${entry.after}` : '']
      : [`Format variable, ${entry.type}`, scope ? `describes a ${scope}` : '']
  return {
    schema: 1, title: entry.name, kind: entry.kind,
    description: entry.summary || `The ${entry.name} ${CATALOG_KINDS[entry.kind].singular} in tmux ${version}.`,
    detail: detail.filter(Boolean).join('; ') + '.',
    signature: entry.kind === 'format' ? `#{${entry.name}}` : entry.kind === 'hook' ? `set-hook -g ${entry.name} 'command'` : `set-option -g ${entry.name} value`,
    signatureLanguage: 'tmux-config',
    href: tmuxCatalogUrl(version, entry.kind, entry.name),
    source: tmuxCatalogSourceUrl(version, entry.source),
  }
}
