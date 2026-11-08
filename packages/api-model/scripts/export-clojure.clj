(ns libtmux.docs.export-clojure
  "Build-only export of compiled public namespace and var metadata."
  (:require [clojure.java.io :as io]
            [clojure.string :as str])
  (:import [com.fasterxml.jackson.databind ObjectMapper]
           [java.nio.charset StandardCharsets]
           [java.nio.file Files]
           [java.security MessageDigest]
           [java.util HexFormat List]
           [java.util.regex Pattern]))

(set! *warn-on-reflection* true)

(def ^:private repo "libtmux/libtmux-java")
(def ^:private exporter-script *file*)

(defn- sha256 [^bytes bytes]
  (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") bytes)))

(defn- bytes-at [file]
  (Files/readAllBytes (.toPath (io/file file))))

(defn- prose [text]
  (when (str/blank? text) (throw (ex-info "Public Clojure declaration has no docstring" {})))
  (str/replace (str/trim text) #"\n  " "\n"))

(defn- tag-text [namespace metadata]
  (when-let [tag (:tag metadata)]
    (let [resolved (if (class? tag) tag
                       (when (symbol? tag) (ns-resolve namespace tag)))]
      (if (class? resolved) (.getName ^Class resolved) (str tag)))))

(defn- parameters [namespace arguments]
  (loop [remaining (seq arguments) variadic? false result []]
    (if-let [argument (first remaining)]
      (if (= '& argument)
        (recur (next remaining) true result)
        (recur (next remaining) false
               (conj result (cond-> {"name" (if (symbol? argument) (str argument) (pr-str argument))}
                              variadic? (assoc "variadic" "positional")
                              (tag-text namespace (meta argument)) (assoc "type" (tag-text namespace (meta argument)))))))
      result)))

(defn- signatures [namespace name metadata]
  (when-not (seq (:arglists metadata))
    (throw (ex-info "Public Clojure var has no callable arities" {:var name})))
  (mapv (fn [arguments]
          (cond-> {"raw" (pr-str (cons (symbol name) arguments))
                   "params" (parameters namespace arguments)}
            (tag-text namespace metadata) (assoc "returns" (tag-text namespace metadata))))
        (:arglists metadata)))

(defn- public-functions [namespace]
  (->> (ns-publics namespace)
       (keep (fn [[name value]]
               (let [metadata (meta value)]
                 (when (and (:file metadata) (not (:no-doc metadata)))
                   [(str name) metadata]))))
       (sort-by first)))

(defn- source-record [module file revision line]
  {"file" (str (get module "path") "/src/main/clojure/" file)
   "line" line "repo" repo "revision" revision})

(defn- namespace-line [source namespace]
  (let [pattern (re-pattern (str "(?m)^\\(ns\\s+" (Pattern/quote (str namespace)) "(?:\\s|$)"))
        matcher (re-matcher pattern source)]
    (when-not (.find matcher)
      (throw (ex-info "Cannot locate the compiled namespace in source" {:namespace namespace})))
    (inc (count (filter #{\newline} (subs source 0 (.start matcher)))))))

(defn- namespace-symbols [root module namespace revision]
  (let [file (str (-> (str namespace) (str/replace "." "/") (str/replace "-" "_")) ".clj")
        path (str (get module "path") "/src/main/clojure/" file)
        ^bytes source-bytes (bytes-at (io/file root path))
        resource (or (io/resource file) (throw (ex-info "Compiled Clojure source is absent" {:file file})))
        loaded-bytes (with-open [stream (io/input-stream resource)] (.readAllBytes stream))
        _ (when-not (= (sha256 source-bytes) (sha256 loaded-bytes))
            (throw (ex-info "Loaded Clojure resource differs from selected source" {:file path})))
        functions (public-functions namespace)
        common {"package" (get module "package") "product" "core" "apiScope" "exported"
                "namespace" (str namespace) "publicOwner" (str namespace)}]
    (when-not (seq functions) (throw (ex-info "Public Clojure namespace has no functions" {:namespace namespace})))
    {:input {"path" path "sha256" (sha256 source-bytes)}
     :symbols
     (into [(merge common {"id" (str namespace) "publicId" (str namespace)
                           "qualifiedName" (str namespace) "name" (str namespace)
                           "kind" "module" "modifiers" []
                           "signatures" [{"raw" (str "(ns " namespace ")") "params" []}]
                           "docstring" (prose (:doc (meta (the-ns namespace))))
                           "source" (source-record module file revision
                                                   (namespace-line (String. source-bytes StandardCharsets/UTF_8) namespace))})]
           (for [[name metadata] functions]
             (do
               (when-not (and (= file (:file metadata)) (pos-int? (:line metadata)))
                 (throw (ex-info "Public var source is outside its namespace" {:namespace namespace :var name})))
               (merge common {"id" (str namespace "/" name) "publicId" (str namespace "/" name)
                              "qualifiedName" (str namespace "/" name) "name" name "kind" "function"
                              "parent" (str namespace)
                              "modifiers" (cond-> [] (> (count (:arglists metadata)) 1) (conj "overload")
                                            (:macro metadata) (conj "macro")
                                            (:deprecated metadata) (conj "deprecated"))
                              "signatures" (signatures namespace name metadata)
                              "docstring" (prose (:doc metadata))
                              "source" (source-record module file revision (:line metadata))}))))}))

(defn- exporter-provenance []
  (let [directory (.getParentFile (io/file exporter-script))
        files (mapv (fn [name]
                      {"path" (str "packages/api-model/scripts/" name)
                       "sha256" (sha256 (bytes-at (io/file directory name)))})
                    ["export-clojure.clj" "export-clojure.gradle"])
        digest (sha256 (.getBytes (str/join "\n" (map #(str (get % "path") ":" (get % "sha256")) files))
                                 StandardCharsets/UTF_8))]
    {"name" "clojure-public-var-metadata" "revision" (str "sha256:" digest)
     "files" files}))

(defn- -main [root destination revision]
  (when-not (re-matches #"[a-f0-9]{40}" revision)
    (throw (ex-info "A selected source revision is required" {})))
  (let [mapper (ObjectMapper.)
        ^List modules (.readValue mapper (System/getProperty "libtmux.docs.clojure.modules") List)
        namespaces (vec (for [module modules namespace (get module "namespaces")]
                          [module (symbol namespace)]))]
    (when (or (empty? namespaces) (not= (count namespaces) (count (set (map second namespaces)))))
      (throw (ex-info "Published Clojure namespaces are absent or duplicated" {})))
    (doseq [[_ namespace] namespaces] (require namespace))
    (let [exports (mapv (fn [[module namespace]] (namespace-symbols root module namespace revision)) namespaces)
          symbols (into [] (mapcat :symbols) exports)
          artifact {"schema" "libtmux.clojure-api/1" "port" "clojure" "repo" repo "revision" revision
                    "compiler" (clojure-version) "extractor" "clojure-public-var-metadata/1"
                    "sources" (mapv (fn [module]
                                      {"product" "core" "package" (get module "package") "repo" repo
                                       "revision" revision "extractedRevision" revision "version" (get module "version")}) modules)
                    "nativeProvenance" {"files" (mapv :input exports) "exporter" (exporter-provenance)}
                    "symbols" symbols}
          output (.getAbsoluteFile (io/file destination))]
      (when-not (= (count symbols) (count (set (map #(get % "id") symbols))))
        (throw (ex-info "Duplicate native Clojure public identity" {})))
      (.mkdirs (.getParentFile output))
      (spit output (str (.writeValueAsString (.writerWithDefaultPrettyPrinter mapper) artifact) "\n") :encoding "UTF-8")
      (binding [*out* *err*]
        (println "Clojure" (clojure-version) ": exported" (count symbols) "public declarations")))))

(apply -main *command-line-args*)
