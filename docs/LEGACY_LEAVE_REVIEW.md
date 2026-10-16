# Legacy Leave Review

Read-only source review, 2026-10-10. Source line references below use `rg` line numbering; the packaged file contains unusual carriage-return sequences, so PowerShell line splitting can give different offsets. No PHP was executed and no staff record was imported or changed.

## Confirmed Source

Paths below are relative to `_legacy_php_system/sf/mymodules/customised`.

| Source | Confirmed Behavior | Replacement Status |
| --- | --- | --- |
| `main_settings.php:596`, `initLeaveRecords` | Selects `leave_types` by default grade, copies `accrual_rate_monthly` and `maximum_days` into balance records, initializes taken days to zero and uses engagement date | Native category/balance entries and effective employment grades exist, but no institution-approved automatic grade-based accrual/cap workflow is implemented. Stored legacy parameters are evidence, not approved current values. |
| `main_settings.php:821`, `leaveBal` | Reads leave balances; displays `dateDiffxx(accrual_start,today) - ytd_days_taken`, pending and authorised counters | Native balances derive from explicit audited grants minus approved usage and pending reservations. The legacy display is not authoritative accrual evidence. |
| `main_settings.php:45`, `dateDiffxx` | Computes elapsed calendar-day difference via Julian day conversion | The caller above does not multiply by the stored monthly accrual rate or apply the stored maximum-day limit. Calendar days since engagement are not safely interpretable as monthly leave entitlement. |
| `authorise_leave.php:29` and `:36` | Recommends/authorises all matching status records for a staff ID | Native individual request/revision decisions, current-supervisor authority and independent approval are verified. Staff-wide mutation scope must not be copied. |
| `authorise_leave.php:44` and `:53` | Reversal/denial updates filter by staff ID rather than selected request | Native cancellation/reversal/denial preserves per-request history and authority. These broad legacy mutations are not approved bulk-decision requirements. |
| `leave_cancel.php:8` | Cancellation filters by a single leave-record ID | Native individual cancellation is implemented, with lifecycle/date restrictions; historical cancellation mapping remains unperformed. |

Source SHA-256 fingerprints:

- `main_settings.php`: `4daf94eddeb483e73cd9ee1e63882f2596c466ff272138859f44c438fb689111`.
- `authorise_leave.php`: `f8fe018e249c89c4c57e212f9789168b282dd5e8ab38d09761c7657856472490`.
- `leave_cancel.php`: `e95b7f6a82e77813eab91b279199be225823e0797b45627d88943357eb81943c`.

## Outstanding Rules

Grade-specific accrual, caps, partial months, fractional days, year boundaries, carry-forward/expiry, employment changes and authoritative opening balances require explicit approved inputs. The inspected display does not establish these rules, nor prove that every feature existed elsewhere in the external HRMS. The native whole-day category/balance workflow is not full automatic-accrual parity.

The user confirmed on 2026-10-10 that no authoritative HR leave policy document is available yet. Automatic accrual, caps, partial-month/fractional treatment and carry-forward remain policy-blocked; existing explicit audited whole-day grants/workflows remain available. Do not seed inferred entitlements, count one leave day per elapsed service day or treat old SQL values as current policy. Only supplied archives are available for migration; the damaged primary is not repaired or imported, and readable historical data is not substituted for current balances.

This milestone adds source evidence, not new runtime verification. Existing bounded leave browser checks remain historical evidence for their stated scope. Automatic accrual and policy-dependent behavior stay open in the legacy coverage goal.
