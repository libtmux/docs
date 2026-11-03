// scripts/gen-mcp-transcript.mjs imports this module with bare Node, so it has no imports.

/** What a client can rely on from a tool: the arguments it accepts and the result it returns. */
export interface ToolContract {
  inputSchema: unknown
  outputSchema?: unknown
}

/** A tool as `tools/list` advertises it, reduced to what a contract reads. */
export interface AdvertisedTool {
  name: string
  inputSchema: unknown
  outputSchema?: unknown
}

export const contractOf = (tool: Pick<AdvertisedTool, 'inputSchema' | 'outputSchema'>): ToolContract => ({
  inputSchema: tool.inputSchema,
  ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
})

/** JSON text that does not change with the order of an object's keys; an array keeps its order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : item))
}

/** Whether two contracts accept and return the same shapes. A missing contract matches nothing. */
export function sameContract(a: ToolContract | undefined, b: ToolContract | undefined): boolean {
  return a !== undefined && b !== undefined && canonical(contractOf(a)) === canonical(contractOf(b))
}

/** Whether two sets of contracts name the same tools with the same contract each. */
export function sameContracts(a: Record<string, ToolContract> | undefined, b: Record<string, ToolContract> | undefined): boolean {
  if (!a || !b) return false
  const names = Object.keys(a)
  return names.length === Object.keys(b).length && names.every((name) => sameContract(a[name], b[name]))
}

/**
 * The contracts of the tools a session called, by tool name.
 *
 * @throws {Error} When a called tool is not among the advertised ones.
 */
export function contractsOf(tools: readonly AdvertisedTool[], called: readonly string[]): Record<string, ToolContract> {
  const advertised = new Map(tools.map((tool) => [tool.name, tool]))
  return Object.fromEntries([...new Set(called)].map((name) => {
    const tool = advertised.get(name)
    if (!tool) throw new Error(`${name} is not among the advertised tools`)
    return [name, contractOf(tool)]
  }))
}
