# frozen_string_literal: true

# Reference layouts for RBS method definitions, produced by syntax_tree-rbs.
#
#   gem install syntax_tree-rbs        # into a scratch GEM_HOME
#   ruby reference.rb reference.json
#
# Reads each case's "id", "name", "static" and "raw" (the text
# RBS::MethodType#to_s writes) and rewrites "reference" and "stock". "stock"
# is SyntaxTree::RBS.format unmodified; it is kept only where it differs.
# "reference" is the same layout engine with the patches below, which the
# documentation needs to keep the exporter's tokens. Both are formatted as
# members of a class at two columns more than the documentation width, then
# dedented, so the width applies to the declaration itself.

require "json"
require "syntax_tree"
require "syntax_tree/rbs"

WIDTH = 60

# Patches over syntax_tree-rbs 1.0.0, whose visitor methods below are adapted
# (MIT License, Copyright (c) 2022-present Kevin Newton). Every group, indent
# and breakable not named here is the stock visitor's.
#
# - An empty parameter list keeps its parentheses; stock prints `-> T`.
# - Parentheses follow RBS::Types#to_s: a union or intersection in a result,
#   an optional or an intersection member, and a proc under `?`. Stock turns
#   on "force parens" for a whole result, so it leaks into nested types.
# - A record key with a digit stays `key:`; stock prints `:key0 =>`.
# - A type parameter keeps its bound, `[T < Bound]`; stock prints the name only.
# - Type-argument and tuple brackets are groups that can break. Stock prints
#   them as text, so a union inside breaks at the margin or the line overflows.
# - A parenthesized union or intersection indents its members, where stock
#   continues them at the enclosing column, outside the parentheses.
module KeepToSPunctuation
  def visit(node, level = 0)
    previous = @level
    @level = level
    node&.accept(self)
  ensure
    @level = previous
  end

  def members(node, operator, &)
    q.group do
      if @level.to_i.positive?
        q.text("(")
        q.indent do
          q.breakable("")
          q.seplist(node.types, -> { q.breakable; q.text(operator) }, &)
        end
        q.breakable("")
        q.text(")")
      else
        q.seplist(node.types, -> { q.breakable; q.text(operator) }, &)
      end
    end
  end

  def visit_union_type(node)
    level = @level.to_i
    members(node, "| ") { |type| visit(type, type.is_a?(::RBS::Types::Intersection) ? [1, level].max : 0) }
  end

  def visit_intersection_type(node)
    members(node, "& ") { |type| visit(type, 2) }
  end

  def visit_optional_type(node)
    inner = node.type
    if inner.is_a?(::RBS::Types::Proc)
      q.text("(")
      visit(inner)
      q.text(")")
    else
      visit(inner, 1)
    end
    q.text(inner.is_a?(::RBS::Types::Literal) && inner.literal.is_a?(Symbol) ? " ?" : "?")
  end

  def visit_proc_type(node)
    q.group do
      q.text("^")
      print_method_signature(node)
    end
  end

  def visit_record_type(node)
    q.group do
      q.text("{")
      q.indent do
        q.breakable
        q.seplist(node.fields, -> { q.text(","); q.breakable }, :each_pair) do |key, type|
          q.text(key.is_a?(Symbol) && key.match?(/\A[A-Za-z_]\w*\z/) ? "#{key}: " : "#{key.inspect} => ")
          visit(type)
        end
      end
      q.breakable
      q.text("}")
    end
  end

  def visit_tuple_type(node)
    return q.text("[ ]") if node.types.empty?

    q.group do
      q.text("[")
      q.indent do
        q.breakable("")
        q.seplist(node.types) { |type| visit(type) }
      end
      q.breakable("")
      q.text("]")
    end
  end

  def print_name_and_args(node)
    return super unless node.respond_to?(:args) && node.args.any?

    q.group do
      visit(node.name)
      q.text("[")
      q.indent do
        q.breakable("")
        q.seplist(node.args) { |arg| visit(arg) }
      end
      q.breakable("")
      q.text("]")
    end
  end

  def print_method_signature(node)
    q.group do
      if node.respond_to?(:type_params) && node.type_params.any?
        q.text("[")
        q.seplist(node.type_params, -> { q.text(", ") }) { |param| q.text(param.to_s) }
        q.text("] ")
      end

      function = node.type
      if function.is_a?(::RBS::Types::UntypedFunction)
        q.text("(?) ")
      else
        params = []
        function.required_positionals.each { |param| params << -> { visit(param) } }
        function.optional_positionals.each { |param| params << -> { q.text("?"); visit(param) } }
        params << -> { q.text("*"); visit(function.rest_positionals) } if function.rest_positionals
        function.trailing_positionals.each { |param| params << -> { visit(param) } }
        function.required_keywords.each { |name, param| params << -> { q.text("#{name}: "); visit(param) } }
        function.optional_keywords.each { |name, param| params << -> { q.text("?#{name}: "); visit(param) } }
        params << -> { q.text("**"); visit(function.rest_keywords) } if function.rest_keywords

        if params.any?
          q.text("(")
          q.indent do
            q.breakable("")
            q.seplist(params, &:call)
          end
          q.breakable("")
          q.text(") ")
        else
          q.text("() ")
        end
      end

      if node.respond_to?(:block) && node.block
        q.text("?") unless node.block.required
        q.text("{")
        q.indent do
          q.breakable
          print_method_signature(node.block)
        end
        q.breakable
        q.text("} ")
      end

      q.text("-> ")
      visit(node.type.return_type, 1)
    end
  end
