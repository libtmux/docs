/**
 * Where a language's own types are documented.
 *
 * A type annotation names two kinds of thing: symbols from this estate, which
 * the model resolves, and the language's own — `bool`, `Task`, `Result`,
 * `string`. The second kind is the majority of what renders unlinked, because
 * nothing here defines them and no inventory covers them: Python, the JDK and
 * the DOM ship as intersphinx inventories, and .NET, Rust, Go, C++ and Swift
 * have no equivalent to fetch.
 *
 * So they are curated. A table of the names these ports actually use, each
 * pointing at that language's own documentation. Curated rather than
 * generated because there is no machine-readable source for most of them, and
 * because a wrong entry here sends a reader to the wrong language's docs —
 * which is worse than the plain text it replaces.
 *
 * Names absent from this table stay plain, deliberately. Generic parameters
 * (`T`, `R`, `V`, `Self`) are absent on purpose: they are placeholders, not
 * types, and linking them would point at whatever happened to share the
 * letter.
 */

const dotnet = (page: string) => `https://learn.microsoft.com/dotnet/api/${page}`
const rust = (page: string) => `https://doc.rust-lang.org/std/${page}`
const go = (page: string) => `https://pkg.go.dev/${page}`
const cpp = (page: string) => `https://en.cppreference.com/w/cpp/${page}`
const swift = (page: string) => `https://developer.apple.com/documentation/swift/${page}`
const mdn = (page: string) =>
  `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/${page}`
const ts = (page: string) => `https://www.typescriptlang.org/docs/handbook/2/${page}`

