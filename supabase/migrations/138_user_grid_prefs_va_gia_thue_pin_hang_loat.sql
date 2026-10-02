-- 138 (da ap dung len DB qua MCP)
-- 1) user_grid_prefs: luu do rong/thu tu cot bang luoi theo TUNG user (RLS: chi doc/ghi dong cua minh).
-- 2) fn_cap_nhat_gia_thue_pin_hang_loat: sua gia Thue pin hang loat cho xe 'Xe doi pin'.
create table if not exists public.user_grid_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  grid_key text not null,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, grid_key)
);
alter table public.user_grid_prefs enable row level security;
create policy user_grid_prefs_own_select on public.user_grid_prefs for select to authenticated using (user_id = auth.uid());
create policy user_grid_prefs_own_insert on public.user_grid_prefs for insert to authenticated with check (user_id = auth.uid());
create policy user_grid_prefs_own_update on public.user_grid_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.fn_cap_nhat_gia_thue_pin_hang_loat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; n int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_danh_muc') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa danh mục xe'; end if;
  if coalesce((p->>'list_price_thue_pin')::bigint, 0) <= 0 then raise exception 'THIEU_THONG_TIN: giá Thuê pin phải > 0'; end if;
  if coalesce(p->>'brand','') = '' and coalesce(p->>'name','') = '' then raise exception 'THIEU_THONG_TIN: chọn Hãng hoặc Model'; end if;
  update public.vehicles set list_price_thue_pin = (p->>'list_price_thue_pin')::bigint
  where model_pin = 'Xe đổi pin'
    and (coalesce(p->>'brand','') = '' or brand = p->>'brand')
    and (coalesce(p->>'name','') = '' or name = p->>'name');
  get diagnostics n = row_count;
  return jsonb_build_object('so_ma_cap_nhat', n);
end $$;
