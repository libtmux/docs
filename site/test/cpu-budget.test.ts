import { describe, expect, it } from 'vitest'
import { cpuBudget } from '../../scripts/lib/cpu-budget.mjs'

/** Work that records its start and ends only when the test says so. */
function job(log: string[], name: string) {
  let end = () => {}
  return {
    work: () => new Promise<void>((resolve) => {
      log.push(name)
      end = resolve
    }),
    end: () => end(),
  }
}

describe('CPU budget', () => {
  it('starts work in arrival order without exceeding the budget', async () => {
    const log: string[] = []
    const budget = cpuBudget(4)
    const jobs = ['a', 'b', 'c', 'd'].map((name) => job(log, name))
    const done = [3, 3, 1, 1].map((cost, index) => budget.run(cost, jobs[index].work))
    // b needs 3 CPUs and 1 is free; c waits behind b instead of overtaking it.
    expect(log).toEqual(['a'])
    jobs[0].end()
    await done[0]
    expect(log).toEqual(['a', 'b', 'c'])
    jobs[1].end()
    jobs[2].end()
    await Promise.all([done[1], done[2]])
    expect(log).toEqual(['a', 'b', 'c', 'd'])
    jobs[3].end()
    await done[3]
  })

  it('runs work larger than the budget alone', async () => {
    const log: string[] = []
    const budget = cpuBudget(2)
    const [big, small] = [job(log, 'big'), job(log, 'small')]
    const done = [budget.run(8, big.work), budget.run(1, small.work)]
    expect(log).toEqual(['big'])
    big.end()
    await done[0]
    expect(log).toEqual(['big', 'small'])
    small.end()
    await done[1]
  })

  it('rejects work that has not started once cancelled', async () => {
    const log: string[] = []
    const budget = cpuBudget(1)
    const [first, second] = [job(log, 'first'), job(log, 'second')]
    const running = budget.run(1, first.work)
    const waiting = budget.run(1, second.work)
    budget.cancel(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
    first.end()
    await running
    expect(log).toEqual(['first'])
  })
})
