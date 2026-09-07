-- ============================================================
-- Migration: 
--  A) Thêm cột battery_option (Kèm pin/Thuê pin) áp dụng cho MỌI đơn
--     bán xe "Đổi pin" — bắt buộc chọn ngay lúc TẠO ĐƠN (khác với
--     end_customer_battery_option chỉ áp dụng cho khách lẻ cuối của
--     đơn bán buôn). Patch fn_ban_hang_v2 nhận + validate.
--  B) Thêm cột dms_code (Mã đơn DMS) — chuyển từ chọn lúc TẠO ĐƠN
--     sang chọn lúc XÁC NHẬN HÓA ĐƠN (đúng thực tế: DMS chỉ có ở
--     khâu giao xe). Patch fn_xac_nhan_hoa_don nhận + lưu.
-- Chạy sau 118. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.sales_orders add column if not exists battery_option text
  check (battery_option in ('Kèm pin','Thuê pin'));
alter table public.sales_orders add column if not exists dms_code text default '';

-- ---------- Di chuyen du lieu DMS CU (neu co) tu custom_fields/extra jsonb sang cot moi ----------
-- Truoc day "Ma don DMS" la 1 custom field (entity=sales_order, luu trong
-- extra jsonb) — gio chuyen thanh cot rieng + doi vi tri UI, nen can:
--  1) Copy du lieu cu (neu co) sang dms_code
--  2) Tat (active=false) custom field cu de KHONG con hien trong form tao
--     don nua (form chi render field active=true) — KHONG xoa han field
--     de khong mat cau hinh/lich su.
do $$
declare v_key text;
begin
  select field_key into v_key from public.custom_fields
  where entity = 'sales_order' and label ilike '%DMS%' limit 1;

  if v_key is not null then
    execute format(
      'update public.sales_orders set dms_code = extra->>%L where extra ? %L and coalesce(dms_code,'''')=''''',
      v_key, v_key);
    update public.custom_fields set active = false where field_key = v_key and entity = 'sales_order';
    raise notice 'Da chuyen du lieu DMS cu (field_key=%) sang cot dms_code, va tat custom field cu.', v_key;
  else
    raise notice 'Khong tim thay custom field DMS cu nao can chuyen — bo qua buoc nay.';
  end if;
end $$;

