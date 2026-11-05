#!/usr/bin/env bash
# JSON files too large for CloudFront to compress, published gzip-encoded.
#
# CloudFront compresses an object only when it is between 1,000 and
# 10,000,000 bytes, so a bigger file leaves the origin whole on every fetch
# that reaches it, whatever the client accepts. The `targets.json` catalogs
# are such files. Stored gzipped with `Content-Encoding: gzip`, one shrinks to
# a few percent of its size. Cloudflare and every browser decode it, and
# Cloudflare decodes it for a client that sends no `Accept-Encoding`;
# CloudFront itself returns the stored gzip bytes to every client.
#
# Sourced by `publish-root.sh` and `reusable-deploy.yml`, the two places that
# write the documentation bucket. A caller keeps these files out of its own
# `aws s3 cp` and `aws s3 sync` with `large_json_excludes`, because a sync
# compares sizes, finds the stored gzip smaller than the local file, and
# uploads it again without the encoding. Then it publishes them once with
# `large_json_upload`. A file the build drops is not excluded, so
# `sync --delete` still removes its object.
#
# `.inv` files are left alone: Sphinx already compresses their bodies, so
# gzip saves them almost nothing.

# The largest size, in bytes, that CloudFront compresses itself.
LARGE_JSON_LIMIT=10000000

# The policy of every object under an `_astro` directory, whose names carry a
# content hash.
LARGE_JSON_IMMUTABLE="public, max-age=31536000, immutable"

# large_json_find DIR
# Set `large_json_paths` to each *.json file under DIR above the limit,
# relative to DIR, sorted. Names are read NUL-delimited, so any byte a name can
# hold survives, and a failing `find` fails the call instead of listing nothing.
large_json_find() {
  local dir=${1%/} listing path
  large_json_paths=()
  listing=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/large-json-list.XXXXXX")
  if ! find "$dir" -type f -name '*.json' -size +"${LARGE_JSON_LIMIT}c" -print0 > "$listing"; then
    rm -f "${listing:?}"
    return 1
  fi
  while IFS= read -r -d '' path; do
    large_json_paths+=("${path#"$dir"/}")
  done < <(sort -z "$listing")
  rm -f "${listing:?}"
}

# large_json_is_large FILE
# Succeed when FILE is a *.json file above the limit.
large_json_is_large() {
  [[ -n "$(find "$1" -maxdepth 0 -type f -name '*.json' -size +"${LARGE_JSON_LIMIT}c")" ]]
}

# large_json_pattern PATH
# Print PATH as an `--exclude` pattern that matches only itself: the CLI reads
# `*`, `?` and `[...]` as wildcards, so each of those characters becomes a
# one-character class.
large_json_pattern() {
  local path=$1 pattern='' char index
  for ((index = 0; index < ${#path}; index++)); do
    char=${path:index:1}
    case $char in
      '*' | '?' | '[' | ']') pattern+="[$char]" ;;
      *) pattern+=$char ;;
    esac
  done
  printf '%s' "$pattern"
}

# large_json_excludes DIR
# Set `large_json_args` to the `--exclude` arguments that keep DIR's large JSON
# files out of an `aws s3 cp --recursive` or `aws s3 sync` of DIR. Each names
# the file's exact path, since a pattern is read relative to the source
# directory.
large_json_excludes() {
  local path
  large_json_find "$1"
  large_json_args=()
  for path in "${large_json_paths[@]}"; do
    large_json_args+=(--exclude "$(large_json_pattern "$path")")
  done
}

# large_json_upload DIR S3_PREFIX CACHE_CONTROL
# Gzip each large JSON file under DIR and upload it to S3_PREFIX/<path> under
# CACHE_CONTROL, or under the immutable policy when the path is inside an
# `_astro` directory, as the copy that left it out would have. `-n` keeps the
# name and time out of the header, so the same file always makes the same bytes.
large_json_upload() {
  local dir=${1%/} prefix=${2%/} cache_control=$3 path scratch policy
  large_json_find "$dir"
  ((${#large_json_paths[@]})) || return 0
  scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/large-json.XXXXXX")
  for path in "${large_json_paths[@]}"; do
    policy=$cache_control
    [[ "/$path" == */_astro/* ]] && policy=$LARGE_JSON_IMMUTABLE
    gzip -9 -n -c "$dir/$path" > "$scratch/object.json"
    aws s3 cp "$scratch/object.json" "$prefix/$path" \
      --content-encoding gzip \
      --content-type application/json \
      --cache-control "$policy"
    rm -f "${scratch:?}/object.json"
  done
  rmdir "$scratch"
}

# large_json_decode DIR REMOTE
# Replace each file under REMOTE that holds the gzip copy of a large JSON file
# under DIR with its decoded bytes. `aws s3 sync` downloads a gzip-encoded
# object as stored, so a comparison with the build would otherwise find every
# one of them different. A copy that is not gzip, from before they were stored
# that way, is left as it is.
large_json_decode() {
  local dir=${1%/} remote=${2%/} path
  large_json_find "$dir"
  for path in "${large_json_paths[@]}"; do
    [[ -f "$remote/$path" ]] || continue
    if gzip -dc "$remote/$path" > "$remote/$path.decoded" 2> /dev/null; then
      mv "$remote/$path.decoded" "$remote/$path"
    else
      rm -f "${remote:?}/$path.decoded"
    fi
  done
}
