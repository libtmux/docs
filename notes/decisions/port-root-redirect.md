# Decision: `/<port>/` keeps its landing page; the deploy denylist gets a hole

Closes the open item in `notes/status.md`, "`/py/` should redirect", and the
`KNOWN OPEN QUESTION` comment on `publish-root` in
`.github/workflows/deploy-shell.yml` (`00-DECISIONS.md` §7.10 item 5).

## The collision

`site/src/pages/[port]/index.astro` renders once per port at the site root
build, so a plain `pnpm build` in `site/` emits `dist/py/index.html`,
`dist/ts/index.html`, and six more — one per `ports.ts` slug. Every one of
those eight names is also a reserved top-level S3 prefix, because each port
deploys its own version tree there from its own repository (`docs/ci.md`,
`notes/research/07-ci-topology.md`). `deploy-shell.yml`'s `publish-root` job
denylists all eight for exactly that reason, and today it denylists them
completely: any reserved name present under `dist/` fails the run outright,
so **every** push to `main` fails at the sync step, not just a hypothetical
one.

Two ways to stop the collision:

- **A. Move the landing page.** Stop building it at `/<port>/`, or stop
  emitting its output under the shell's own `dist/` root.
- **B. Keep the landing page where it is.** Teach `publish-root` to write the
  one file the shell legitimately owns under each reserved prefix, without
  touching the version tree the port's own workflow owns there.

## Decision: B

The landing page is not dead weight sitting on a prefix it doesn't need —
it's the only content ever served at `/<port>/` for five of the eight ports,
permanently, by design:

