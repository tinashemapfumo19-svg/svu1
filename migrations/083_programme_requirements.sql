alter table programme_versions add column revision integer not null default 1;
create function protect_published_programme_requirements() returns trigger language plpgsql as $$
begin
  if old.status in ('published','retired') and new.status='draft' then
    raise exception 'Published programme versions cannot be reopened';
  end if;
  if old.status in ('published','retired') and new.requirements is distinct from old.requirements then
    raise exception 'Published admission requirements are immutable';
  end if;
  return new;
end;
$$;
create trigger programme_requirements_immutable before update on programme_versions for each row execute function protect_published_programme_requirements();
