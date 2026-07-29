-- ============================================================
-- Migration 073 — QUẢN LÝ HÀNG HÓA (phụ kiện, quà tặng, ...)
--  1) products: danh muc hang hoa co ton kho (khong phai xe, khong theo serial)
--  2) product_txns: lich su xuat nhap ton hang hoa
--  3) fn_nhap_hang_hoa: nhap ton hang hoa
--  4) fn_xuat_hang_hoa: xuat ton hang hoa (goi khi ban kem don xe)
--  5) Trigger tu dong tru ton khi ban kem don xe (sale_items)
-- Chạy SAU 072. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) DANH MỤC HÀNG HÓA =====================
create table if not exists public.products (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  group_name text not null default 'Phụ kiện',
  unit text not null default 'Cái',        -- don vi tinh
  cost_price bigint not null default 0,    -- gia von
  sale_price bigint not null default 0,    -- gia ban le mac dinh
  stock_qty int not null default 0,        -- ton kho hien tai
  min_qty int not null default 0,          -- canh bao khi duoi muc nay
  location_code text references public.locations(code),
  barcode text default '',
  note text default '',
  status text not null default 'Hoạt động' check (status in ('Hoạt động','Ngừng')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_group_idx on public.products (group_name, status);
alter table public.products enable row level security;
create policy "products_auth" on public.products for all to authenticated using (true) with check (true);

-- ===================== 2) LỊCH SỬ XUẤT NHẬP TỒN =====================
create table if not exists public.product_txns (
  id bigserial primary key,
  product_id bigint not null references public.products(id),
  txn_type text not null check (txn_type in ('Nhập','Xuất','Điều chỉnh')),
  qty int not null,                        -- so luong thay doi (duong=nhap, am=xuat)
  stock_before int not null default 0,
  stock_after int not null default 0,
  unit_price bigint default 0,             -- gia nhap/ban tai thoi diem
  ref_code text default '',               -- ma don lien quan (BH-..., phieu nhap...)
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index if not exists product_txns_product_idx on public.product_txns (product_id, created_at desc);
alter table public.product_txns enable row level security;
create policy "product_txns_auth" on public.product_txns for all to authenticated using (true) with check (true);

-- ===================== 3) HÀM NHẬP TỒN HÀNG HÓA =====================
create or replace function public.fn_nhap_hang_hoa(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; prod record; v_qty int; v_before int;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/Quản lý/BGĐ được nhập hàng hóa';
  end if;
  select * into prod from public.products where id = (p->>'product_id')::bigint for update;
  if prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm không tồn tại'; end if;
  v_qty := coalesce((p->>'qty')::int, 0);
  if v_qty <= 0 then raise exception 'THIEU_THONG_TIN: số lượng nhập phải > 0'; end if;
  v_before := prod.stock_qty;
  update public.products set
    stock_qty = stock_qty + v_qty,
    cost_price = coalesce(nullif((p->>'cost_price')::bigint, 0), cost_price),
    updated_at = now()
  where id = prod.id;
  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    unit_price, ref_code, note, created_by, created_by_name)
  values (prod.id, 'Nhập', v_qty, v_before, v_before + v_qty,
    coalesce((p->>'cost_price')::bigint, prod.cost_price),
    coalesce(p->>'ref_code',''), coalesce(p->>'note',''), me.uid, me.name);
end $$;

-- ===================== 4) HÀM XUẤT TỒN HÀNG HÓA =====================
create or replace function public.fn_xuat_hang_hoa(
  p_product_id bigint, p_qty int, p_price bigint, p_ref text, p_note text,
  p_uid uuid, p_uname text
) returns void language plpgsql security definer set search_path = public as $$
declare prod record; v_before int;
begin
  select * into prod from public.products where id = p_product_id for update;
  if prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm %', p_product_id; end if;
  if prod.stock_qty < p_qty then
    raise exception 'KHONG_DU_TON: % chỉ còn % %, cần % %', prod.name, prod.stock_qty, prod.unit, p_qty, prod.unit;
  end if;
  v_before := prod.stock_qty;
  update public.products set stock_qty = stock_qty - p_qty, updated_at = now() where id = p_product_id;
  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    unit_price, ref_code, note, created_by, created_by_name)
  values (p_product_id, 'Xuất', p_qty, v_before, v_before - p_qty,
    p_price, coalesce(p_ref,''), coalesce(p_note,''), p_uid, p_uname);
end $$;

-- ===================== 5) HOÀN TỒN KHI HỦY ĐƠN =====================
create or replace function public.fn_hoan_ton_hang_hoa(p_sale_code text, p_uid uuid, p_uname text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; prod record; v_before int;
begin
  -- Tim cac sale_items co product_id (hang hoa co ton kho)
  for r in select * from public.sale_items where sale_code = p_sale_code and product_id is not null loop
    select * into prod from public.products where id = r.product_id for update;
    if prod is not null then
      v_before := prod.stock_qty;
      update public.products set stock_qty = stock_qty + r.qty, updated_at = now() where id = r.product_id;
      insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
        unit_price, ref_code, note, created_by, created_by_name)
      values (r.product_id, 'Nhập', r.qty, v_before, v_before + r.qty,
        r.unit_price, p_sale_code, 'Hoàn tồn do hủy/trả đơn ' || p_sale_code, p_uid, p_uname);
    end if;
  end loop;
end $$;

-- ===================== 6) THÊM product_id VÀO sale_items =====================
alter table public.sale_items add column if not exists product_id bigint references public.products(id);

-- ===================== 7) TÍCH HỢP HỦY ĐƠN: hoàn tồn hàng hóa =====================
-- Cập nhật fn_xoa_don để hoàn tồn hàng hóa khi hủy đơn
create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được hủy đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do hủy đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn này đã hủy/trả trước đó'; end if;

  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null,
      coc_status = case when coalesce(o.coc_giao,false) and u.coc_status = 'DA_GIAO' then 'DA_VE'
                        else u.coc_status end,
      updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  end if;

  -- Hoan ton hang hoa ban kem
  perform public.fn_hoan_ton_hang_hoa(o.code, me.uid, me.name);
  perform public._hoan_quy_don(o.code, trim(p_ly_do), me.uid, me.name);

  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do), updated_at = now()
  where id = p_id;
end $$;

-- ===================== 8) DV_SERVICES: thêm nhóm Dịch vụ bán kèm =====================
-- Them cot de phan biet dich vu ky thuat (dung trong phieu DV) vs dich vu ban kem don xe
alter table public.dv_services add column if not exists service_scope text not null default 'repair'
  check (service_scope in ('repair','sale'));
-- repair: dich vu sua chua/bao duong (hien trong phieu DV)
-- sale: dich vu ban kem don xe (dang ky, bao hiem, ...)

do $do$
begin
  raise notice 'XONG 073: products + product_txns + fn nhap/xuat hang hoa + tich hop don ban + huy don';
end $do$;