- **rs, go, java** are `referenceMode: 'ecosystem'`. `ports.ts`'s
  `portHomeUrl()` sends them to `/<port>/` and nowhere else — "Ecosystem
  ports have no local version prefix — `/rs/latest/` has never existed". That
  comment is not aspirational; `notes/status.md` records fixing exactly this
  bug already ("Port switcher emitted a local version prefix for ecosystem
  ports, which have no local tree ... `portHomeUrl()` sends ecosystem ports
  to their landing page").
- **dotnet, swift** are self-hosted but `referencePublished: false` today.
  `hasReference()` is false for them, so `referenceUrl()` also resolves to
  `/<port>/` — the landing page is what renders "Not published yet" instead
  of a 404 (another `notes/status.md` fix: "Ports carry `referencePublished`;
  the UI says 'Reference not published yet'").

Only **py, ts, cxx** have both a published local version tree and a
CloudFront-level bare-root redirect (`infra/cloudfront-function.js` rule 1:
`/py` or `/py/` with no further path segment does a KVS lookup on
`<slug>:default` and 302s to `/py/stable/` before the request ever reaches
the origin). For those three, `dist/py/index.html` is legitimately
unreachable in production — but that's a property of the *reader's* path
through CloudFront, not a reason to stop the shell from building or
publishing it:

- If the KVS lookup ever fails — the store unreachable, or a key not yet
  written for a port that just flipped `referencePublished` — the function's
  own `catch` falls through to the ordinary directory-index rule and serves
  whatever `index.html` sits at that prefix. Removing the landing page turns
  that fallback into a 403 (remapped to `/404.html`) instead of a page that
  explains the port.
- Moving the landing page to a URL that doesn't collide with `/<port>/`
  means every link that currently reads `/<port>/` — nav, `PortSwitcher`,
  `parity.astro`, this port's own README, any external link anyone has
  already made — has to change too, and `portHomeUrl()`'s contract
  ("Where the port switcher should send someone") stops being true for the
  ports it exists to serve. That's a URL-scheme change to fix a deploy-script
  bug, disproportionate for what's the smaller of the two fixes.

The infrastructure was already built for B and the workflow just hasn't
caught up. `notes/research/07-ci-topology.md`'s IAM policy grants the shell
role `s3:PutObject` on `arn:aws:s3:::libtmux-docs/*` — the whole bucket — and
only *denies* `s3:DeleteObject` on the eight language prefixes
(`ShellDeleteExceptLanguagePrefixes`'s `NotResource`). Nothing in IAM stops
the shell from writing a single object into `py/`; the workflow's denylist
is stricter than the policy that's supposed to back it up, and stricter than
it needs to be. And each `dist/<slug>/` directory the shell build actually
emits holds exactly one file — verified by building: `pnpm build` in `site/`
with `LIBTMUX_DOCS_BASE=/` puts every shared asset under one root-level
`_astro/`, never under `dist/<slug>/_astro/`, so there is no directory of
assets to reconcile, only the one HTML file.

Per-port deploys can't collide with that file even by accident:
`reusable-deploy.yml` validates `path-prefix` is never bare (`"$p" == "$r"`
is rejected with "qualify it, e.g. '$r/stable'"), so a port's own `sync
--delete` always runs scoped to `<slug>/<version>/`, never `<slug>/`. The
shell's `<slug>/index.html` and a port's `<slug>/stable/` tree are disjoint
keys; putting one can never race or clobber the other.

### A correction this decision surfaces

`cloudfront-function.js`'s own self-check table has a stale row:

```
| `/rs`  | 1 (KVS)  | 302 -> `/rs/stable/` — ecosystem ports still carry
                       a guides prefix even though their API reference is
                       external (ports.ts referenceUrl) |
```

That's the *pre-fix* behavior `notes/status.md` describes and reverses.
Under current `ports.ts`, `rs`/`go`/`java` must never get a `<slug>:default`
KVS entry — there's no version prefix to point it at — so `/rs` and `/rs/`
fall through to the ordinary rules exactly like the table's own `/ja` row
(KVS misses, rule 2/3 handles it). This decision depends on that reading
(sections above list rs/go/java among the ports the landing page serves
permanently); the stale row itself is `cloudfront-function.js`'s to fix, not
this assignment's file, but it should not survive uncorrected — it documents
behavior that would 404 every ecosystem port's landing page if implemented
as written.

## Implementation

`deploy-shell.yml`'s `publish-root` job (not in this assignment's file list,
but B has no other implementation surface):

- Split `dist/*` into plain directories (unreserved names: `concepts`,
  `examples`, `guides`, `parity`, `search`, `third-party-notices`, ...),
  synced exactly as before, and reserved-prefix directories (the eight port
  slugs).
- For each reserved directory actually present in `dist/`: assert its only
  entry is `index.html` — anything else fails the run loudly, preserving the
  "a bug here should fail closed" property the original denylist had — then
  `aws s3 cp` (never `sync --delete`) that one file to
  `s3://$BUCKET/<slug>/index.html`.
- Invalidate exactly `/<slug>/` for each one synced this way — the precise
  object CloudFront's directory-index rule rewrites to, never `/<slug>/*`,
  which would invalidate cache entries for a port's own version tree that
  this job has no business touching.
- `manifest` and `_shell` stay denylisted outright — this decision gives
  neither an exception. `manifest` genuinely has no shell output today.
  `_shell` does: `site/public/_shell/` (a separate assignment's work) now
  makes the build emit `dist/_shell/{shell.js,tokens.css,README.md}`,
  unversioned, which will make `publish-root` fail on `_shell` the same way
  it used to fail on every port slug — but `_shell/v*/**` is the shell's
  *own* prefix per `notes/research/07-ci-topology.md`'s ownership table, an
  unversioned shape there contradicts that table, and neither of those is
  this assignment's question to resolve. Recorded here as a known residual
  failure, not silently left for the next person to rediscover.

## Rejected: change `ports.ts` or the URL scheme instead

Considered and rejected: adding a `landingPath` concept so ecosystem/
unpublished ports render at some non-reserved URL and only published
self-hosted ports keep `/<port>/` for the CloudFront redirect. Rejected
because it's a bigger surface for a smaller problem — every reader-facing
link in the shell already assumes `portHomeUrl()` returns `/<port>/`, none
of that is wrong today, and the actual bug is entirely contained in one
workflow's overly broad denylist.
