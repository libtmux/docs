/** Native meanings of the shared reference labels, keyed by language. */
import type { Definition } from './api-glossary.ts'

const term = (definition: string, title: string, url: string, detail?: string): Definition => ({
  definition, ...(detail ? { detail } : {}), references: [{ title, url }],
})
const scalaTour = (page: string) => `https://docs.scala-lang.org/tour/${page}.html`
const scalaReference = (page: string) => `https://docs.scala-lang.org/scala3/reference/${page}.html`
const javaSpec = (chapter: number, section: string) => `https://docs.oracle.com/javase/specs/jls/se21/html/jls-${chapter}.html#jls-${section}`
const kotlinDocs = (page: string) => `https://kotlinlang.org/docs/${page}.html`
const juliaManual = (page: string) => `https://docs.julialang.org/en/v1/manual/${page}/`
const pythonDocs = (page: string) => `https://docs.python.org/3/${page}.html`
const tsHandbook = (page: string) => `https://www.typescriptlang.org/docs/handbook/2/${page}.html`
const csharpDocs = (page: string) => `https://learn.microsoft.com/en-us/dotnet/csharp/${page}`
const fsharpDocs = (page: string) => `https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/${page}`
const powershellDocs = (page: string) => `https://learn.microsoft.com/en-us/powershell/${page}`
const goSpec = (section: string) => `https://go.dev/ref/spec#${section}`
const cxxSpec = (section: string) => `https://eel.is/c++draft/${section}`
const rustReference = (page: string) => `https://doc.rust-lang.org/reference/${page}.html`
const rubySyntax = (page: string) => `https://docs.ruby-lang.org/en/3.4/syntax/${page}_rdoc.html`
const luaManual = (section: string) => `https://www.lua.org/manual/5.4/manual.html#${section}`
const luaAnnotation = (section: string) => `https://luals.github.io/wiki/annotations/#${section}`
const elixirDocs = (page: string) => `https://elixir.hexdocs.pm/${page}`
const swiftBook = (page: string) => `https://docs.swift.org/latest/documentation/the-swift-programming-language/${page}/`

