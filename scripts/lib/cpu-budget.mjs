/**
 * Admit work in arrival order while its CPU cost fits the budget.
 *
 * Checks that start together share the same cores and stretch each other's
 * wall-clock bounds, so a subprocess test that takes seconds alone can exceed
 * its own limit. A check waits until the checks ahead of it leave room. Work
 * whose cost exceeds the budget takes all of it.
 *
 * @param {number} cpus CPUs the loop may keep busy at once.
 */
export function cpuBudget(cpus) {
  let free = cpus
  const waiting = []
  const admit = () => {
    while (waiting.length && waiting[0].cost <= free) {
      const task = waiting.shift()
      free -= task.cost
      task.start()
    }
  }
  return {
    /**
     * Run `work` once `cost` CPUs are free, and release them when its promise settles.
     *
     * @param {number} cost CPUs the work keeps busy.
     * @param {() => Promise<void>} work Starts the work and settles when it ends.
     */
    run(cost, work) {
      const slots = Math.min(Math.max(1, cost), cpus)
      return new Promise((resolve, reject) => {
        const start = () => Promise.try(work).finally(() => {
          free += slots
          admit()
        }).then(resolve, reject)
        waiting.push({ cost: slots, start, reject })
        admit()
      })
    },
    /** Reject the work that has not started. */
    cancel(error) {
      for (const task of waiting.splice(0)) task.reject(error)
    },
  }
}
