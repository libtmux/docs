import { describe, expect, it } from 'vitest'
import { matrix } from '../../scripts/check-port-heads.mjs'
import { PORTS } from '../src/lib/ports.ts'

describe('port-heads matrix', () => {
  type Leg = { port: string; repo: string; ref: string; members: string }
  const head = () => 'f'.repeat(40)
  const legs = [...matrix(head).include, ...matrix(head, { own: true }).include] as Leg[]

  it('covers every port, wrappers with their parent and python included', () => {
    expect(legs.flatMap((leg) => leg.members.split(' ')).sort()).toEqual(PORTS.map((port) => port.slug).sort())
    expect(legs.find((leg) => leg.port === 'java')?.members).toBe('java clojure kotlin scala')
    expect(legs.find((leg) => leg.port === 'py')).toBeTruthy()
  })

  it('sends lua and ruby, whose repositories build their own docs, to the own-workflow job only', () => {
    expect(matrix(head, { own: true }).include.map((leg: Leg) => leg.port)).toEqual(['ruby', 'lua'])
    expect(matrix(head).include.map((leg: Leg) => leg.port)).not.toContain('lua')
  })

  it('names each leg by the repository the port builds from', () => {
    for (const leg of legs) expect(PORTS.find((port) => port.slug === leg.port)?.repo).toBe(leg.repo)
  })
})
