import { describe, expect, it } from 'vitest'
import { matrix } from '../../scripts/check-port-heads.mjs'
import { PORTS } from '../src/lib/ports.ts'

describe('port-heads matrix', () => {
  const legs = matrix(() => 'f'.repeat(40)).include as { port: string; repo: string; ref: string; members: string }[]

  it('covers every port, wrappers with their parent and python included', () => {
    expect(legs.flatMap((leg) => leg.members.split(' ')).sort()).toEqual(PORTS.map((port) => port.slug).sort())
    expect(legs.find((leg) => leg.port === 'java')?.members).toBe('java clojure kotlin scala')
    expect(legs.find((leg) => leg.port === 'py')).toBeTruthy()
  })

  it('names each leg by the repository the port builds from', () => {
    for (const leg of legs) expect(PORTS.find((port) => port.slug === leg.port)?.repo).toBe(leg.repo)
  })
})
