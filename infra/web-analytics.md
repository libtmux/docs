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

This policy uses a separate manual registration for `libtmux.org`, while
the production zone registration retains automatic installation and EU
exclusion. Create the manual registration with
`cf rum site-info create --host libtmux.org --auto-install=false`, then
copy its public token into the policy JSON. Check a real beacon POST after
registration has propagated. In the preview rollout, the automatic zone
token returned 404 from the external collector; the manual registration
returned 204. A downloaded script alone does not verify collection.

Cloudflare's [collection FAQ](https://developers.cloudflare.com/web-analytics/faq/)
distinguishes the manual collector at `cloudflareinsights.com/cdn-cgi/rum`
from automatic collection at the site's own `/cdn-cgi/rum`. The owned
loader checks geographic permission before requesting the manual beacon.

The beacon carries Astro's handled-script marker so a late insertion during
a swap cannot enter the router's script wait. The isolated ClientRouter
probe checks this race and a negative control with the marker removed.
Cloudflare's [SPA measurement](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)
already tracks route changes; installing a fresh beacon on each
`astro:page-load` would duplicate that work.

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

After the loader is published and the location rule is verified, disable
automatic injection only in this preview. The second manifest uses a
[Configuration Rule](https://developers.cloudflare.com/rules/configuration-rules/settings/#disable-real-user-monitoring-rum),
which is available on Free plans. Dedicated Web Analytics path rules
require a paid plan.

Validate the injection ruleset:

```console
$ cf rulesets create \
    --zone deedd02022458587e848f38e9a246724 \
    --body @infra/web-analytics-injection-preview.json \
    --validate-only
```

Create it when the configuration phase has no existing entrypoint;
otherwise append its rule to the existing entrypoint:

```console
$ cf rulesets create \
    --zone deedd02022458587e848f38e9a246724 \
    --body @infra/web-analytics-injection-preview.json
```

Keep the site's `auto_install`, `enabled`, and `lite` settings intact.
Trunk retains its automatic injection and EU exclusion. Cloudflare's
[setup guide](https://developers.cloudflare.com/web-analytics/get-started/)
and [path rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/)
describe these controls. Removing the preview's configuration rule restores
automatic injection; the loader then skips the existing beacon.

Check US and EU locations with Cloudflare Trace. In Chromium, hold the
beacon response and separately hold the policy response: both
`DOMContentLoaded` and `load` must finish while required fonts, masks,
underlines, and effects still complete before reveal. Compare ordinary
cache loads separately from these intercepted causal checks.
