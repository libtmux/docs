#!/usr/bin/env escript
%%! +S 2:2
%% OTP owns token boundaries, sigils, string indentation and atom spelling.
main([]) ->
    "29" = erlang:system_info(otp_release),
    ok = io:setopts(standard_io, [{encoding, unicode}]),
    case erl_scan:string(read([]), 1, [text]) of
        {ok, Tokens, _} -> io:put_chars(json:encode([token(T) || T <- Tokens]));
        {error, {Line, Module, Reason}, _} ->
            io:format(standard_error, "line ~tp: ~ts~n", [Line, Module:format_error(Reason)]),
            halt(1)
    end.

read(Parts) ->
    case io:get_chars(standard_io, "", 65536) of
        eof -> lists:append(lists:reverse(Parts));
        {error, Reason} -> error({source_read, Reason});
        Characters -> read([Characters | Parts])
    end.

token({atom, Anno, Value}) ->
    Text = unicode:characters_to_binary(erl_pp:expr({atom, 0, Value}, [{encoding, unicode}])),
    #{t => atom, v => atom_to_binary(Value), n => Text,
      quoted => binary:first(Text) =:= $', line => erl_anno:line(Anno)};
token({string, Anno, Value}) -> #{t => str, v => unicode:characters_to_binary(Value), line => erl_anno:line(Anno)};
token({sigil_prefix, Anno, Value}) ->
    #{t => sigil_prefix, v => atom_to_binary(Value), line => erl_anno:line(Anno)};
token({sigil_suffix, Anno, Value}) ->
    #{t => sigil_suffix, v => unicode:characters_to_binary(Value), line => erl_anno:line(Anno)};
token({integer, Anno, Value}) -> #{t => number, v => integer_to_binary(Value), line => erl_anno:line(Anno)};
token({Kind, Anno, _}) -> #{t => Kind, v => <<>>, line => erl_anno:line(Anno)};
token({dot, Anno}) -> #{t => stop, v => <<".">>, line => erl_anno:line(Anno)};
token({Kind, Anno}) -> #{t => sym, v => atom_to_binary(Kind), line => erl_anno:line(Anno)}.
