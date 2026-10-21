# Expediting a preview

A same-repository pull request that carries the `ci:expedite` label publishes
its preview as soon as the build and the publisher dry-run pass. The audits
still run in full, and `test` still fails if any of them fails. The label
stops the preview from waiting; it does not skip, relax or reorder a check.

## How it is read

The `expedite` job in [test.yml](workflows/test.yml) reads the pull request's
labels through the API when the dry-run passes. A label applied at any time
before then counts. A label applied later does not, and removing it before then
cancels the expedite. The workflow has no `labeled` trigger, so applying or
removing a label never starts a run and never cancels one in progress.

The label stays on the pull request, so every later push is expedited too until
the label is removed. Fork pull requests never publish, so the label has no
effect on them. If the API read fails, the preview publishes after the audits.

## What the label risks

An expedited preview can show a change that an audit then rejects, and it can
be live before the output audits have checked that its pages carry
`noindex, nofollow`. The repository is public, so anyone who can read the pull
request can find the preview URL. Do not expedite a change whose preview
should not be seen before the audits pass.

Do not merge on a red `test`. If a pull request merged while `test` was still
running and it turns red, fix forward in a new pull request: `deploy-shell`
publishes production without waiting for `test`, and nothing reverts the merge.

Do not expedite a pull request that changes what the port repositories pin by
docs SHA: `reusable-deploy.yml`, `port-docs.yml`, `publish.yml` and the scripts
they run. A pin that proves wrong is fixed in every caller, not forward in
this repository. The workflow does not enforce this.

## Who applies it

Anyone with triage access can apply a label, and the author of a same-repository
pull request usually has write access. The workflow does not check who applied
it. Create the label once with
`gh label create ci:expedite --description "Publish the preview before the audits finish"`.
