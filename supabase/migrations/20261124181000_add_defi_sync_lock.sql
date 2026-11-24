alter table public.defi_wallets
  add column if not exists sync_lock_until timestamptz;

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
  set sync_lock_until = now() + interval '10 minutes'
  where id = p_wallet_id
    and user_id = p_user_id
    and (sync_lock_until is null or sync_lock_until < now())
    and (last_synced_at is null or last_synced_at <= now() - interval '1 hour');
  claimed := found;
  return claimed;
end;
$$;

revoke all on function public.claim_defi_wallet_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_defi_wallet_sync(uuid, uuid) to service_role;

