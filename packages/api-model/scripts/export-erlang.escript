#!/usr/bin/env escript
-mode(compile).
-include_lib("kernel/include/eep48.hrl").

%% Build in the source checkout's toolchain; read compiler chunks, never source regexes.
main([Root0, AppName, Output0]) ->
    Output = filename:absname(Output0),
    try
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
            M <- [module(Name, Ebin, Files)], M =/= hidden],
        require(Public =/= [], "application documents no public modules"),
        clean(),
        require(Files =:= inputs(), "source inputs changed while compiling"),
        require(Revision =:= trim(run("git", ["rev-parse", "HEAD"])),
            "source revision changed while compiling"),
        Artifact = #{schema => 1, port => <<"erlang">>,
            source => #{repository => Repository, revision => Revision, files => Files},
            exporter => #{name => <<"Erlang EEP-48 and abstract code">>, version => 1,
                otp => otp_version(), columns => 60},
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

module(Name, Ebin, Files) ->
    Beam = filename:join(Ebin, atom_to_list(Name) ++ ".beam"),
    case beam_lib:chunks(Beam, [abstract_code, "Docs"]) of
        {ok, {Name, [{abstract_code, {raw_abstract_v1, Forms}}, {"Docs", DocsBin}]}} ->
            case binary_to_term(DocsBin) of
                #docs_v1{beam_language = erlang, format = <<"text/markdown">>,
                        module_doc = hidden} -> hidden;
                #docs_v1{beam_language = erlang, format = <<"text/markdown">>,
                        module_doc = Doc, metadata = Meta, docs = Entries} ->
                    File = source_file(atom_to_list(Name) ++ ".erl", Files),
                    Located = located_forms(Forms, Files),
                    Exports = lists:append([Fs || {attribute, _, export, Fs} <- Forms]),
                    Types = lists:append([Ts || {attribute, _, export_type, Ts} <- Forms]),
                    Records = lists:append([Rs || {attribute, _, export_record, Rs} <- Forms]),
                    Members = [member(E, Located, Types) || E <- lists:sort(Entries),
                        public(E, Exports)],
                    #{name => bin(Name), doc => documentation(Doc),
                        source => location(File, maps:get(source_anno, Meta, 1)),
                        members => Members,
                        records => [#{name => bin(R), declaration => pretty(F),
                            source => location(RecordFile, Anno)} ||
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

member({{Kind, Name, Arity}, _, Signatures, Doc, Meta}, Located, Types) ->
    Declarations = [{File, F} || {File, F} <- Located, declaration(F, Kind, Name, Arity)],
    require(Declarations =/= [], [bin(Name), <<": missing compiler declaration">>]),
    Visibility = case [K || {_, {attribute, _, K, _}} <- Declarations] of
        [opaque] -> opaque;
        [nominal] -> nominal;
        _ -> public
    end,
    #{kind => Kind, name => bin(Name), arity => Arity,
        signatures => Signatures, doc => documentation(Doc),
        since => metadata(since, Meta), deprecated => metadata(deprecated, Meta),
        visibility => Visibility,
        exported => Kind =/= type orelse lists:member({Name, Arity}, Types),
        source => member_location(Kind, Name, Arity, Located, Declarations),
        declarations => [declaration_text(F) || {_, F} <- Declarations]}.

member_location(function, Name, Arity, Located, _) ->
    [{File, {function, Anno, Name, Arity, _}}] =
        [{F, Form} || {F, Form = {function, _, N, A, _}} <- Located,
            N =:= Name, A =:= Arity],
    location(File, Anno);
member_location(_, _, _, _, [{File, {attribute, Anno, _, _}} | _]) ->
    location(File, Anno).

%% EEP-48 line annotations omit filenames; -file forms retain include boundaries.
located_forms(Forms, Files) ->
    {Located, _} = lists:mapfoldl(fun
        (Form = {attribute, _, file, {Path, _}}, _) ->
            File = source_file(Path, Files),
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

pretty(Form) -> trim(unicode:characters_to_binary(erl_pp:form(Form, [{linewidth, 60}]))).

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