export const NATIVE_API_GLOSSARIES: Record<string, Record<string, Definition>> = {
  scala: {
    module: term('A singleton object that groups Scala declarations.', 'Scala singleton objects', scalaTour('singleton-objects'), 'The module badge represents object declarations here. Its members belong to that object; the label does not identify a separately installed artifact.'),
    class: term('A Scala class that defines instances, constructors and members.', 'Scala classes', scalaTour('classes'), 'Traits and case classes have their own declaration syntax; read the displayed signature for those distinctions.'),
    enum: term('A Scala enum whose cases describe the alternatives of a type.', 'Scala enums', scalaReference('enums/enums'), 'Cases can be singleton values or carry constructor parameters.'),
    function: term('A callable Scala declaration shown at package or object scope.', 'Scala functions and methods', `${scalaTour('basics')}#methods`, 'A def declaration is a method; a function value is a value that can be applied. The signature distinguishes them.'),
    method: {
      definition: 'A Scala method declared with def, with parameter lists and a result type.',
      detail: 'An extension method adds callable syntax to a receiver without changing its type. The extension declaration identifies that receiver and any contextual requirements.',
      references: [
        { title: 'Scala method declarations', url: `${scalaTour('basics')}#methods` },
        { title: 'Scala extension methods', url: scalaReference('contextual/extension-methods') },
      ],
    },
    property: {
      definition: 'A Scala value or variable exposed as a member.',
      detail: 'val prevents reassignment of its binding; var permits it. A val may still refer to a mutable object.',
      references: [{ title: 'Scala values', url: `${scalaTour('basics')}#values` }, { title: 'Scala variables', url: `${scalaTour('basics')}#variables` }],
    },
    constant: term('A named Scala value exposed by the API.', 'Scala values', `${scalaTour('basics')}#values`, 'Read its declaration for val, lazy val or a literal value; the badge alone does not promise compile-time evaluation.'),
    typealias: term('A Scala type name defined with type, including an opaque type alias.', 'Scala opaque type aliases', scalaReference('other-new-features/opaques'), 'An opaque alias hides its representation outside its defining scope while retaining that representation inside it.'),
    opaque: term('A Scala opaque type alias whose representation is visible in its defining scope and hidden outside it.', 'Scala opaque type aliases', scalaReference('other-new-features/opaques'), 'Its public bounds and provided operations define how callers can use the alias.'),
    overload: term('Scala methods with the same name and different accepted parameter types or lists.', 'Scala overload resolution', scalaReference('changed-features/overload-resolution'), 'The call and its available context determine which signature applies.'),
    package: term('The library artifact supplying this Scala API.', 'Scala packages and imports', scalaTour('packages-and-imports'), 'An artifact dependency and a Scala package used in imports are different names; use the displayed installation and import instructions.'),
  },
  java: {
    class: term('A Java reference type declared with class, with its constructors, fields and methods.', 'Java class declarations', javaSpec(8, '8.1')),
    interface: term('A Java contract with abstract, default or static methods, implemented by classes.', 'Java interfaces', javaSpec(9, '9.1')),
    struct: term('A Java record class, shown with the struct badge. Components have private final fields and public accessors.', 'Java record classes', javaSpec(8, '8.10')),
    enum: term('A Java enum class whose named constants are instances of that class.', 'Java enum classes', javaSpec(8, '8.9')),
    method: term('Named Java behavior called on an object or, for static methods, on a class.', 'Java method declarations', javaSpec(8, '8.4')),
    attribute: term('A Java field holding a value on an instance or its class.', 'Java fields', javaSpec(8, '8.3')),
    constant: term('A named Java API value. A final primitive or String initialized with a constant expression is a constant variable.', 'Java constant variables', javaSpec(4, '4.12.4')),
    annotation: term('A Java annotation interface declared with @interface, or an element declared inside it.', 'Java annotation interfaces and elements', javaSpec(9, '9.6'), 'Elements are declared as methods with no parameters. An element may use default to supply its value when an annotation omits it.'),
    static: term('A class member accessed without an instance. A static method has no current object.', 'Java static methods', javaSpec(8, '8.4.3.2')),
    abstract: term('An incompletely implemented class or method. Concrete subclasses implement inherited abstract methods.', 'Java abstract classes', javaSpec(8, '8.1.1.1')),
    readonly: {
      definition: 'A final Java declaration. A final class cannot be extended; a final field cannot be reassigned after initialization.',
      references: [{ title: 'Java final classes', url: javaSpec(8, '8.1.1.2') }, { title: 'Java final fields', url: javaSpec(8, '8.3.1.2') }],
    },
    overload: term('Methods sharing a name with different signatures; the compiler resolves a call from its arguments.', 'Java overloading', javaSpec(8, '8.4.9')),
    package: term('The library artifact supplying the Java API, distinct from a package used to qualify class names.', 'Java packages', javaSpec(7, '7.1')),
  },
  kotlin: {
    module: term('A Kotlin object or companion object that groups declarations under one instance.', 'Kotlin object declarations', kotlinDocs('object-declarations'), 'The module badge describes this declaration scope, not a separately installed Gradle module.'),
    class: term('A Kotlin class declaring constructors, properties and member functions.', 'Kotlin classes', kotlinDocs('classes'), 'Classes are final unless the declaration permits inheritance. Data classes add generated operations described by their declaration.'),
    function: term('A Kotlin function declared with fun at top level or inside another scope.', 'Kotlin functions', kotlinDocs('functions'), 'Extension functions are resolved from their declared receiver and scope; they do not add members to the receiver class.'),
    method: term('A Kotlin member function called on its receiver.', 'Kotlin member functions', `${kotlinDocs('functions')}#function-scope`, 'Read the signature for receiver, parameters, result and any suspend requirement.'),
    property: term('A Kotlin val or var accessed through a getter and, for var, a setter.', 'Kotlin properties', kotlinDocs('properties'), 'Accessors may execute code. A val has no setter but may return a mutable object.'),
    async: term('A Kotlin suspend function that can suspend inside a coroutine.', 'Kotlin suspending functions', `${kotlinDocs('coroutines-basics')}#suspending-functions`, 'Calling a suspending function does not itself launch a coroutine or guarantee execution on another thread.'),
    overload: term('Kotlin functions sharing a name with distinct accepted signatures.', 'Kotlin functions', kotlinDocs('functions'), 'Argument types, receivers and available overloads determine which declaration a call resolves to.'),
    package: term('The library dependency supplying this Kotlin API.', 'Kotlin packages and imports', kotlinDocs('packages'), 'A Kotlin package organizes declarations; its name need not equal the Gradle artifact name.'),
  },
  julia: {
    module: term('A Julia namespace with its own global bindings and imported or exported names.', 'Julia modules', juliaManual('modules')),
    class: term('A Julia abstract type, grouped under the class badge.', 'Julia abstract types', `${juliaManual('types')}#man-abstract-types`, 'It defines a place in the type hierarchy and cannot be instantiated directly.'),
    struct: term('A Julia composite type declared with struct or mutable struct.', 'Julia composite types', `${juliaManual('types')}#Composite-Types`, 'struct prevents field reassignment; mutable struct permits it. Fields may refer to mutable values in either case.'),
    function: term('A Julia generic function whose methods implement calls for different argument types.', 'Julia methods', juliaManual('methods'), 'Dispatch selects a method from the types of its positional arguments; keyword arguments follow separate rules.'),
    method: term('One Julia implementation of a generic function for particular argument types.', 'Julia method dispatch', juliaManual('methods'), 'Methods belong to functions rather than being stored on an instance; call the function with its arguments.'),
    property: term('A Julia value obtained through dot access, which can invoke getproperty.', 'Julia property access', 'https://docs.julialang.org/en/v1/base/base/#Base.getproperty', 'A property can be computed; getfield reads a stored field directly.'),
    attribute: term('A named Julia field or property accessed on a value.', 'Julia fields and properties', 'https://docs.julialang.org/en/v1/base/base/#Base.getproperty', 'Dot access can invoke getproperty rather than read storage directly.'),
    typealias: term('A Julia binding that gives another name to a type expression.', 'Julia type aliases', `${juliaManual('types')}#Type-Aliases`, 'The alias refers to that type; it does not declare a new concrete representation.'),
    abstract: term('A Julia abstract type that can have subtypes but no direct instances.', 'Julia abstract types', `${juliaManual('types')}#man-abstract-types`),
    readonly: term('A Julia field whose containing immutable struct prevents field reassignment.', 'Julia immutable composite types', `${juliaManual('types')}#Composite-Types`, 'A referenced vector or other mutable value can still change internally.'),
    package: term('The Julia package supplying the module and its public bindings.', 'Julia code loading', juliaManual('code-loading'), 'Package loading and module namespaces are related but distinct; use the documented project environment.'),
  },
  elixir: {
    module: term('An Elixir module, a named collection of functions, macros and types defined with defmodule.', 'Elixir modules and functions', elixirDocs('modules-and-functions.html'), 'Module names are atoms, and a nested name such as LibTmux.Control.Request is one flat module rather than a child of LibTmux.Control.'),
    struct: term('An Elixir module that defines a struct: a map with a fixed set of keys and optional defaults.', 'Elixir structs', elixirDocs('structs.html'), 'Fields hold values and are never reassigned. Functions on the module return a new struct rather than changing one.'),
    exception: term('An Elixir struct declared with defexception, which can be raised and rescued.', 'Elixir exceptions', `${elixirDocs('Kernel.html')}#defexception/1`, 'The struct also carries the fields of the error. A bang function raises it; the plain function returns it in an error tuple.'),
    interface: term('An Elixir behaviour, a module that declares callbacks other modules implement.', 'Elixir behaviours', `${elixirDocs('typespecs.html')}#behaviours`, 'A module implements a behaviour with the @behaviour attribute and defines each required callback.'),
    function: term('An Elixir function identified by its module, name and arity.', 'Elixir functions', elixirDocs('modules-and-functions.html'), 'Functions of one name and different arities are different functions. A name ending in ! raises on failure, and a name ending in ? returns a boolean.'),
    method: term('A callback that a behaviour declares and an implementing module defines.', 'Elixir behaviour callbacks', `${elixirDocs('typespecs.html')}#behaviours`, 'A callback is called through the implementing module, not through the behaviour that declares it.'),
    property: term('A field of an Elixir struct, read with dot access or pattern matching.', 'Elixir structs', elixirDocs('structs.html'), 'A field has no accessor function; structs are plain maps, so the value is stored as the field holds it.'),
    typealias: term('An Elixir type declared with @type or @opaque, named and given an arity.', 'Elixir user-defined types', `${elixirDocs('typespecs.html')}#user-defined-types`, 'Types document values for readers and tools. They are not checked when a function runs.'),
    macro: term('An Elixir macro, defined with defmacro and expanded at compile time.', 'Elixir macros', `${elixirDocs('Kernel.html')}#defmacro/2`, 'A caller must require or import the defining module before using the macro.'),
    abstract: term('A callback of a behaviour, declared without a body.', 'Elixir behaviour callbacks', `${elixirDocs('typespecs.html')}#behaviours`),
    opaque: term('An Elixir type declared with @opaque, whose structure callers must not depend on.', 'Elixir user-defined types', `${elixirDocs('typespecs.html')}#user-defined-types`, 'Other modules should build and inspect the value only through the declaring module’s functions.'),
    deprecated: term('A declaration marked with the @deprecated attribute.', 'Elixir @deprecated attribute', `${elixirDocs('Module.html')}#module-deprecated-since-v1-6-0`, 'The compiler warns at call sites of a deprecated function. The message names the replacement when the author gave one.'),
    overload: term('A function with several @spec clauses, each describing one accepted combination of argument types.', 'Elixir function specifications', `${elixirDocs('typespecs.html')}#defining-a-specification`, 'The clauses describe one function. Which clause applies depends on the arguments, not on a separate definition.'),
    package: term('The Hex package supplying this API.', 'Hex packages', 'https://hex.pm/docs/usage', 'A package name and its application name are the same in a Mix dependency, and the module names it defines are independent of both.'),
  },
  py: {
    class: term('A Python type defining attributes and behavior for its instances.', 'Python classes', pythonDocs('tutorial/classes')),
    function: term('A Python callable defined with def or a lambda expression.', 'Python function definitions', `${pythonDocs('reference/compound_stmts')}#function-definitions`),
    method: term('A Python callable obtained through a class or instance. An ordinary bound method supplies its instance as the first argument.', 'Python instance methods', `${pythonDocs('reference/datamodel')}#instance-methods`),
    property: term('A Python descriptor whose getter, setter or deleter runs during attribute access.', 'Python properties', `${pythonDocs('builtins/functions')}#property`, 'A property need not correspond to a stored field, and reading it may execute code.'),
    attribute: term('A named Python value accessed on an object or class, potentially through a descriptor or dynamic lookup.', 'Python attribute access', `${pythonDocs('reference/datamodel')}#customizing-attribute-access`),
    constant: term('A named Python API value conventionally treated as constant. Uppercase naming does not prevent reassignment at runtime.', 'Python constant naming', 'https://peps.python.org/pep-0008/#constants'),
    exception: term('A Python exception class whose instances can be raised and handled with except.', 'Python exceptions', `${pythonDocs('tutorial/errors')}#user-defined-exceptions`),
    async: term('A Python coroutine function declared with async def. Calling it creates a coroutine to await or schedule.', 'Python coroutine functions', `${pythonDocs('reference/compound_stmts')}#coroutine-function-definition`),
    classmethod: term('A Python method that receives the class as its implicit first argument, including when called through an instance.', 'Python class methods', `${pythonDocs('builtins/functions')}#classmethod`),
    inherited: term('A Python member resolved from a base class through the method resolution order.', 'Python inheritance', `${pythonDocs('tutorial/classes')}#inheritance`, 'The reference names the declaring class so its original definition remains navigable.'),
    package: term('The Python distribution supplying this API. Its installation name can differ from the package name used in imports.', 'Python distributions and import packages', 'https://packaging.python.org/en/latest/discussions/distribution-package-vs-import-package/'),
  },
  ts: {
    class: term('A TypeScript class declaring a runtime constructor and members, with a corresponding instance type.', 'TypeScript classes', tsHandbook('classes')),
    interface: term('A TypeScript type describing a structural contract. It does not create a runtime object or constructor.', 'TypeScript interfaces', `${tsHandbook('everyday-types')}#interfaces`),
    function: term('A TypeScript callable with typed parameters and a return type.', 'TypeScript functions', tsHandbook('functions')),
    method: term('A TypeScript function member declared on a class or object type.', 'TypeScript methods', `${tsHandbook('classes')}#methods`),
    property: {
      definition: 'A TypeScript object member, including a stored field or an accessor.',
      detail: 'Getters and setters can execute code; the type declaration alone does not promise storage.',
      references: [{ title: 'TypeScript fields', url: `${tsHandbook('classes')}#fields` }, { title: 'TypeScript getters and setters', url: `${tsHandbook('classes')}#getters--setters` }],
    },
    attribute: term('A TypeScript field or declared object member in this reference.', 'TypeScript fields', `${tsHandbook('classes')}#fields`),
    typealias: term('A TypeScript name for a type expression, including a union, object or function type.', 'TypeScript type aliases', `${tsHandbook('everyday-types')}#type-aliases`, 'It does not create a runtime constructor or a distinct nominal type.'),
    async: term('A TypeScript async function returning a Promise. Awaiting it can suspend its caller without implying a new thread.', 'TypeScript async/await in ES6 targets', 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-1-7.html#asyncawait-support-in-es6-targets-node-v4'),
    private: term('A TypeScript member restricted to its declaring class.', 'TypeScript member visibility', `${tsHandbook('classes')}#member-visibility`, 'The private keyword is checked by TypeScript; JavaScript #private fields also enforce privacy at runtime.'),
    readonly: term('A TypeScript member that cannot be assigned through that typed reference after its permitted initialization.', 'TypeScript readonly fields', `${tsHandbook('classes')}#readonly`, 'Referenced objects may still be mutable; readonly does not freeze them.'),
    static: term('A TypeScript member accessed on its class constructor rather than on an instance.', 'TypeScript static members', `${tsHandbook('classes')}#static-members`),
    overload: term('Multiple TypeScript call signatures describing accepted argument and result combinations.', 'TypeScript overloads', `${tsHandbook('functions')}#function-overloads`, 'A function implementation supplies one body; callers use its exposed overload signatures.'),
    package: term('The npm package supplying this TypeScript API. Package identity and module import paths can differ.', 'TypeScript modules and packages', 'https://www.typescriptlang.org/docs/handbook/modules/reference.html#node_modules-package-lookups'),
  },
  csharp: {
    class: term('A C# reference type with constructors, fields and function members.', 'C# classes', csharpDocs('language-reference/language-specification/classes')),
    interface: term('A C# contract declaring members that implementing types provide, potentially with default implementations.', 'C# interfaces', csharpDocs('language-reference/keywords/interface')),
    struct: term('A C# value type whose assignment copies its value. Referenced objects inside it can remain shared.', 'C# structures', csharpDocs('language-reference/builtin-types/struct')),
    enum: term('A C# value type with named integral constants and a specified underlying integer type.', 'C# enums', csharpDocs('language-reference/builtin-types/enum')),
    method: term('A C# callable member invoked on an instance or, for static methods, on a type.', 'C# methods', csharpDocs('programming-guide/classes-and-structs/methods')),
    property: term('A C# member accessed through get, set or init accessors, which may execute code.', 'C# properties', csharpDocs('programming-guide/classes-and-structs/properties')),
    constant: term('A named C# constant or enum member. const values are compile-time values; static readonly fields are initialized at runtime.', 'C# constants', csharpDocs('programming-guide/classes-and-structs/constants')),
    static: term('A C# member belonging to its type rather than a particular instance.', 'C# static members', csharpDocs('programming-guide/classes-and-structs/static-classes-and-static-class-members')),
    abstract: term('A C# class that cannot be instantiated, or a member whose implementation is supplied by a derived type.', 'C# abstract declarations', csharpDocs('language-reference/keywords/abstract')),
    async: term('A C# method that can await asynchronous work. The modifier does not itself start a new thread.', 'C# async methods', csharpDocs('language-reference/keywords/async')),
    readonly: term('A C# field assignable during initialization or construction, or a struct with readonly instance fields.', 'C# readonly declarations', csharpDocs('language-reference/keywords/readonly'), 'References stored in readonly fields can still point to mutable objects.'),
    overload: term('C# methods sharing a name but accepting different parameter signatures.', 'C# signatures and overloading', csharpDocs('language-reference/language-specification/basic-concepts#75-signatures-and-overloading')),
    package: term('The NuGet package supplying this C# API. A package name is distinct from a namespace or assembly name.', 'NuGet packages', 'https://learn.microsoft.com/en-us/nuget/what-is-nuget'),
  },
  fsharp: {
    module: term('An F# grouping of values, functions and types, addressed by a qualified name or opened into scope.', 'F# modules', fsharpDocs('modules')),
    class: {
      definition: 'An F# class groups constructors and members. The shared class badge also covers some abbreviated types; inspect their signatures.',
      references: [{ title: 'F# classes', url: fsharpDocs('classes') }, { title: 'F# type abbreviations', url: fsharpDocs('type-abbreviations') }],
    },
    struct: term('An F# record or structured type in this reference. Records are reference types unless marked with the Struct attribute.', 'F# records', fsharpDocs('records')),
    enum: term('An F# discriminated union in this reference, with named cases that can carry data.', 'F# discriminated unions', fsharpDocs('discriminated-unions')),
    function: term('An F# callable value, often declared with let or exposed with val in a signature file.', 'F# functions', fsharpDocs('functions/'), 'Curried arguments can be supplied one at a time; tupled arguments form a single argument value.'),
    method: term('An F# member function declared on a type, called on an instance or as a static member.', 'F# methods', fsharpDocs('members/methods')),
    property: term('An F# member accessed as a value through a getter and an optional setter.', 'F# properties', fsharpDocs('members/properties'), 'Accessors may execute code; a property is not necessarily a record field.'),
    constant: term('A named F# union case or literal value in this reference. A union case can accept associated data.', 'F# union cases', fsharpDocs('discriminated-unions')),
    package: term('The NuGet package supplying this F# API. Its package identity and F# namespace or module names serve different roles.', 'NuGet packages', 'https://learn.microsoft.com/en-us/nuget/what-is-nuget'),
  },
  powershell: {
    cmdlet: term('A PowerShell command participating in pipeline input, parameter binding and object output.', 'PowerShell cmdlets', powershellDocs('scripting/developer/cmdlet/cmdlet-overview'), 'The reference uses this label for exported advanced functions as well as binary cmdlets.'),
    function: term('A PowerShell named script block with parameters and a body.', 'PowerShell functions', powershellDocs('module/microsoft.powershell.core/about/about_functions'), 'Advanced functions use CmdletBinding and related attributes for cmdlet-style behavior.'),
    module: term('A PowerShell unit loaded with Import-Module, grouping exported commands and resources.', 'PowerShell modules', powershellDocs('scripting/developer/module/understanding-a-windows-powershell-module')),
    package: term('The distributed PowerShell module supplying these commands, distinct from each exported Verb-Noun command name.', 'PowerShell module distribution', powershellDocs('scripting/developer/module/writing-a-windows-powershell-module')),
  },
  go: {
    struct: term('A named Go type shown under the struct badge in this reference.', 'Go type definitions', goSpec('Type_definitions'), 'The underlying type can be a struct, string, function or another Go type. Its declaration determines fields, call syntax and conversion rules.'),
    function: term('A Go function declared at package scope with parameters and result values.', 'Go function declarations', goSpec('Function_declarations')),
    method: term('A Go function with a receiver parameter associating it with a defined type.', 'Go method declarations', goSpec('Method_declarations'), 'A pointer receiver and a value receiver have different method sets; follow the displayed signature.'),
    attribute: term('A Go struct field or package variable in this reference, including exported error values.', 'Go variable declarations', goSpec('Variable_declarations')),
    constant: term('A Go constant value. Typed and untyped constants follow the type and representability rules at their use site.', 'Go constants', goSpec('Constants')),
    package: term('The Go module supplying this API. Its importable packages have paths and names distinct from the module dependency identity.', 'Go modules and packages', 'https://go.dev/doc/modules/layout'),
  },
  cxx: {
    class: term('A C++ class type grouping data and member functions, with private member access by default.', 'C++ classes', cxxSpec('class.pre')),
    struct: term('A C++ class declared with struct, whose members and bases are public by default.', 'C++ class keys', cxxSpec('class.pre'), 'struct does not imply immutability or a particular allocation strategy.'),
    enum: term('A C++ enumeration with named values. enum class introduces a scoped enumeration.', 'C++ enumerations', cxxSpec('dcl.enum')),
    function: term('A C++ non-member function, typically declared within a namespace.', 'C++ function declarations', cxxSpec('dcl.fct')),
    method: term('A C++ member function invoked for an object or, when static, through its class.', 'C++ member functions', cxxSpec('class.mfct.non.static')),
    attribute: term('A C++ data member in this reference. The badge describes data, rather than a bracketed attribute annotation.', 'C++ data members', cxxSpec('class.mem')),
    constant: term('A named C++ API value or preprocessor macro. Read the declaration to distinguish const, constexpr and #define.', 'C++ macro replacement', cxxSpec('cpp.replace')),
    typealias: term('A C++ typedef or using declaration naming an existing type without creating a new distinct type.', 'C++ type aliases', cxxSpec('dcl.typedef')),
    static: term('A C++ member associated with its class rather than a particular object.', 'C++ static members', cxxSpec('class.static')),
    abstract: term('A C++ class with an unimplemented pure virtual function, which cannot be instantiated directly.', 'C++ abstract classes', cxxSpec('class.abstract')),
    readonly: term('A const-qualified C++ declaration. A const member function cannot change ordinary members through this; mutable members and referenced objects may still change.', 'C++ const qualification', cxxSpec('dcl.type.cv')),
    overload: term('C++ functions sharing a name, resolved from arguments and the applicable member qualifiers.', 'C++ overload resolution', cxxSpec('over.match')),
    package: term('The C++ library distribution supplying headers and library targets. Its installation identity is separate from namespace names.', 'CMake packages', 'https://cmake.org/cmake/help/latest/manual/cmake-packages.7.html'),
  },
  rs: {
    class: {
      definition: 'A Rust named type shown with the shared class badge. Rust declares structs and enums; inspect the declaration for its actual form.',
      references: [{ title: 'Rust structs', url: rustReference('items/structs') }, { title: 'Rust enums', url: rustReference('items/enumerations') }],
    },
    struct: term('A Rust data type with named, tuple or no fields. Its fields, visibility and ownership follow the declaration.', 'Rust structs', rustReference('items/structs')),
    enum: term('A Rust type whose variants can be unit-like, tuple-like or struct-like, each potentially carrying data.', 'Rust enums', rustReference('items/enumerations')),
    trait: term('A Rust contract of associated functions, types and constants implemented for concrete types.', 'Rust traits', rustReference('items/traits')),
    function: term('A Rust fn item with typed parameters, a return type and any declared generic bounds.', 'Rust functions', rustReference('items/functions')),
    method: term('A Rust associated function declared on a type or trait.', 'Rust associated functions and methods', `${rustReference('items/associated-items')}#associated-functions-and-methods`, 'A function with a self receiver is a method; its receiver determines borrowing or ownership. An associated function without a receiver, such as a constructor, is called with Type::function.'),
    attribute: term('A Rust struct field in this reference, rather than a #[...] attribute annotation.', 'Rust fields', rustReference('items/structs')),
    constant: {
      definition: 'A Rust constant or enum variant shown as a named API value. Variants can carry fields.',
      references: [{ title: 'Rust constants', url: rustReference('items/constant-items') }, { title: 'Rust enum variants', url: rustReference('items/enumerations') }],
    },
    typealias: term('A Rust type name referring to an existing type expression, without creating a distinct newtype.', 'Rust type aliases', rustReference('items/type-aliases')),
    async: term('A Rust async fn that returns a future. Its body runs when that future is polled, rather than when the function is called.', 'Rust async functions', `${rustReference('items/functions')}#async-functions`),
    overload: term('Multiple extracted declarations or implementations for this Rust item. Inspect the impl and trait context; Rust functions do not overload by parameter types.', 'Rust associated declarations', rustReference('items/associated-items')),
    package: term('A Cargo package supplying one or more crates. Rust paths and imports refer to crates and their modules.', 'Cargo packages and targets', 'https://doc.rust-lang.org/cargo/reference/cargo-targets.html'),
  },
  ruby: {
    module: term('A Ruby namespace that can also supply instance methods as a mixin.', 'Ruby modules', `${rubySyntax('modules_and_classes')}#label-Modules`),
    class: term('A Ruby object type defining instance behavior and inheriting from a superclass.', 'Ruby classes', `${rubySyntax('modules_and_classes')}#label-Classes`),
    method: term('A Ruby operation called on a receiver, usually declared with def.', 'Ruby methods', rubySyntax('methods'), 'Instance methods act on instances; singleton methods act on a particular object, including a class object.'),
    static: term('A Ruby class-level or module-level singleton method, called on that object.', 'Ruby singleton methods', rubySyntax('methods')),
    typealias: term('An RBS type alias used to describe Ruby values for tooling. It does not define a runtime class.', 'RBS type aliases', 'https://github.com/ruby/rbs/blob/master/docs/syntax.md#type-alias-declaration'),
    package: term('The Ruby gem supplying this API. Gem names identify distributions; require loads Ruby files.', 'Ruby gems', 'https://guides.rubygems.org/what-is-a-gem/'),
  },
  lua: {
    module: term('A Lua module loaded through require, commonly returning a table of exported values.', 'Lua modules', luaManual('pdf-require')),
    class: term('A Lua tooling annotation describing a table or other value as a named object shape.', 'Lua class annotations', luaAnnotation('class'), 'Lua does not have a class declaration keyword; the implementation supplies its runtime behavior.'),
    function: term('A Lua callable value with parameters and potentially multiple results.', 'Lua function definitions', luaManual('3.4.11')),
    method: term('A Lua function called with colon syntax, which passes the receiver as the first argument self.', 'Lua method calls', luaManual('3.4.10')),
    attribute: term('A Lua table field or annotated member. Reading a missing field may invoke a metatable lookup.', 'Lua table access', luaManual('2.4')),
    typealias: term('A Lua tooling alias describing a type expression in comments, without declaring a runtime type.', 'Lua type aliases', luaAnnotation('alias')),
    overload: term('Alternative Lua function signatures supplied by documentation annotations, rather than runtime overload selection.', 'Lua overload annotations', luaAnnotation('overload')),
    inherited: term('A Lua member documented on an annotated parent type. Follow its declaring type for the original contract.', 'Lua class inheritance', luaAnnotation('class')),
    package: term('The Lua library distribution supplying these modules. A package name and the string passed to require need not match.', 'Lua packages and require', luaManual('6.3')),
  },
  swift: {
    class: term('A Swift reference type whose instances can share identity and whose subclasses can inherit behavior.', 'Swift classes', swiftBook('classesandstructures')),
    struct: term('A Swift value type copied when assigned or passed. Reference-valued properties can still share objects.', 'Swift structures', swiftBook('classesandstructures')),
    enum: term('A Swift type with named cases, which can carry associated values or have raw values.', 'Swift enumerations', swiftBook('enumerations')),
    interface: term('A Swift protocol declaring requirements for conforming types, shown with the interface badge.', 'Swift protocols', swiftBook('protocols')),
    function: term('A Swift callable declared with func, using parameter names, argument labels and a result type.', 'Swift functions', swiftBook('functions')),
    method: term('A Swift function associated with a class, structure or enumeration.', 'Swift methods', swiftBook('methods'), 'Instance methods use a value; type methods are called on the type. mutating permits changes to a value-type receiver.'),
    property: term('A Swift stored or computed member, declared with let or var as applicable.', 'Swift properties', swiftBook('properties'), 'Computed properties use accessors; their value need not be stored.'),
    constant: term('A Swift binding declared with let, or a named enum case in this reference.', 'Swift constants', swiftBook('thebasics'), 'A let binding cannot be reassigned, but a referenced class instance may remain mutable.'),
    typealias: term('A Swift name for an existing type, without defining a new distinct type.', 'Swift type aliases', `${swiftBook('declarations')}#Type-Alias-Declaration`),
    static: term('A Swift member called or accessed on its type. Class members declared with class can allow subclass overrides.', 'Swift type methods', swiftBook('methods')),
    async: term('A Swift asynchronous function that can suspend at await points, without promising a particular thread.', 'Swift concurrency', swiftBook('concurrency')),
    overload: term('Swift declarations sharing a base name, distinguished by their argument labels, types and applicable context.', 'Swift function declarations', swiftBook('functions')),
    inherited: term('A Swift member supplied by a superclass. The reference identifies its original declaring type.', 'Swift inheritance', swiftBook('inheritance')),
    package: term('The Swift package supplying products built from modules and targets. Package and module names serve different roles.', 'Swift packages', 'https://www.swift.org/documentation/package-manager/'),
  },
}
