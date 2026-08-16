-- ============================================================
-- Migration 081: Module "Đặt hàng nhập" (đơn đặt trước NCC)
-- Quy tắc nghiệp vụ đã chốt với anh Kỳ:
--  - Chỉ là đơn đặt trước, KHÔNG phát sinh công nợ (công nợ phải trả
--    NCC chỉ tính khi có "Đơn nhập" thật qua module Nhập hàng).
--  - Quản lý theo Model xe + màu + SỐ LƯỢNG (chưa có số khung cụ thể).
--  - 3 trạng thái: Chưa nhập / Nhập một phần / Hoàn thành.
--    (+ 1 trạng thái phụ "Đã hủy" khi hủy đơn — chỉ hiện ở tab
--    "Tất cả đơn đặt hàng", không tính vào 3 tab lọc theo yêu cầu).
--  - Sửa: chỉ được sửa SL các dòng CHƯA nhận đủ, không cho sửa xuống
--    dưới SL đã nhận. Hủy: chỉ khi trạng thái = 'Chưa nhập'.
--  - Nút "Nhập hàng" trong Đơn đặt hàng chuyển sang màn Nhập hàng,
--    prefill dữ liệu. fn_nhap_hang_v2 nhận thêm po_id để tự cập nhật
--    SL đã nhận + trạng thái đơn đặt hàng.
-- Chạy sau 080.
-- ============================================================

