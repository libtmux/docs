# Native control and recovery interface fixture

This qualified export describes [Haskell source 08d61c7](https://github.com/libtmux/libtmux-haskell/commit/08d61c781f794e689112442270a76f7dd4acedbd).
It was replayed from the original Haddock HTML and compiled interface in the
[exact green source workflow](https://github.com/libtmux/libtmux-haskell/actions/runs/44479171697).
Both artifact digests and all 38 required source pages were checked against
committed bytes before extraction. The provenance records the separately
committed docs producer.

The control profile preserves STM event reads, typed terminal outcomes,
opaque client ownership and the public Recovery module. Recovery's selected
Program cleanup exports retain their compiled canonical Program owner;
they add references rather than duplicate declaration rows. All earlier
profiles and their fixtures remain separate.