end

def source_for(entry)
  "class Probe\n  def #{entry["static"] ? "self." : ""}#{entry["name"]}: #{entry["raw"]}\nend\n"
end

def layout_of(entry)
  SyntaxTree::RBS.format(source_for(entry), WIDTH + 2).lines.map(&:chomp)[1...-1]
    .map { |line| line.sub(/\A  /, "") }.join("\n")
end

def tokens(text)
  text.gsub(/\s+/, "")
end

path = ARGV.fetch(0)
fixture = JSON.parse(File.read(path))
cases = fixture.fetch("cases")

# Stock output is taken before the patches are prepended. It cannot print an
# untyped function, `(?) -> T`.
stocks = cases.map do |entry|
  layout_of(entry)
rescue NoMethodError
  nil
end
SyntaxTree::RBS::Format.prepend(KeepToSPunctuation)

cases.each_with_index do |entry, position|
  reference = layout_of(entry)
  quoted = ::RBS::Parser::KEYWORDS.include?(entry["name"]) ? "`#{entry["name"]}`" : entry["name"]
  expected = "def #{entry["static"] ? "self." : ""}#{quoted}: #{entry["raw"]}"
  raise "#{entry["id"]}: the reference changed tokens" unless tokens(reference) == tokens(expected)

  # The reference must also read back as the method type it was made from.
  parse = ->(text) { ::RBS::Parser.parse_method_type(text, require_eof: true).to_s }
  raise "#{entry["id"]}: the reference does not parse back" unless parse.(reference.sub(/\Adef (?:self\.)?\S+?:\s*/m, "")) == parse.(entry["raw"])

  entry["reference"] = reference
  entry.delete("stock")
  entry["stock"] = stocks.fetch(position) unless stocks.fetch(position) == reference
end

tools = {
  "ruby" => RUBY_VERSION,
  "rbs" => ::RBS::VERSION,
  "syntax_tree" => SyntaxTree::VERSION,
  "syntax_tree-rbs" => SyntaxTree::RBS::VERSION,
  "prettier_print" => Gem.loaded_specs.fetch("prettier_print").version.to_s,
}
File.write(path, "#{JSON.pretty_generate("tools" => tools, "width" => WIDTH, "cases" => cases)}\n")
