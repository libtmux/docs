#!/usr/bin/env escript
%%! +S 1:1 +SDcpu 1:1 +SDio 1 +sbwt none +sbwtdcpu none +sbwtdio none
%% One scheduler that never spins: a short-lived run on a busy host
%% would otherwise spend its CPU share waiting for work. The script is
%% interpreted because compiling it on every start costs more than it saves
%% on a source or manifest of ordinary size.
-mode(interpret).
%% Read constant .app.src terms; never evaluate application source.
main([]) ->
    "29" = erlang:system_info(otp_release),
    ok = io:setopts(standard_io, [{encoding, unicode}]),
    Inputs = json:decode(unicode:characters_to_binary(read([]))),
    io:put_chars(json:encode([application(Input) || Input <- Inputs])).

read(Parts) ->
    case io:get_chars(standard_io, "", 65536) of
        eof -> lists:append(lists:reverse(Parts));
        {error, Reason} -> error({manifest_read, Reason});
        Characters -> read([Characters | Parts])
    end.

application(#{<<"manifest">> := Path, <<"text">> := Source}) ->
    {ok, Tokens, _} = erl_scan:string(unicode:characters_to_list(Source)),
    {ok, {application, Name, Properties}} = erl_parse:parse_term(Tokens),
    true = is_atom(Name),
    true = is_list(Properties),
    [Version] = [Value || {vsn, Value} <- Properties],
    true = is_list(Version) andalso Version =/= [],
    true = lists:all(fun erlang:is_integer/1, Version),
    VersionText = unicode:characters_to_binary(Version),
    true = is_binary(VersionText),
    true = byte_size(VersionText) > 0,
    NameText = atom_to_binary(Name),
    NameText = filename:basename(Path, <<".app.src">>),
    #{name => NameText, version => VersionText, manifest => Path}.
