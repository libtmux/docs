#r "FSharp.Compiler.Service.dll"

open System
open System.IO
open System.Text.Json
open System.Text.RegularExpressions
open System.Xml.Linq
open FSharp.Compiler.CodeAnalysis
open FSharp.Compiler.Diagnostics
open FSharp.Compiler.Syntax
open FSharp.Compiler.Text
open FSharp.Compiler.Xml

// Run through the source repository's pinned SDK, which supplies this parser.
type Parameter = { name: string; ``type``: string; optional: bool }
type Declaration = {
    id: string
    name: string
    kind: string
    parent: string
    file: string
    line: int
    signature: string
    parameters: Parameter array
    returns: string
    documentation: string
    namespaces: string array
}

let declarations = ResizeArray<Declaration>()
let checker = FSharpChecker.Create()
let publicAccess = function None | Some (SynAccess.Public _) -> true | _ -> false
let qualify owner name = if String.IsNullOrEmpty owner then name else owner + "." + name
let xml (doc: PreXmlDoc) = doc.ToXmlDoc(false, None).GetXmlText()
let compact text = Regex.Replace(text, @"\s+", " ").Trim()

let parseFile file =
    let mutable namespaces: string list = []
    let lines = File.ReadAllLines file
    let source (range: range) =
        [ for row in range.StartLine .. range.EndLine do
            let line = lines[row - 1]
            let first = if row = range.StartLine then range.StartColumn else 0
            let last = if row = range.EndLine then range.EndColumn else line.Length
            yield line.Substring(first, last - first) ]
        |> String.concat "\n"
    let add owner name kind (range: range) signature parameters returns doc =
        declarations.Add {
            id = qualify owner name; name = name; kind = kind; parent = owner
            file = file; line = range.StartLine; signature = signature
            parameters = parameters; returns = returns; documentation = xml doc
            namespaces = Array.ofList namespaces
        }
    let parameter position = function
        | SynType.SignatureParameter(optional = optional; id = name; usedType = value) ->
            { name = name |> Option.map _.idText |> Option.defaultValue $"arg{position}"
              ``type`` = compact (source value.Range); optional = optional }
        | value ->
            { name = $"arg{position}"; ``type`` = compact (source value.Range); optional = false }
    let rec signature (parameters: Parameter list) = function
        | SynType.WithGlobalConstraints(typeName = value) -> signature parameters value
        | SynType.Fun(argType = argument; returnType = returns) ->
            signature (parameters @ [parameter (parameters.Length + 1) argument]) returns
        | returns -> Array.ofList parameters, compact (source returns.Range)
    let emitValue owner prefix (SynValSig(ident = SynIdent(name, _); synType = value;
                                        xmlDoc = doc; accessibility = access; range = range)) =
        let access = match access with SynValSigAccess.Single access | SynValSigAccess.GetSet(access, _, _) -> access
        if publicAccess access then
            let parameters, returns = signature [] value
            let kind = if prefix = "member" then "method" elif parameters.Length > 0 then "function" else "constant"
            let written = prefix + " " + source (Range.mkRange file name.idRange.Start range.End)
            add owner name.idText kind name.idRange written parameters returns doc
    let componentInfo (SynComponentInfo(longId = names; xmlDoc = doc; accessibility = access; range = range)) =
        String.concat "." (names |> List.map _.idText), doc, access, range
    let rec emitType owner (SynTypeDefnSig(typeInfo = info; typeRepr = repr; members = members;
                                         range = declarationRange; trivia = trivia)) =
        let name, doc, access, range = componentInfo info
        if publicAccess access then
            let kind =
                match repr with
                | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.Union _) -> "enum"
                | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.Record _) -> "struct"
                | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.TypeAbbrev _) -> "typealias"
                | _ -> "class"
            let headerEnd = trivia.EqualsRange |> Option.map _.Start |> Option.defaultValue declarationRange.End
            let header = "type " + (source (Range.mkRange file range.Start headerEnd)).Trim()
            let written = match repr with
                          | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.TypeAbbrev(rhsType = value)) -> header + " = " + source value.Range
                          | _ -> header
            add owner name kind range written [||] "" doc
            let parent = qualify owner name
            match repr with
            | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.Union(accessibility = access; unionCases = cases)) when publicAccess access ->
                for SynUnionCase(ident = SynIdent(name, _); caseType = caseType; xmlDoc = doc; accessibility = access; range = range) in cases do
                    if publicAccess access then
                        let parameters =
                            match caseType with
                            | SynUnionCaseKind.Fields fields -> fields |> List.mapi (fun index (SynField(idOpt = name; fieldType = value)) ->
                                { name = name |> Option.map _.idText |> Option.defaultValue $"arg{index + 1}"
                                  ``type`` = compact (source value.Range); optional = false }) |> Array.ofList
                            | SynUnionCaseKind.FullType(fullType = value) -> fst (signature [] value)
                        add parent name.idText "constant" name.idRange (source (Range.mkRange file name.idRange.Start range.End)) parameters parent doc
            | SynTypeDefnSigRepr.Simple(repr = SynTypeDefnSimpleRepr.Record(accessibility = access; recordFields = fields)) when publicAccess access ->
                for field in fields do emitField parent field
            | SynTypeDefnSigRepr.ObjectModel(memberSigs = members) ->
                for memberSig in members do emitMember parent memberSig
            | _ -> ()
            for memberSig in members do emitMember parent memberSig
    and emitField owner (SynField(idOpt = name; fieldType = value; xmlDoc = doc; accessibility = access; range = range)) =
        match name with
        | Some name when publicAccess access ->
            add owner name.idText "property" range (name.idText + ": " + source value.Range) [||] (compact (source value.Range)) doc
        | _ -> ()
    and emitMember owner = function
        | SynMemberSig.Member(memberSig = value) -> emitValue owner "member" value
        | SynMemberSig.ValField(field = field) -> emitField owner field
        | SynMemberSig.NestedType(nestedType = nested) -> emitType owner nested
        | SynMemberSig.Interface _ | SynMemberSig.Inherit _ -> ()
    let rec emitModule owner = function
        | SynModuleSigDecl.Val(valSig = value) -> emitValue owner "val" value
        | SynModuleSigDecl.Types(types = types) -> for value in types do emitType owner value
        | SynModuleSigDecl.NestedModule(moduleInfo = info; moduleDecls = members) ->
            let name, doc, access, range = componentInfo info
            if publicAccess access then
                add owner name "module" range ("module " + name) [||] "" doc
                let outer = namespaces
                for memberSig in members do emitModule (qualify owner name) memberSig
                namespaces <- outer
        | SynModuleSigDecl.NamespaceFragment(fragment) -> emitNamespace fragment
        | SynModuleSigDecl.Open(range = range) ->
            let opened = Regex.Match(source range, @"^open\s+([\w.]+)\s*$")
            if not opened.Success then failwithf "Unsupported F# open declaration: %s" (source range)
            namespaces <- namespaces @ [opened.Groups[1].Value]
        | SynModuleSigDecl.HashDirective _ -> ()
        | other -> failwithf "Unsupported public F# signature declaration: %A" other
    and emitNamespace (SynModuleOrNamespaceSig(longId = names; decls = members; accessibility = access)) =
        if publicAccess access then
            namespaces <- []
            let owner = String.concat "." (names |> List.map _.idText)
            for memberSig in members do emitModule owner memberSig
    let options = { FSharpParsingOptions.Default with SourceFiles = [|file|] }
    let result = checker.ParseFile(file, SourceText.ofString (File.ReadAllText file), options) |> Async.RunSynchronously
    let errors = result.Diagnostics |> Array.filter (fun error -> error.Severity = FSharpDiagnosticSeverity.Error)
    if errors.Length > 0 then failwith (errors |> Array.map string |> String.concat "\n")
    match result.ParseTree with
    | ParsedInput.SigFile(ParsedSigFileInput(contents = modules)) -> for value in modules do emitNamespace value
    | _ -> failwith $"Expected an F# public signature file: {file}"

let files = fsi.CommandLineArgs |> Array.skip 1
if files.Length = 0 then failwith "Pass the public .fsi files to extract."
let signatures = files |> Array.collect (fun file ->
    if Path.GetExtension file = ".fsproj" then
        XDocument.Load(file).Descendants(XName.Get "Compile")
        |> Seq.choose (fun item ->
            let includePath = item.Attribute(XName.Get "Include")
            if isNull includePath || not (includePath.Value.EndsWith ".fsi") then None
            else Some (Path.Combine(Path.GetDirectoryName file, includePath.Value)))
        |> Seq.toArray
    else [|file|])
for file in signatures do parseFile (Path.GetFullPath file)
if declarations.Count = 0 then failwith "No public F# declarations were extracted."
let result = {|
    schema = 1
    port = "fsharp"
    compiler = typeof<FSharpChecker>.Assembly.GetName().Version.ToString()
    declarations = declarations.ToArray()
|}
printfn "%s" (JsonSerializer.Serialize result)
