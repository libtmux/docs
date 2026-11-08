#!/usr/bin/env escript
-mode(compile).
-include_lib("kernel/include/eep48.hrl").

%% Build in the source checkout's toolchain; read compiler chunks, never source regexes.
main([Root0, AppName, Output0]) ->
    Output = filename:absname(Output0),
    try
        ExporterDigest = exporter_digest(),
        "29" = erlang:system_info(otp_release),
        Root = filename:absname(Root0),
        ok = file:set_cwd(Root),
        Revision = trim(run("git", ["rev-parse", "HEAD"])),
        clean(),
        Files = inputs(),
        Repository = repository(trim(run("git", ["remote", "get-url", "origin"]))),
        _ = run("rebar3", ["compile"]),
        Ebin = filename:join(["_build", "default", "lib", AppName, "ebin"]),
        AppFile = filename:join(Ebin, AppName ++ ".app"),
        {ok, [{application, App, Properties}]} = file:consult(AppFile),
        true = atom_to_list(App) =:= AppName,
        Modules = lists:sort(proplists:get_value(modules, Properties)),
        Public = [M || Name <- Modules,
            M <- [module(Name, Ebin, Files, Modules)], M =/= hidden],
        require(Public =/= [], "application documents no public modules"),
        clean(),
        require(Files =:= inputs(), "source inputs changed while compiling"),
        require(Revision =:= trim(run("git", ["rev-parse", "HEAD"])),
            "source revision changed while compiling"),
        Artifact = #{schema => 1, port => <<"erlang">>,
            source => #{repository => Repository, revision => Revision, files => Files},
            exporter => #{name => <<"Erlang EEP-48 and abstract code">>, version => 3,
                otp => otp_version(), columns => 60,
                source_sha256 => ExporterDigest},
            package => #{name => bin(AppName), version => bin(proplists:get_value(vsn, Properties))},
            modules => Public},
        ok = filelib:ensure_dir(Output),
        ok = file:write_file(Output, [json:encode(Artifact), $\n])
    catch
        throw:{export_error, Message} ->
            io:format(standard_error, "Erlang export: ~ts~n", [Message]), halt(1);
        error:Reason ->
            io:format(standard_error, "Erlang export failed: ~p~n", [Reason]), halt(1)
    end;
main(_) ->
    io:format(standard_error, "usage: export-erlang.escript SOURCE_ROOT APP OUTPUT.json~n", []),
    halt(1).

module(Name, Ebin, Files, ProjectModules) ->
    Beam = filename:join(Ebin, atom_to_list(Name) ++ ".beam"),
    case beam_lib:chunks(Beam, [abstract_code, "Docs"]) of
        {ok, {Name, [{abstract_code, {raw_abstract_v1, Forms}}, {"Docs", DocsBin}]}} ->
            case binary_to_term(DocsBin) of
                #docs_v1{beam_language = erlang, format = <<"text/markdown">>,
                        module_doc = hidden} -> hidden;
                #docs_v1{beam_language = erlang, format = <<"text/markdown">>,
                        module_doc = Doc, metadata = Meta, docs = Entries} ->
                    File = source_file(atom_to_list(Name) ++ ".erl", Files),
                    Located = located_forms(Forms),
                    Exports = lists:append([Fs || {attribute, _, export, Fs} <- Forms]),
                    Types = lists:append([Ts || {attribute, _, export_type, Ts} <- Forms]),
                    Records = lists:append([Rs || {attribute, _, export_record, Rs} <- Forms]),
                    Scope = #{owner => Name, modules => ProjectModules, files => Files,
                              otp_types => otp_types(Forms, ProjectModules)},
                    Members = [member(E, Located, Types, Scope) || E <- lists:sort(Entries),
                        public(E, Exports)],
                    #{name => bin(Name), display_name => atom_text(Name), doc => documentation(Doc),
                        source => location(File, maps:get(source_anno, Meta, 1)),
                        members => Members,
                        records => [#{name => bin(R), display_name => atom_text(R), declaration => pretty(F),
                            references => form_references(pretty(F), Scope),
                            source => location(source_file(RecordFile, Files), Anno)} ||
                            {RecordFile, F = {attribute, Anno, native_record, {R, _}}} <- Located,
                            lists:member(R, Records)]};
                _ -> fail([bin(Name), <<": unsupported compiler documentation format">>])
            end;
        _ -> fail([bin(Name), <<": cannot read compiler chunks (EEP-48 and abstract code required)">>])
    end.

