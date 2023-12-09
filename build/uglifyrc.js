/* eslint max-len:off */
module.exports = {
  compress: {
    // Maybe for production builds
    conditionals: false, // JE: removes dead code, however makes most if statement blocks un-breakpointable (default: true) — apply optimizations for if-s and conditional expressions
    global_defs: {}, // (default: {}) — see conditional compilation

    // Super useful
    collapse_vars: true, // Cleans up after poor Babel codegen around foo?.bar; however, does make potentially confusing reordering of statements (default: true) — Collapse single-use non-constant variables, side effects permitting.
    strings: true, // JE: Cleans up after a lot of string template output (default: true) — compact string concatenations.

    // Potentially useful
    assignments: true, // a+=1 -> ++a (default: true) — apply optimizations to assignment expressions
    evaluate: true, // 3*3 => 9 (default: true) — Evaluate expression for shorter constant representation. Pass "eager" to always replace function calls whenever possible, or a positive integer to specify an upper bound for each individual evaluation in number of characters.
    dead_code: true, // JE: Barely has any effect (default: true) — remove unreachable code
    typeofs: true, // (default: true) — compress typeof expressions, e.g. typeof foo == "undefined" → void 0 === foo
    unused: true, // (default: true) — drop unreferenced functions and variables (simple direct variable assignments do not count as references unless set to "keep_assign")
    keep_fargs: false, // (default: false) — discard unused function arguments except when unsafe to do so, e.g. code which relies on Function.prototype.length. Pass true to always retain function arguments.
    passes: 1, // (default: 1) — The maximum number of times to run compress. In some cases more than one pass leads to further compressed code. Keep in mind more passes will take more time.
    pure_funcs: null, // (default: null) — You can pass an array of names and UglifyJS will assume that those functions do not produce side effects. DANGER: will not check if the name is redefined in scope. An example case here, for instance var q = Math.floor(a/b). If variable q is not used elsewhere, UglifyJS will drop it, but will still keep the Math.floor(a/b), not knowing what it does. You can pass pure_funcs: [ 'Math.floor' ] to let it know that this function won't produce any side effect, in which case the whole statement would get discarded. The current implementation adds some overhead (compression will be slower). Make sure symbols under pure_funcs are also under mangle.reserved to avoid mangling.
    pure_getters: 'strict', // (default: "strict") — If you pass true for this, UglifyJS will assume that object property access (e.g. foo.bar or foo["bar"]) doesn't have any side effects. Specify "strict" to treat foo.bar as side-effect-free only when foo is certain to not throw, i.e. not null or undefined.
    side_effects: true, // JE: mostly `return undefined` -> `return`, but also cleans up some Bable codegen (default: true) — drop extraneous code which does not affect outcome of runtime execution.
    switches: true, // JE: mostly removes empty `default:` cases that are there to make ESLint happy (default: true) — de-duplicate and remove unreachable switch branches
    top_retain: null, // (default: null) — prevent specific toplevel functions and variables from unused removal (can be array, comma-separated, RegExp or function. Implies toplevel)

    // Definitely off (causes problems or not recommended or not applicable):
    annotations: false, // JE: not in our code (default: true) — Pass false to disable potentially dropping functions marked as "pure". A function call is marked as "pure" if a comment annotation /*@__PURE__*/ or /*#__PURE__*/ immediately precedes the call. For example: /*@__PURE__*/foo();
    arguments: false, // JE: ESLint handles this (default: true) — replace arguments[index] with function parameter name whenever possible.
    arrows: false, // JE: Babel handles this (default: true) — apply optimizations to arrow functions
    awaits: false, // JE: Babel handles this (default: true) — apply optimizations to await expressions
    booleans: false, // JE: potential performance/AST impact (default: true) — various optimizations for boolean context, for example !!a ? b : c → a ? b : c
    comparisons: false, // JE: not valid with checks against NaN (usually always false) (default: true) — apply certain optimizations to binary nodes, e.g. !(a <= b) → a > b, attempts to negate binary nodes, e.g. a = !b && !c && !d && !e → a=!(b||c||d||e) etc.
    default_values: false, // JE: Babel handles this (default: true) — drop overshadowed default values
    directives: false, // JE: not in our code (default: true) — remove redundant or non-standard directives
    drop_console: false, // (default: false) — Pass true to discard calls to console.* functions. If you wish to drop a specific function call such as console.info and/or retain side effects from function arguments after dropping the function call then use pure_funcs instead.
    drop_debugger: false, // JE: useful for debugging (default: true) — remove debugger; statements
    expression: false, // (default: false) — Pass true to preserve completion values from terminal statements without return, e.g. in bookmarklets.
    functions: false, // JE: ESLint handles this (default: true) — convert declarations from var to function whenever possible.
    hoist_exports: false, // JE: Babel handles this (default: true) — hoist export statements to facilitate various compress and mangle optimizations.
    hoist_funs: false, // (default: false) — hoist function declarations
    hoist_props: false, // JE: no effect (default: true) — hoist properties from constant object and array literals into regular variables subject to a set of constraints. For example: var o={p:1, q:2}; f(o.p, o.q); is converted to f(1, 2);. Note: hoist_props works best with toplevel and mangle enabled, alongside with compress option passes set to 2 or higher.
    hoist_vars: false, // (default: false) — hoist var declarations (this is false by default because it seems to increase the size of the output in general)
    if_return: false, // JE: small effect, creates confusing reordering confusing debugging (default: true) — optimizations for if/return and if/continue
    imports: false, // JE: Babel handles this (default: true) — drop unreferenced import symbols when used with unused
    inline: false, // JE: bad call stacks (default: true) — inline calls to function with simple/return statement:
    //                                   false — same as 0
    //                                   0 — disabled inlining
    //                                   1 — inline simple functions
    //                                   2 — inline functions with arguments
    //                                   3 — inline functions with arguments and variables
    //                                   4 — inline functions with arguments, variables and statements
    //                                   true — same as 4
    join_vars: false, // JE: significantly worse line numbers (default: true) — join consecutive var statements
    keep_infinity: true, // JE: seems safer (default: false) — Pass true to prevent Infinity from being compressed into 1/0, which may cause performance issues on Chrome.
    loops: false, // JE: no effect, and makes look break conditions un-breakpointable (default: true) — optimizations for do, while and for loops when we can statically determine the condition.
    merge_vars: false, // JE: Will make debugging more difficult (default: true) — combine and reuse variables.
    negate_iife: false, // JE: no significant effect (default: true) — negate "Immediately-Called Function Expressions" where the return value is discarded, to avoid the parens that the code generator would insert.
    objects: false, // JE: ESLint handles this (default: true) — compact duplicate keys in object literals.
    properties: false, // JE: no effect seen (default: true) — rewrite property access using the dot notation, for example foo["bar"] → foo.bar
    reduce_funcs: false, // JE: performance impact (default: true) — Allows single-use functions to be inlined as function expressions when permissible allowing further optimization. Enabled by default. Option depends on reduce_vars being enabled. Some code runs faster in the Chrome V8 engine if this option is disabled. Does not negatively impact other major browsers.
    reduce_vars: false, // JE: makes debugging more difficult (default: true) — Improve optimization on variables assigned with and used as constant values.
    rests: false, // JE: Babel handles this (default: true) — apply optimizations to rest parameters
    sequences: false, // JE: significantly worse line numbers, carriage return is a superior separator (default: true) — join consecutive simple statements using the comma operator. May be set to a positive integer to specify the maximum number of consecutive comma sequences that will be generated. If this option is set to true then the default sequences limit is 200. Set option to false or 0 to disable. The smallest sequences length is 2. A sequences value of 1 is grandfathered to be equivalent to true and as such means 200. On rare occasions the default sequences limit leads to very slow compress times in which case a value of 20 or less is recommended.
    spreads: false, // JE: Babel handles this (default: true) — flatten spread expressions.
    templates: true, // JE: Babel handles this (default: true) — compact template literals by embedding expressions and/or converting to string literals, e.g. `foo ${42}` → "foo 42"
    toplevel: false, // (default: false) — drop unreferenced functions ("funcs") and/or variables ("vars") in the top level scope (false by default, true to drop both unreferenced functions and variables)
    unsafe: false, // (default: false) — apply "unsafe" transformations (discussion below)
    unsafe_comps: false, // (default: false) — assume operands cannot be (coerced to) NaN in numeric comparisons, e.g. a <= b. In addition, expressions involving in or instanceof would never throw.
    unsafe_Function: false, // (default: false) — compress and mangle Function(args, code) when both args and code are string literals.
    unsafe_math: false, // (default: false) — optimize numerical expressions like 2 * x * 3 into 6 * x, which may give imprecise floating point results.
    unsafe_proto: false, // (default: false) — optimize expressions like Array.prototype.slice.call(a) into [].slice.call(a)
    unsafe_regexp: false, // (default: false) — enable substitutions of variables with RegExp values the same way as if they are constants.
    unsafe_undefined: false, // (default: false) — substitute void 0 if there is a variable named undefined in scope (variable name will be mangled, typically reduced to a single character)
    varify: false, // JE: Babel handles this (default: true) — convert block-scoped declarations into var whenever safe to do so
    yields: false, // JE: Babel handles this (default: true) — apply optimizations to yield expressions
  },
  keep_fnames: true,
  mangle: false,
  output: { semicolons: false },
};
