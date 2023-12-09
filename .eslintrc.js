let ignore_style = false; // Set to true when editing other people's code
let relaxed = true; // Specific things I'm relaxing for convenience, probably not the best for readability

module.exports = {
  "env": {
    "es6": true,
    "node": true,
    // "browser": true, // Don't set this, it masks undefined variables named "status", etc
  },
  "globals": {
    // Just the super-common ones, don't mask undefined variables named "status", etc
    "window": true,
    "document": true,
    "Blob": true,
    "Image": true,
    "FileReader": true,
    // Our engine globals
    "gl": true,
    "Z": true,
    "profilerStart": true,
    "profilerStartFunc": true,
    "profilerStop": true,
    "profilerStopFunc": true,
    "profilerStopStart": true,
    // Our pre-processor defines
    "BUILD_TIMESTAMP": true,
    "__funcname": true,
    // For Node types
    "NodeJS": true,
    // Our global types
    "Constructor": true,
  },
  "parser": "@typescript-eslint/parser",
  "plugins": [
    "@typescript-eslint",
    "html",
    "import",
  ],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/typescript",
  ],
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/member-delimiter-style": "error",
    "@typescript-eslint/no-array-constructor": "error",
    "@typescript-eslint/no-dupe-class-members": "error",
    "@typescript-eslint/no-empty-function": "error",
    "@typescript-eslint/no-extra-semi": "error",
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/no-invalid-this": "error",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-redeclare": "error",
    "@typescript-eslint/no-shadow": [
      "error",
      { "allow": ["next", "done", "err", "pak"] }
    ],
    "@typescript-eslint/no-this-alias": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { "args": "none" }
    ],
    "@typescript-eslint/no-use-before-define": [
      "error",
      {
        "classes": true,
        "functions": true,
        "variables": true
      }
    ],
    "@typescript-eslint/no-useless-constructor": "error",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/semi": "error",

    "accessor-pairs": "error",
    "array-bracket-newline": ["error", "consistent"], // JE
    "array-bracket-spacing": ignore_style ? "off" : [
      "error",
      "never"
    ],
    "array-callback-return": "error",
    "array-element-newline": "off",
    "arrow-body-style": "off", // JE
    "arrow-parens": [
      "error",
      "always"
    ],
    "arrow-spacing": ignore_style ? "off" : [
      "error",
      {
        "before": true,
        "after": true
      }
    ],
    "block-scoped-var": "error",
    "block-spacing": "error",
    "brace-style": ignore_style ? "off" : [
      "error",
      "1tbs",
      {
        "allowSingleLine": false
      }
    ],
    "callback-return": "off", // JE
    "camelcase": "off",
    "capitalized-comments": "off",
    "class-methods-use-this": "off", // JG
    "comma-dangle": [
      "error",
      "only-multiline"
    ],
    "comma-spacing": ignore_style || relaxed ? "off" : "error",
    "comma-style": [
      "error",
      "last"
    ],
    "complexity": "off", // ignore_style ? "off" : "error",
    "computed-property-spacing": [
      "error",
      "never"
    ],
    "consistent-this": "off", // JE
    "constructor-super": "error",
    "curly": "error",
    "default-case": "error",
    "dot-location": [
      "error",
      "property"
    ],
    "dot-notation": "error",
    "eol-last": ignore_style ? "off" : "error",
    "eqeqeq": [
      "error",
      "smart"
    ],
    "for-direction": "error",
    "func-call-spacing": "error",
    "func-name-matching": "error",
    "func-names": "off", // JE
    "func-style": [
      "error",
      "declaration",
      {
        "allowArrowFunctions": true
      }
    ],
    "function-paren-newline": "off", // JE
    "generator-star-spacing": "error",
    "global-require": "error",
    "guard-for-in": "off",
    "handle-callback-err": "error",
    "id-blacklist": "error",
    "id-length": "off",
    "id-match": [
      "error",
      "^([a-z]+([A-Z][a-z]+))*|([a-z]([a-z_]*[a-z])?)$",
    ],
    "implicit-arrow-linebreak": [
      "error",
      "beside"
    ],
    "import/no-dynamic-require": "error",
    "import/order": ["error", {
      "groups": [
        "builtin",
        ["external", "internal"],
        "parent",
        "sibling",
        "index",
        "object",
        "type",
      ],
      "pathGroups": [{
        "pattern": "glov/**",
        "group": "internal"
      }],
      "pathGroupsExcludedImportTypes": ["type"],
      "warnOnUnassignedImports": true,
      "alphabetize": {
        "order": "asc",
        "caseInsensitive": false,
      }
    }],
    "indent": [
      "error",
      2,
      {
        "ArrayExpression": "first",
        "CallExpression": {
          "arguments": 1, // JE "first"
        },
        "FunctionDeclaration": {
          "parameters": 1, // JE "first"
        },
        "FunctionExpression": {
          "parameters": 1, // JE "first"
        },
        "MemberExpression": "off",
        "ObjectExpression": 1, // "first",
        "SwitchCase": 1,
        "flatTernaryExpressions": true, // JE
        // JE: ignore inconsistent application to ternaries in object properties / function parameters:
        "ignoredNodes": ["ObjectExpression > Property > ConditionalExpression", "CallExpression > ConditionalExpression"],
      }
    ],
    "indent-legacy": "off",
    "init-declarations": "off", //["error", "always"],
    "jsx-quotes": "error",
    "key-spacing": ignore_style ? "off" : [
      "error",
      {
        "mode": "strict"
      }
    ],
    "keyword-spacing": [
      "error",
      {
        "after": true,
        "before": true
      }
    ],
    "line-comment-position": "off",
    "linebreak-style": [
      "error",
      "unix"
    ],
    "lines-around-comment": "off", // JE
    "lines-around-directive": "error",
    "lines-between-class-members": "off", // JE
    "max-classes-per-file": "off", // JE
    "max-depth": relaxed ? "off" : "error",
    "max-len": [
      "error",
      {
        "code": 120,
        "ignorePattern": "^// Flags:",
        "ignoreRegExpLiterals": true,
        "ignoreUrls": true,
        "tabWidth": 2
      }
    ],
    "max-lines": "off",
    "max-lines-per-function": "off",
    "max-nested-callbacks": "error",
    "max-params": "off",
    "max-statements": "off",
    "max-statements-per-line": ignore_style ? "off" : "error",
    "multiline-comment-style": relaxed ? "off" : [
      "error",
      "separate-lines"
    ],
    "multiline-ternary": "off",
    "new-cap": "error",
    "new-parens": "error",
    "newline-after-var": "off",
    "newline-before-return": "off",
    "newline-per-chained-call": "off",
    "no-alert": "error",
    "no-array-constructor": "off", // replaced with @typescript-eslint/no-array-constructor
    "no-async-promise-executor": "error",
    "no-await-in-loop": "error",
    "no-bitwise": "off", // JE
    "no-buffer-constructor": "error",
    "no-caller": "error",
    "no-catch-shadow": "error",
    "no-class-assign": "error",
    "no-confusing-arrow": "error",
    "no-console": "off", // JE
    "no-const-assign": "error",
    "no-constructor-return": "error", // JE
    "no-constant-condition": "off", // JE
    "no-control-regex": "error",
    "no-continue": "off", // JE
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-div-regex": "error",
    "no-dupe-args": "error",
    "no-dupe-class-members": "off", // replaced with @typescript-eslint/no-dupe-class-members
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-duplicate-imports": "error",
    "no-else-return": ignore_style || relaxed ? "off" : "error",
    "no-empty-character-class": "error",
    "no-empty-function": "off", // replaced with @typescript-eslint/no-empty-function
    "no-eq-null": "error",
    "no-eval": "error",
    "no-ex-assign": "error",
    "no-extend-native": "error",
    "no-extra-bind": "error",
    "no-extra-boolean-cast": "error",
    "no-extra-label": "error",
    "no-extra-parens": ignore_style ? "off" : [
      "error",
      "functions", // JE: Complains about useful parens for readability
    ],
    "no-extra-semi": "off", // replaced with @typescript-eslint/no-extra-semi
    "no-fallthrough": "error",
    "no-floating-decimal": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-implicit-coercion": "error",
    "no-implicit-globals": "error",
    "no-implied-eval": "error",
    "no-inline-comments": "off",
    "no-invalid-regexp": "error",
    "no-invalid-this": "off", // replaced with @typescript-eslint/no-invalid-this
    "no-irregular-whitespace": "error",
    "no-iterator": "error",
    "no-label-var": "error",
    "no-labels": "error",
    "no-lone-blocks": "error",
    "no-lonely-if": "off", // JE
    "no-loop-func": "error",
    "no-magic-numbers": "off",
    "no-misleading-character-class": "error",
    "no-mixed-operators": [
      "error",
      {
        "groups": [
          ["+", "-", "|", "||"],
          ["*", "/", "&", "&&", "^", "<<", ">>", ">>>"],
          ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
        ],
        "allowSamePrecedence": true,
      }
    ],
    "no-mixed-requires": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-multi-assign": ignore_style || relaxed ? "off" : "error",
    "no-multi-spaces": [
      "error",
      {
        "ignoreEOLComments": true
      }
    ],
    "no-multi-str": "error",
    "no-multiple-empty-lines": [
      "error",
      {
        "max": 2,
        "maxEOF": 0,
        "maxBOF": 1
      }
    ],
    "no-native-reassign": "error",
    "no-negated-condition": "off", // JE: Makes nested ternaries more readable
    "no-negated-in-lhs": "error",
    "no-nested-ternary": "off", // JE
    "no-new": "error",
    "no-new-func": "error",
    "no-new-object": "error",
    "no-new-require": "error",
    "no-new-symbol": "error",
    "no-new-wrappers": "error",
    "no-obj-calls": "error",
    "no-octal": "error",
    "no-octal-escape": "error",
    "no-param-reassign": "off",
    "no-path-concat": "error",
    "no-plusplus": "off", // JE
    "no-process-env": "off", // JE
    "no-process-exit": "off", // JE
    "no-proto": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "off", // replaced with @typescript-eslint/no-redeclare
    "no-restricted-globals": "error",
    "no-restricted-imports": "error",
    "no-restricted-modules": "error",
    "no-restricted-properties": "error",
    "no-restricted-syntax": "error",
    "no-return-assign": "error",
    "no-return-await": "error",
    "no-script-url": "error",
    "no-self-assign": "error",
    "no-self-compare": "error",
    "no-sequences": "error",
    "no-shadow": "off", // replaced with @typescript-eslint/no-shadow
    "no-shadow-restricted-names": "error",
    "no-spaced-func": "error",
    "no-sync": "off", // JE
    "no-tabs": "error",
    "no-template-curly-in-string": "error",
    "no-ternary": "off", // JE
    "no-this-before-super": "error",
    "no-throw-literal": "error",
    "no-trailing-spaces": "error",
    "no-undef": [
      "error",
      {
        "typeof": true
      }
    ],
    "no-undef-init": "error",
    "no-undefined": "off",
    "no-underscore-dangle": [
      "error",
      {
        "allowAfterThis": true,
        "enforceInMethodNames": false,
      }
    ],
    "no-unexpected-multiline": "error",
    "no-unmodified-loop-condition": "error",
    "no-unneeded-ternary": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unused-expressions": "error",
    "no-unused-labels": "error",
    "no-unused-vars": "off", // Replaced with @typescript-eslint/no-unused-vars
    "no-use-before-define": "off", // Replaced with @typescript-eslint/no-use-before-define
    "no-useless-call": "error",
    "no-useless-computed-key": "error",
    "no-useless-concat": "error",
    "no-useless-constructor": "off", // replaced with @typescript-eslint/no-useless-constructor
    "no-useless-escape": "error",
    "no-useless-rename": "error",
    "no-useless-return": "error",
    "no-var": "error",
    "no-void": "off",
    "no-warning-comments": "off", // JE: Allow TODO:
    "no-whitespace-before-property": "error",
    "no-with": "error",
    "nonblock-statement-body-position": "error",
    "object-curly-newline": "error",
    "object-curly-spacing": ignore_style ? "off" : [
      "error",
      "always"
    ],
    "object-shorthand": "off",
    "one-var": ["error", {
      "var": "never",
      "let": "never",
      "const": "never",
      "separateRequires": true,
    }],
    "one-var-declaration-per-line": "error",
    "operator-assignment": "error",
    "operator-linebreak": [
      "error",
      "after",
      // { "overrides": { "?": "ignore", ":": "ignore" } }
    ],
    "padded-blocks": "off",
    "padding-line-between-statements": "error",
    "prefer-arrow-callback": "off",
    "prefer-const": ignore_style || relaxed ? "off" : [
      "error",
      {
        "ignoreReadBeforeAssign": true
      }
    ],
    "prefer-destructuring": "off",
    "prefer-numeric-literals": "error",
    "prefer-object-spread": "error",
    "prefer-promise-reject-errors": "error",
    "prefer-reflect": "off", // JE
    "prefer-rest-params": "error",
    "prefer-spread": "off",
    "prefer-template": "off", // JE: jsjam
    "quote-props": relaxed ? "off" : [
      "error",
      "consistent"
    ],
    "quotes": [
      "error",
      "single",
      {
        "avoidEscape": true
      }
    ],
    "radix": "error",
    "require-atomic-updates": "error",
    "require-await": "error",
    "require-jsdoc": "off",
    "require-unicode-regexp": "off", // JE: Hasn't caught anything useful, generates bigger code
    "rest-spread-spacing": "error",
    "semi": "off", // replaced by @typescript-eslint/semi
    "semi-spacing": "error",
    "semi-style": [
      "error",
      "last"
    ],
    "sort-imports":["error", {
      "ignoreCase": false,
      "ignoreDeclarationSort": true,
      "ignoreMemberSort": false,
    }],
    "sort-keys": "off",
    "sort-vars": "off", // JE
    "space-before-blocks": [
      "error",
      "always"
    ],
    "space-before-function-paren": [
      "error",
      {
        "anonymous": "always",
        "named": "never",
        "asyncArrow": "always"
      }
    ],
    "space-in-parens": [
      "error",
      "never"
    ],
    "space-infix-ops": ignore_style || relaxed ? "off" : "error",
    "space-unary-ops": "error",
    "spaced-comment": ignore_style || relaxed ? "off" : [
      "error",
      "always",
      {
        "block": {
          "balanced": true
        },
        "exceptions": [
          "-", "/"
        ]
      }
    ],
    "strict": "error",
    "switch-colon-spacing": "error",
    "symbol-description": "error",
    "template-curly-spacing": [
      "error",
      "never"
    ],
    "template-tag-spacing": "error",
    "unicode-bom": [
      "error",
      "never"
    ],
    "use-isnan": "error",
    "valid-jsdoc": "error",
    "valid-typeof": "error",
    "vars-on-top": "off", // JE
    "wrap-iife": "error",
    "wrap-regex": "error",
    "yield-star-spacing": "error",
    "yoda": [
      "error",
      "never"
    ]
  },
  "overrides": [
    {
      // Enable rules specifically for JavaScript files
      "files": ["*.js"],
      "rules": {
        "consistent-return": [
          "error",
          {
            "treatUndefinedAsUnspecified": true,
          }
        ],
      }
    },
    {
      // Enable rules specifically for TypeScript files
      "files": ["*.ts", "*.tsx"],
      "rules": {
        "@typescript-eslint/explicit-function-return-type": ["error", {
          "allowExpressions": true,
        }],
        "@typescript-eslint/explicit-module-boundary-types": "error",
        // TODO: resolve issues on existing files, or disable, enforce this going forward:
        // "@typescript-eslint/naming-convention": [
        //   "error",
        //   // exceptions
        //   {
        //     selector: ['property'],
        //     format: ['snake_case'],
        //     leadingUnderscore: 'allow',
        //     trailingUnderscore: 'forbid',
        //     filter: {
        //       regex: '^_opaque$',
        //       match: true,
        //     },
        //   },
        //   // function parameters, variables: strictly snake_case
        //   {
        //     selector: ['default', 'parameter', 'parameterProperty', 'variable'],
        //     format: ['snake_case'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   // variables: unless const, then UPPER_CASE
        //   {
        //     selector: ['variable'],
        //     format: ['snake_case', 'UPPER_CASE'],
        //     modifiers: ['const'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   // properties, same as variables, but cannot tell if they're "const", so allow both
        //   {
        //     selector: ['property'],
        //     format: ['snake_case', 'UPPER_CASE'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   {
        //     selector: ['function', 'method', 'classMethod', 'typeMethod'],
        //     format: ['camelCase'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   {
        //     selector: ['enumMember'],
        //     format: ['PascalCase', 'UPPER_CASE'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   {
        //     selector: ['class', 'enum', 'interface', 'typeAlias', 'typeParameter'],
        //     format: ['PascalCase'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        //   {
        //     selector: ['objectLiteralMethod'],
        //     format: ['snake_case', 'camelCase'],
        //     leadingUnderscore: 'forbid',
        //     trailingUnderscore: 'forbid',
        //   },
        // ],
      }
    },
  ]
};