public({{Kind, Name, Arity}, _, _, Doc, _}, Exports) ->
    Doc =/= hidden andalso case Kind of
        function -> lists:member({Name, Arity}, Exports);
        type -> true;
        callback -> true
    end.

member({{Kind, Name, Arity}, _, Signatures, Doc, Meta}, Located, Types, Scope) ->
    Declarations = [{File, F} || {File, F} <- Located, declaration(F, Kind, Name, Arity)],
    require(Declarations =/= [], [bin(Name), <<": missing compiler declaration">>]),
    Visibility = case [K || {_, {attribute, _, K, _}} <- Declarations] of
        [opaque] -> opaque;
        [nominal] -> nominal;
        _ -> public
    end,
    #{kind => Kind, name => bin(Name), display_name => atom_text(Name), arity => Arity,
        signatures => Signatures, doc => documentation(Doc),
        specs => callable_specs(Kind, Name, Arity, Located, Declarations, Scope),
        since => metadata(since, Meta), deprecated => metadata(deprecated, Meta),
        visibility => Visibility,
        exported => Kind =/= type orelse lists:member({Name, Arity}, Types),
        source => member_location(Kind, Name, Arity, Located, Declarations, maps:get(files, Scope)),
        declarations => [declaration_text(F) || {_, F} <- Declarations],
        declaration_references => [declaration_references(F, Scope) || {_, F} <- Declarations]}.

callable_specs(type, _, _, _, _, _) -> [];
callable_specs(Kind, Name, Arity, Located, Declarations, Scope) ->
    Patterns = case [Args || {_, {function, _, N, A, [{clause, _, Args, _, _} | _]}} <- Located,
                            N =:= Name, A =:= Arity] of
        [Args] -> Args;
        [] -> lists:duplicate(Arity, none)
    end,
    Attribute = case Kind of function -> spec; callback -> callback end,
    [spec_clause(Clause, Patterns, Attribute, Anno, Name, Arity, Scope)
     || {_, {attribute, Anno, AttributeName, {{Name1, Arity1}, Clauses}}} <- Declarations,
        AttributeName =:= Attribute, Name1 =:= Name, Arity1 =:= Arity, Clause <- Clauses].

spec_clause(Clause, Patterns, Attribute, Anno, Name, Arity, Scope) ->
    Fun = case Clause of
        {type, _, bounded_fun, [Function, _]} -> Function;
        _ -> Clause
    end,
    {type, _, 'fun', [{type, _, product, Parameters}, Return]} = Fun,
    require(length(Parameters) =:= Arity, "compiler typespec arity mismatch"),
    Text = pretty({attribute, Anno, Attribute, {{Name, Arity}, [Clause]}}),
    ReturnText = type_text(Return),
    #{parameters => [parameter(Type, Pattern, Index, Scope)
        || {Type, Pattern, Index} <- lists:zip3(Parameters, Patterns, lists:seq(1, Arity))],
      returns => ReturnText, returns_references => type_references(ReturnText, Scope),
      text => Text, references => form_references(Text, Scope)}.

parameter({ann_type, _, [{var, _, Name}, Type]}, _, _, Scope) ->
    typed_parameter(bin(Name), Type, Scope);
parameter(Type, Pattern, Index, Scope) ->
    Name = case Pattern of
        {var, _, Variable} when Variable =/= '_' -> bin(Variable);
        {match, _, {var, _, Variable}, _} when Variable =/= '_' -> bin(Variable);
        {match, _, _, {var, _, Variable}} when Variable =/= '_' -> bin(Variable);
        _ -> <<"Argument", (integer_to_binary(Index))/binary>>
    end,
    typed_parameter(Name, Type, Scope).

typed_parameter(Name, Type, Scope) ->
    Text = type_text(Type),
    #{name => Name, type => Text, references => type_references(Text, Scope)}.

declaration_references({attribute, _, opaque, _}, _) -> [];
declaration_references({function, _, _, _, _}, _) -> [];
declaration_references(Form, Scope) -> form_references(pretty(Form), Scope).

