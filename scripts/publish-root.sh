#!/usr/bin/env bash
#
# Publish one locale's assembled shell to the documentation bucket.
#
# A file rather than a `run:` block in `.github/workflows/deploy-shell.yml`,
# because three readers need this text and only one of them is the deploy:
# `check-publish` exercises it against the artifact without uploading, and
# `site/test/publish-prefixes.test.ts` drives it with a recording `aws`. Both
# used to re-extract the block by splitting the workflow on a step name and a
# ten-space indent, so renaming or reindenting the step would have left them
# exercising a truncated script rather than failing.
#
# It ships inside the publication metadata artifact, so `publish-root` still
# runs without a checkout of its own: the script it runs is the one carried by
# the commit that built the tree it is publishing.
#
# Reads BUCKET, LOCALE and RUNNER_TEMP, and the metadata files beside `dist/`.

set -euo pipefail
locale="${LOCALE:?LOCALE is required}"
# The artifact declares the shell-owned ports, products and paths. Missing
# metadata must never turn a reserved port into an unrestricted sync.
for metadata in reserved-prefixes.txt reserved-products.txt shell-paths.json; do
  if [[ ! -s "$metadata" ]]; then
    echo "::error::$metadata is missing or empty" >&2
    exit 1
  fi
done
mapfile -t reserved < reserved-prefixes.txt
mapfile -t products < reserved-products.txt
if ! jq -e '.schema == 1 and (.locale | type == "string") and (.directories | type == "array") and (.files | type == "array") and (all(.directories[], .files[]; type == "string"))' shell-paths.json > /dev/null; then
  echo '::error::invalid shell-paths.json ownership metadata' >&2
  exit 1
fi
port_locale=$(jq -r '.locale' shell-paths.json)
mapfile -t shell_dirs < <(jq -r '.directories[]' shell-paths.json)
mapfile -t shell_files < <(jq -r '.files[]' shell-paths.json)
for name in "${reserved[@]}" "${products[@]}" "$port_locale"; do
  if [[ ! "$name" =~ ^[a-z][a-z0-9-]*$ ]]; then
    echo "::error::invalid ownership name '$name'" >&2
    exit 1
  fi
done
reserved+=(manifest)
shopt -s nullglob dotglob globstar
# Validate the entire artifact before the first AWS operation.
# Following links could publish files outside the validated subtree.
for entry in dist dist/**; do
  if [[ -L "$entry" ]]; then
    echo "::error::symlink in publication artifact: $entry" >&2
    exit 1
  fi
done
for path in "${shell_dirs[@]}" "${shell_files[@]}"; do
  if [[ ! "$path" =~ ^([a-z][a-z0-9-]*)/latest/([a-zA-Z0-9_][a-zA-Z0-9_.-]*)$ ]]; then
    echo "::error::invalid shell-owned path: $path" >&2
    exit 1
  fi
  port=${BASH_REMATCH[1]}
  child=${BASH_REMATCH[2]}
  known=false
  for candidate in "${reserved[@]}"; do
    [[ "$port" == "$candidate" ]] && known=true && break
  done
  if [[ "$known" == false || "$port" == manifest || "$child" == api ]]; then
    echo "::error::$path is outside shell-owned paths" >&2
    exit 1
  fi
done
if [[ "$locale" == "$port_locale" ]]; then
  for path in "${shell_dirs[@]}"; do
    [[ -d "dist/$path" ]] || { echo "::error::missing shell directory: $path" >&2; exit 1; }
  done
  for path in "${shell_files[@]}"; do
    [[ -f "dist/$path" ]] || { echo "::error::missing shell file: $path" >&2; exit 1; }
  done
  for port in "${reserved[@]}"; do
    [[ "$port" == manifest ]] && continue
    for path in index.html "${products[@]/%//index.html}"; do
      [[ -f "dist/$port/latest/$path" ]] || { echo "::error::missing version entry page: $port/latest/$path" >&2; exit 1; }
    done
  done
fi
dirs=()
reserved_index_dirs=()
version_files=()
for entry in dist/*; do
  [[ -d "$entry" ]] || continue
  name=${entry##*/}
  is_reserved=false
  for port in "${reserved[@]}"; do
    [[ "$name" == "$port" ]] && is_reserved=true && break
  done
  if [[ "$is_reserved" == false ]]; then
    dirs+=("$name")
    continue
  fi
  if [[ "$name" == manifest || ! -f "$entry/index.html" ]]; then
    echo "::error::$entry is not a shell-owned port landing tree" >&2
    exit 1
  fi
  for child in "$entry"/*; do
    [[ "$child" == "$entry/index.html" || "$child" == "$entry/index.md" ]] && continue
    if [[ "$child" != "$entry/latest" || ! -d "$child" ]]; then
      echo "::error::$child is outside shell-owned latest paths" >&2
      exit 1
    fi
    for shell_entry in "$child"/*; do
      path=${shell_entry#dist/}
      allowed=false
      if [[ -d "$shell_entry" ]]; then
        for candidate in "${shell_dirs[@]}"; do
          [[ "$path" == "$candidate" ]] && allowed=true && break
        done
        dirs+=("$path")
      elif [[ -f "$shell_entry" ]]; then
        for candidate in "${shell_files[@]}"; do
          [[ "$path" == "$candidate" ]] && allowed=true && break
        done
        version_files+=("$path")
      fi
      if [[ "$allowed" == false ]]; then
        echo "::error::$shell_entry is outside declared shell-owned paths" >&2
        exit 1
      fi
    done
  done
  reserved_index_dirs+=("$name")
done

# Each deleting sync owns one shell subtree, never a locale, port,
# or version root shared with a native documentation publisher.
for name in "${dirs[@]}"; do
  # Cached HTML can still reference assets from the previous build.
  sync_options=(--delete)
  [[ "${name##*/}" == _astro ]] && sync_options=()
  aws s3 sync "dist/$name/" "s3://$BUCKET/$locale/$name/" \
    "${sync_options[@]}" \
    --cache-control "public, max-age=0, s-maxage=300"
done
for name in "${reserved_index_dirs[@]}"; do
  aws s3 cp "dist/$name/index.html" "s3://$BUCKET/$locale/$name/index.html" \
    --cache-control "public, max-age=0, s-maxage=300"
  # The port home's Markdown twin, which its footer links.
  if [[ -f "dist/$name/index.md" ]]; then
    aws s3 cp "dist/$name/index.md" "s3://$BUCKET/$locale/$name/index.md" \
      --cache-control "public, max-age=0, s-maxage=300"
  fi
done
for path in "${version_files[@]}"; do
  aws s3 cp "dist/$path" "s3://$BUCKET/$locale/$path" \
    --cache-control "public, max-age=0, s-maxage=300"
done
for file in dist/*; do
  [[ -f "$file" ]] || continue
  aws s3 cp "$file" "s3://$BUCKET/$locale/${file##*/}" \
    --cache-control "public, max-age=0, s-maxage=300"
done
if [[ -f dist/robots.txt ]]; then
  aws s3 cp dist/robots.txt "s3://$BUCKET/robots.txt" \
    --cache-control "public, max-age=0, s-maxage=300"
fi

# Only the locale crosses into the next step now. The three lists
# that used to be written here fed the per-path invalidation and
# have no other reader.
printf '%s\n' "$locale" > "$RUNNER_TEMP/shell-locale.txt"
