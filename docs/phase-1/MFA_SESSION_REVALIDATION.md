# Current MFA Session Requirements

The implementation guide requires MFA for privileged and sensitive roles. A session's stored status is not an exemption from the configured policy after factor enrolment or an effective role change.

## Authentication Boundary

`authenticateSession` reads active account/session state, expiry, current active-factor presence and current effective high/critical-risk role assignments in the session lookup. Before loading permissions or role scopes, it applies the same `mfaRequirement` policy used by login:

| Policy | Current Context | Accepted Assurance Or Challenge |
| --- | --- | --- |
| `off` | Any | Existing status boundary; no new MFA requirement |
| `enrolled` | No active factor | Existing status boundary |
| `privileged` | No factor, no effective high/critical-risk role | Existing status boundary |
| `privileged` | No factor, effective high/critical-risk role | Enrolment-required challenge only, on routes explicitly allowing it |
| `enrolled` or `privileged` | Active factor | MFA assurance, or a pending verification challenge on routes explicitly allowing it |

An older password-only active session is refused with `401` when the current policy requires MFA. An enrolment-required challenge is also refused after another session activates a factor; it cannot start or confirm another enrolment. Sign in again to obtain the current challenge, then complete verification. A refused token is not silently upgraded, converted to a different challenge or treated as a privileged actor. This applies to authenticated self-service routes as well as permission-protected routes.

The session that successfully confirms enrolment retains its existing upgrade to active MFA assurance. Fresh login, TOTP/recovery verification and partial-session route restrictions are unchanged. Current effective dates, not the risk at login, determine privilege. Administrative MFA reset and account suspension retain their existing session-revocation behaviour.

## Verification Scope

Five focused repository tests cover stale-factor and privileged-policy refusal before permission loading, explicit off/default enrolled compatibility, valid verified/partial-session boundaries and a displaced enrolment challenge. Native cases use real routers, repositories and ephemeral enrolled/privileged/off servers on a disposable integration database. They grant a role through the API, enrol through TOTP, refuse old self-service/protected-session-list/enrolment requests and verify a fresh session using a real recovery code. Each policy is independently exercised by the desktop and mobile projects; these are API-native cases, not visual MFA page coverage.

The initial native failure is retained separately from recovery evidence in [build verification](../BUILD_VERIFICATION.md). Existing visual enrolment/cancellation/verification workflows must also pass against the completed shared-sign-in shell before broad current-build acceptance. This change does not prove production identity-provider configuration, institutional MFA/recovery approval, provider delivery or an immutable authentication snapshot for requests already authorized before a change.
