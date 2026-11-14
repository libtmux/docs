/**
 * Links from a Perl reference page to the POD of the CPAN release that ships
 * the same declaration.
 *
 * Everything here is computed from two committed inputs and requests nothing:
 * the Perl API model, which records each declaration's distribution, parent,
 * owning file and the SHA-256 of every source file it read, and
 * `data/perl-pod.json`, which `scripts/gen-perl-pod.mjs` wrote from MetaCPAN's
 * API for each distribution's latest release. A link appears only when the
 * release documents the declaration's package, and a method links to its own
 * section only when the release's rendered POD has that fragment.
 *
 * The release may not be what the page documents. When the declaring file's
 * SHA-256 is the release's, the page and the release describe the same bytes.
 * When it differs, the link still opens the release's POD, is labelled with the
 * release version, and gives a method a link only if the release's POD has its
 * section: a declaration the file gained since the release is not in the POD.
 */
import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import data from '../data/perl-pod.json'

export interface PodDocument {
  /** The file in the release, relative to the distribution root. */
  path: string
  sha256: string
  /** Fragments of the rendered page: heading and `=item` ids, in order. */
  anchors: readonly string[]
}

export interface PodRelease {
  author: string
  release: string
  documents: Readonly<Record<string, PodDocument>>
  /** Every package the release provides, and the document that documents it. */
  packages: Readonly<Record<string, string | null>>
}

export interface PodData {
  schema: 1
  distributions: Readonly<Record<string, PodRelease>>
}

export const POD_DATA = data as PodData

/** An alternate documentation link beside a declaration's source link. */
export interface ApiAlternate {
  /** Which documentation host and kind the link opens. */
  kind: 'metacpan-pod'
  href: string
  /** The visible text: the host and kind, and the release when the page documents other bytes. */
  label: string
  /** The accessible name and tooltip: it starts with the label, then names the module, its distribution and release. */
  title: string
  module: string
  distribution: string
  release: string
  section?: string
  /** The page's declaring file is not the release's. */
  differs: boolean
}

/** A decimal release tag, such as the Perl tag for release 0.003: a documentation version pinned to a release. */
const RELEASE_TAG = /^v\d+\.\d+$/

const filesOf = new WeakMap<object, ReadonlyMap<string, string>>()
/** The SHA-256 of each source file the model read, by repository path. */
function fileHashes(model: Pick<ApiModel, 'nativeProvenance'>): ReadonlyMap<string, string> {
  let files = filesOf.get(model)
  if (!files) {
    files = new Map((model.nativeProvenance?.files ?? []).map((file) => [file.path, file.sha256]))
    filesOf.set(model, files)
  }
  return files
}

/** `packages/core/lib/LibTmux/Server.pm` in the repository is `lib/LibTmux/Server.pm` in its distribution. */
const inDistribution = (file: string): string | undefined => /^.*?\/(lib\/.+)$/.exec(file)?.[1]

/**
 * The package a declaration belongs to: a method's declaring package, which
 * for an inherited method is the base class, and for anything else itself.
 */
function ownerOf(model: Pick<ApiModel, 'symbols'>, symbol: ApiSymbol): ApiSymbol | undefined {
  const id = symbol.kind === 'method' ? symbol.inheritedFrom ?? symbol.parent : symbol.id
  return id === symbol.id ? symbol : model.symbols.find((candidate) => candidate.id === id)
}

/**
 * The MetaCPAN POD link for a declaration, or nothing when the release does not
 * document it.
 *
 * `version` is the documentation version the page belongs to. A page for a
 * release tag pins the link to the recorded release, so it does not change when
 * a newer one is uploaded; a page for trunk opens whatever MetaCPAN calls the
 * latest release, which the record names.
 */
export function podLink(
  model: Pick<ApiModel, 'symbols' | 'nativeProvenance'>,
  symbol: ApiSymbol,
  version = 'latest',
  pod: PodData = POD_DATA,
): ApiAlternate | undefined {
  const owner = ownerOf(model, symbol)
  const dist = owner?.package
  const release = dist ? pod.distributions[dist] : undefined
  const path = owner && inDistribution(owner.source.file)
  if (!owner || !dist || !release || !path) return undefined
  // CPAN says which document documents a package, and the document must be the owner's own file.
  const module = release.packages[owner.id]
  const document = module ? release.documents[module] : undefined
  if (!module || !document || document.path !== path) return undefined

  const differs = fileHashes(model).get(owner.source.file) !== document.sha256
  let section: string | undefined
  if (symbol.id !== module) {
    // A method has a section of its own in the POD of the package that declares it. A package declared in the document
    // of another, as an exception subclass is, has its own heading when the release gave it one. A heading in a
    // shared document may belong to another package, so a subclass's method does not claim it.
    const heading = symbol.kind === 'method' ? (owner.id === module ? symbol.name : undefined) : symbol.name
    section = heading !== undefined && document.anchors.includes(heading) && !document.anchors.includes(`${heading}-1`) ? heading : undefined
    // With no section, the declaration is in the release only if its file is the release's own.
    if (section === undefined && differs) return undefined
  }

  const pinned = RELEASE_TAG.test(version)
  const page = pinned
    ? `https://metacpan.org/release/${release.author}/${dist}-${release.release}/view/${document.path}`
    : `https://metacpan.org/pod/${module}`
  const label = differs ? `MetaCPAN POD ${release.release}` : 'MetaCPAN POD'
  const target = section === undefined ? module : `${module}, section ${section},`
  return {
    kind: 'metacpan-pod',
    href: section === undefined ? page : `${page}#${section}`,
    label,
    title: `${label}: ${target} in ${dist} ${release.release}${differs ? '; this page documents other source' : ''}`,
    module, distribution: dist, release: release.release, section, differs,
  }
}

/** The alternate documentation link a port's reference page offers beside a declaration, if its ecosystem hosts one. */
export function alternateDocs(model: Pick<ApiModel, 'port' | 'symbols' | 'nativeProvenance'>, symbol: ApiSymbol, version = 'latest'): ApiAlternate | undefined {
  return model.port === 'perl' ? podLink(model, symbol, version) : undefined
}
