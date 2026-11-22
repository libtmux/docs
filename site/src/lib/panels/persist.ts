/** The part of `Storage` the panels use. */
export type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Reading `localStorage` throws where site data is blocked, so the page asks for it here. */
export function browserStorage(): PanelStorage | undefined {
  try { return localStorage } catch { return undefined }
}

/**
 * JSON in storage that may be absent, blocked, full or hold something else.
 * A failed read is the fallback and a failed write is `false`; the layout then lasts for the visit.
 */
export function panelStore(storage: PanelStorage | undefined) {
  return {
    read<T>(key: string, fallback: T): T {
      try {
        const value = storage?.getItem(key)
        return value ? JSON.parse(value) as T : fallback
      } catch { return fallback }
    },
    write(key: string, value: unknown): boolean {
      try {
        if (!storage) return false
        storage.setItem(key, JSON.stringify(value))
        return true
      } catch { return false }
    },
  }
}
