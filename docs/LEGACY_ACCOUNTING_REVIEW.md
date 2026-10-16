# Legacy Accounting Review

Read-only review, 2026-10-10. No archived PHP was executed or modified, and no financial records were imported. This corrects the earlier accounting audit: the package contains local period-reconciliation logic as well as student-payment relay logic.

## Confirmed Functions

| Source | Capability | New-System Coverage |
| --- | --- | --- |
| `main_settings.php:1360`, `loadPayments` | Relay student payments into `acc_revenue` | Native student payment/ledger workflow exists; no automatic posting into a broader institutional cashbook |
| `recon_process.php:8`, `recon_updator.php:28` | Check period overlap before reconciliation | Unmatched institutional reconciliation boundary |
| `recon_updator.php:61`, `reconcilePeriod` | Sum period revenue, expenditure, bank charges, deposits and withdrawals; carry previous closing balance; create reconciliation | Unmatched; student finance reporting reconciles student-ledger totals, not these institutional accounts |
| `recon_updator.php:172`, `closingBalance` | Recalculate closing balance and shortfall | Unmatched |
| `recon_updator.php:184`, `updateCashInHand` | Record physical cash observation and recalculate | Unmatched |
| `recon_updator.php:193`, `isCloseRecon` | Read closed state | Unmatched |
| `recon_updator.php:209`, `compleRecon` | Close a reconciliation | Function is present; no caller was found in the supplied PHP tree. Neither reachability nor production use is established |
| `recon_updator.php:17,218` | Find latest reconciliation and lookup by dates | Supporting lookup, not an independent accounting system |

Menu links identify income, cash records, expenditure and bank reconciliation. Redirects identify an external SMS frontend. The supplied tree has no matching controller/model filenames; absence from this package does not prove those applications never existed.

## Defects Not To Reproduce

- `checkOverlappingDates` never returns its computed flag. It checks only the last reconciliation and endpoint containment, not every overlapping/enclosing interval. Its SQL OR precedence also weakens the ID restriction.
- Expenditure is queried only when income is positive. A zero-revenue period can therefore omit real spending.
- Opening balance uses the maximum record ID without requiring a preceding closed period or separating currencies/accounts. Reordered dates and competing inserts can select inappropriate balances.
- Initial shortfall suppresses negative values, while later cash updates retain signed differences. Those two definitions are inconsistent.
- The prior closing balance includes bank plus physical cash, yet is added into the next bank balance. This is not an approved opening-bank policy.
- Direct SQL interpolation, permissive `is_numeric` amounts and multi-statement updates do not provide bounded minor-unit arithmetic, atomic snapshots, optimistic revisions or immutable approval evidence. Cash updates do not themselves guard against an already closed reconciliation.

These are source observations, not approved financial rules. A replacement must preserve the required business capabilities without copying defects or presenting inferred arithmetic as institutional policy.

## Implementation Requirements

The institutional cashbook/reconciliation domain must remain separate from the student receivables ledger. Confirm currency/account scope, opening bank and cash evidence, revenue/expense categories, charge treatment, transfer directions and statement/physical-cash reconciliation definitions. Student receipts need explicitly approved, idempotent posting rules to avoid double counting.

A native implementation needs authorized institutional accounts; append-only, currency-bound cashbook events with reversal history; bounded integer minor units; period overlap protection across all relevant periods; atomic captured control totals; observed closing balances; signed variance; revision/replay-safe commands; independent closure authority and immutable closed snapshots. Backdating, corrections, exports, retention and legacy mappings require explicit treatment. An external implementation instead needs the actual system contract, approved ownership and acknowledgment/reconciliation evidence.

No chart of accounts, tax treatment, currency conversion, opening balance, actual bank balance or institutional accounting approval is inferred from this archive. Asked for the accounting policy owner and native-versus-external boundary. Independent audit/build work can continue while that answer is pending.

## Source Evidence

- `recon_updator.php`: 7,411 bytes, SHA-256 `981ac610eac0eeea66ba2fe7396e9559f1538c78904c710e3e24a6edf533a79f`.
- Historical SQL preview revalidated directly from original bytes: SHA-256 `dd5f04aa5fd2dd12f0db91c621b974bbe5d3a728ee29fca4e9ab1b0012ae3572`; no `acc_*`, fleet/vehicle, `node`, `field_*` or `file_managed` tables. This limited table-name check does not prove the absence of every related domain.
- Primary archive remains damaged and is not an authorized import source. Only supplied archives are available. No missing accounting tables were reconstructed as actual data.
