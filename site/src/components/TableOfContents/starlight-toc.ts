/**
 * Based on Starlight's starlight-toc custom element
 * Original source: https://github.com/withastro/starlight
 * License: MIT
 * Copyright (c) 2023 Astro contributors
 *
 * Simplified to prevent infinite loops. Unlike upstream (which predates
 * ClientRouter usage here), window-level listeners are scoped to an
 * AbortController and released in disconnectedCallback so swapped-out
 * instances don't leak.
 */

import { PAGE_TITLE_ID } from '../../constants'

class StarlightTOC extends HTMLElement {
  private _current = this.querySelector<HTMLAnchorElement>('a[aria-current="true"]')
  private minH = Number.parseInt(this.dataset.minH || '2', 10)
  private maxH = Number.parseInt(this.dataset.maxH || '3', 10)

  // Track visible and active headings
  private visibleHeadings = new Set<string>()
  private headingElements = new Map<string, HTMLHeadingElement>()
  private headingLinks = new Map<string, HTMLAnchorElement>()
  private currentActiveId: string | null = null

  // Lifecycle-scoped cleanup handles
  private controller: AbortController | null = null
  private observer: IntersectionObserver | undefined
  private scrollTimeout: number | undefined
  private resizeTimeout: number | undefined

  protected set current(link: HTMLAnchorElement) {
    if (link === this._current) return
    if (this._current) this._current.removeAttribute('aria-current')
    link.setAttribute('aria-current', 'true')
    this._current = link
  }

  private onIdle = (cb: IdleRequestCallback) => (window.requestIdleCallback || ((cb) => setTimeout(cb, 1)))(cb)

  connectedCallback(): void {
    this.onIdle(() => this.init())
  }

  disconnectedCallback(): void {
    this.controller?.abort()
    this.controller = null
    this.observer?.disconnect()
    this.observer = undefined
    clearTimeout(this.scrollTimeout)
    clearTimeout(this.resizeTimeout)
  }

  private init = (): void => {
    // The idle callback may fire after a navigation removed this instance
    if (!this.isConnected) return
    this.controller?.abort()
    this.controller = new AbortController()
    const { signal } = this.controller

    /** All the links in the table of contents. */
    const links = [...this.querySelectorAll('a')]

    // Build maps for quick lookups
    this.buildLookupMaps(links)

    // Set initial active state before enabling animations
    this.setInitialActiveState()

    // Initialize collapse/expand functionality
    this.initCollapseExpand()

    /** Test if an element is a table-of-contents heading. */
    const isHeading = (el: Element): el is HTMLHeadingElement => {
      if (el instanceof HTMLHeadingElement) {
        // Special case for page title h1
        if (el.id === PAGE_TITLE_ID) return true
        // Check the heading level is within the user-configured limits for the ToC
        const level = el.tagName[1]
        if (level) {
          const int = Number.parseInt(level, 10)
          if (int >= this.minH && int <= this.maxH) return true
        }
      }
      return false
    }

    /** Track which headings are visible - simple visibility tracking only */
    const updateVisibility: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const target = entry.target
        if (!isHeading(target)) continue

        const heading = target as HTMLHeadingElement
        if (entry.isIntersecting) {
          this.visibleHeadings.add(heading.id)
        } else {
          this.visibleHeadings.delete(heading.id)
        }
      }

