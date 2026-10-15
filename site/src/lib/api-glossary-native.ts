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
    property: term('A Scala value or variable exposed as a member.', 'Scala values and variables', `${scalaTour('basics')}#values`, 'val prevents reassignment of its binding; var permits it. A val may still refer to a mutable object.'),
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
    static: term('A class member accessed without an instance. A static method has no current object.', 'Java static methods', javaSpec(8, '8.4.3.2')),
    abstract: term('An incompletely implemented class or method. Concrete subclasses implement inherited abstract methods.', 'Java abstract classes', javaSpec(8, '8.1.1.1')),
    readonly: term('A final Java declaration. A final class cannot be extended; a final field cannot be reassigned after initialization.', 'Java final declarations', javaSpec(8, '8.1.1.2')),
    overload: term('Methods sharing a name with different signatures; the compiler resolves a call from its arguments.', 'Java overloading', javaSpec(8, '8.4.9')),
    package: term('The library artifact supplying the Java API, distinct from a package used to qualify class names.', 'Java packages', javaSpec(7, '7.1')),
  },
  kotlin: {
    module: term('A Kotlin object or companion object that groups declarations under one instance.', 'Kotlin object declarations', kotlinDocs('object-declarations'), 'The module badge describes this declaration scope, not a separately installed Gradle module.'),
    class: term('A Kotlin class declaring constructors, properties and member functions.', 'Kotlin classes', kotlinDocs('classes'), 'Classes are final unless the declaration permits inheritance. Data classes add generated operations described by their declaration.'),
    function: term('A Kotlin function declared with fun at top level or inside another scope.', 'Kotlin functions', kotlinDocs('functions'), 'Extension functions are resolved from their declared receiver and scope; they do not add members to the receiver class.'),
    method: term('A Kotlin member function called on its receiver.', 'Kotlin member functions', `${kotlinDocs('functions')}#function-scope`, 'Read the signature for receiver, parameters, result and any suspend requirement.'),
    property: term('A Kotlin val or var accessed through a getter and, for var, a setter.', 'Kotlin properties', kotlinDocs('properties'), 'Accessors may execute code. A val has no setter but may return a mutable object.'),
    async: term('A Kotlin suspend function that can suspend inside a coroutine.', 'Kotlin suspending functions', kotlinDocs('coroutines-basics'), 'Calling a suspending function does not itself launch a coroutine or guarantee execution on another thread.'),
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
}
