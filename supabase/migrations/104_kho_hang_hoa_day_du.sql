-- ============================================================
-- Migration 104: Nâng cấp module "Hàng hóa" (Phụ kiện/Phụ tùng/Quà
-- tặng/Khác) từ 1 con số tồn duy nhất (products.stock_qty) sang mô
-- hình tách tồn THEO TỪNG KHO — giống mô hình Điều chuyển xe.
--
-- Theo xác nhận của anh Kỳ:
--  - KHÔNG theo dõi từng đơn vị riêng (không serial) — chỉ theo SỐ LƯỢNG/kho.
--  - Điều chuyển 2 BƯỚC: tạo phiếu (trừ ngay kho đi) -> kho đến XÁC NHẬN
--    NHẬN mới cộng tồn — giống hệt Điều chuyển xe hiện có.
--  - Giá vốn: chỉ lưu giá vốn LẦN NHẬP GẦN NHẤT (products.cost_price),
--    không tính bình quân gia quyền.
--
-- Tái dùng bảng product_txns đã có sẵn (migration 073), chỉ mở rộng
-- thêm txn_type + cột location_code — không tạo bảng log trùng lặp.
--
-- AN TOÀN DỮ LIỆU: KHÔNG xóa cột products.stock_qty (giữ lại làm dữ
-- liệu tham chiếu lịch sử) — di chuyển toàn bộ tồn hiện có sang
-- products_stock tại đúng location_code đang gán trên từng sản phẩm.
-- Sản phẩm nào CHƯA từng gán kho (location_code null) sẽ được liệt kê
-- rõ trong NOTICE khi chạy migration để anh biết cần kiểm kê bổ sung
-- thủ công cho đúng kho thực tế.
-- Chạy sau 103. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- 1) BẢNG TỒN THEO KHO ----------
create table if not exists public.products_stock (
  product_id bigint not null references public.products(id) on delete cascade,
  location_code text not null references public.locations(code),
  qty int not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, location_code)
);
create index if not exists products_stock_loc_idx on public.products_stock (location_code);

alter table public.products_stock enable row level security;
drop policy if exists "read_products_stock" on public.products_stock;
create policy "read_products_stock" on public.products_stock for select to authenticated using (true);

-- ---------- 2) MỞ RỘNG product_txns: thêm location_code + loại giao dịch mới ----------
alter table public.product_txns add column if not exists location_code text references public.locations(code);
alter table public.product_txns drop constraint if exists product_txns_txn_type_check;
alter table public.product_txns add constraint product_txns_txn_type_check
  check (txn_type in ('Nhập','Xuất','Điều chỉnh','Điều chuyển đi','Điều chuyển đến','Kiểm kê'));

-- ---------- 3) PHIẾU ĐIỀU CHUYỂN HÀNG HÓA (2 bước, giống transfer_orders) ----------
create table if not exists public.product_transfers (
  id bigserial primary key,
  code text unique not null,
  from_location text not null references public.locations(code),
  to_location text not null references public.locations(code),
  product_id bigint not null references public.products(id),
  qty int not null check (qty > 0),
  status text not null default 'Đang chuyển' check (status in ('Đang chuyển','Đã nhận','Đã hủy')),
  note text default '',
  requested_by uuid references public.profiles(id),
  requested_by_name text default '',
  requested_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  received_by_name text default '',
  received_at timestamptz
);
alter table public.product_transfers enable row level security;
drop policy if exists "read_product_transfers" on public.product_transfers;
create policy "read_product_transfers" on public.product_transfers for select to authenticated using (true);

-- ---------- 4) DI CHUYỂN DỮ LIỆU TỒN CŨ SANG products_stock ----------
insert into public.products_stock (product_id, location_code, qty)
select p.id, p.location_code, p.stock_qty
from public.products p
where p.location_code is not null and p.stock_qty > 0
on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();

