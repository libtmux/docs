# Native pane interface fixture

`artifact.json` replays unprepared Haddock output retained by
[the successful source CI run](https://github.com/libtmux/libtmux-haskell/actions/runs/44454581404)
at [the recorded source](https://github.com/libtmux/libtmux-haskell/commit/e1d02bab8d3fe0072d4eb4ce05c168bf65f6718f).
The compiled interface matches the separately retained prepared documentation.
Every required native source page matches the recorded source bytes.

The profile adds `LibTmux.Pane`, text capture, explicit window and split
creation, and receipt type synonyms. `CreatedEntities` keeps its constructor
hidden and exposes checked fields. `CreatedSession`, `CreatedWindow` and
`CreatedPane` retain their native aliases to that public type.

Use the checks artifact's original source pages for export. The prepared
documentation redirects ambiguous identifiers through a generated index;
those presentation anchors are not compiled source declarations.
