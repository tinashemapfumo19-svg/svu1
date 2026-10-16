# Native Asset Reports

The Assets workspace exports asset-register, current-allocation and stock-check CSV reports through authenticated `GET /api/assets/reports`. Reports require an institution-wide permission-bearing asset role (`assets.view`, `assets.manage` or `assets.approve`). An unrelated global role does not broaden scoped asset authority.

Supported filters: `kind` (`register`, `allocations`, `stock_checks`), `q`, `status`, `departmentId`, `staffQ`, and optional `from`/`to` dates for stock checks only. Text searches are literal, including percent and underscore characters. Dates are inclusive, real calendar dates, no earlier than 1900 and not in the future. Unknown and duplicate parameters are refused. Pagination parameters are not export filters.

Each export captures one repeatable-read snapshot, generation timestamp and `asset-register-reports-v1` definition. All matching rows are exported up to 5,000; larger requests fail without partial output and require narrower filters. An audit-storage failure rolls back and returns no CSV. The export audit retains filters and row count, not CSV contents. Responses are no-store.

CSV columns include asset identifiers/name/category, current status/condition/department/location, currency, exact acquisition minor units, current custodian/employee number/allocation date, and stock-check date/outcome/observed condition/location where applicable. Formula-like text cells are prefixed and CSV quotes escaped. Values remain exact decimal strings; no floating-point conversion, currency conversion, depreciation or grand total across currencies is performed.

Stock-check dates select retained observations, not historical reconstruction of current register metadata. Each observation has its own row, so repeating acquisition values across check rows must not be summed as asset totals. Current allocations include only open custody; these exports are not historical custody reports or external SMS issue vouchers.

## Verification

All 484 unit tests pass, including strict filters, exact values, formula protection, scoped denial, oversize refusal and audit rollback. The existing full asset custody/disposal journey plus report API and download controls passed on desktop and mobile in `svu_rebuild_it_1791585368183`, subsequently dropped. Checks include all 27 observations beyond a single history page, empty current-allocation results, one-row register results, duplicate/date misuse rejection and unauthorized/scoped access. Screenshots inspected in `data/asset-reporting-browser`.

Browser verification preserved the 461-file source hash `62c0ba6acab29e7b1f00ddc090494ed94486da062c3657bcf29c63114bf25079`. Afterward only unit tests changed: corrected an error assertion to the existing `statusCode` contract and added failure/rollback cases; no browser-tested runtime code changed.

The archived relay identifies an absent external SMS report application. These exports provide native report functionality; they do not prove identical external layouts, historical imports, accounting policy or approved inventory vouchers. Those boundaries remain in the active coverage register.
