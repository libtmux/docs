/**
 * The component demos under `/demo/`, grouped as the sidebar lists them.
 *
 * `DemoLayout` builds its sidebar from this, and the overview and section
 * pages build their cards from it, so a demo is added in one place.
 */

export interface Demo {
  href: string
  title: string
  description: string
}

export interface DemoSection extends Demo {
  slug: string
  demos: Demo[]
}

export const DEMO_OVERVIEW = '/demo/'

export const DEMO_SECTIONS: DemoSection[] = [
  {
    slug: 'ux',
    href: '/demo/ux/',
    title: 'UX components',
    description: 'Components that pages and widgets are built from.',
    demos: [
      {
        href: '/demo/ux/button/',
        title: 'Button',
        description: 'The reroll button in eight sizes, with and without a label.',
      },
      {
        href: '/demo/ux/aside/',
        title: 'Aside',
        description: 'Notes, tips, cautions and dangers in five container variants.',
      },
    ],
  },
]
