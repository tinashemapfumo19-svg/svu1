# Chat Localization Source Preview

Read-only audit and verifier implementation, 2026-10-12. This is translation-source evidence, not native language support, translation approval or legacy runtime certification.

## Source Findings

Both supplied bundles contain 42 main catalogues. The initializer's literal accepted list contains 39 codes; `ca_CAT`, `cs_CZ` and `mk_MK` are packaged but not allowlisted. Its active caller at `src/pfcglobalconfig.class.php:648` passes one argument, selecting the main catalogue. No `admin.php` is supplied in any locale, including English. The initializer's optional admin branch and its unchanged language list do not prove working admin translations.

English main has 125 unique labels. Among the 39 accepted catalogues:

- 25 contain empty values, 980 empty labels total. `_pfc`/`_pfc2` use an underscore-wrapped source key when a label is absent or empty; they do not use the English catalogue as a per-label fallback. Unsupported language codes instead select `en_US` during initialization.
- `nl_NL` lacks three English keys: `Private message`, `Close this tab`, and `Do you really want to leave this room ?`.
- Ten catalogues have 16 nonempty format-review issues: `ba_BA`, `de_DE-informal`, `hr_HR`, `hy_AM`, `it_IT`, `nl_BE`, `nl_NL`, `nn_NO`, `oc_FR`, `sv_SE`. These are mismatched placeholder signatures or syntax outside the verifier's bounded printf recognizer, not a claim that every case was executed or every unsupported format is invalid PHP. Empty fallback values are counted separately, not misclassified as format errors.
- `hu_HU` repeats two nickname-related keys at lines 409 and 412. The report retains duplicate evidence and the final literal value; no overwrite is silently approved. Nickname editing remains excluded by the user's account-name decision.
- Accepted catalogues contain 17 extra keys beyond English. No recognized values have HTML-like tags under the reported detector; this is not a general HTML/XSS or translation-quality certificate.

The three unaccepted catalogues have 51 empty labels, 17 missing English labels and three format-review issues. File presence does not establish active deployment support. Raw archive locale identifiers are retained; no country/language code, formal/informal variant or translation is silently renamed or repaired.

The sorted `{path,sha256}` inventory covers the initializer plus 42 main files, 43 files per bundle. Both inventories match SHA-256 `1449b258559627b3f9be3a40715f9ac4339fd530799c57aee9d9d6766c775848`. All 42 main sources pass literal recognition; all 42 admin paths are absent. This inventory is narrower than the full chat tree and does not cover configured runtime data, third-party assets or themes.

## Verifier

Run `node scripts/legacy-chat-locales-preview.js`. It prints JSON metadata and public source keys for review, never translation values. Exit 0 means the recognized source passes the configured structural review checks, not institutional approval; exit 2 means the preview completed with review findings; exit 1 means structural/source refusal, mismatched bundles or unsupported invocation. The supplied archives deliberately return 2.

`legacy-chat-locales-reader.js` recognizes only bounded UTF-8 literal `$GLOBALS['i18n'][key]=value;` assignments, PHP comments/quotes/byte escapes and the marked literal accepted-language array. It is not a general PHP parser, interpreter, complete sprintf implementation or importer. Code, includes, interpolation, malformed syntax, invalid UTF-8/NUL and excessive input/entries fail closed. PHP byte escapes are decoded as UTF-8 without evaluating code. Unknown format syntax is reported for review rather than guessed.

The filesystem reader restricts inspection to both public `src/pfci18n.class.php` files and locale `main.php`/`admin.php` paths. It rejects symlinks, escaping paths and nonregular/excessive files. No archive configuration, private cache/log, credential, message record or PHP runtime is read/executed. There are no database, provider, server write or archive write operations. Missing English admin is reported as unavailable, not substituted from main; the initial verifier assumption that it existed was corrected after the first preview refused that absent file.

Six focused tests pass, covering syntax/code refusal, quoting/UTF-8 byte escapes, strict accepted-language arrays, duplicates/fallback accounting, bounded positional printf signatures and real archive/CLI behavior. The archive test pins both inventories, checks all 42 catalogue statuses, invokes the real CLI (expected exit 2), rejects `--import` and rechecks identical reports afterward. No source bytes are changed. These checks are not browser localization proof or a full application integration certificate.

The final focused run ends with exit 0 / six passed / no failed tests. The fixed ordered reader/preview/test three-file fingerprint remains unchanged before/after that run: `90cdfe4c26a47e52c08219ddf06e4b8d99825dfe3f8643bc27cea468812db4c8`. This scoped verifier proof does not replace or narrow the complete application integration guard.

Working `/api/health` is 200/no-store; the new script path and archive translation path both remain nonpublic (404/no-store). No working server restart, session/fixture/grant, schema migration, reseed, provider enablement or translation/history import occurred.

## Remaining Work

Native messaging is still English-labelled; a locale chooser and complete native label catalogues are not implemented by this preview. The user's latest preference is "maybe 2 other most common zambian langauges". The proposed launch set is English by default, Bemba and Nyanja, subject to fluent-speaker review and confirmation against student/staff needs. This tentative preference does not approve unfinished translations or retire the other legacy languages; the goal retains the localization requirement.

The [ZamStats 2022 Census National Analytical Report](https://www.zamstats.gov.zm/wp-content/uploads/2025/08/2022-Census-National-Analytical-Report.pdf), chapter 10, distinguishes language of communication at home from general language proficiency. Nationally it reports Bemba 34.0%, Tonga 12.8% and Nyanja 11.4%; in urban areas Bemba leads and Nyanja is second at 21.8%. Accordingly, Bemba/Nyanja is a practical urban-oriented interface recommendation, not a claim that these are the national top two or that the institution's users have been surveyed. If national at-home ranking is the intended criterion, the two are Bemba and Tonga. Neither Bemba nor Nyanja is included in the 39 legacy allowlisted catalogues; new native catalogues and review are needed.

The 39 accepted entries group into 34 languages: Arabic (Lebanon), Armenian, Bengali (Bangladesh), Bosnian, Bulgarian, Chinese (Simplified/Traditional), Croatian, Danish, Dutch (Netherlands/Belgium), English (US), Esperanto, French, Galician, German (formal/informal), Greek, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian (Bokmal/Nynorsk), Occitan, Polish, Portuguese (Portugal/Brazil), Romanian, Russian, Serbian, Slovak, Spanish, Swedish, Thai, Turkish, Ukrainian and Vietnamese. The catalogue headers identify `ba_BA` as Bosnian and `uk_RO` as Romanian; these misleading archive identifiers must not be blindly converted by parsing their prefixes. This clarification does not rename source files or approve native tag mappings. Modern tag selection should follow [W3C guidance](https://www.w3.org/International/questions/qa-choosing-language-tags).

Native mapping must distinguish applicable controls from excluded nickname/presence/censor/debug/infrastructure labels. It needs complete new consent, invitation, moderation, safety, pending/retry, alert and accessible control text, safe text/attribute rendering, explicit fallback, allowed locale selection, account/session preference lifetime and RTL/layout proof where applicable. Stored messages, account names and literal evidence must not be translated or rewritten automatically. Source annotations declare LGPL 2.1-or-later, but this preview copies no translation into the application and gives no blanket licensing/accuracy approval.

Broader command recall, localization/themes, current regression, policy/key/retention, CMS and historical imports keep the full goal active.