type_references(Text, Scope) ->
    Prefix = <<"-type reference() :: ">>,
    Offset = utf16_length(Prefix),
    [R#{start := maps:get(start, R) - Offset, 'end' := maps:get('end', R) - Offset}
     || R <- form_references(<<Prefix/binary, Text/binary, ".">>, Scope)].

%% Rescan the compiler's own spelling. Parser annotations distinguish types
%% from declaration names, variables and literal lookalikes without a lexer
%% maintained in another language. Browser offsets count UTF-16 code units.
form_references(Text, Scope) ->
    Characters = unicode:characters_to_list(Text),
    {ok, Tokens, _} = erl_scan:string(Characters, {1, 1}, [text]),
    {ok, Form} = erl_parse:parse_form(Tokens),
    Positions = positions(Characters, 1, 1, 0, #{}),
    References = references(Form, Scope, Positions),
    lists:sort(fun(A, B) -> maps:get(start, A) < maps:get(start, B) end, References).

references({user_type, Anno, Name, Arguments}, Scope, Positions) ->
    [reference(Anno, Anno, maps:get(owner, Scope), Name, length(Arguments), Scope, Positions)
     | references(Arguments, Scope, Positions)];
references({remote_type, _, [{atom, First, Module}, {atom, Last, Name}, Arguments]}, Scope, Positions) ->
    [reference(First, Last, Module, Name, length(Arguments), Scope, Positions)
     | references(Arguments, Scope, Positions)];
references({type, First, record, [{tuple, _, [{atom, _, Module}, {atom, Last, Name}]} | Fields]}, Scope, Positions) ->
    [record_reference(First, Last, Module, Name, Positions) | references(Fields, Scope, Positions)];
references({type, First, record, [{atom, Last, Name} | Fields]}, Scope, Positions) ->
    [record_reference(First, Last, maps:get(owner, Scope), Name, Positions)
     | references(Fields, Scope, Positions)];
references({type, Anno, Name, Arguments}, Scope, Positions) ->
    Arity = case Arguments of any -> 0; _ when is_list(Arguments) -> length(Arguments) end,
    Explicit = erl_anno:text(Anno) =:= unicode:characters_to_list(atom_text(Name)),
    Head = case Explicit andalso erl_internal:is_type(Name, Arity) of
        true -> [reference(Anno, Anno, erlang, Name, Arity, Scope, Positions)];
        false -> []
    end,
    Head ++ references(Arguments, Scope, Positions);
references(Tuple, Scope, Positions) when is_tuple(Tuple) ->
    references(tuple_to_list(Tuple), Scope, Positions);
references(List, Scope, Positions) when is_list(List) ->
    lists:append([references(Item, Scope, Positions) || Item <- List]);
references(_, _, _) -> [].

reference(First, Last, Module, Name, Arity, Scope, Positions) ->
    Target = <<"t:", (atom_text(Module))/binary, ":", (atom_text(Name))/binary,
               "/", (integer_to_binary(Arity))/binary>>,
    Range = reference_range(First, Last, Target, Positions),
    case lists:member(Module, maps:get(modules, Scope)) of
        true -> Range;
        false ->
            case documented_otp_type(Module, Name, Arity, Scope) of
                none -> Range;
                Application ->
                    Href = iolist_to_binary([<<"https://www.erlang.org/doc/apps/">>,
                        Application, <<"/">>, uri_string:quote(bin(Module)), <<".html#t:">>,
                        uri_string:quote(atom_text(Name)), <<"/">>, integer_to_binary(Arity)]),
                    Range#{external => #{href => Href, project => <<"Erlang/OTP">>}}
            end
    end.

otp_types(Forms, ProjectModules) ->
    Modules = lists:usort(remote_modules(Forms)),
    maps:from_list([{Module, {otp_application(Module), documented_types(Module)}}
        || Module <- Modules, not lists:member(Module, ProjectModules),
           otp_application(Module) =/= none]).

documented_types(Module) ->
    case code:get_doc(Module) of
        {ok, #docs_v1{module_doc = Doc, docs = Entries}} when Doc =/= hidden ->
            sets:from_list([{Name, Arity} || {{type, Name, Arity}, _, _, TypeDoc, _} <- Entries,
                                            TypeDoc =/= hidden]);
        _ -> sets:new()
    end.

documented_otp_type(erlang, Name, Arity, Scope) ->
    case erl_internal:is_type(Name, Arity) of
        true -> <<"erts">>;
        false -> lookup_otp_type(erlang, Name, Arity, Scope)
    end;
documented_otp_type(Module, Name, Arity, Scope) -> lookup_otp_type(Module, Name, Arity, Scope).

lookup_otp_type(Module, Name, Arity, Scope) ->
    case maps:find(Module, maps:get(otp_types, Scope)) of
        {ok, {Application, Types}} ->
            case sets:is_element({Name, Arity}, Types) of true -> Application; false -> none end;
        error -> none
    end.

remote_modules({remote_type, _, [{atom, _, Module}, _, Arguments]}) ->
    [Module | remote_modules(Arguments)];
remote_modules(Tuple) when is_tuple(Tuple) -> remote_modules(tuple_to_list(Tuple));
remote_modules(List) when is_list(List) -> lists:append([remote_modules(Item) || Item <- List]);
remote_modules(_) -> [].

record_reference(First, Last, Module, Name, Positions) ->
    Target = <<"#", (atom_text(Module))/binary, ":", (atom_text(Name))/binary, "{}">>,
    reference_range(First, Last, Target, Positions).

reference_range(First, Last, Target, Positions) ->
    #{start => maps:get(erl_anno:location(First), Positions),
      'end' => maps:get(erl_anno:location(Last), Positions) + utf16_length(erl_anno:text(Last)),
      target => Target}.

otp_application(erlang) -> <<"erts">>;
otp_application(Module) ->
    case code:which(Module) of
        Beam when is_list(Beam) ->
            Library = filename:split(code:lib_dir()),
            Parts = filename:split(Beam),
            case lists:prefix(Library, Parts) of
                true ->
                    [Application, "ebin", _] = lists:nthtail(length(Library), Parts),
                    [Name | _] = string:split(Application, "-"),
                    bin(Name);
                false -> none
            end;
        _ -> none
    end.

positions([], Line, Column, Offset, Acc) -> Acc#{{Line, Column} => Offset};
positions([Character | Rest], Line, Column, Offset, Acc) ->
    Next = Acc#{{Line, Column} => Offset},
    Units = case Character > 16#ffff of true -> 2; false -> 1 end,
    case Character of
        $\n -> positions(Rest, Line + 1, 1, Offset + Units, Next);
        _ -> positions(Rest, Line, Column + 1, Offset + Units, Next)
    end.

utf16_length(Text) -> byte_size(unicode:characters_to_binary(Text, unicode, {utf16, big})) div 2.

type_text(Type) ->
    [_, Body] = binary:split(pretty({attribute, 0, type, {doc_type, Type, []}}), <<"::">>),
    trim(binary:part(Body, 0, byte_size(Body) - 1)).

atom_text(Name) -> unicode:characters_to_binary(erl_pp:expr({atom, 0, Name}, [{encoding, unicode}])).

exporter_digest() ->
    {ok, Source} = file:read_file(escript:script_name()),
    binary:encode_hex(crypto:hash(sha256, Source), lowercase).

member_location(function, Name, Arity, Located, _, Files) ->
    [{File, {function, Anno, Name, Arity, _}}] =
        [{F, Form} || {F, Form = {function, _, N, A, _}} <- Located,
            N =:= Name, A =:= Arity],
    location(source_file(File, Files), Anno);
member_location(_, _, _, _, [{File, {attribute, Anno, _, _}} | _], Files) ->
    location(source_file(File, Files), Anno).

%% EEP-48 line annotations omit filenames; -file forms retain include boundaries.
located_forms(Forms) ->
    {Located, _} = lists:mapfoldl(fun
        (Form = {attribute, _, file, {Path, _}}, _) ->
            File = bin(Path),
            {{File, Form}, File};
        (Form, File) -> {{File, Form}, File}
    end, undefined, Forms),
    Located.

declaration({attribute, _, spec, {{Name, Arity}, _}}, function, Name, Arity) -> true;
declaration({attribute, _, callback, {{Name, Arity}, _}}, callback, Name, Arity) -> true;
declaration({attribute, _, K, {Name, _, Args}}, type, Name, Arity)
        when K =:= type; K =:= opaque; K =:= nominal -> length(Args) =:= Arity;
declaration(_, _, _, _) -> false.

%% An opaque declaration exposes its name and parameters, not its private body.
declaration_text({attribute, _, opaque, {Name, _, Args}}) ->
    Parameters = lists:join(<<", ">>, [bin(erl_pp:expr(A)) || A <- Args]),
    unicode:characters_to_binary([<<"-opaque ">>,
        erl_pp:expr({atom, 0, Name}, [{encoding, unicode}]), $(, Parameters, <<").">>]);
declaration_text(Form) -> pretty(Form).

pretty(Form) ->
    State = #{next => 0, names => #{}, atoms => sets:from_list(form_atoms(Form))},
    {Printable, #{names := Names}} = qualified_records(Form, State),
    Text = format_form(Printable, Names, 60),
    {ok, Tokens, _} = erl_scan:string(unicode:characters_to_list(Text), {1, 1}, [text]),
    {ok, Parsed} = erl_parse:parse_form(Tokens),
    require(normalized_form(Form) =:= normalized_form(Parsed),
            [<<"native declaration formatter changed its syntax tree: ">>, Text]),
    Text.

%% erl_pp can append punctuation beyond linewidth. Reduce its hint when the
%% rendered declaration exceeds the cap; indivisible tokens remain visible
%% to the site's final display-width check instead of being truncated.
format_form(Form, Names, Width) ->
    Printed = trim(unicode:characters_to_binary(erl_pp:form(Form, [{linewidth, Width}]))),
    Text = restore_record_names(Printed, Names),
    Longest = lists:max([length(unicode:characters_to_list(Line))
        || Line <- binary:split(Text, <<"\n">>, [global])]),
    case Longest =< 60 orelse Width =:= 1 of
        true -> Text;
        false -> format_form(Form, Names, max(1, Width - (Longest - 60)))
    end.

normalized_form({attribute, Anno, Kind, Body}) when Kind =:= native_record; Kind =:= nominal ->
    %% map_anno does not traverse these new attribute bodies. Their annotation
    %% layout matches record/type; retain the actual kind after traversal.
    Traversal = case Kind of native_record -> record; nominal -> type end,
    {attribute, Zero, Traversal, CleanBody} =
        erl_parse:map_anno(fun(_) -> 0 end, {attribute, Anno, Traversal, Body}),
    {attribute, Zero, Kind, CleanBody};
normalized_form(Form) -> erl_parse:map_anno(fun(_) -> 0 end, Form).

%% OTP29 erl_pp handles local record types but loses a qualified record name.
%% Format those names through private, wider atom tokens, then restore only
%% their scanner tokens. Literal lookalikes cannot be rewritten. The parser
%% round trip above checks the public declaration before it leaves this VM.
qualified_records({type, Anno, record,
        [{tuple, _, [{atom, _, Module}, {atom, Last, Name}]} | Fields]}, State0) ->
    {Marker, State1} = record_marker(Module, Name, State0),
    {Mapped, State} = qualified_records(Fields, State1),
    {{type, Anno, record, [{atom, Last, Marker} | Mapped]}, State};
qualified_records(Tuple, State0) when is_tuple(Tuple) ->
    {List, State} = qualified_records(tuple_to_list(Tuple), State0),
    {list_to_tuple(List), State};
qualified_records(List, State) when is_list(List) ->
    lists:mapfoldl(fun qualified_records/2, State, List);
qualified_records(Other, State) -> {Other, State}.

record_marker(Module, Name, #{next := Next, names := Names, atoms := Used} = State) ->
    Characters = "__libtmux_record_" ++ integer_to_list(Next) ++ "_" ++
                 atom_to_list(Module) ++ ":" ++ atom_to_list(Name),
    require(length(Characters) =< 255, "qualified record name exceeds formatter budget"),
    Marker = list_to_atom(Characters),
    case sets:is_element(Marker, Used) of
        true -> record_marker(Module, Name, State#{next := Next + 1});
        false ->
            Label = <<(atom_text(Module))/binary, ":", (atom_text(Name))/binary>>,
            {Marker, State#{next := Next + 1, names := Names#{Marker => Label}}}
    end.

restore_record_names(Text, Names) when map_size(Names) =:= 0 -> Text;
restore_record_names(Text, Names) ->
    Characters = unicode:characters_to_list(Text),
    {ok, Tokens, _} = erl_scan:string(Characters, {1, 1}, [text]),
    Positions = positions(Characters, 1, 1, 0, #{}),
    Ranges = [{maps:get(erl_anno:location(Anno), Positions),
               utf16_length(erl_anno:text(Anno)), maps:get(Name, Names)}
              || {atom, Anno, Name} <- Tokens, maps:is_key(Name, Names)],
    Encoded = unicode:characters_to_binary(Text, unicode, {utf16, big}),
    Restored = lists:foldl(fun({Start, Length, Label}, Bytes) ->
        PrefixBytes = Start * 2,
        NameBytes = Length * 2,
        <<Prefix:PrefixBytes/binary, _:NameBytes/binary, Suffix/binary>> = Bytes,
        Replacement = unicode:characters_to_binary(Label, unicode, {utf16, big}),
        <<Prefix/binary, Replacement/binary, Suffix/binary>>
    end, Encoded, lists:reverse(lists:sort(Ranges))),
    unicode:characters_to_binary(Restored, {utf16, big}, utf8).

form_atoms(Atom) when is_atom(Atom) -> [Atom];
form_atoms(Tuple) when is_tuple(Tuple) -> form_atoms(tuple_to_list(Tuple));
form_atoms(List) when is_list(List) -> lists:append([form_atoms(Item) || Item <- List]);
form_atoms(_) -> [].

documentation(none) -> null;
documentation(Doc) when is_map(Doc) ->
    case maps:find(<<"en">>, Doc) of
        {ok, English} when is_binary(English) -> English;
        _ -> fail("compiler documentation has no English Markdown")
    end.

metadata(Key, Meta) ->
    case maps:get(Key, Meta, null) of
        null -> null;
        Value when is_binary(Value) -> Value;
        Value when is_list(Value) -> bin(Value)
    end.

location(File, Anno) -> #{file => File, line => erl_anno:line(Anno)}.

source_file(Path, Files) ->
    Base = filename:basename(bin(Path)),
    case [P || #{path := P} <- Files, filename:basename(P) =:= Base] of
        [File] -> File;
        _ -> fail([Base, <<": source path is missing or ambiguous">>])
    end.

inputs() ->
    Names = binary:split(run("git", ["ls-files", "-z"]), <<0>>, [global]),
    [#{path => Name, sha256 => binary:encode_hex(crypto:hash(sha256, read(Name)), lowercase)}
        || Name <- lists:sort(Names), Name =/= <<>>, input(Name)].

input(Name) -> lists:member(filename:extension(Name), [<<".erl">>, <<".hrl">>, <<".src">>])
    orelse lists:member(filename:basename(Name),
        [<<"rebar.config">>, <<"rebar.lock">>, <<".tool-versions">>]).

read(Name) -> {ok, Content} = file:read_file(Name), Content.
clean() -> require(trim(run("git", ["status", "--porcelain", "--untracked-files=all"])) =:= <<>>,
    "checkout has uncommitted changes; no revision describes it").

repository(Url) ->
    case re:run(Url, <<"^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\\.git)?$">>,
            [{capture, [1], binary}]) of
        {match, [Repository]} -> Repository;
        _ -> fail("origin must name a GitHub repository")
    end.

otp_version() ->
    File = filename:join([code:root_dir(), "releases", erlang:system_info(otp_release), "OTP_VERSION"]),
    trim(read(File)).

run(Executable, Arguments) ->
    case os:find_executable(Executable) of
        false -> fail([bin(Executable), <<" is required on PATH">>]);
        Path ->
            Port = open_port({spawn_executable, Path}, [binary, exit_status, use_stdio,
                stderr_to_stdout, {args, Arguments}]),
            collect(Port, [], Executable)
    end.

collect(Port, Acc, Executable) ->
    receive
        {Port, {data, Data}} -> collect(Port, [Data | Acc], Executable);
        {Port, {exit_status, 0}} -> iolist_to_binary(lists:reverse(Acc));
        {Port, {exit_status, Status}} ->
            fail([bin(Executable), <<" failed (">>, integer_to_binary(Status), <<"): ">>,
                lists:reverse(Acc)])
    end.

require(true, _) -> ok;
require(false, Message) -> fail(Message).
fail(Message) -> throw({export_error, unicode:characters_to_binary(Message)}).
trim(Binary) -> string:trim(Binary).
bin(Atom) when is_atom(Atom) -> atom_to_binary(Atom);
bin(List) -> unicode:characters_to_binary(List).
