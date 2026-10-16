# Student Screen Loading

Implemented after the user's request to speed up the new student screens.

## Changes

- `src/student.js` reuses successful shared GET responses for 15 seconds:
  student record, programme registrations, countries and admissions catalogue.
  Cache entries are in memory, tied to the session token and exact endpoint.
  Concurrent reads share the same request; consumers receive separate copies.
- Finance, results, identity and request data remain uncached. Independent
  page reads start together instead of waiting for other modules to finish.
  Detail reads still follow their owning adapter initialization where required.
- Writes clear shared reads before and after the request, including failed
  writes. Explicit retry and account/session changes also clear shared reads.
  Errors are never cached; expiry triggers a new server read.
- Destination navigation is shown immediately during loading, so another tab
  remains reachable. Generation/session guards prevent superseded screens
  from repainting or starting more requests after their core read completes.
- Existing styles, adapters, form revisions, eligibility checks and permissions
  are unchanged. There is no persistent browser storage of cached records and
  no cache for payment standing or approval/request details.

## Local Measurement

Read-only live browser check at http://127.0.0.1:4173, on the same demo account.
These are individual local samples, not a latency guarantee or load benchmark.
The after sample navigated within the 15-second shared-data window.

| Screen | Before | After | After API Requests |
| --- | --- | --- | --- |
| Courses | 1466ms | 289ms | 2 |
| Timetable | 925ms | 255ms | 1 |
| My Details | 945ms | 408ms | 4 |
| Requests | 1412ms | 496ms | 8 |
| Today | 928ms | 388ms | 7 |

All after-sample tab changes made zero student-record/registration reads.
Initial visits and expired caches still fetch those records from the server.
Reference countries are fetched on the first Details visit; independent reads
start even while another module is slow. Page content is painted once its data
is ready; this change does not introduce individually streaming content panels.

## Verification

Focused read-only desktop/mobile loading tests passed before the isolated
checkpoint. They cover warm-cache reuse, expiry, in-flight deduplication,
parallel reads, visible destination navigation, superseded routes, failed-read
eviction and retry. Existing Office tests cover refused saves, real save/retry,
identity submissions and account-switch privacy. The final isolated result is
recorded below and in the shared workspace log.

- Full isolated run: all ten student browser cases passed, along with the
  unit suite and all 22 API smoke suites. Source guard passed (400 files), and
  database `svu_rebuild_it_1791407637586` was dropped. Overall run failed only
  because the existing staff test used an ambiguous descendant-fieldset selector.
- That assertion now selects the outer workspace review-controls fieldset.
  Its separate browser-only isolated desktop/mobile rerun passed, including
  the source guard (400 files). Database `svu_rebuild_it_1791408172460` was
  dropped. No production code changed between those runs.
- Receipts: `data/student-loading-workflow-receipt.json` and
  `data/student-loading-shell-receipt.json`. Both runs kept sources stable;
  the second was browser-only and did not rerun units/API smoke suites.

Screenshots from the live recheck: `data/student-loading-reviewed-desktop.png`
and `data/student-loading-reviewed-mobile.png`.
