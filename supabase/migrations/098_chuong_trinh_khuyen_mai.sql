-- ============================================================
-- Migration 098: Module "Chương trình khuyến mại" — CHỈ dạng TAG
-- gắn vào Đơn bán để nhận diện/lọc/báo cáo, KHÔNG tính giảm giá
-- (không đụng discount_amount/sale_price).
--
-- 1 đơn bán có thể gắn NHIỀU chương trình cùng lúc (0 hoặc nhiều).
-- Nhân viên bán TỰ CHỌN TAY lúc tạo/sửa đơn, chỉ thấy chương trình
-- còn hạn + đúng hãng/tên xe đang bán.
-- Chạy sau 097. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create table if not exists public.promotions (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  brand text not null,
  vehicle_names text[] not null default '{}',   -- ten xe (Model) ap dung, rong = ap dung moi model cua hang
  start_date date not null,
  end_date date not null,
  note text default '',
  status text not null default 'Đang áp dụng' check (status in ('Đang áp dụng','Tạm dừng','Hết hạn')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists promotions_date_idx on public.promotions (start_date, end_date);

create table if not exists public.sale_order_promotions (
  id bigserial primary key,
  sale_code text not null references public.sales_orders(code) on delete cascade,
  promotion_id bigint not null references public.promotions(id),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  unique (sale_code, promotion_id)
);
create index if not exists sop_sale_idx on public.sale_order_promotions (sale_code);
create index if not exists sop_promo_idx on public.sale_order_promotions (promotion_id);

alter table public.promotions enable row level security;
alter table public.sale_order_promotions enable row level security;
drop policy if exists "read_promotions" on public.promotions;
create policy "read_promotions" on public.promotions for select to authenticated using (true);
drop policy if exists "read_sale_order_promotions" on public.sale_order_promotions;
create policy "read_sale_order_promotions" on public.sale_order_promotions for select to authenticated using (true);
-- Ghi chi qua RPC (security definer)

-- ---------- Tạo/sửa chương trình khuyến mại (ADMIN/CEO) ----------
create or replace function public.fn_luu_khuyen_mai(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được quản lý chương trình khuyến mại'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên chương trình'; end if;
  if coalesce(trim(p->>'brand'),'') = '' then raise exception 'THIEU_THONG_TIN: chọn hãng áp dụng'; end if;
  if nullif(p->>'start_date','') is null or nullif(p->>'end_date','') is null then
    raise exception 'THIEU_THONG_TIN: nhập đủ thời hạn chương trình';
  end if;

  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    v_code := nullif(trim(p->>'code'),'');
    if v_code is null then v_code := public.fn_gen_code('KM'); end if;
    insert into public.promotions (code, name, brand, vehicle_names, start_date, end_date, note, status, created_by, created_by_name)
    values (v_code, trim(p->>'name'), trim(p->>'brand'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      (p->>'start_date')::date, (p->>'end_date')::date, coalesce(p->>'note',''),
      coalesce(nullif(p->>'status',''), 'Đang áp dụng'), me.uid, me.name)
    returning id into v_id;
  else
    update public.promotions set
      name = trim(p->>'name'), brand = trim(p->>'brand'),
      vehicle_names = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      note = coalesce(p->>'note',''), status = coalesce(nullif(p->>'status',''), status),
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'KHONG_TIM_THAY: chương trình không tồn tại'; end if;
  end if;
  return v_id;
end $$;

-- ---------- Gắn/bỏ tag khuyến mại cho 1 đơn bán (SALES trở lên, dùng chung quyền xuat_ban) ----------
-- p_promotion_ids: mảng ID chương trình MUỐN GẮN — hàm sẽ đồng bộ đúng danh sách này
-- (xóa tag không còn trong danh sách, thêm tag mới có trong danh sách).
create or replace function public.fn_gan_khuyen_mai_don(p_sale_code text, p_promotion_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN'; end if;
  if not exists (select 1 from public.sales_orders where code = p_sale_code) then
    raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại';
  end if;

  delete from public.sale_order_promotions
  where sale_code = p_sale_code and not (promotion_id = any(coalesce(p_promotion_ids, '{}')));

  insert into public.sale_order_promotions (sale_code, promotion_id, created_by, created_by_name)
  select p_sale_code, pid, me.uid, me.name
  from unnest(coalesce(p_promotion_ids, '{}')) pid
  on conflict (sale_code, promotion_id) do nothing;
end $$;