export const BUILTINS: Record<string, Record<string, string>> = {
  dotnet: {
    bool: dotnet('system.boolean'),
    Boolean: dotnet('system.boolean'),
    string: dotnet('system.string'),
    String: dotnet('system.string'),
    int: dotnet('system.int32'),
    Int32: dotnet('system.int32'),
    long: dotnet('system.int64'),
    Int64: dotnet('system.int64'),
    void: dotnet('system.void'),
    object: dotnet('system.object'),
    byte: dotnet('system.byte'),
    Byte: dotnet('system.byte'),
    ArgumentException: dotnet('system.argumentexception'),
    ArgumentNullException: dotnet('system.argumentnullexception'),
    ArgumentOutOfRangeException: dotnet('system.argumentoutofrangeexception'),
    InvalidOperationException: dotnet('system.invalidoperationexception'),
    NotSupportedException: dotnet('system.notsupportedexception'),
    ObjectDisposedException: dotnet('system.objectdisposedexception'),
    TimeoutException: dotnet('system.timeoutexception'),
    ProcessStartInfo: dotnet('system.diagnostics.processstartinfo'),
    ReadOnlySpan: dotnet('system.readonlyspan-1'),
    Span: dotnet('system.span-1'),
    Task: dotnet('system.threading.tasks.task'),
    ValueTask: dotnet('system.threading.tasks.valuetask'),
    CancellationToken: dotnet('system.threading.cancellationtoken'),
    Exception: dotnet('system.exception'),
    IReadOnlyList: dotnet('system.collections.generic.ireadonlylist-1'),
    IReadOnlyDictionary: dotnet('system.collections.generic.ireadonlydictionary-2'),
    IEnumerable: dotnet('system.collections.generic.ienumerable-1'),
    IAsyncEnumerable: dotnet('system.collections.generic.iasyncenumerable-1'),
    IAsyncDisposable: dotnet('system.iasyncdisposable'),
    IDisposable: dotnet('system.idisposable'),
    Func: dotnet('system.func-1'),
    Action: dotnet('system.action'),
    TimeSpan: dotnet('system.timespan'),
    DateTimeOffset: dotnet('system.datetimeoffset'),
    Guid: dotnet('system.guid'),
    Stream: dotnet('system.io.stream'),
    Type: dotnet('system.type'),
  },
  rs: {
    Result: rust('result/enum.Result.html'),
    Option: rust('option/enum.Option.html'),
    Vec: rust('vec/struct.Vec.html'),
    String: rust('string/struct.String.html'),
    str: rust('primitive.str.html'),
    bool: rust('primitive.bool.html'),
    u8: rust('primitive.u8.html'),
    u16: rust('primitive.u16.html'),
    u32: rust('primitive.u32.html'),
    u64: rust('primitive.u64.html'),
    usize: rust('primitive.usize.html'),
    i32: rust('primitive.i32.html'),
    i64: rust('primitive.i64.html'),
    f64: rust('primitive.f64.html'),
    char: rust('primitive.char.html'),
    Duration: rust('time/struct.Duration.html'),
    Instant: rust('time/struct.Instant.html'),
    HashMap: rust('collections/struct.HashMap.html'),
    BTreeMap: rust('collections/struct.BTreeMap.html'),
    PathBuf: rust('path/struct.PathBuf.html'),
    Path: rust('path/struct.Path.html'),
    Arc: rust('sync/struct.Arc.html'),
    Cow: rust('borrow/enum.Cow.html'),
    Into: rust('convert/trait.Into.html'),
    From: rust('convert/trait.From.html'),
    Iterator: rust('iter/trait.Iterator.html'),
    Display: rust('fmt/trait.Display.html'),
    Drop: rust('ops/trait.Drop.html'),
    OsStr: rust('ffi/struct.OsStr.html'),
  },
  go: {
    bool: go('builtin#bool'),
    string: go('builtin#string'),
    int: go('builtin#int'),
    int64: go('builtin#int64'),
    int32: go('builtin#int32'),
    uint32: go('builtin#uint32'),
    byte: go('builtin#byte'),
    rune: go('builtin#rune'),
    float64: go('builtin#float64'),
    error: go('builtin#error'),
    any: go('builtin#any'),
    'context.Context': go('context#Context'),
    'time.Time': go('time#Time'),
    'time.Duration': go('time#Duration'),
    'io.Reader': go('io#Reader'),
    'io.Writer': go('io#Writer'),
    'sync.Mutex': go('sync#Mutex'),
    'fmt.Stringer': go('fmt#Stringer'),
  },
  cxx: {
    void: cpp('language/void'),
    bool: cpp('language/bool_literal'),
    int: cpp('language/types'),
    long: cpp('language/types'),
    size_t: cpp('types/size_t'),
    'std::string': cpp('string/basic_string'),
    'std::string_view': cpp('string/basic_string_view'),
    'std::vector': cpp('container/vector'),
    'std::optional': cpp('utility/optional'),
    'std::shared_ptr': cpp('memory/shared_ptr'),
    'std::unique_ptr': cpp('memory/unique_ptr'),
    'std::function': cpp('utility/functional/function'),
    'std::map': cpp('container/map'),
    'std::chrono': cpp('chrono'),
    'std::variant': cpp('utility/variant'),
    'std::span': cpp('container/span'),
  },
  swift: {
    String: swift('string'),
    Int: swift('int'),
    Bool: swift('bool'),
    Double: swift('double'),
    Array: swift('array'),
    Dictionary: swift('dictionary'),
    Void: swift('void'),
    Error: swift('error'),
    Result: swift('result'),
    Optional: swift('optional'),
    Sendable: swift('sendable'),
    Codable: swift('codable'),
    Hashable: swift('hashable'),
    Equatable: swift('equatable'),
    Comparable: swift('comparable'),
    Duration: swift('duration'),
    Decoder: swift('decoder'),
    Encoder: swift('encoder'),
    // Protocols every conformance in the Swift symbol graphs resolves to.
    // `Bases:` renders these, so an unmapped one shows as bare text.
    Actor: swift('actor'),
    AsyncIteratorProtocol: swift('asynciteratorprotocol'),
    AsyncSequence: swift('asyncsequence'),
    CaseIterable: swift('caseiterable'),
    Copyable: swift('copyable'),
    CustomStringConvertible: swift('customstringconvertible'),
    Decodable: swift('decodable'),
    Encodable: swift('encodable'),
    ExpressibleByArrayLiteral: swift('expressiblebyarrayliteral'),
    ExpressibleByExtendedGraphemeClusterLiteral: swift('expressiblebyextendedgraphemeclusterliteral'),
    ExpressibleByStringLiteral: swift('expressiblebystringliteral'),
    ExpressibleByUnicodeScalarLiteral: swift('expressiblebyunicodescalarliteral'),
    Identifiable: swift('identifiable'),
    OptionSet: swift('optionset'),
    RawRepresentable: swift('rawrepresentable'),
    SendableMetatype: swift('sendablemetatype'),
    SetAlgebra: swift('setalgebra'),
  },
  ts: {
    string: mdn('String'),
    number: mdn('Number'),
    boolean: mdn('Boolean'),
    bigint: mdn('BigInt'),
    symbol: mdn('Symbol'),
    Promise: mdn('Promise'),
    Array: mdn('Array'),
    Map: mdn('Map'),
    Set: mdn('Set'),
    Date: mdn('Date'),
    Error: mdn('Error'),
    RegExp: mdn('RegExp'),
    AsyncIterable: mdn('AsyncIterator'),
    Iterable: mdn('Iterator'),
    void: ts('everyday-types.html#void'),
    never: ts('everyday-types.html#never'),
    unknown: ts('everyday-types.html#unknown'),
    undefined: mdn('undefined'),
    null: mdn('null'),
    Record: ts('..%2Futility-types.html#recordkeys-type'),
    Partial: ts('..%2Futility-types.html#partialtype'),
    Readonly: ts('..%2Futility-types.html#readonlytype'),
  },
  java: {
    boolean: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.5',
    int: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.1',
    long: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.1',
    byte: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.1',
    void: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4.5',
  },
  py: {},
}

/** The documentation URL for a language's own type, if this is one. */
export function builtinHref(port: string, name: string): string | undefined {
  return BUILTINS[port]?.[name]
}
