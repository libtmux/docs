/**
 * PowerShell's common parameters, and the Microsoft Learn page that documents them.
 *
 * The page and the words that link to it are written here, and each parameter's own heading is built from its name here, so the
 * link verifier reads the pair and the component draws it from one place.
 */

/** The page that documents the common parameters, with the words that link to it. */
const COMMON_PARAMETERS = { title: 'common parameter behavior', url: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4' }
export const POWER_SHELL_COMMON_HELP = COMMON_PARAMETERS.url
export const POWER_SHELL_COMMON_HELP_TITLE = COMMON_PARAMETERS.title

/** The heading of the page that describes one common parameter: Learn lower-cases a heading into its fragment. */
export const powerShellCommonParameterHref = (name: string) => `${POWER_SHELL_COMMON_HELP}#-${name.toLowerCase()}`

/** The words that name that link to a reader who cannot see what it sits beside. */
export const powerShellCommonParameterLabel = (name: string) => `Microsoft Learn reference for -${name}`
