-- Automatic six-digit internal codes. Existing non-empty codes are immutable.
-- No existing listing is rewritten. Public projections must exclude internal_code.
create sequence if not exists private.listing_internal_code_seq
  as integer start with 100001 minvalue 100001 maxvalue 999999 no cycle;

create unique index if not exists listings_six_digit_internal_code_key
  on public.listings (internal_code)
  where internal_code ~ '^[0-9]{6}$';

create or replace function private.assign_listing_internal_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_code text;
  candidate text;
begin
  -- The trigger does not grant write access: the table's existing RLS still applies.
  -- Only active administrators may trigger allocation through the Data API.
  if current_setting('role', true) in ('anon', 'authenticated')
     and (auth.uid() is null or not public.is_site_admin()) then
    raise insufficient_privilege using message = '仅管理员可保存房源。';
  end if;

  if tg_op = 'INSERT' then
    -- PostgREST saves with INSERT ... ON CONFLICT DO UPDATE. Preserve its code
    -- before the insert attempt; an empty existing code is allocated on UPDATE.
    select l.internal_code into existing_code
      from public.listings as l where l.id = new.id;
    if found then
      new.internal_code := existing_code;
      return new;
    end if;
  elsif nullif(btrim(old.internal_code), '') is not null then
    new.internal_code := old.internal_code;
    return new;
  end if;

  -- nextval is atomic across administrators and tabs. Never recycle codes.
  loop
    begin
      candidate := nextval('private.listing_internal_code_seq'::regclass)::text;
    exception when sequence_generator_limit_exceeded then
      raise exception using errcode = 'P0001',
        message = '六位房源编号已用尽，请联系管理员扩展编号规则。';
    end;
    exit when not exists (
      select 1 from public.listings as l where l.internal_code = candidate
    );
  end loop;
  new.internal_code := candidate;
  return new;
end;
$$;

revoke all on sequence private.listing_internal_code_seq from public, anon, authenticated;
revoke all on function private.assign_listing_internal_code() from public, anon, authenticated;

create or replace trigger assign_listing_internal_code
  before insert or update on public.listings
  for each row execute function private.assign_listing_internal_code();

comment on sequence private.listing_internal_code_seq is
  'Six-digit private listing identifiers, allocated on first save; gaps are allowed and codes are never reused.';