create table if not exists public.purchase_orders (
  id bigserial primary key,
  code text unique not null,
  supplier text default '',
  location_code text not null references public.locations(code),
  ngay_du_kien date,
  note text default '',
  status text not null default 'Chưa nhập'
    check (status in ('Chưa nhập','Nhập một phần','Hoàn thành','Đã hủy')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id bigserial primary key,
  po_id bigint not null references public.purchase_orders(id) on delete cascade,
  vehicle_id text not null references public.vehicles(id),
  qty_ordered int not null check (qty_ordered > 0),
  qty_received int not null default 0 check (qty_received >= 0),
  note text default ''
);
create index if not exists po_lines_po_idx on public.purchase_order_lines (po_id);
create index if not exists po_lines_vehicle_idx on public.purchase_order_lines (vehicle_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
drop policy if exists "read_po" on public.purchase_orders;
create policy "read_po" on public.purchase_orders for select to authenticated using (true);
drop policy if exists "read_po_lines" on public.purchase_order_lines;
create policy "read_po_lines" on public.purchase_order_lines for select to authenticated using (true);
-- Ghi chỉ qua RPC (security definer) nên không cần policy insert/update trực tiếp cho client.

-- ---------- 1) TẠO ĐƠN ĐẶT HÀNG ----------
create or replace function public.fn_tao_don_dat_hang(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text; ln jsonb;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo đơn đặt hàng'; end if;
  if coalesce(p->>'location_code','') = '' then raise exception 'THIEU_THONG_TIN: chọn chi nhánh'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then raise exception 'THIEU_DONG: chưa có dòng sản phẩm nào'; end if;

  v_code := public.fn_next_code('OSN');
  insert into public.purchase_orders (code, supplier, location_code, ngay_du_kien, note, created_by, created_by_name)
  values (v_code, coalesce(p->>'supplier',''), p->>'location_code', nullif(p->>'ngay_du_kien','')::date,
    coalesce(p->>'note',''), me.uid, me.name)
  returning id into v_id;

  for ln in select jsonb_array_elements(p->'lines') loop
    if coalesce((ln->>'qty')::int, 0) <= 0 then continue; end if;
    insert into public.purchase_order_lines (po_id, vehicle_id, qty_ordered, note)
    values (v_id, ln->>'vehicle_id', (ln->>'qty')::int, coalesce(ln->>'note',''));
  end loop;

  if not exists (select 1 from public.purchase_order_lines where po_id = v_id) then
    raise exception 'THIEU_DONG: không có dòng sản phẩm hợp lệ nào';
  end if;

  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ---------- 2) SỬA ĐƠN ĐẶT HÀNG (chỉ sửa SL dòng chưa nhận đủ) ----------
create or replace function public.fn_sua_don_dat_hang(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; po record; ln jsonb; v_line record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN'; end if;

  select * into po from public.purchase_orders where id = (p->>'id')::bigint for update;
  if po is null then raise exception 'KHONG_TIM_THAY'; end if;
  if po.status = 'Hoàn thành' then raise exception 'DA_HOAN_THANH: đơn đã hoàn thành, không thể sửa'; end if;
  if po.status = 'Đã hủy' then raise exception 'DA_HUY: đơn đã hủy, không thể sửa'; end if;

  update public.purchase_orders set
    supplier = coalesce(p->>'supplier', supplier),
    ngay_du_kien = coalesce(nullif(p->>'ngay_du_kien','')::date, ngay_du_kien),
    note = coalesce(p->>'note', note),
    updated_at = now()
  where id = po.id;

  for ln in select jsonb_array_elements(p->'lines') loop
    select * into v_line from public.purchase_order_lines
      where id = (ln->>'id')::bigint and po_id = po.id;
    if v_line is null then continue; end if;
    if coalesce((ln->>'qty_ordered')::int, 0) < v_line.qty_received then
      raise exception 'SL_NHO_HON_DA_NHAN: SL đặt dòng % không được nhỏ hơn SL đã nhận (%).', v_line.vehicle_id, v_line.qty_received;
    end if;
    update public.purchase_order_lines set qty_ordered = (ln->>'qty_ordered')::int, note = coalesce(ln->>'note', note)
    where id = v_line.id;
  end loop;

  return jsonb_build_object('id', po.id);
end $$;

-- ---------- 3) HỦY ĐƠN ĐẶT HÀNG (chỉ khi 'Chưa nhập') ----------
create or replace function public.fn_huy_don_dat_hang(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; po record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into po from public.purchase_orders where id = p_id for update;
  if po is null then raise exception 'KHONG_TIM_THAY'; end if;
  if po.status <> 'Chưa nhập' then
    raise exception 'KHONG_THE_HUY: chỉ hủy được đơn ở trạng thái Chưa nhập (đơn này đã % hàng)',
      case po.status when 'Nhập một phần' then 'nhập một phần' when 'Hoàn thành' then 'nhập xong' else 'hủy' end;
  end if;
  update public.purchase_orders set status = 'Đã hủy', updated_at = now() where id = p_id;
end $$;

-- ---------- 4) PATCH fn_nhap_hang_v2: liên kết với đơn đặt hàng ----------
create or replace function public.fn_nhap_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_doc text; ln jsonb; f text; v_loc text;
  v_before int; v_n int := 0; v_xe int := 0; v_von bigint := 0;
  v_frames text[]; v_cost bigint; v_nv_id uuid; v_nv_name text;
  v_po_id bigint; v_line record; v_recv int; v_all_done boolean; v_any_recv boolean;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập hàng'; end if;

  v_nv_id := nullif(p->>'nguoi_nhap_id','')::uuid;
  if v_nv_id is not null and exists (select 1 from public.profiles where id = v_nv_id) then
    select name into v_nv_name from public.profiles where id = v_nv_id;
  else
    v_nv_id := me.uid; v_nv_name := me.name;
  end if;

  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'THIEU_DONG: chưa có dòng hàng nào';
  end if;
  v_loc := p->>'location_code';
  if coalesce(v_loc,'') = '' then raise exception 'THIEU_THONG_TIN: chọn kho nhập'; end if;

  v_po_id := nullif(p->>'po_id','')::bigint;
  if v_po_id is not null and not exists (select 1 from public.purchase_orders where id = v_po_id) then
    v_po_id := null;
  end if;

  v_doc := coalesce(nullif(p->>'doc',''), public.fn_next_code('PN'));

  for ln in select jsonb_array_elements(p->'lines') loop
    if coalesce(ln->>'vehicle_id','') = '' then continue; end if;

    select array_agg(x) into v_frames
    from jsonb_array_elements_text(coalesce(ln->'frames','[]'::jsonb)) x;
    if coalesce(array_length(v_frames,1),0) = 0 then
      raise exception 'THIEU_SO_KHUNG: dòng % chưa có số khung nào', ln->>'vehicle_id';
    end if;

    v_cost := coalesce((ln->>'cost_price')::bigint, 0);
    v_before := public._count_at(ln->>'vehicle_id', v_loc);

    foreach f in array v_frames loop
      f := upper(btrim(f));
      if f = '' then continue; end if;
      if exists (select 1 from public.vehicle_units where frame_number = f) then
        raise exception 'TRUNG_SO_KHUNG: số khung % đã có trên hệ thống', f;
      end if;
      insert into public.vehicle_units (frame_number, vehicle_id, location_code, status,
        cost_price, imported_at, import_doc, note)
      values (f, ln->>'vehicle_id', v_loc, 'TON_KHO', v_cost, now(), v_doc,
        coalesce(ln->>'note',''));
      v_n := v_n + 1;
      v_von := v_von + v_cost;
    end loop;

    if v_cost > 0 then
      update public.vehicles set default_cost = v_cost where id = ln->>'vehicle_id';
    end if;

    -- Cap nhat SL da nhan cho dong don dat hang tuong ung (neu co lien ket)
    if v_po_id is not null then
      update public.purchase_order_lines
      set qty_received = qty_received + array_length(v_frames,1)
      where po_id = v_po_id and vehicle_id = ln->>'vehicle_id';
    end if;

    perform public._log_txn('Nhập hàng', ln->>'vehicle_id', null, v_loc,
      array_length(v_frames,1), v_before, v_before + array_length(v_frames,1), v_doc,
      trim(concat(
        case when coalesce(p->>'supplier','') <> '' then concat('NCC: ', p->>'supplier', ' · ') else '' end,
        'SK: ', array_to_string(v_frames, ', '),
        case when v_cost > 0 then concat(' · giá vốn ', v_cost, 'đ/xe') else '' end,
        case when coalesce(p->>'note','') <> '' then concat(' · ', p->>'note') else '' end)),
      v_nv_id, v_nv_name);
    v_xe := v_xe + 1;
  end loop;

  if v_n = 0 then raise exception 'THIEU_SO_KHUNG: không có số khung hợp lệ nào'; end if;

  -- Cap nhat trang thai don dat hang lien ket
  if v_po_id is not null then
    v_all_done := true; v_any_recv := false;
    for v_line in select * from public.purchase_order_lines where po_id = v_po_id loop
      if v_line.qty_received > 0 then v_any_recv := true; end if;
      if v_line.qty_received < v_line.qty_ordered then v_all_done := false; end if;
    end loop;
    update public.purchase_orders set
      status = case when v_all_done then 'Hoàn thành' when v_any_recv then 'Nhập một phần' else status end,
      updated_at = now()
    where id = v_po_id;
  end if;

  perform public._notify_discord(jsonb_build_object('content',
    concat('📦 **Nhập hàng ', v_doc, '** · ', v_n, ' xe (', v_xe, ' mã) · kho ', v_loc,
      case when coalesce(p->>'supplier','') <> '' then concat(' · NCC ', p->>'supplier') else '' end,
      case when v_po_id is not null then concat(' · từ đơn đặt #', v_po_id) else '' end,
      case when v_von > 0 then concat(E'\n💰 Tổng giá vốn: ', to_char(v_von, 'FM999,999,999,999'), 'đ') else '' end,
      E'\n👤 ', v_nv_name)));

  return jsonb_build_object('doc', v_doc, 'so_ma', v_n, 'so_xe', v_xe, 'von', v_von, 'po_id', v_po_id);
end $$;
