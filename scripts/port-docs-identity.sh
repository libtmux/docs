#!/usr/bin/env bash
# Which versions of a port's docs one event builds, and which of them it
# publishes: the identity job of .github/workflows/port-docs.yml.
#
# - A pull request builds `latest` from the merge commit GitHub tests, and
#   publishes nothing. Not the head: the workflow also runs in the default
#   branch's context, where checking out and running a pull request's head
#   could poison its caches.
# - A push to the default branch publishes `latest`. It is the default version
#   only until the port's first stable release: from then on `stable` is, and
#   a push to trunk must not take the default back. TAGS lists the port's
#   tags, one per line.
# - A release tag publishes its version plus an alias: `next` for a
#   prerelease, `stable` (the default) for a release. TAG_PREFIX is stripped
#   first, so libtmux-rs's `libtmux@v0.1.0` publishes `v0.1.0`.
# - A dispatch publishes exactly what its inputs name, at any ref.
#
# Reads the event from the environment and writes source_ref, matrix and
# should_publish to $GITHUB_OUTPUT.
set -euo pipefail

entry() {
  jq -cn --arg version "$1" --arg kind "$2" --argjson isDefault "$3" \
    --arg resolvesTo "$4" --argjson publish "$5" \
    '{version: $version, kind: $kind, isDefault: $isDefault, resolvesTo: $resolvesTo, publish: $publish}'
}

slug='^[A-Za-z0-9][A-Za-z0-9._-]*$'

case "$EVENT" in
  pull_request)
    source_ref="$SHA"
    entries=$(entry latest trunk false '' false)
    ;;
  push)
    source_ref="$SHA"
    if [[ "$REF_TYPE" == tag ]]; then
      [[ "$REF_NAME" == "$TAG_PREFIX"* ]] || {
        echo "tag $REF_NAME does not start with $TAG_PREFIX" >&2
        exit 1
      }
      version="${REF_NAME#"$TAG_PREFIX"}"
      [[ "$version" =~ ^v?[0-9]+\.[0-9]+ && "$version" =~ $slug ]] || {
        echo "unsupported release tag: $REF_NAME" >&2
        exit 1
      }
      entries=$(entry "$version" tag false '' true)
      # Any letter after the leading v marks a prerelease, whatever the
      # grammar: 0.1.0-alpha.1, 0.62.0a1, 0.1.0.alpha.1, 0.1.0alpha1.
      if [[ "${version#v}" =~ [A-Za-z] ]]; then
        entries+=$'\n'$(entry next alias false "$version" true)
      else
        entries+=$'\n'$(entry stable alias true "$version" true)
      fi
    elif [[ "$REF_NAME" == "$DEFAULT_BRANCH" ]]; then
      default=true
      while IFS= read -r name; do
        [[ "$name" == "$TAG_PREFIX"* ]] || continue
        version="${name#"$TAG_PREFIX"}"
        if [[ "$version" =~ ^v?[0-9]+\.[0-9]+ && ! "${version#v}" =~ [A-Za-z] ]]; then
          default=false
          break
        fi
      done <<< "${TAGS:-}"
      entries=$(entry latest trunk "$default" '' true)
    else
      echo "unsupported documentation branch: $REF_NAME" >&2
      exit 1
    fi
    ;;
  workflow_dispatch)
    source_ref="$INPUT_SOURCE_REF"
    [[ -n "$source_ref" ]] || {
      echo 'a dispatch requires source-ref' >&2
      exit 1
    }
    [[ "$INPUT_VERSION" =~ $slug ]] || {
      echo "invalid version slug: $INPUT_VERSION" >&2
      exit 1
    }
    case "$INPUT_KIND" in
      trunk | tag | alias) ;;
      *) echo "invalid version-kind: $INPUT_KIND" >&2; exit 1 ;;
    esac
    if [[ "$INPUT_KIND" == alias && -z "$INPUT_RESOLVES_TO" ]]; then
      echo 'an alias requires resolves-to' >&2
      exit 1
    fi
    if [[ "$INPUT_KIND" != alias && -n "$INPUT_RESOLVES_TO" ]]; then
      echo 'resolves-to applies only to aliases' >&2
      exit 1
    fi
    entries=$(entry "$INPUT_VERSION" "$INPUT_KIND" "${INPUT_DEFAULT:-false}" "$INPUT_RESOLVES_TO" "${INPUT_PUBLISH:-false}")
    ;;
  *)
    echo "unsupported event: $EVENT" >&2
    exit 1
    ;;
esac

matrix=$(jq -cs '{include: .}' <<< "$entries")
{
  echo "source_ref=$source_ref"
  echo "matrix=$matrix"
  echo "should_publish=$(jq -r 'any(.include[]; .publish)' <<< "$matrix")"
} >> "$GITHUB_OUTPUT"
jq . <<< "$matrix"
