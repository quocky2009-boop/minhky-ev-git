-- =====================================================================
-- 127_fn_sua_don_ban_battery_option.sql
--
-- MỤC ĐÍCH: fn_sua_don_ban (sửa đơn bán) đến giờ CHƯA từng đọc/lưu
-- battery_option — dù frontend có gửi lên thì cột này trên sales_orders
-- vẫn không bao giờ được cập nhật qua màn "Sửa đơn". Patch này thêm:
--   - Bắt buộc chọn battery_option khi xe (frame đầu tiên của đơn sau
--     khi sửa) thuộc model_pin = 'Xe đổi pin', giống hệt logic đã có
--     sẵn trong fn_ban_hang_v2.
--   - Lưu battery_option mới vào sales_orders nếu có gửi lên; nếu
--     không gửi (giữ nguyên) thì KHÔNG đổi giá trị cũ.
--
-- KHÔNG đổi bất kỳ logic nào khác của hàm ngoài phần trên.
-- CHỮ KÝ HÀM KHÔNG ĐỔI (vẫn p jsonb) -> DROP FUNCTION IF EXISTS chỉ để
-- an toàn, không có rủi ro tạo overload trùng.
-- =====================================================================

drop function if exists public.fn_sua_don_ban(jsonb);

create or replace function public.fn_sua_don_ban(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; it jsonb; pm jsonb; fe jsonb;
  v_gia bigint; v_ck bigint; v_dm numeric; v_dt text; v_before int;
  v_cust bigint; v_seller_id uuid; v_seller_name text;
  v_sp_id bigint; v_cash_code text; v_model_pin text; v_battery text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'DA_XAC_NHAN: đơn đã xuất HĐ không thể sửa'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn đã đóng'; end if;

  -- SUA MOI: bat buoc battery_option khi xe (frame dau tien sau khi sua) la Doi pin
  v_battery := nullif(p->>'battery_option','');
  select model_pin into v_model_pin from public.vehicles
  where id = (select vehicle_id from public.vehicle_units where frame_number = p->'frames'->0->>'frame_number');
  if v_model_pin = 'Xe đổi pin' and v_battery is null and o.battery_option is null then
    raise exception 'THIEU_THONG_TIN: xe Đổi pin bắt buộc chọn Hình thức kinh doanh pin (Kèm pin/Thuê pin)';
  end if;

  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone',
    p->>'customer_cccd', p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);

  v_seller_id   := coalesce(nullif(p->>'seller_id','')::uuid, o.seller_id, me.uid);
  v_seller_name := coalesce(nullif(p->>'seller_name',''), o.seller_name, me.name);

  for u in select * from public.vehicle_units where sale_code = o.code and status = 'DA_BAN' for update loop
    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='TON_KHO', sale_code=null, updated_at=now() where frame_number = u.frame_number;
    perform public._log_txn('Hủy đơn bán', u.vehicle_id, null, u.location_code, 1, v_before, v_before+1,
      o.code, concat('Sửa đơn: hoàn xe ', u.frame_number), me.uid, me.name);
  end loop;

  delete from public.sale_items where sale_code = o.code;

  for fe in select jsonb_array_elements(p->'frames') loop
    select * into u from public.vehicle_units where frame_number = fe->>'frame_number' for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: %', fe->>'frame_number'; end if;
    if u.status not in ('TON_KHO','GIU_CHO') then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang %', u.frame_number, u.status;
    end if;
    v_gia := coalesce((fe->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(fe->>'discount_type',''),'amount');
    v_dm  := coalesce((fe->>'discount_value')::numeric,0);
    v_ck  := case when v_dt='percent' then round(v_gia*least(greatest(v_dm,0),100)/100.0)
                  else least(greatest(v_dm,0)::bigint,v_gia) end;
    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='DA_BAN', sale_code=o.code, updated_at=now() where frame_number=u.frame_number;
    perform public._log_txn('Bán hàng', u.vehicle_id, u.location_code, null, -1, v_before, v_before-1,
      o.code, concat('Sửa đơn: bán xe ', u.frame_number), me.uid, me.name);
  end loop;

  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'')='' then continue; end if;
    v_gia := greatest(coalesce((it->>'qty')::int,1),1)*coalesce((it->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(it->>'discount_type',''),'amount');
    v_dm  := coalesce((it->>'discount_value')::numeric,0);
    v_ck  := case when v_dt='percent' then round(v_gia*least(greatest(v_dm,0),100)/100.0)
                  else least(greatest(v_dm,0)::bigint,v_gia) end;
    insert into public.sale_items(sale_code,item_type,name,qty,unit_price,amount,payment_method,discount_type,discount_value)
    values(o.code,coalesce(nullif(it->>'item_type',''),'PHU_KIEN'),trim(it->>'name'),
      greatest(coalesce((it->>'qty')::int,1),1),coalesce((it->>'unit_price')::bigint,0),
      greatest(v_gia-v_ck,0),'Chuyển khoản',v_dt,v_dm);
  end loop;

  select (fe2->>'unit_price')::bigint into v_gia
  from jsonb_array_elements(p->'frames') fe2 limit 1;

  v_dt := coalesce(nullif(p->>'discount_type',''),'amount');
  v_dm := coalesce((p->>'discount_value')::numeric,0);

  update public.sales_orders set
    sale_date     = coalesce(nullif(p->>'sale_date','')::date, sale_date),
    location_code = coalesce(nullif(p->>'location_code',''), location_code),
    customer_name = coalesce(p->>'customer_name', customer_name),
    customer_phone= coalesce(p->>'customer_phone', customer_phone),
    customer_cccd = coalesce(p->>'customer_cccd', customer_cccd),
    customer_address = coalesce(p->>'customer_address', customer_address),
    customer_type = coalesce(p->>'customer_type', customer_type),
    customer_source = coalesce(p->>'customer_source', customer_source),
    seller_id     = v_seller_id,
    seller_name   = v_seller_name,
    document_status = coalesce(nullif(p->>'document_status',''), document_status),
    note          = case when coalesce(trim(p->>'ly_do'),'') <> ''
                    then trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Sửa: ' || trim(p->>'ly_do'))
                    else note end,
    extra         = coalesce(p->'extra', extra),
    customer_id   = v_cust,
    sale_price    = coalesce(v_gia, sale_price),
    vehicle_discount_type  = coalesce(nullif(p->'frames'->0->>'discount_type',''), vehicle_discount_type),
    vehicle_discount_value = coalesce((p->'frames'->0->>'discount_value')::numeric, vehicle_discount_value),
    discount_type  = v_dt,
    discount_value = v_dm,
    discount_amount = case when v_dm > 0 then
        case when v_dt='percent'
          then round((coalesce(v_gia,sale_price)
               + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code=o.code),0))
               * least(greatest(v_dm,0),100)/100.0)
          else least(v_dm::bigint, coalesce(v_gia,sale_price)) end
      else 0 end,
    frame_number  = (select string_agg(f2->>'frame_number',', ' order by f2->>'frame_number')
                     from jsonb_array_elements(p->'frames') f2),
    vehicle_id    = (select vehicle_id from public.vehicle_units
                     where frame_number=(p->'frames'->0->>'frame_number') limit 1),
    quantity      = jsonb_array_length(p->'frames'),
    battery_option = coalesce(v_battery, battery_option),
    updated_at    = now()
  where id = o.id;

  for pm in select jsonb_array_elements(coalesce(p->'new_payments','[]'::jsonb)) loop
    if coalesce((pm->>'amount')::bigint, 0) <= 0 then continue; end if;

    if pm->>'method' = 'Trả góp' then
      insert into public.sale_payments (sale_code, method, amount, note, status, finance_company,
        created_by, created_by_name)
      values (o.code, 'Trả góp', (pm->>'amount')::bigint, coalesce(pm->>'note',''), 'Chờ giải ngân',
        coalesce(pm->>'tra_gop_ct',''), me.uid, me.name);
    else
      insert into public.sale_payments (sale_code, method, amount, note, status, created_by, created_by_name)
      values (o.code, coalesce(nullif(pm->>'method',''),'Tiền mặt'), (pm->>'amount')::bigint,
        coalesce(pm->>'note',''), 'Đã thu', me.uid, me.name)
      returning id into v_sp_id;

      v_cash_code := public._auto_thu(o.location_code, pm->>'method', (pm->>'amount')::bigint,
        'Bán xe', o.customer_name, concat('Sửa đơn - thu thêm - Đơn ', o.code),
        concat(o.code, '-suathem-', v_sp_id), me.uid, me.name, nullif(pm->>'account_id','')::bigint);

      if v_cash_code is not null then
        update public.sale_payments set
          cash_txn_code = v_cash_code,
          account_id = (select account_id from public.cash_txns where code = v_cash_code)
        where id = v_sp_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object('code', o.code, 'id', o.id);
end $$;

-- =====================================================================
-- XÁC MINH SAU KHI CHẠY (chỉ đọc, không đổi gì)
-- Kỳ vọng: đúng 1 dòng, không overload trùng.
-- =====================================================================
select oid::regprocedure from pg_proc where proname = 'fn_sua_don_ban';
