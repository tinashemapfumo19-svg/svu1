# Local Demo Logins

> **2026-10-12, user request:** on the running servers at `http://127.0.0.1:4173` (working) and
> `http://127.0.0.1:4211` (UI preview), every demo account below, plus `demo.lecturer@southvalley.test`,
> `demo.classmate@southvalley.test` and the preview applicant `ui.applicant@example.edu` (4211 only), now uses the
> password **`SvuDemo2026!`**. The passwords in the tables below remain what the seed and walkthrough scripts
> create in a fresh database. `npm run demo:check` and `demo:walkthrough` still use those seed passwords, so they
> report failed logins against these two servers until the seed passwords are changed to match.

Open http://127.0.0.1:4188/#signin for the current seeded walkthrough environment.
See [the walkthrough](DEMO_WALKTHROUGH.md) for student and staff tours.

| Account | Email | Password |
| --- | --- | --- |
| Administrator | admin@southvalley.test | Phase1-Admin-Password-2026! |
| Registrar | registrar@southvalley.test | Kariba-Senate-Approvals-2026! |
| Student | tinashe@example.edu | Phase1-Student-Password-2026! |
| Active student (run `demo:student`) | active.student@southvalley.test | Active-Student-Demo-2026! |

## Active Student Demo

Run `npm.cmd run demo:student` against the current local development server on
4177. This adds Tariro Demo Moyo through applicant activation, accepted offer,
student conversion, completed contact and next-of-kin details, and approved
onboarding. It preserves existing records and reuses this demo account on reruns.
The provisioner requires the local database and development outbox settings to
match the server. Set `SVU_BASE_URL` to target another local server.

The current working demo has student number `S27000019`, BSc Information Systems,
February 2027 intake, and status `onboarded`. Sign in and open the student portal
at `#apply`. `demo:walkthrough` has additionally populated course registrations,
published results, fees, messages, support, resources and examinations. Its
uploaded identity/transcript documents are synthetic development fixtures.

Sign out before switching accounts. The administrator has system access; the
registrar has academic registry access; the student has self-service access.
The seed also includes admissions@example.edu, but it has no seeded password.

Check the three password logins with `npm.cmd run demo:check`. This creates and
revokes its own probe sessions. It does not reset accounts or application data.
Set `SVU_BASE_URL` to check another local port.

## Fresh Disposable Environment

Use a separate new local PostgreSQL database for a fresh demo. These commands
assume you have created an empty database named `svu_demo` on port 5433:

```powershell
$env:SVU_ENV='development'
$env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5433/svu_demo'
$env:SVU_PORT='4188'
$env:SVU_MFA_POLICY='enrolled'
npm.cmd run migrate
npm.cmd run seed -- --reset-database svu_demo
npm.cmd run dev
```

Then open http://127.0.0.1:4188/#signin. In another terminal, run:

```powershell
$env:SVU_BASE_URL='http://127.0.0.1:4188'
npm.cmd run demo:check
```

Seeding resets the entire target dataset. Do not point the seed command at an
existing working database. Configuration comes from process environment variables;
the server does not automatically load `.env` files. The development `enrolled`
MFA policy still requests verification for accounts that enrolled an authenticator.
