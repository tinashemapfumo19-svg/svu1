# University data alignment — 16 October 2026

The user clarified that the requested assignment concerns university data and relationships, rather than login permissions. These source-backed relationships have now been applied to the existing imported records:

| Relationship | Reconciled count |
| --- | ---: |
| Module to programme curriculum, study year and semester | 182 |
| Programmes with module lists in the source | 10 of 48 |
| Previous staff/module teaching assignment records | 161 |
| Teaching assignments matched to an existing staff record | 160 |
| Staff profiles with source department/category/supervisor context | 115 |
| Student programme records with the previously recorded study year | 638 |

The source has no module lists for the other 38 programme catalogue entries. All 48 programmes remain retained. One teaching record has a staff code absent from the staff register; its programme/module link remains available for reconciliation.

## Where the data is visible

- **Academic setup → Programmes → Legacy catalogue:** module list with source study year and semester. Missing credits and core/elective classifications display as not recorded.
- **Teaching:** previous teaching assignments, including the source active/inactive flag and assignment date. Staff can see their own matched history; staff reviewers are limited to their programme scope.
- **Staff records:** previous department code, category and matched supervisor are visible where no native employment period supersedes them. The source department fields contain numeric codes with no corresponding named department table. These codes were retained without inventing department/faculty names. All source staff grades were blank.
- **Student record overview:** previously recorded study year appears alongside previous-system status. This historical field does not fabricate confirmed registration receipts or academic progression decisions, including the source's two records showing year 9.

## Completion still required

The source does not provide module credits, core/elective classifications or course effective dates. These are left unfilled. Completing a draft course's valid credits, level and effective date makes its catalogue record active; curriculum publication refuses incomplete imported entries. Existing source programme/module associations are available while this work is pending.

The legacy teaching records have no registration-period/offering or independent-review mapping. They are historical links, not current approved allocations or class-list entitlements. Finance balances, result publication, assessment policy and attachment bytes still need the target-specific reconciliation described in [the cutover record](LEGACY_CUTOVER.md).

## Evidence

Migration 120 adds source relationship fields and the teaching-history table. `scripts/link-legacy-university-data.js` uses the retained encrypted source, updates only explicit source-context fields, checks every module and teaching link and applies the changes atomically. Replaying it was checked for stable relationship totals.

The curriculum, teaching, staff and foundation suite passed 43 tests. Database and application checks verified counts, scoped and own-staff teaching visibility, staff profile fallback, refusal to publish incomplete curricula, and HTTP delivery of curriculum/history views. Fresh-database migrations passed. Local count/evidence files are `data/legacy-cutover/university-data-links.json` and `data/legacy-cutover/university-data-links-verification.json`.
