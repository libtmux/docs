# Optional Web Analytics

The shared head starts Cloudflare's beacon after the browser's `load`
event. It first fetches `_shell/web-analytics.json` without using the
browser cache. A successful response must have `x-libtmux-analytics: allow`
before the beacon is installed. Missing permission, request failure, or
invalid configuration leaves analytics disabled. Neither request belongs
to the required appearance gate.

The token in that JSON is the public installation token, not an API
credential. The loader skips an already injected beacon and initializes
once per browser document, including Astro navigation.

## Preview configuration

[web-analytics-preview.json](web-analytics-preview.json) limits the edge
permission to policy resources under `/pr-142/`. Its country exclusions
follow Cloudflare's [EU geolocation list](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ip.src.is_in_european_union/),
including overseas territories. Unknown and Tor locations are also
excluded. This uses `ip.src.country`, which does not require the paid-plan
EU field. Cloudflare evaluates [response transforms](https://developers.cloudflare.com/rules/transform/response-header-modification/)
for each visitor after its cache lookup; the policy body is the same for
every location.

Validate the new ruleset before creating it:

```console
$ cf rulesets create \
    --zone deedd02022458587e848f38e9a246724 \
    --body @infra/web-analytics-preview.json \
    --validate-only
```

Create it only when the response-header phase has no existing entrypoint.
For an existing entrypoint, append this rule instead of replacing its
other rules.

```console
$ cf rulesets create \
    --zone deedd02022458587e848f38e9a246724 \
    --body @infra/web-analytics-preview.json
```

After the loader is published and the location rule is verified, exclude
only this preview from automatic injection:

```console
$ cf rum rules create \
    --host libtmux.org \
    --paths '/pr-142/*' \
    --inclusive=false \
    --is-paused=false \
    146150de-c7c9-48e4-86ba-057a7e655b4d
```

Keep the site's `auto_install`, `enabled`, and `lite` settings intact.
Trunk retains its automatic injection and EU exclusion. Cloudflare's
[setup guide](https://developers.cloudflare.com/web-analytics/get-started/)
and [path rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/)
describe these controls. Removing the preview's exclusion rule restores
automatic injection; the loader then skips the existing beacon.

Check US and EU locations with Cloudflare Trace. In Chromium, hold the
beacon response and separately hold the policy response: both
`DOMContentLoaded` and `load` must finish while required fonts, masks,
underlines, and effects still complete before reveal. Compare ordinary
cache loads separately from these intercepted causal checks.