      // Update active selection after visibility changes
      this.updateActiveSelection()
    }

    // Only observe heading elements directly - much simpler and safer
    const headingSelector = Array.from(
      { length: this.maxH - this.minH + 1 },
      (_, i) => `main article h${this.minH + i}[id]`,
    ).join(', ')

    // Add h1 with PAGE_TITLE_ID if it exists
    const fullSelector = `main article h1#${PAGE_TITLE_ID}, ${headingSelector}`
    const toObserve = document.querySelectorAll(fullSelector)

    const observe = () => {
      // A timeout/idle callback scheduled before navigation can fire after
      // disconnectedCallback; never (re)create an observer for a dead instance
      if (!this.isConnected || this.observer) return

      this.observer = new IntersectionObserver(updateVisibility, {
        rootMargin: this.getRootMargin(),
        threshold: 0.1,
      })
      toObserve.forEach((h) => {
        this.observer!.observe(h)
      })
    }

    observe()

    // Add scroll handler for precise active selection
    const handleScroll = () => {
      clearTimeout(this.scrollTimeout)
      this.scrollTimeout = window.setTimeout(() => {
        this.updateActiveSelection()
      }, 16) // ~60fps
    }

    window.addEventListener('scroll', handleScroll, { passive: true, signal })

    window.addEventListener(
      'resize',
      () => {
        // Disable intersection observer while window is resizing.
        if (this.observer) {
          this.observer.disconnect()
          this.observer = undefined
        }
        clearTimeout(this.resizeTimeout)
        this.resizeTimeout = window.setTimeout(() => this.onIdle(observe), 200)
      },
      { signal },
    )

    // Handle hash changes
    window.addEventListener(
      'hashchange',
      () => {
        this.handleInitialHash()
      },
      { signal },
    )
  }

  private getRootMargin(): `-${number}px 0% ${number}px` {
    const navBarHeight = document.querySelector('header')?.getBoundingClientRect().height || 0
    // `<summary>` only exists in mobile ToC, so will fall back to 0 in large viewport component.
    const mobileTocHeight = this.querySelector('summary')?.getBoundingClientRect().height || 0
    /** Start intersections at nav height + 2rem padding. */
    const top = navBarHeight + mobileTocHeight + 32
    /** End intersections `53px` later. This is slightly more than the maximum `margin-top` in Markdown content. */
    const bottom = top + 53
    const height = document.documentElement.clientHeight
    return `-${top}px 0% ${bottom - height}px`
  }

  private initCollapseExpand(): void {
    // Sections start collapsed in HTML/CSS to prevent flicker
    // Update collapse state based on current active item
    this.updateCollapseStates()
  }

  private buildLookupMaps(links: HTMLAnchorElement[]): void {
    // Build heading element and link maps for quick lookups
    for (const link of links) {
      const hash = link.hash
      if (!hash) continue

      const id = hash.substring(1) // Remove #
      const element = document.getElementById(id)

      if (element && element instanceof HTMLHeadingElement) {
        this.headingElements.set(id, element)
        this.headingLinks.set(id, link)
      }
    }
  }

  private setInitialActiveState(): void {
    const hash = window.location.hash

    if (hash) {
      // If there's a hash, set that as active
      const id = hash.substring(1)
      const link = this.headingLinks.get(id)

      if (link) {
        this.setActiveHeadingWithoutAnimation(id)

        // Scroll ToC to make active item visible
        setTimeout(() => {
          // Site is intentionally motionless: jump, don't smooth-scroll
          link.scrollIntoView({ block: 'center' })
        }, 100)
        return
      }
    }

    // No hash or hash not found - highlight first item and open first menu
    const allLinks = Array.from(this.headingLinks.keys())
    if (allLinks.length > 0) {
      // Get the first heading by sorting all headings by their position
      const firstId = allLinks
        .map((id) => ({ id, element: this.headingElements.get(id)! }))
        .filter((item) => item.element) // Safety check
        .sort((a, b) => {
          const posA = a.element.offsetTop
          const posB = b.element.offsetTop
          return posA - posB
        })[0]?.id

      if (firstId) {
        this.setActiveHeadingWithoutAnimation(firstId)
      }
    }
  }

  private handleInitialHash(): void {
    // This method is now handled by setInitialActiveState
    // Keep for compatibility with hashchange events
    const hash = window.location.hash
    if (!hash) return

    const id = hash.substring(1)
    const link = this.headingLinks.get(id)

    if (link) {
      this.setActiveHeading(id)
    }
  }

  private getActiveZoneBuffer(): number {
    const navBarHeight = document.querySelector('header')?.getBoundingClientRect().height || 0
    return navBarHeight + 32 // nav height + some padding
  }

  private updateActiveSelection(): void {
    const buffer = this.getActiveZoneBuffer()
    const viewportHeight = window.innerHeight
    const scrollY = window.scrollY
    const documentHeight = document.documentElement.scrollHeight

    // Check edge cases
    const atVeryTop = scrollY < 50
    const nearTop = scrollY < 200
    const atVeryBottom = scrollY + viewportHeight >= documentHeight - 50
    const nearBottom = scrollY + viewportHeight >= documentHeight - 200

    let selectedId: string | null = null

    // Special override: If at the very top of page, always highlight the first item
    if (atVeryTop) {
      const allLinks = Array.from(this.headingLinks.keys())
      if (allLinks.length > 0) {
        // Get the first heading by sorting all headings by their position
        const firstId = allLinks
          .map((id) => ({ id, element: this.headingElements.get(id)! }))
          .filter((item) => item.element) // Safety check
          .sort((a, b) => {
            const posA = a.element.offsetTop
            const posB = b.element.offsetTop
            return posA - posB
          })[0]?.id

        if (firstId) {
          selectedId = firstId
        }
      }
    }
    // Special override: If at the very bottom of page, always highlight the last item
    else if (atVeryBottom) {
      const allLinks = Array.from(this.headingLinks.keys())
      if (allLinks.length > 0) {
        // Get the last heading by sorting all headings by their position
        const lastId = allLinks
          .map((id) => ({ id, element: this.headingElements.get(id)! }))
          .filter((item) => item.element) // Safety check
          .sort((a, b) => {
            const posA = a.element.offsetTop
            const posB = b.element.offsetTop
            return posB - posA
          })[0]?.id

        if (lastId) {
          selectedId = lastId
        }
      }
    }
    // Normal scrolling behavior
    else {
      // If we have visible headings, check for active zone
      if (this.visibleHeadings.size > 0) {
        // Find heading in active zone (with "give")
        for (const id of this.visibleHeadings) {
          const element = this.headingElements.get(id)
          if (!element) continue

          const rect = element.getBoundingClientRect()

          // Check if heading is in the active zone
          if (rect.top <= buffer && rect.bottom >= buffer) {
            selectedId = id
            break
          }
        }
      }
    }

    // Update active heading if changed
    if (selectedId && selectedId !== this.currentActiveId) {
      this.setActiveHeading(selectedId)
    }

    // Handle auto-expand for sections when no item is active
    this.handleAutoExpand(nearTop, nearBottom)
  }

  private setActiveHeading(id: string): void {
    const link = this.headingLinks.get(id)
    if (!link) return

    this.currentActiveId = id

    // Update ToC UI
    this.current = link

    // Update collapse states based on new active item
    this.updateCollapseStates()
  }

  private setActiveHeadingWithoutAnimation(id: string): void {
    const link = this.headingLinks.get(id)
    if (!link) return

    this.currentActiveId = id

    // Update ToC UI
    this.current = link

    // Update collapse states immediately without animation
    this.updateCollapseStatesWithoutAnimation()
  }

  private handleAutoExpand(nearTop: boolean, nearBottom: boolean): void {
    // Only auto-expand if no item is currently active
    if (this.currentActiveId) return

    const itemsWithChildren = this.querySelectorAll('li[data-has-children="true"]')

    // Check if any sections are currently expanded (excluding sections that are only expanded due to hover)
    const hasExpandedSections = Array.from(itemsWithChildren).some((item) => !item.classList.contains('collapsed'))

    // Check if any sections are being hovered over (don't auto-collapse these)
    const hasHoveredSections = Array.from(itemsWithChildren).some((item) => item.matches(':hover'))

    // Don't collapse sections if user is hovering over them
    if (hasHoveredSections) {
      return
    }

    // Special override: If at top-ish of page and no items are open, show first ToC section open
    if (nearTop && !hasExpandedSections && itemsWithChildren.length > 0) {
      const firstSection = itemsWithChildren[0]
      if (firstSection) {
        firstSection.classList.remove('collapsed')
      }
    }
    // Special override: If at bottom-ish of page and no items are open, show last ToC section open
    else if (nearBottom && !hasExpandedSections && itemsWithChildren.length > 0) {
      const lastSection = itemsWithChildren[itemsWithChildren.length - 1]
      if (lastSection) {
        lastSection.classList.remove('collapsed')
      }
    }
  }

  private updateCollapseStates(): void {
    const itemsWithChildren = this.querySelectorAll('li[data-has-children="true"]')

    itemsWithChildren.forEach((item) => {
      // Check if this section or any of its children have an active item
      const hasActiveChild = item.querySelector('a[aria-current="true"]')

      if (hasActiveChild) {
        // Expand this section if it has an active child
        item.classList.remove('collapsed')
      } else {
        // Collapse this section if no active children
        item.classList.add('collapsed')
      }
    })
  }

  private updateCollapseStatesWithoutAnimation(): void {
    const itemsWithChildren = this.querySelectorAll('li[data-has-children="true"]')

    itemsWithChildren.forEach((item) => {
      // Check if this section or any of its children have an active item
      const hasActiveChild = item.querySelector('a[aria-current="true"]')

      if (hasActiveChild) {
        // Expand this section immediately without animation
        item.classList.remove('collapsed')
        item.setAttribute('data-initial-expand', 'true')
      } else {
        // Collapse this section if no active children
        item.classList.add('collapsed')
        item.removeAttribute('data-initial-expand')
      }
    })
  }
}

customElements.define('starlight-toc', StarlightTOC)
