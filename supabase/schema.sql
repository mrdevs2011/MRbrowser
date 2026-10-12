-- MRBrowser — Supabase full schema
-- SQL Editor da bir marta ishga tushiring.

-- 1) Asosiy sinxron jadvali
create table if not exists public.browser_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.browser_sync is 'MRBrowser bulut profili (sozlamalar, accountlar, bookmark, shortcuts, history...)';
comment on column public.browser_sync.payload is 'JSON: { v, settings, accounts, lastAccountId, updatedAt }';

-- 2) updated_at avto-yangilash
create or replace function public.browser_sync_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_browser_sync_updated_at on public.browser_sync;
create trigger trg_browser_sync_updated_at
before update on public.browser_sync
for each row execute function public.browser_sync_set_updated_at();

-- 3) RLS
alter table public.browser_sync enable row level security;

drop policy if exists "own_sync_select" on public.browser_sync;
drop policy if exists "own_sync_insert" on public.browser_sync;
drop policy if exists "own_sync_update" on public.browser_sync;
drop policy if exists "own_sync_delete" on public.browser_sync;
drop policy if exists "own_sync" on public.browser_sync;

create policy "own_sync_select" on public.browser_sync
  for select using (auth.uid() = user_id);

create policy "own_sync_insert" on public.browser_sync
  for insert with check (auth.uid() = user_id);

create policy "own_sync_update" on public.browser_sync
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own_sync_delete" on public.browser_sync
  for delete using (auth.uid() = user_id);

-- 4) Auth eslatma (Dashboard):
-- Authentication → Providers → Email yoqilgan bo'lsin.
-- Test uchun "Confirm email" ni o'chirib qo'yish mumkin.
