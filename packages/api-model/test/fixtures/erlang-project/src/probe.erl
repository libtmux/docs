-module(probe).
-moduledoc """
Captured values with `m:probe` and `read/1` references.

```erlang
1> probe:double(2).
4
```
""".
-export([double/1, hidden/0, read/1, handle/0, links/1, wide/2]).
-export_type([handle/0, id/0, row/0, included_id/0, 'odd-name'/1, 'λ-handle'/1, 'a::b'/0]).
-export_type([box/0, box/1, container/3, '🧭'/0]).
-export_type([unresolved/0]).
-include("public_types.hrl").
-include_lib("kernel/include/file.hrl").
-export_record([row]).

-record #row{id :: id()}.
-doc "A nominal identifier.".
-nominal id() :: binary().
-doc "An opaque handle; its representation stays private.".
-opaque handle() :: #{private_token := reference()}.
-doc "A handle with a quoted type name.".
-opaque 'odd-name'(T) :: {private_token, T}.
-doc "A handle with a Unicode name.".
-opaque 'λ-handle'(T) :: {private_token, T}.
-doc "A quoted opaque type whose name includes a delimiter.".
-opaque 'a::b'() :: private_token.
-doc "A supporting output mode.".
-type internal_mode() :: ready | stopped.
-doc "One public row.".
-type row() :: #row{}.
-type box() :: atom().
-type box(T) :: [T].
-type container(A, B, C) :: {A, B, C}.
-type '🧭'() :: integer().
-type unresolved() :: file:no_such_type().

-doc "Prepare one row.".
-callback prepare(row()) -> {ok, handle()}.

-doc "Double an integer or float.".
-doc #{since => "0.1.0", deprecated => "Use a calculator."}.
-spec double(integer()) -> integer(); (float()) -> float().
double(Number) -> Number * 2.

-doc "Read one `t:handle/0`; see `c:prepare/1`.".
-spec read(handle()) -> {ok, internal_mode()}.
read(_Handle) -> {ok, ready}.

-doc "Construct a handle; the type and function share a name.".
-spec handle() -> handle().
handle() -> #{private_token => make_ref()}.

-doc "Compiler references distinguish arities, native records and literal names.".
-spec links(probe:container(fun((box(), #probe:row{}) -> box()),
                            #{key := 'a,b'}, '🧭'())) ->
    {'literal:box()', '🧭', '__libtmux_record_0_probe:row',
     <<_:8>>, 'a::b'(), box(term()), file:filename_all()}.
links(_Input) -> error(not_called).

-doc "Keep native typespec punctuation within the API column limit.".
-spec wide(probe:container(term(), term(), term()), box()) -> box().
wide(_Input, Value) -> Value.

-doc false.
hidden() -> secret.
