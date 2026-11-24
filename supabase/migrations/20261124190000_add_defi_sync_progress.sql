alter table public.defi_wallets
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_positions jsonb not null default '[]'::jsonb,
  add column if not exists sync_cursor integer not null default 0,
  add column if not exists sync_failed_count integer not null default 0,
  add column if not exists sync_open_count integer not null default 0;

create or replace function public.claim_defi_wallet_sync(p_wallet_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.defi_wallets
  set sync_lock_until = now() + interval '2 minutes'
  where id = p_wallet_id
    and user_id = p_user_id
    and (sync_lock_until is null or sync_lock_until < now())
    and (sync_started_at is not null or last_synced_at is null or last_synced_at <= now() - interval '1 hour');
  claimed := found;
  return claimed;
end;
$$;

revoke all on function public.claim_defi_wallet_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_defi_wallet_sync(uuid, uuid) to service_role;

