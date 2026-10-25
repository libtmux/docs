import { API_MODELS } from './api-models'
import { apiTreeVersion, navTree, referenceTree } from './api-tree'
import { API_MODEL_PORTS, PORT_BY_SLUG, referenceUrl } from './ports'
import { defaultVersionFor } from './versions'
import { IS_ROOT_BUILD } from './site-root'
import { tmuxManualUrl } from './tmux-manual-data'
import { tmuxManualNavigation } from './tmux-manual-navigation'

export const DEMO_LANGUAGES = [...API_MODEL_PORTS.map((port) => port.slug), 'tmux']

/**
 * The gallery at the site root frames each preview and fetches its inventory by
 * root-relative URL, so a port build, which renders every route, has no use for its copies.
 */
export function sidebarPreviewPaths() {
  return IS_ROOT_BUILD ? DEMO_LANGUAGES.map((port) => ({ params: { port } })) : []
}

/** Server-only inventories keep model data out of the gallery's control bundle. */
export function sidebarDemoData(port: string) {
  if (port === 'tmux') {
    const navigation = tmuxManualNavigation()
    return { inventory: navigation.json, label: 'tmux CLI', base: tmuxManualUrl('latest'), version: 'latest', key: navigation.version }
  }
  const version = defaultVersionFor(port)
  return { inventory: referenceTree(port), label: PORT_BY_SLUG[port]!.name, base: referenceUrl(PORT_BY_SLUG[port]!, version),
    version, key: apiTreeVersion(API_MODELS[port]!, navTree(port)) }
}
