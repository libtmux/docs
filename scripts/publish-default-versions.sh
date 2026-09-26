#!/usr/bin/env bash
#
# Write each port's `<slug>:default` row to the CloudFront KeyValueStore that
# the edge function's bare-port-root rule reads (infra/README.md, "The
# bare-language-root redirect and its KeyValueStore").
#
# A file rather than a `run:` block so `site/test/publish-default-versions.test.ts`
# drives the text the deploy runs. Reads KVS_ARN, plus `dist/versions.json`
# (already merged with every port's published fragment) and
# `reserved-prefixes.txt` from the working directory.
#
# An unset KVS_ARN skips with a warning, so the secret and the Terraform grant
# can land in either order. Once it is set, any failure fails the step: an
# empty store degrades every port root silently, which is how this went
# unnoticed before.

set -euo pipefail
kvs_arn="${KVS_ARN:-}"
if [[ -z "$kvs_arn" ]]; then
  echo '::warning::KVS_ARN is not set; port roots keep their current redirect rows' >&2
  exit 0
fi

manifest=dist/versions.json
if [[ ! -s reserved-prefixes.txt ]]; then
  echo "::error::reserved-prefixes.txt is missing or empty" >&2
  exit 1
fi
if ! jq -e '.schema == 1 and (.defaultVersion | type == "object")' "$manifest" > /dev/null; then
  echo "::error::$manifest is not a version manifest" >&2
  exit 1
fi

# `latest` is the fallback: every port publishes one, `stable` only after a
# release.
declare -A desired
while IFS= read -r slug; do
  [[ -z "$slug" ]] && continue
  desired["$slug:default"]=$(jq -r --arg slug "$slug" '.defaultVersion[$slug] // "latest"' "$manifest")
done < reserved-prefixes.txt

etag=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$kvs_arn" --output json | jq -r '.ETag // empty')
if [[ -z "$etag" ]]; then
  echo "::error::describe-key-value-store returned no ETag for $kvs_arn" >&2
  exit 1
fi

# The CLI follows NextToken itself, so this is the whole store. An assignment,
# not process substitution, so a failed read stops the script.
rows=$(aws cloudfront-keyvaluestore list-keys --kvs-arn "$kvs_arn" --output json | jq -r '.Items[]? | [.Key, .Value] | @tsv')
declare -A current
while IFS=$'\t' read -r key value; do
  [[ -z "$key" ]] && continue
  current["$key"]=$value
done <<< "$rows"

puts=()
for key in $(printf '%s\n' "${!desired[@]}" | sort); do
  value=${desired[$key]}
  if [[ "${current[$key]-}" != "$value" ]]; then
    puts+=("Key=$key,Value=$value")
  fi
done

if [[ ${#puts[@]} -eq 0 ]]; then
  echo 'publish-default-versions: every row already matches' >&2
  exit 0
fi

# A concurrent deploy changes the ETag, so this fails rather than overwrites.
aws cloudfront-keyvaluestore update-keys \
  --kvs-arn "$kvs_arn" \
  --if-match "$etag" \
  --puts "${puts[@]}"
echo "publish-default-versions: wrote ${puts[*]}" >&2
