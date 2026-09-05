declare global {
  interface Window {
    /**
     * Set by ThemeScript's inline FOUC-prevention script and called again
     * after an astro:after-swap navigation. Optional because the inline
     * script has not run yet during SSR.
     */
    __applyTheme?: () => void
    /**
     * Set by the same inline script, which also resolves the package
     * picker's saved language before first paint so the widget is painted
     * once rather than corrected twice.
     */
    __applyPackagePort?: () => void
  }
}

export {}
