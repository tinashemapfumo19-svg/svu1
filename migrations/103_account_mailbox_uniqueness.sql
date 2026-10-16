lock table accounts in share mode;

do $$
begin
  if exists (
    select 1 from accounts group by lower(btrim(email)) having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'Canonical account email collision; resolve identities before migration.';
  end if;
end $$;

create unique index accounts_canonical_email_key on accounts (lower(btrim(email)));