-- ---------- A) fn_ban_hang_v2: nhan + bat buoc battery_option khi xe la Doi pin ----------
create or replace function public.fn_ban_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_batch text; v_code text; v_codes text[] := '{}';
  f jsonb; it jsonb; pm jsonb; u record; v_list bigint; v_cust bigint;
  v_before int; v_gia bigint; v_ck bigint; v_dm numeric; v_dt text;
  v_first text; v_coc bigint := 0; d record; n int := 0; v_def bigint;
  v_sale_loc text; v_seller_id uuid; v_seller_name text;
  v_sp_id bigint; v_cash_code text; v_finance text; v_model_pin text; v_battery text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo đơn bán'; end if;
  if jsonb_array_length(coalesce(p->'frames','[]'::jsonb)) = 0 then
    raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe';
  end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;

  v_sale_loc := nullif(p->>'location_code','');
  if v_sale_loc is null then raise exception 'THIEU_DIEM_BAN: phải chọn điểm bán (cửa hàng)'; end if;
  v_seller_id   := coalesce(nullif(p->>'seller_id','')::uuid, me.uid);
  v_seller_name := coalesce(nullif(p->>'seller_name',''), me.name);

  -- SUA MOI: kiem tra model_pin cua xe DAU TIEN de biet co bat buoc battery_option khong
  v_battery := nullif(p->>'battery_option','');
  select model_pin into v_model_pin from public.vehicles
  where id = (select vehicle_id from public.vehicle_units where frame_number = p->'frames'->0->>'frame_number');
  if v_model_pin = 'Xe đổi pin' and v_battery is null then
    raise exception 'THIEU_THONG_TIN: xe Đổi pin bắt buộc chọn Hình thức kinh doanh pin (Kèm pin/Thuê pin)';
  end if;

  v_batch := public.fn_next_code('LO');
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);

  for f in select jsonb_array_elements(p->'frames') loop
    select * into u from public.vehicle_units where frame_number = f->>'frame_number' for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f->>'frame_number'; end if;

    if u.status = 'GIU_CHO' then
      if not public.fn_coc_cho_phep_ban(u.frame_number, p->>'customer_phone') then
        raise exception 'XE_DANG_GIU: xe % đang giữ cho khách khác', u.frame_number;
      end if;
      for d in select * from public.deposits where frame_number = u.frame_number and status = 'DANG_GIU' loop
        v_coc := v_coc + coalesce(d.amount, 0);
        update public.deposits set status = 'DA_BAN' where id = d.id;
      end loop;
    elsif u.status <> 'TON_KHO' then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', u.frame_number, u.status;
    end if;

    v_gia := coalesce((f->>'unit_price')::bigint, 0);
    v_dt  := coalesce(nullif(f->>'discount_type',''), 'amount');
    v_dm  := coalesce((f->>'discount_value')::numeric, 0);
    v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                  else least(greatest(v_dm,0)::bigint, v_gia) end;

    v_code := public.fn_gen_code('BH');
    v_codes := array_append(v_codes, v_code);
    if v_first is null then v_first := v_code; end if;
    n := n + 1;

    select list_price, default_cost into v_list, v_def from public.vehicles where id = u.vehicle_id;
    if coalesce(u.cost_price,0) = 0 and coalesce(v_def,0) > 0 then
      update public.vehicle_units set cost_price = v_def where frame_number = u.frame_number;
    end if;

    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now()
    where frame_number = u.frame_number;

    perform public._log_txn('Bán hàng', u.vehicle_id, u.location_code, null, -1, v_before, v_before - 1,
      v_code, concat('KH ', p->>'customer_name', ' · SK ', u.frame_number,
        case when v_ck > 0 then concat(' · CK ', v_ck, 'đ') else '' end), me.uid, me.name);

    insert into public.sales_orders (code, sale_date, location_code, vehicle_id, quantity, frame_number,
      customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
      list_price, sale_price, vehicle_discount_type, vehicle_discount_value,
      coc_applied, paid_amount, payment_method, seller_id, seller_name, document_status, note, extra, customer_id,
      battery_option)
    values (v_code, coalesce(nullif(p->>'sale_date','')::date, current_date),
      v_sale_loc, u.vehicle_id, 1, u.frame_number,
      p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
      coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
      coalesce(v_list,0), greatest(v_gia - v_ck, 0), v_dt, v_dm,
      v_coc, v_coc, 'Chuyển khoản', v_seller_id, v_seller_name,
      coalesce(p->>'document_status','Đang làm đăng ký'),
      trim(both ' | ' from concat(coalesce(p->>'note',''),
        case when n > 1 or jsonb_array_length(p->'frames') > 1 then concat(' | Lô ', v_batch) else '' end)),
      coalesce(p->'extra','{}'::jsonb) || jsonb_build_object('batch_code', v_batch), v_cust,
      v_battery);
  end loop;

  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'') = '' then continue; end if;
    v_gia := greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(it->>'discount_type',''), 'amount');
    v_dm  := coalesce((it->>'discount_value')::numeric, 0);
    v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                  else least(greatest(v_dm,0)::bigint, v_gia) end;
    insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount,
      payment_method, discount_type, discount_value, product_id)
    values (v_first, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
      greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
      greatest(v_gia - v_ck, 0), 'Chuyển khoản', v_dt, v_dm,
      nullif(it->>'product_id','')::bigint);
  end loop;

  if coalesce((p->>'discount_value')::numeric, 0) > 0 then
    update public.sales_orders set
      discount_type = coalesce(nullif(p->>'discount_type',''), 'amount'),
      discount_value = (p->>'discount_value')::numeric,
      discount_amount = case when coalesce(nullif(p->>'discount_type',''),'amount') = 'percent'
        then round((sale_price + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = v_first),0))
                   * least(greatest((p->>'discount_value')::numeric,0),100) / 100.0)
        else least((p->>'discount_value')::numeric, sale_price)::bigint end
    where code = v_first;
  end if;

  v_finance := p->'extra'->>'tra_gop_cong_ty';
  for pm in select jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    if coalesce((pm->>'amount')::bigint, 0) <= 0 then continue; end if;

    if pm->>'method' = 'Trả góp' then
      insert into public.sale_payments (sale_code, method, amount, note, status, finance_company,
        created_by, created_by_name)
      values (v_first, 'Trả góp', (pm->>'amount')::bigint, coalesce(pm->>'note',''), 'Chờ giải ngân',
        coalesce(v_finance,''), me.uid, me.name);
    else
      insert into public.sale_payments (sale_code, method, amount, note, status, created_by, created_by_name)
      values (v_first, coalesce(nullif(pm->>'method',''),'Tiền mặt'), (pm->>'amount')::bigint,
        coalesce(pm->>'note',''), 'Đã thu', me.uid, me.name)
      returning id into v_sp_id;

      v_cash_code := public._auto_thu(v_sale_loc,
        pm->>'method', (pm->>'amount')::bigint, 'Bán xe', p->>'customer_name',
        concat('Đơn ', v_first), concat(v_first, '-', pm->>'method', '-', pm->>'amount'), me.uid, me.name,
        nullif(pm->>'account_id','')::bigint);

      if v_cash_code is not null then
        update public.sale_payments set
          cash_txn_code = v_cash_code,
          account_id = (select account_id from public.cash_txns where code = v_cash_code)
        where id = v_sp_id;
      end if;
    end if;
  end loop;

  update public.sales_orders set
    payment_method = coalesce((select method from public.sale_payments where sale_code = v_first and not is_reversed order by amount desc limit 1), 'Chuyển khoản'),
    note = trim(both ' | ' from concat(note, case when v_coc > 0 then concat(' | Đã nhận cọc trước: ', v_coc, 'đ') else '' end))
  where code = v_first;

  return jsonb_build_object('batch', v_batch, 'codes', to_jsonb(v_codes), 'count', n, 'first', v_first);
