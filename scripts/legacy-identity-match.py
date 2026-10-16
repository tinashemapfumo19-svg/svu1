"""Read-only literal SQL identity matching; never exports credential values or executes SQL."""
import collections
import hashlib
import json
import pathlib
import re
import sys

SOURCE_TABLES = {
    'students_registration', 'student_pro', 'svu_student_control',
    'svu_staff_members', 'svu_sl', 'users', 'courses', 'svu_course_codes',
}
HEADER = re.compile(r'INSERT INTO `([^`]+)`\s*\(([^)]*)\)\s*VALUES\s*')
TOKEN = re.compile(r"'(?:\\[\s\S]|''|[^'\\])*'|0x[0-9a-fA-F]+|NULL|[-+]?\d+(?:\.\d+)?|[(),;]")


def literal(token):
    if token == 'NULL':
        return None
    if not token.startswith("'"):
        return token
    escapes = {'0': '\0', 'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'Z': '\x1a'}
    return re.sub(r"\\([\s\S])|''", lambda m: escapes.get(m[1], m[1]) if m[1] is not None else "'", token[1:-1])


def read_rows(sql, selected_tables=SOURCE_TABLES):
    result = collections.defaultdict(list)
    for header in HEADER.finditer(sql):
        table = header[1]
        if selected_tables is not None and table not in selected_tables:
            continue
        columns = re.findall(r'`([^`]+)`', header[2])
        at = header.end()
        row = None
        expect_value = False
        while True:
            while at < len(sql) and sql[at].isspace():
                at += 1
            match = TOKEN.match(sql, at)
            if not match:
                raise ValueError(f'Unsupported literal syntax in {table} at line {sql.count(chr(10), 0, at) + 1}')
            token = match[0]
            at = match.end()
            if token == ';':
                if row is not None or expect_value:
                    raise ValueError('Incomplete selected insert')
                break
            if token == '(':
                if row is not None:
                    raise ValueError('Nested expressions are not supported')
                row = []
                expect_value = True
            elif token == ')':
                if row is None or expect_value or len(row) != len(columns):
                    raise ValueError('Selected row column count mismatch')
                result[table].append(dict(zip(columns, row)))
                row = None
            elif token == ',':
                if row is not None:
                    if expect_value:
                        raise ValueError('Missing selected value')
                    expect_value = True
            else:
                if row is None or not expect_value:
                    raise ValueError('Unexpected selected value')
                row.append(literal(token))
                expect_value = False
    return result


def norm(value):
    return (value or '').strip().casefold()


def index(rows, field):
    result = collections.defaultdict(list)
    for position, row in enumerate(rows, 1):
        if norm(row.get(field)):
            result[norm(row[field])].append(position)
    return result


def credential_format(value):
    if not value:
        return 'missing'
    if re.fullmatch(r'[a-fA-F0-9]{32}', value):
        return 'md5_shaped'
    if value.startswith('$S$'):
        return 'drupal7_shaped'
    if value.startswith(('$P$', '$H$')):
        return 'phpass_shaped'
    return 'other_requires_review'


def main():
    if len(sys.argv) != 4:
        raise ValueError('Usage: python scripts/legacy-identity-match.py source.sql target-snapshot.json output.json')
    source, snapshot, destination = map(pathlib.Path, sys.argv[1:])
    if destination.resolve() in (source.resolve(), snapshot.resolve()):
        raise ValueError('Output cannot replace an input')
    raw = source.read_bytes()
    sql = raw.decode('utf-8', errors='strict')
    tables = read_rows(sql)
    target = json.loads(snapshot.read_text(encoding='utf-8'))
    registrations = tables['students_registration']
    staff = tables['svu_staff_members']
    student_numbers = index(registrations, 'svu_reg_number')
    student_emails = index(registrations, 'email')
    staff_ids = index(staff, 'staff_id')
    staff_emails = index(staff, 'email')
    accounts = target['accounts']
    account_emails = index(accounts, 'email')
    account_numbers = index(accounts, 'student_number')
    matches = []

    for table, rows in [('students_registration', registrations), ('svu_staff_members', staff)]:
        for position, row in enumerate(rows, 1):
            email_hits = account_emails.get(norm(row.get('email')), [])
            number_hits = account_numbers.get(norm(row.get('svu_reg_number')), []) if table == 'students_registration' else []
            candidates = sorted(set(email_hits + number_hits))
            repeated_email = len((student_emails if table == 'students_registration' else staff_emails).get(norm(row.get('email')), [])) > 1
            repeated_number = table == 'students_registration' and len(student_numbers.get(norm(row.get('svu_reg_number')), [])) > 1
            conflict = bool(email_hits and number_hits and set(email_hits) != set(number_hits))
            state = 'review_conflict' if repeated_email or repeated_number or conflict or len(candidates) > 1 else 'candidate_existing' if candidates else 'no_target_match'
            matches.append({'sourceTable': table, 'sourceRow': position,
                            'legacyId': row.get('reg_number' if table == 'students_registration' else 'staff_id'),
                            'state': state, 'targetAccountIds': sorted({accounts[i-1]['id'] for i in candidates}),
                            'matchedBy': [field for field, hits in [('email', email_hits), ('student_number', number_hits)] if hits],
                            'duplicateSourceEmail': repeated_email, 'duplicateSourceStudentNumber': repeated_number})

    credential_links = []
    credential_sources = [('student_pro', 'key_id', 'student_id', student_numbers),
                          ('svu_sl', 'authid', 'staff_id', staff_ids),
                          ('users', 'pass', 'mail', None)]
    credential_summary = {}
    for table, field, key, lookup in credential_sources:
        counts = collections.Counter()
        for position, row in enumerate(tables[table], 1):
            hits = lookup.get(norm(row.get(key)), []) if lookup is not None else []
            state = 'unique_source_link' if len(hits) == 1 else 'ambiguous_source_link' if hits else 'unlinked'
            fmt = credential_format(row.get(field))
            counts[state] += 1
            counts['format:' + fmt] += 1
            credential_links.append({'sourceTable': table, 'sourceRow': position, 'credentialColumn': field,
                                     'format': fmt, 'state': state, 'linkedSourceRows': hits,
                                     'linkedSourceTable': 'svu_staff_members' if table == 'svu_sl' else 'students_registration' if lookup is not None else None})
        credential_summary[table + '.' + field] = dict(counts)

    catalogue = {}
    for old, old_field, new in [('courses', 'course_code', 'programmes'), ('svu_course_codes', 'coursecode', 'courses')]:
        target_codes = index(target[new], 'code')
        codes = {norm(row.get(old_field)) for row in tables[old]} - {''}
        catalogue[old] = {'sourceDistinctCodes': len(codes), 'exactTargetCodeMatches': sum(code in target_codes for code in codes)}

    report = {'mode': 'read_only_candidates_no_import', 'sourceSha256': hashlib.sha256(raw).hexdigest(),
              'targetSnapshotAt': target['capturedAt'], 'credentialPolicy': 'Preserve original credential values in source; no password resets or credential exports during matching.',
              'limitations': ['Exact identifiers and normalized emails produce candidates, not verified ownership or automatic merges.',
                              'Credential formats are shape classifications; verifier semantics require source-code review.',
                              'No password/hash values, sessions, reset tokens or permission assignments are exported.',
                              'Unlinked or conflicting records are retained for reconciliation, not discarded.'],
              'selectedSourceRows': {name: len(rows) for name, rows in tables.items()},
              'identitySummary': {table: dict(collections.Counter(row['state'] for row in matches if row['sourceTable'] == table)) for table in ['students_registration', 'svu_staff_members']},
              'credentialSummary': credential_summary, 'catalogueSummary': catalogue,
              'nonPasswordSourceFields': {'students_registration.auth_id': 'Application association/reference; not treated as a password.',
                                          'svu_student_control.authid': 'Legacy session control; not treated as a password.'},
              'identityCandidates': matches, 'credentialLinks': credential_links}
    destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['selectedSourceRows', 'identitySummary', 'credentialSummary', 'catalogueSummary']}))


if __name__ == '__main__':
    main()
