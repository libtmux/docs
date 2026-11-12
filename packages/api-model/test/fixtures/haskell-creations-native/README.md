# Native session creation interface fixture

These Haddock pages and installed interface describe
[the recorded Haskell source](https://github.com/libtmux/libtmux-haskell/commit/bcd17ddf57ee290bd2bcf385538c028a4306bf29).
Each consumed source page matches the committed bytes. `provenance.json`
records public modules, defining origins and source hashes.

The creation profile adds options, process modes, historical target references
and an opaque recovery owner. Public fields on the constructor-hidden
`CreatedSession` retain their native anchors. The exporter checks each field's
record owner and type against GHC annotations in the source browser, then
uses its checked source line. An authored type description cannot override
those annotations. Shared field labels may have more than one public owner;
the compiler's preferred destination must be one of those actual owners.

Earlier scalar, observation, query and mutation fixtures stay separate.
No private module becomes a public reference page.
