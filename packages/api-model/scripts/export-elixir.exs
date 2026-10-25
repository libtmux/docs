# Export a compiled Mix application's public API as the artifact the docs site reads.
#
# Run it from the source checkout, through that checkout's own toolchain:
#
#     MIX_ENV=prod mix run --no-start <path to>/export-elixir.exs OUTPUT.json
#
# Mix compiles the project first, so the beam files carry the same EEP-48
# documentation chunks and abstract code that ExDoc reads. Nothing here parses
# Elixir source: documentation, specs, types and callbacks come from
# `Code.fetch_docs/1` and `Code.Typespec`, and a module or function that ExDoc
# would hide (`@moduledoc false`, `@doc false`) is not exported.
#
# The tree must be clean. The artifact names the commit it describes and the
# digest of every source file, and the adapter in packages/api-model rejects an
# artifact whose revision is not the checkout the site is built from.

defmodule LibTmuxDocsExport do
  @moduledoc false

  # The reference lays code out in 60 columns; see CODE_COLUMNS in
  # site/src/lib/code-layout.ts. Declarations are formatted here, by the
  # language's own formatter, so the site never re-flows Elixir.
  @columns 60
  @version 1

  def main([out]) do
    config = Mix.Project.config()
    root = File.cwd!()
    revision = git!(root, ["rev-parse", "HEAD"])

    case git!(root, ["status", "--porcelain", "--untracked-files=no"]) do
      "" -> :ok
      dirty -> abort("the checkout has uncommitted changes, so no revision describes it:\n#{dirty}")
    end

    app = Keyword.fetch!(config, :app)
    load_application(app)
    ebin = Mix.Project.compile_path()
    Code.prepend_path(ebin)

    modules =
      app
      |> Application.spec(:modules)
      |> Enum.sort()
      |> Enum.flat_map(&export_module(&1, root))

    names = Enum.map(modules, &elem(&1, 1) |> field("name"))

    if names != Enum.uniq(names), do: abort("duplicate module names")

    artifact =
      obj([
        {"schema", 1},
        {"port", "elixir"},
        {"source",
         obj([
           {"repository", repository(config)},
           {"revision", revision},
           {"files", source_files(root)}
         ])},
        {"exporter",
         obj([
           {"name", "Elixir EEP-48 documentation chunks and Code.Typespec"},
           {"version", @version},
           {"elixir", System.version()},
           {"otp", otp_version()},
           {"columns", @columns}
         ])},
        {"package",
         obj([
           {"name", to_string(Keyword.get(config, :package_name, app))},
           {"app", to_string(app)},
           {"version", Keyword.fetch!(config, :version)},
           {"elixir", Keyword.get(config, :elixir)}
         ])},
        {"modules", Enum.map(modules, &elem(&1, 1))}
      ])

    File.mkdir_p!(Path.dirname(Path.expand(out)))
    File.write!(out, encode(artifact) <> "\n")
  end

  def main(_), do: abort("usage: mix run --no-start export-elixir.exs OUTPUT.json")

  defp load_application(app) do
    case Application.load(app) do
      :ok -> :ok
      {:error, {:already_loaded, ^app}} -> :ok
      {:error, reason} -> abort("cannot load #{app}: #{inspect(reason)}")
    end
  end

  # ── modules ────────────────────────────────────────────────────────────────

  defp export_module(module, root) do
    with {:docs_v1, anno, :elixir, "text/markdown", moduledoc, metadata, entries} <-
           fetch_docs!(module),
         false <- moduledoc == :hidden,
         {:module, ^module} <- ensure_loaded!(module) do
      specs = typespecs(&Code.Typespec.fetch_specs/1, module)
      callbacks = typespecs(&Code.Typespec.fetch_callbacks/1, module)
      types = type_definitions(module)
      file = relative(metadata[:source_path], root)
      line = module_line(metadata, anno)

      members =
        entries
        |> Enum.flat_map(&export_entry(&1, module, file, specs, callbacks, types))
        |> distinguish_ids()

      ids = Enum.map(members, &field(&1, "id"))
      if ids != Enum.uniq(ids), do: abort("#{inspect(module)} has colliding member ids: #{inspect(ids -- Enum.uniq(ids))}")

      [
        {module,
         obj([
           {"name", inspect(module)},
           {"kind", module_kind(module, callbacks)},
           {"doc", doc_text(moduledoc)},
           {"since", metadata[:since]},
           {"deprecated", deprecation(metadata[:deprecated])},
           {"behaviours", Enum.map(metadata[:behaviours] || [], &inspect/1)},
           {"source", source(file, line)},
           {"fields", struct_fields(module, entries, types)},
           {"members", Enum.sort_by(members, &{field(&1, "line"), field(&1, "id")})}
         ])}
      ]
    else
      true -> []
    end
  end

  # ExDoc skips a module whose documentation is hidden, and nothing else. A
  # module that cannot be read is an error, because skipping it would publish
  # a reference with a hole in it.
  defp fetch_docs!(module) do
    case Code.fetch_docs(module) do
      {:docs_v1, _, :elixir, "text/markdown", _, _, _} = chunk -> chunk
      {:error, reason} -> abort("cannot read the documentation of #{inspect(module)}: #{inspect(reason)}")
      _ -> abort("#{inspect(module)} documents itself in a format other than Elixir Markdown")
    end
  end

  defp ensure_loaded!(module) do
    case Code.ensure_loaded(module) do
      {:module, ^module} = loaded -> loaded
      {:error, reason} -> abort("cannot load #{inspect(module)}: #{inspect(reason)}")
    end
  end

  # A function and a type may share a name and an arity: `result/0` the type and
  # `result/0` the function. ExDoc tells them apart by a `t:` or `c:` prefix on
  # the anchor, and so does the id here, but only where the plain id is taken,
  # so the common id stays the one a reader would write.
  defp distinguish_ids(members) do
    taken =
      members
      |> Enum.filter(&(field(&1, "kind") in ["function", "macro"]))
      |> MapSet.new(&field(&1, "id"))

    Enum.map(members, fn member ->
      prefix = %{"type" => "type", "callback" => "callback", "macrocallback" => "callback"}[field(member, "kind")]
      id = field(member, "id")

      if prefix && MapSet.member?(taken, id) do
        {:object, pairs} = member
        {:object, List.keyreplace(pairs, "id", 0, {"id", String.replace(id, ~r/\.([^.]+)$/, ".#{prefix}:\\1")})}
      else
        member
      end
    end)
  end

  # Elixir spells a module's role in code, not in an attribute: whether it has a
  # struct, an exception or callbacks is read from the compiled module.
  defp module_kind(module, callbacks) do
    cond do
      function_exported?(module, :exception, 1) and function_exported?(module, :__struct__, 0) -> "exception"
      function_exported?(module, :__protocol__, 1) -> "protocol"
      callbacks != %{} -> "behaviour"
      function_exported?(module, :__struct__, 0) -> "struct"
      true -> "module"
    end
  end

  defp module_line(metadata, anno) do
    case metadata[:source_annos] do
      [first | _] -> :erl_anno.line(first)
      _ -> :erl_anno.line(anno)
    end
  end

  # A struct's fields are public when the module publishes its `t` type
  # transparently. An `@opaque` type, or a struct with no `t` at all, keeps its
  # layout to itself.
  defp struct_fields(module, entries, types) do
    transparent? =
      Enum.any?(entries, fn
        {{:type, :t, _}, _, _, _, meta} -> meta[:opaque] != true
        _ -> false
      end)

    if transparent? and function_exported?(module, :__struct__, 0) do
      defaults = module.__struct__() |> Map.from_struct()
      field_types = struct_field_types(types)

      for %{field: name} = info <- module.__info__(:struct) || [],
          not String.starts_with?(Atom.to_string(name), "__"),
          Map.has_key?(field_types, name) do
        obj([
          {"name", Atom.to_string(name)},
          {"type", format_type(Map.fetch!(field_types, name))},
          {"required", info[:required] == true},
          {"default", if(info[:required] == true, do: nil, else: inspect(Map.get(defaults, name)))}
        ])
      end
    else
      []
    end
  end

  defp struct_field_types(types) do
    case Map.get(types, {:t, 0}) do
      {_kind, {:"::", _, [_head, {:%, _, [_module, {:%{}, _, pairs}]}]}} ->
        for {key, value} <- pairs, is_atom(key), into: %{}, do: {key, value}

      _ ->
        %{}
    end
  end

  # ── members ────────────────────────────────────────────────────────────────

  defp export_entry({{kind, name, arity}, anno, signatures, doc, meta}, module, file, specs, callbacks, types)
       when kind in [:function, :macro, :callback, :macrocallback, :type] do
    if doc == :hidden or name == :__struct__ do
      []
    else
      key = {name, arity}
      line = :erl_anno.line(anno)

      common = [
        {"id", "#{inspect(module)}.#{name}/#{arity}"},
        {"name", Atom.to_string(name)},
        {"arity", arity},
        {"kind", Atom.to_string(kind)},
        {"line", line},
        {"doc", doc_text(doc)},
        {"since", meta[:since]},
        {"deprecated", deprecation(meta[:deprecated])},
        {"source", source(file, line)}
      ]

      body =
        case kind do
          :type -> type_body(Map.get(types, key), meta)
          k when k in [:callback, :macrocallback] -> callable_body(hd_signature(signatures), name, arity, Map.get(callbacks, key, []), kind, meta)
          # The compiler gives a macro one more argument than its author wrote: the caller's environment.
          :macro -> callable_body(hd_signature(signatures), name, arity, Map.get(specs, {:"MACRO-#{name}", arity + 1}, []), :macro, meta)
          _ -> callable_body(hd_signature(signatures), name, arity, Map.get(specs, key, []), :spec, meta)
        end

      [obj(common ++ body)]
    end
  end

  defp export_entry(_other, _module, _file, _specs, _callbacks, _types), do: []

  defp hd_signature([signature | _]), do: signature
  defp hd_signature([]), do: nil

  defp callable_body(head, name, arity, clauses, attribute, meta) do
    specs =
      for clause <- clauses do
        quoted = name |> Code.Typespec.spec_to_quoted(clause) |> without_caller(attribute == :macro)
        {args, returns, constraints} = split_spec(quoted)

        obj([
          {"parameters", Enum.map(args, &format_type/1)},
          {"returns", format_type(returns)},
          {"constraints", Enum.map(constraints, fn {var, type} -> obj([{"name", Atom.to_string(var)}, {"type", format_type(type)}]) end)},
          {"text", format_spec(quoted, attribute)}
        ])
      end

    [
      {"signature", head},
      {"head", head && format_code(head)},
      {"parameters", parameters_of(head, arity)},
      {"defaults", meta[:defaults] || 0},
      {"specs", specs},
      {"guard", meta[:guard] == true},
      {"delegateTo", delegate(meta[:delegate_to])},
      {"equiv", meta[:equiv]}
    ]
  end

  defp delegate({module, name, arity}), do: "#{inspect(module)}.#{name}/#{arity}"
  defp delegate(_), do: nil

  defp type_body(nil, meta), do: [{"opaque", meta[:opaque] == true}, {"head", nil}, {"declaration", nil}]

  defp type_body({kind, {:"::", _, [head, _definition]} = quoted}, meta) do
    opaque? = kind == :opaque or meta[:opaque] == true

    [
      {"opaque", opaque?},
      {"head", Macro.to_string(head)},
      # An opaque type's structure is not part of the contract.
      {"declaration", format_code(if(opaque?, do: "@opaque " <> Macro.to_string(head), else: "@type " <> Macro.to_string(quoted)))}
    ]
  end

  # The signature ExDoc prints is the chunk's `name(arg, default \\ value)`. The
  # chunk already gives destructured arguments stable names.
  defp parameters_of(head, arity) do
    case head && Code.string_to_quoted(head) do
      {:ok, {_call, _, args}} when is_list(args) -> Enum.map(args, &parameter_of/1)
      _ -> Enum.map(1..arity//1, &parameter("arg#{&1}", nil))
    end
  end

  defp parameter_of({:\\, _, [pattern, default]}),
    do: parameter(pattern_name(pattern), Macro.to_string(default))

  defp parameter_of(pattern), do: parameter(pattern_name(pattern), nil)

  defp parameter(name, default), do: obj([{"name", name}, {"default", default}])

  defp pattern_name({name, _, context}) when is_atom(name) and is_atom(context), do: Atom.to_string(name)
  defp pattern_name(other), do: Macro.to_string(other)

  defp without_caller(quoted, false), do: quoted

  defp without_caller({:when, meta, [spec, constraints]}, true), do: {:when, meta, [without_caller(spec, true), constraints]}

  defp without_caller({:"::", meta, [{name, head_meta, [_caller | args]}, returns]}, true),
    do: {:"::", meta, [{name, head_meta, args}, returns]}

  # `@spec f(a) :: b` or `@spec f(a) :: b when var: c`.
  defp split_spec({:when, _, [{:"::", _, [{_name, _, args}, returns]}, constraints]}),
    do: {args || [], returns, constraints}

  defp split_spec({:"::", _, [{_name, _, args}, returns]}), do: {args || [], returns, []}

  # ── typespecs ──────────────────────────────────────────────────────────────

  defp typespecs(fetch, module) do
    case fetch.(module) do
      {:ok, list} -> Map.new(list)
      :error -> %{}
    end
  end

  defp type_definitions(module) do
    case Code.Typespec.fetch_types(module) do
      {:ok, types} ->
        for {kind, {name, _, args} = type} <- types, kind in [:type, :opaque], into: %{} do
          {{name, length(args)}, {kind, Code.Typespec.type_to_quoted(type)}}
        end

      :error ->
        %{}
    end
  end

  defp format_type(quoted), do: quoted |> Macro.to_string() |> one_line()

  defp one_line(text), do: text |> String.split("\n") |> Enum.map(&String.trim/1) |> Enum.join(" ")

  # Declarations are laid out by the formatter at the reference's width. A
  # formatter failure is a bug in this script, not a reason to ship an
  # unformatted declaration.
  #
  # The formatter keeps a call whole when it can, and a few declarations then
  # run past the budget. Narrowing its limit makes it break the call instead,
  # so the first limit whose widest line fits is the layout. The narrowest limit
  # is the last resort, and the site reports a line that still does not fit.
  defp format_code(code) do
    layouts = for limit <- @columns..(@columns - 20)//-1 do
      text = code |> Code.format_string!(line_length: limit) |> IO.iodata_to_binary()
      {text, text |> String.split("\n") |> Enum.map(&String.length/1) |> Enum.max()}
    end

    case Enum.find(layouts, fn {_text, widest} -> widest <= @columns end) do
      {text, _widest} -> text
      nil -> layouts |> hd() |> elem(0)
    end
  end

  defp format_spec(quoted, :macro), do: format_spec(quoted, :spec)
  defp format_spec(quoted, attribute), do: format_code("@#{attribute} " <> Macro.to_string(quoted))

  # ── provenance ─────────────────────────────────────────────────────────────

  defp source_files(root) do
    root
    |> Path.join("lib/**/*.ex")
    |> Path.wildcard()
    |> Kernel.++([Path.join(root, "mix.exs")])
    |> Enum.sort()
    |> Enum.map(fn path ->
      obj([
        {"path", Path.relative_to(path, root)},
        {"sha256", :crypto.hash(:sha256, File.read!(path)) |> Base.encode16(case: :lower)}
      ])
    end)
  end

  defp repository(config) do
    case Keyword.get(config, :source_url) do
      "https://github.com/" <> repository -> String.trim_trailing(repository, ".git")
      other -> abort("source_url must name a GitHub repository, got #{inspect(other)}")
    end
  end

  defp otp_version do
    Path.join([:code.root_dir(), "releases", :erlang.system_info(:otp_release), "OTP_VERSION"])
    |> File.read!()
    |> String.trim()
  end

  defp git!(root, args) do
    case System.cmd("git", ["-C", root | args], stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      {output, status} -> abort("git #{Enum.join(args, " ")} failed (#{status}): #{output}")
    end
  end

  defp relative(path, root) do
    path = path |> to_string() |> Path.expand()

    case Path.relative_to(path, root) do
      ^path -> abort("#{path} is outside the checkout")
      relative -> relative
    end
  end

  defp source(file, line), do: obj([{"file", file}, {"line", line}])

  defp doc_text(%{"en" => text}), do: text
  defp doc_text(_), do: nil

  defp deprecation(nil), do: nil
  defp deprecation(message) when is_binary(message), do: message
  defp deprecation(other), do: inspect(other)

  # ── deterministic JSON ─────────────────────────────────────────────────────

  # Objects keep the order they were written in; an Elixir map would not.
  defp obj(pairs), do: {:object, pairs}
  defp field({:object, pairs}, key), do: pairs |> List.keyfind!(key, 0) |> elem(1)

  defp encode({:object, pairs}) do
    "{" <> Enum.map_join(pairs, ",", fn {key, value} -> JSON.encode!(key) <> ":" <> encode(value) end) <> "}"
  end

  defp encode(list) when is_list(list), do: "[" <> Enum.map_join(list, ",", &encode/1) <> "]"
  defp encode(value), do: JSON.encode!(value)

  defp abort(message) do
    IO.puts(:stderr, "export-elixir: " <> message)
    System.halt(1)
  end
end

LibTmuxDocsExport.main(System.argv())