do $$
declare v_n int;
begin
  select count(*) into v_n from public.products where location_code is null and stock_qty > 0;
  if v_n > 0 then
    raise notice '⚠️ CÓ % SẢN PHẨM CÓ TỒN NHƯNG CHƯA GÁN KHO — chưa migrate được vào products_stock, cần vào Kiểm kê hàng hóa bổ sung tồn đúng kho cho các sản phẩm này thủ công.', v_n;
  end if;
end $$;

-- ---------- 5) NHẬP TỒN THEO KHO (thay cho nút "+Nhập" đơn giản cũ) ----------
create or replace function public.fn_hh_nhap_v2(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_prod record; v_loc text; v_qty int; v_cost bigint; v_before int; v_doc text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_danh_muc') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập tồn hàng hóa'; end if;

  select * into v_prod from public.products where id = (p->>'product_id')::bigint for update;
  if v_prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm không tồn tại'; end if;

  v_loc := nullif(p->>'location_code','');
  if v_loc is null then raise exception 'THIEU_THONG_TIN: chọn kho để nhập tồn'; end if;
  v_qty := coalesce((p->>'qty')::int, 0);
  if v_qty <= 0 then raise exception 'SO_LUONG_SAI: số lượng nhập phải > 0'; end if;
  v_cost := coalesce((p->>'unit_cost')::bigint, v_prod.cost_price);
  v_doc := coalesce(nullif(p->>'doc',''), public.fn_next_code('PNHH'));

  select coalesce(qty,0) into v_before from public.products_stock where product_id = v_prod.id and location_code = v_loc;
  v_before := coalesce(v_before, 0);

  insert into public.products_stock (product_id, location_code, qty)
  values (v_prod.id, v_loc, v_before + v_qty)
  on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();

  update public.products set cost_price = v_cost, updated_at = now() where id = v_prod.id;

  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    unit_price, ref_code, location_code, note, created_by, created_by_name)
  values (v_prod.id, 'Nhập', v_qty, v_before, v_before + v_qty, v_cost, v_doc, v_loc,
    coalesce(p->>'note',''), me.uid, me.name);
end $$;

-- ---------- 6) ĐIỀU CHUYỂN — BƯỚC 1: TẠO PHIẾU (trừ ngay kho đi) ----------
create or replace function public.fn_hh_dieu_chuyen_tao(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_from text; v_to text; v_qty int; v_prod record; v_ton int; v_code text; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dieu_chuyen') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền điều chuyển'; end if;

  v_from := nullif(p->>'from_location',''); v_to := nullif(p->>'to_location','');
  if v_from is null or v_to is null then raise exception 'THIEU_THONG_TIN: chọn kho đi và kho đến'; end if;
  if v_from = v_to then raise exception 'KHO_TRUNG: kho đi và kho đến không được trùng'; end if;

  select * into v_prod from public.products where id = (p->>'product_id')::bigint for update;
  if v_prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm không tồn tại'; end if;
  v_qty := coalesce((p->>'qty')::int, 0);
  if v_qty <= 0 then raise exception 'SO_LUONG_SAI: số lượng chuyển phải > 0'; end if;

  select coalesce(qty,0) into v_ton from public.products_stock where product_id = v_prod.id and location_code = v_from;
  v_ton := coalesce(v_ton, 0);
  if v_ton < v_qty then
    raise exception 'KHONG_DU_TON: % chỉ còn % tại kho đi, không đủ % để chuyển', v_prod.name, v_ton, v_qty;
  end if;

  v_code := public.fn_next_code('DCHH');
  insert into public.product_transfers (code, from_location, to_location, product_id, qty, note, requested_by, requested_by_name)
  values (v_code, v_from, v_to, v_prod.id, v_qty, coalesce(p->>'note',''), me.uid, me.name)
  returning id into v_id;

  update public.products_stock set qty = v_ton - v_qty, updated_at = now()
  where product_id = v_prod.id and location_code = v_from;

  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    ref_code, location_code, note, created_by, created_by_name)
  values (v_prod.id, 'Điều chuyển đi', -v_qty, v_ton, v_ton - v_qty, v_code, v_from,
    concat('Chuyển tới ', v_to), me.uid, me.name);

  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ---------- 7) ĐIỀU CHUYỂN — BƯỚC 2: XÁC NHẬN NHẬN (cộng kho đến) ----------
