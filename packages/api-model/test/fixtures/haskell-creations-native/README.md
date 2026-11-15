# Native session creation interface fixture

These Haddock pages and installed interface describe
[the recorded Haskell source](https://github.com/libtmux/libtmux-haskell/commit/4bc620669cf31c1a7bb3a589d94d0b75cc5b3a49).
Each consumed source page matches the committed bytes. `provenance.json`
records public modules, defining origins and source hashes.
The committed [producer](https://github.com/libtmux/docs/commit/7f5c4e2501d768ffa42730dd645df723378ebf62)
and its native input hashes are recorded separately from the library revision.

The creation profile adds options, process modes, historical target references
and an opaque recovery owner. Public fields on the constructor-hidden
`CreatedSession` retain their native anchors. The exporter checks each field's
record owner and type against GHC annotations in the source browser, then
uses its checked source line. An authored type description cannot override
those annotations. Shared field labels may have more than one public owner;
the compiler's preferred destination must be one of those actual owners.

Earlier scalar, observation, query and mutation fixtures stay separate.
No private module becomes a public reference page.
