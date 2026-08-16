-- ============================================================
-- Migration 101: Bảng "Chỉ tiêu doanh số" (sales_targets) theo tháng
-- + theo cửa hàng (location_code NULL = áp dụng toàn hệ thống).
-- CEO nhập trên App (trang /chi-tieu), KHÔNG giao cho Bot "ghi nhớ"
-- — dữ liệu có cấu trúc, đối chiếu được, có lịch sử sửa.
-- Chạy sau 100. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create table if not exists public.sales_targets (
  id bigserial primary key,
  thang date not null,              -- luon luu ngay 01 cua thang, VD 2026-08-01
  location_code text references public.locations(code),  -- NULL = toan he thong
  target_revenue bigint not null default 0,
  target_units int not null default 0,
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (thang, location_code)
);

alter table public.sales_targets enable row level security;
drop policy if exists "read_sales_targets" on public.sales_targets;
create policy "read_sales_targets" on public.sales_targets for select to authenticated using (true);

create or replace function public.fn_luu_chi_tieu(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_thang date;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đặt chỉ tiêu'; end if;
  v_thang := date_trunc('month', (p->>'thang')::date)::date;

  insert into public.sales_targets (thang, location_code, target_revenue, target_units, note, created_by, created_by_name)
  values (v_thang, nullif(p->>'location_code',''), coalesce((p->>'target_revenue')::bigint,0),
    coalesce((p->>'target_units')::int,0), coalesce(p->>'note',''), me.uid, me.name)
  on conflict (thang, location_code) do update set
    target_revenue = excluded.target_revenue, target_units = excluded.target_units,
    note = excluded.note, updated_at = now();
end $$;