create or replace function public.fn_hh_dieu_chuyen_nhan(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_ton int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dieu_chuyen') then raise exception 'KHONG_CO_QUYEN'; end if;

  select * into t from public.product_transfers where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY: phiếu không tồn tại'; end if;
  if t.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái đang chuyển'; end if;

  select coalesce(qty,0) into v_ton from public.products_stock where product_id = t.product_id and location_code = t.to_location;
  v_ton := coalesce(v_ton, 0);

  insert into public.products_stock (product_id, location_code, qty)
  values (t.product_id, t.to_location, v_ton + t.qty)
  on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();

  update public.product_transfers set status = 'Đã nhận', received_by = me.uid, received_by_name = me.name, received_at = now()
  where id = p_id;

  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    ref_code, location_code, note, created_by, created_by_name)
  values (t.product_id, 'Điều chuyển đến', t.qty, v_ton, v_ton + t.qty, t.code, t.to_location,
    concat('Nhận từ ', t.from_location), me.uid, me.name);
end $$;

-- ---------- 8) ĐIỀU CHUYỂN — HỦY PHIẾU (chỉ khi đang chuyển, hoàn lại kho đi) ----------
create or replace function public.fn_hh_dieu_chuyen_huy(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_ton int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dieu_chuyen') then raise exception 'KHONG_CO_QUYEN'; end if;

  select * into t from public.product_transfers where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY: phiếu không tồn tại'; end if;
  if t.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI: chỉ hủy được phiếu đang chuyển (chưa nhận)'; end if;

  select coalesce(qty,0) into v_ton from public.products_stock where product_id = t.product_id and location_code = t.from_location;
  v_ton := coalesce(v_ton, 0);

  update public.products_stock set qty = v_ton + t.qty, updated_at = now()
  where product_id = t.product_id and location_code = t.from_location;

  update public.product_transfers set status = 'Đã hủy',
    note = concat(note, ' · [ĐÃ HỦY bởi ', me.name, ': ', coalesce(p_ly_do,''), ']')
  where id = p_id;

  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    ref_code, location_code, note, created_by, created_by_name)
  values (t.product_id, 'Điều chỉnh', t.qty, v_ton, v_ton + t.qty, t.code, t.from_location,
    concat('Hoàn tồn do hủy phiếu điều chuyển: ', coalesce(p_ly_do,'')), me.uid, me.name);
end $$;

-- ---------- 9) KIỂM KÊ HÀNG HÓA THEO KHO ----------
create or replace function public.fn_hh_kiem_ke(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_loc text; ln jsonb; v_prod_id bigint; v_dem int; v_ton int; v_lech int; v_so_dong int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('kiem_ke') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền kiểm kê'; end if;

  v_loc := nullif(p->>'location_code','');
  if v_loc is null then raise exception 'THIEU_THONG_TIN: chọn kho để kiểm kê'; end if;

  for ln in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_prod_id := (ln->>'product_id')::bigint;
    v_dem := coalesce((ln->>'dem_thuc_te')::int, 0);
    select coalesce(qty,0) into v_ton from public.products_stock where product_id = v_prod_id and location_code = v_loc;
    v_ton := coalesce(v_ton, 0);
    v_lech := v_dem - v_ton;
    if v_lech = 0 then continue; end if;

    insert into public.products_stock (product_id, location_code, qty)
    values (v_prod_id, v_loc, v_dem)
    on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();

    insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
      location_code, note, created_by, created_by_name)
    values (v_prod_id, 'Kiểm kê', v_lech, v_ton, v_dem, v_loc,
      coalesce(p->>'note',''), me.uid, me.name);
    v_so_dong := v_so_dong + 1;
  end loop;

  return jsonb_build_object('so_dong_lech', v_so_dong);
end $$;
