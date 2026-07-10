-- ============================================================
-- Migration 002: Ham nghiep vu (RPC) - moi thay doi ton kho
-- deu di qua cac ham nay, co kiem tra quyen + khoa hang (lock)
-- ============================================================

-- Helper: lay role & ten cua nguoi goi
create or replace function public.fn_me()
returns table (uid uuid, role text, name text)
language sql security definer set search_path = public stable as $$
  select id, role, name from public.profiles where id = auth.uid();
$$;

-- Helper: sinh ma phieu
create or replace function public.fn_gen_code(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || to_char(now(),'YYMM') || '-' || lpad(floor(random()*100000)::text, 5, '0');
$$;

-- Helper noi bo: cap nhat ton + ghi lich su (khong expose ra ngoai)
create or replace function public._apply_stock_change(
  p_vehicle text, p_loc text, p_delta int, p_type text,
  p_doc text, p_note text, p_uid uuid, p_uname text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int;
begin
  insert into public.inventory (vehicle_id, location_code, quantity)
  values (p_vehicle, p_loc, 0)
  on conflict (vehicle_id, location_code) do nothing;

  select quantity into v_before from public.inventory
  where vehicle_id = p_vehicle and location_code = p_loc for update;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'TON_KHONG_DU: tồn hiện tại % xe, không thể thay đổi %', v_before, p_delta;
  end if;

  update public.inventory set quantity = v_after, updated_at = now()
  where vehicle_id = p_vehicle and location_code = p_loc;

  insert into public.inventory_txns (txn_type, vehicle_id, from_location, to_location, qty, stock_before, stock_after, doc_code, note, created_by, created_by_name)
  values (p_type, p_vehicle, case when p_delta < 0 then p_loc end, case when p_delta > 0 then p_loc end, p_delta, v_before, v_after, p_doc, p_note, p_uid, p_uname);
end; $$;

-- ============ NHAP HANG (ADMIN, CEO) ============
create or replace function public.fn_nhap_hang(
  p_vehicle text, p_loc text, p_qty int,
  p_supplier text default '', p_doc text default '', p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_doc text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được nhập hàng'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'SO_LUONG_SAI: số lượng nhập phải > 0'; end if;
  v_doc := coalesce(nullif(p_doc,''), public.fn_gen_code('PN'));
  perform public._apply_stock_change(p_vehicle, p_loc, p_qty, 'Nhập hàng', v_doc,
    trim(coalesce('NCC: '||nullif(p_supplier,'')||'. ','') || coalesce(p_note,'')), me.uid, me.name);
  return v_doc;
end; $$;

-- ============ BAN HANG (moi vai tro) ============
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce((p->>'quantity')::int,0) <= 0 then raise exception 'SO_LUONG_SAI: số lượng bán phải > 0'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  v_code := public.fn_gen_code('BH');

  -- Tru ton truoc (se raise TON_KHONG_DU neu ban vuot ton)
  perform public._apply_stock_change(p->>'vehicle_id', p->>'location_code', -((p->>'quantity')::int),
    'Bán hàng', v_code, 'KH '||(p->>'customer_name'), me.uid, me.name);

  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, payment_method, seller_id, seller_name, document_status, note)
  values (v_code, p->>'location_code', p->>'vehicle_id', (p->>'quantity')::int, coalesce(p->>'frame_number',''),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), coalesce((p->>'sale_price')::bigint, v_list, 0),
    coalesce(p->>'payment_method','Chuyển khoản'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''));
  return v_code;
end; $$;

-- Cap nhat trang thai ho so / bao hanh / app (MANAGER, ADMIN, CEO)
create or replace function public.fn_cap_nhat_don(p_id bigint, p_doc text, p_warranty text, p_app text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  update public.sales_orders set
    document_status = coalesce(p_doc, document_status),
    warranty_status = coalesce(p_warranty, warranty_status),
    vinfast_app_status = coalesce(p_app, vinfast_app_status)
  where id = p_id;
end; $$;

-- ============ DIEU CHUYEN 2 BUOC ============
create or replace function public.fn_tao_dieu_chuyen(
  p_vehicle text, p_from text, p_to text, p_qty int, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_stock int;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if p_from = p_to then raise exception 'KHO_TRUNG: kho đi và kho đến không được trùng'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'SO_LUONG_SAI'; end if;
  select coalesce(quantity,0) into v_stock from public.inventory where vehicle_id = p_vehicle and location_code = p_from;
  if coalesce(v_stock,0) < p_qty then raise exception 'TON_KHONG_DU: kho đi chỉ còn % xe', coalesce(v_stock,0); end if;
  v_code := public.fn_gen_code('DCH');
  insert into public.transfer_orders (code, from_location, to_location, vehicle_id, quantity, requested_by, requested_by_name, note)
  values (v_code, p_from, p_to, p_vehicle, p_qty, me.uid, me.name, coalesce(p_note,''));
  return v_code;
end; $$;

create or replace function public.fn_xac_nhan_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ xác nhận nhận xe'; end if;
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái Đang chuyển'; end if;
  -- Tru kho di + cong kho den trong cung transaction
  perform public._apply_stock_change(tr.vehicle_id, tr.from_location, -tr.quantity, 'Điều chuyển', tr.code, 'Chuyển đến '||tr.to_location, me.uid, me.name);
  perform public._apply_stock_change(tr.vehicle_id, tr.to_location, tr.quantity, 'Điều chuyển', tr.code, 'Nhận từ '||tr.from_location, me.uid, me.name);
  update public.transfer_orders set status='Đã nhận', confirmed_by=me.uid, confirmed_by_name=me.name, confirmed_at=now() where id = p_id;
end; $$;

create or replace function public.fn_huy_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record;
begin
  select * into me from public.fn_me();
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI'; end if;
  if not (me.role in ('MANAGER','ADMIN','CEO') or me.uid = tr.requested_by) then raise exception 'KHONG_CO_QUYEN'; end if;
  update public.transfer_orders set status='Đã hủy', confirmed_by=me.uid, confirmed_by_name=me.name, confirmed_at=now() where id = p_id;
end; $$;

-- ============ DIEU CHINH TON (de xuat -> duyet) ============
create or replace function public.fn_de_xuat_dieu_chinh(
  p_vehicle text, p_loc text, p_actual int, p_reason text, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_sys int; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: Sales không được đề xuất điều chỉnh tồn'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'THIEU_LY_DO: điều chỉnh tồn bắt buộc có lý do'; end if;
  select coalesce(quantity,0) into v_sys from public.inventory where vehicle_id = p_vehicle and location_code = p_loc;
  v_sys := coalesce(v_sys,0);
  if p_actual = v_sys then raise exception 'KHONG_CHENH_LECH: tồn thực tế bằng tồn hệ thống'; end if;
  v_code := public.fn_gen_code('DC');
  insert into public.stock_adjustments (code, location_code, vehicle_id, system_qty, actual_qty, diff_qty, reason, requested_by, requested_by_name, note)
  values (v_code, p_loc, p_vehicle, v_sys, p_actual, p_actual - v_sys, p_reason, me.uid, me.name, coalesce(p_note,''));
  return v_code;
end; $$;

create or replace function public.fn_duyet_dieu_chinh(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; ad record; v_sys int; v_delta int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được duyệt điều chỉnh'; end if;
  select * into ad from public.stock_adjustments where id = p_id for update;
  if ad.status <> 'Chờ duyệt' then raise exception 'TRANG_THAI_SAI'; end if;
  if p_approve then
    select coalesce(quantity,0) into v_sys from public.inventory where vehicle_id = ad.vehicle_id and location_code = ad.location_code;
    v_delta := ad.actual_qty - coalesce(v_sys,0);
    if v_delta <> 0 then
      perform public._apply_stock_change(ad.vehicle_id, ad.location_code, v_delta, 'Điều chỉnh', ad.code, ad.reason||coalesce('. '||nullif(ad.note,''),''), me.uid, me.name);
    end if;
    update public.stock_adjustments set status='Đã duyệt', approved_by=me.uid, approved_by_name=me.name, approved_at=now() where id = p_id;
  else
    update public.stock_adjustments set status='Từ chối', approved_by=me.uid, approved_by_name=me.name, approved_at=now() where id = p_id;
  end if;
end; $$;

-- ============ QUAN LY NGUOI DUNG (CEO) ============
create or replace function public.fn_set_role(p_user uuid, p_role text, p_region text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ CEO được phân quyền'; end if;
  update public.profiles set role = p_role, region = p_region, updated_at = now() where id = p_user;
end; $$;

-- ============ DANH MUC XE (ADMIN, CEO) ============
create or replace function public.fn_them_xe(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  v_id := upper(replace(trim(p->>'brand')||'_'||trim(p->>'name')||'_'||trim(p->>'color'), ' ', '_'));
  insert into public.vehicles (id, mfr_code, brand, name, color, list_price, min_stock)
  values (v_id, coalesce(p->>'mfr_code',''), p->>'brand', p->>'name', p->>'color',
          coalesce((p->>'list_price')::bigint,0), coalesce((p->>'min_stock')::int,2));
  return v_id;
end; $$;
