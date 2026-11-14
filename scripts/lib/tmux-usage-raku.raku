use v6.d;
use experimental :rakuast;
use JSON::Fast;

# Trusted source can execute compile-time code during RakuAST parsing.
my $text = $*IN.slurp;
my $tree = $text.AST;
my @functions;
my @types;
my %seen;
sub line-at(Int:D $offset --> Int:D) { 1 + $text.substr(0, $offset).comb("\n").elems }
sub walk($node, Str:D $owner = '', Int:D $function = -1, Str:D $receiver = '') {
    return if %seen{$node.WHICH}++;
    my $kind = $node.^name;
    return if $kind.starts-with('RakuAST::Doc::');
    my $next-owner = $owner;
    my $next-function = $function;
    if $kind eq any(<RakuAST::Class RakuAST::Role RakuAST::Module>) {
        $next-owner = $node.name.DEPARSE.split('::').tail;
        @types.push(%(name => $next-owner, start => line-at($node.origin.from),
            end => line-at($node.origin.to))) if $node.origin.defined;
    }
    if $kind eq any(<RakuAST::Method RakuAST::Sub RakuAST::Submethod>)
            && $node.origin.defined && $node.name.defined {
        my $name = $node.name.DEPARSE;
        $name = '!' ~ $name if $node.^can('private') && $node.private;
        my %fn = :$name, start => line-at($node.origin.from),
            nameLine => line-at($node.origin.from), end => line-at($node.origin.to),
            kind => $kind, literals => [], calls => [];
        %fn<owner> = $owner if $owner.chars;
        $next-function = @functions.elems;
        @functions.push(%fn);
    }
    if $function >= 0 && $node.origin.defined {
        if $kind eq 'RakuAST::QuotedString' {
            unless $node.has-variables {
                my $value = $node.literal-value;
                for ($value ~~ Positional ?? $value.List !! ($value,)) -> $literal {
                    @functions[$function]<literals>.push(%(value => $literal,
                        line => line-at($node.origin.from))) if $literal ~~ Str;
                }
            }
            return;
        }
        if $kind eq any(<RakuAST::Call::Name RakuAST::Call::Method RakuAST::Call::PrivateMethod>) {
            my $name = $node.name.DEPARSE;
            $name = '!' ~ $name if $kind eq 'RakuAST::Call::PrivateMethod';
            my %call = :$name, line => line-at($node.origin.from);
            %call<receiver> = $receiver if $receiver.chars;
            @functions[$function]<calls>.push(%call);
        }
    }
    if $kind eq 'RakuAST::ApplyPostfix' {
        walk($node.operand, $next-owner, $next-function);
        walk($node.postfix, $next-owner, $next-function, $node.operand.DEPARSE);
    } else {
        $node.visit-children(-> $child { walk($child, $next-owner, $next-function) });
    }
}
walk($tree);
say to-json(%(compiler => $*RAKU.compiler.version.Str,
    functions => @functions, types => @types), :sorted-keys);
