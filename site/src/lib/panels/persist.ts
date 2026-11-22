/** The part of `Storage` the panels use; a store that cannot remove a key keeps it. */
export type PanelStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>

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
    /** Forget a key, so the next read is the fallback. A failed removal is `false`. */
    remove(key: string): boolean {
      try {
        if (!storage?.removeItem) return false
        storage.removeItem(key)
        return true
      } catch { return false }
    },
  }
}