end $$;

-- ---------- B) fn_xac_nhan_hoa_don: nhan + luu dms_code ----------
create or replace function public.fn_xac_nhan_hoa_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_brand text; v_bh boolean; v_app boolean; v_coc boolean;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xac_nhan_hd') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền xác nhận hóa đơn'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn này đã xác nhận rồi'; end if;
  if coalesce(trim(p->>'invoice_no'),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập số hóa đơn khi xác nhận';
  end if;

  select brand into v_brand from public.vehicles where id = o.vehicle_id;

  if o.customer_type = 'Khách buôn'
     and upper(coalesce(v_brand,'')) like '%VINFAST%'
     and coalesce(o.end_customer_id, 0) = 0 then
    raise exception 'THIEU_KHACH_LE: đơn bán buôn xe VinFast phải bổ sung thông tin khách lẻ cuối (họ tên, SĐT, địa chỉ VNeID, email) trước khi xuất hóa đơn';
  end if;

  v_bh  := coalesce((p->>'warranty_activated')::boolean, false);
  v_app := coalesce((p->>'app_activated')::boolean, false);
  v_coc := coalesce((p->>'coc_giao')::boolean, false);

  if not v_bh then
    raise exception 'CHUA_KICH_HOAT_BAO_HANH: phải kích hoạt bảo hành cho xe trước khi hoàn thành đơn';
  end if;
  if upper(coalesce(v_brand,'')) like '%VINFAST%' and not v_app then
    raise exception 'CHUA_KICH_HOAT_APP: xe VinFast bắt buộc kích hoạt app VF eScooter trước khi hoàn thành đơn';
  end if;
  if not v_coc then
    raise exception 'CHUA_GIAO_COC: phải xác nhận đã bàn giao giấy COC trước khi hoàn thành đơn';
  end if;

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh, app_activated = v_app, coc_giao = v_coc,
    dms_code = coalesce(nullif(trim(p->>'dms_code'),''), dms_code)
  where id = o.id;
end $$;
