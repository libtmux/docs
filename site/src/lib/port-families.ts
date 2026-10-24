/** A heading in the port picker and the ports listed under it, in display order. */
export interface PortFamily {
  label: string
  ports: string[]
}

/**
 * The picker's groups, in display order. Ports that share a language runtime
 * (the JVM, .NET, the BEAM) sit in a group named for it; the rest are split
 * by how they are built and run. A port belongs to one group.
 */
export const PORT_FAMILIES: readonly PortFamily[] = [
  { label: 'Scripting & web', ports: ['py', 'ruby', 'lua', 'julia', 'ts'] },
  { label: 'Compiled & native', ports: ['rs', 'go', 'cxx', 'swift'] },
  { label: 'JVM', ports: ['java', 'kotlin', 'scala'] },
  { label: '.NET', ports: ['csharp', 'fsharp', 'powershell'] },
  { label: 'BEAM', ports: ['elixir'] },
]

/** The label of the group that collects every port no family names. */
export const OTHER_FAMILY_LABEL = 'Other languages'

/** The groups to draw for these ports, ending with the ports no family names. */
export function portFamilies(ports: readonly string[]): PortFamily[] {
  const known = new Set(PORT_FAMILIES.flatMap((family) => family.ports))
  return [
    ...PORT_FAMILIES.map((family) => ({ label: family.label, ports: [...family.ports] })),
    { label: OTHER_FAMILY_LABEL, ports: ports.filter((port) => !known.has(port)) },
  ]
}
