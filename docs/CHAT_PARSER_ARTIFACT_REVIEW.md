# Chat Parser Artifact Review

Implementation follow-up, 2026-10-11: the remaining lexer and browser-bundled token/character/helper/node code were inspected, the browser artifact was vendored byte-for-byte with its MIT notice, and the real UMD API was exercised in isolated VM and native browser tests. Named/default parse exports and positional attributes were checked rather than inferred. A native bounded whitelist renderer rejects mismatched source slices and parser recovery; no bundled HTML serialization helper is used for rendering. The separate wildcard helper/types npm archives were not installed or declared independently audited. See `CHAT_FORMATTING.md` for implementation and current verification status. The preparation record below remains historical.

Read-only preparation, 2026-10-11. This is not an installed dependency or a verified native formatting implementation.

GitHub raw manifest/source fetches returned cache misses; the repository package-folder view did not expose inspectable code. A direct public npm registry read initially failed with sandbox EACCES, then succeeded through the approved network path. No credentials, project files or message data were sent. The archive was held in memory and known members were read through `tar.exe` stdout; nothing was extracted to disk or executed.

## Published Artifact

- The public registry reported `@bbob/parser` version 4.4.1, MIT, with ESM `es/index.mjs`, CommonJS `lib/index.js` and browser `dist/index.js` / exported `dist/index.min.js` entries.
- The [published 4.4.1 archive](https://registry.npmjs.org/@bbob/parser/-/parser-4.4.1.tgz) is 39983 bytes. Its SHA-512 integrity was independently calculated and matched registry metadata: `sha512-Hs6caDSsY5zJdZZpj7ohTz4hQZGKPL+ZgZy+qbgDtfD9WV2YGxFGtXQf7PBu/aIRKOrkGgbCQxDYWlCEyONi9w==`.
- Manifest, ESM index, parser declarations and LICENSE were inspected. The declarations expose named/default `parse(input, options)` returning tag nodes. LICENSE names the MIT notice and copyright; preservation is needed if redistributed. No claim of blanket security approval follows from the license.
- All 260 lines of `es/parse.mjs` were read across two calls: 8388 bytes, SHA-256 `722ccd06afcda7d43a8a49207c4f65c7357a2d0ecbe1ccfcf2699949d83fe7e7`. Source shows allowed-tag selection, original tag positions, an error callback and propagation of context-free/escape/case/whitespace options to the lexer.
- Lexer metadata and selected option/error/loop lines were inspected, not the entire lexer: 11498 bytes / 295 lines, SHA-256 `1a8ba39772562cce06687c3246682771a17b394a56228d840d13ebc09d53e40b`. Tokenization/helper behavior still needs full review and executable test evidence.
- Minified browser entry: 8947 bytes, SHA-256 `1f192e2ab1f661085d74c59129e1d2939d12e946edb07d3c55ffede36cf47734`. Its inspected UMD prefix defines a `BbobParser` global and accepts exports rather than external helper arguments. This prefix is not proof of every bundled behavior or compatibility.
- Parser dependencies are wildcard `@bbob/plugin-helper` and `@bbob/types`; registry metadata reported each at 4.4.1. Helper also declares wildcard types. An installation must resolve/pin the actual dependency graph or use an integrity-tracked, locally served browser artifact with its notices. Registry latest values alone are not a lockfile or reproducible installation.

## Preparation Gate (Historical)

Inspect remaining lexer/helper/bundle behavior, choose and preserve an exact artifact/dependency graph, and test the real API before integrating. Bound native input/tree/output/depth, whitelist presentation tags and colors, escape all text/attributes, validate links independently, keep original persisted/report bodies and default literal display, and verify malformed/XSS/nesting/link/desktop/mobile behavior. Do not install or change guarded sources during an active integration run. No parser code, dependency, vendor asset or formatter was added by this review.
