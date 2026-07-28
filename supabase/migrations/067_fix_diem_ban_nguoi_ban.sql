-- ============================================================
-- Migration 067 — FIX ĐIỂM BÁN & NGƯỜI BÁN trong tạo/sửa đơn
--  Bug 1: fn_ban_hang_v2 lưu location_code = u.location_code (kho xe)
--         thay vì p->>'location_code' (điểm bán từ form).
--  Bug 2: fn_ban_hang_v2 lưu seller_id = me.uid, seller_name = me.name
--         thay vì dùng p->>'seller_id' / p->>'seller_name' từ form.
--  Bug 3: fn_sua_don_ban không cập nhật seller khi sửa đơn.
-- Chạy SAU 066. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ban_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_batch text; v_code text; v_codes text[] := '{}';
  f jsonb; it jsonb; pm jsonb; u record; v_list bigint; v_cust bigint;
  v_before int; v_gia bigint; v_ck bigint; v_dm numeric; v_dt text;
  v_first text; v_coc bigint := 0; d record; n int := 0; v_def bigint;
  v_sale_loc text; v_seller_id uuid; v_seller_name text;
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

  -- Diem ban: bat buoc chon tu form; seller: tu form hoac fallback ve nguoi dang login
  v_sale_loc := nullif(p->>'location_code','');
  if v_sale_loc is null then raise exception 'THIEU_DIEM_BAN: phải chọn điểm bán (cửa hàng)'; end if;
  v_seller_id   := coalesce(nullif(p->>'seller_id','')::uuid, me.uid);
  v_seller_name := coalesce(nullif(p->>'seller_name',''), me.name);

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

    -- FIX: dung v_sale_loc (diem ban) thay vi u.location_code (kho xe)
    --      dung v_seller_id/v_seller_name thay vi me.uid/me.name
    insert into public.sales_orders (code, sale_date, location_code, vehicle_id, quantity, frame_number,
      customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
      list_price, sale_price, vehicle_discount_type, vehicle_discount_value,
      paid_amount, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
    values (v_code, coalesce(nullif(p->>'sale_date','')::date, current_date),
      v_sale_loc, u.vehicle_id, 1, u.frame_number,
      p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
      coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
      coalesce(v_list,0), greatest(v_gia - v_ck, 0), v_dt, v_dm,
      0, 'Chuyển khoản', v_seller_id, v_seller_name,
      coalesce(p->>'document_status','Đang làm đăng ký'),
      trim(both ' | ' from concat(coalesce(p->>'note',''),
        case when n > 1 or jsonb_array_length(p->'frames') > 1 then concat(' | Lô ', v_batch) else '' end)),
      coalesce(p->'extra','{}'::jsonb) || jsonb_build_object('batch_code', v_batch), v_cust);
  end loop;

  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'') = '' then continue; end if;
    v_gia := greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(it->>'discount_type',''), 'amount');
    v_dm  := coalesce((it->>'discount_value')::numeric, 0);
    v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                  else least(greatest(v_dm,0)::bigint, v_gia) end;
    insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount,
      payment_method, discount_type, discount_value)
    values (v_first, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
      greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
      greatest(v_gia - v_ck, 0), 'Chuyển khoản', v_dt, v_dm);
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

  for pm in select jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    if coalesce((pm->>'amount')::bigint, 0) <= 0 then continue; end if;
    insert into public.sale_payments (sale_code, method, amount, note, created_by, created_by_name)
    values (v_first, coalesce(nullif(pm->>'method',''),'Tiền mặt'), (pm->>'amount')::bigint,
      coalesce(pm->>'note',''), me.uid, me.name);
    perform public._auto_thu(v_sale_loc,
      pm->>'method', (pm->>'amount')::bigint, 'Bán xe', p->>'customer_name',
      concat('Đơn ', v_first), concat(v_first, '-', pm->>'method', '-', pm->>'amount'), me.uid, me.name);
  end loop;

  update public.sales_orders set
    paid_amount = v_coc + coalesce((select sum(amount) from public.sale_payments where sale_code = v_first), 0),
    payment_method = coalesce((select method from public.sale_payments where sale_code = v_first order by amount desc limit 1), 'Chuyển khoản'),
    note = trim(both ' | ' from concat(note, case when v_coc > 0 then concat(' | Đã nhận cọc trước: ', v_coc, 'đ') else '' end))
  where code = v_first;

  return jsonb_build_object('batch', v_batch, 'codes', to_jsonb(v_codes), 'count', n, 'first', v_first);
end $$;

-- ===================== FIX fn_sua_don_ban: cap nhat seller =====================
-- Doc full fn_sua_don_ban roi them seller update
create or replace function public.fn_sua_don_ban(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; it jsonb; pm jsonb; f jsonb;
  v_gia bigint; v_ck bigint; v_dm numeric; v_dt text; v_before int;
  v_cust bigint; v_seller_id uuid; v_seller_name text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'DA_XAC_NHAN: đơn đã xuất HĐ không thể sửa'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn đã đóng'; end if;

  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone',
    p->>'customer_cccd', p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);

  -- Seller: tu form hoac giu nguyen
  v_seller_id   := coalesce(nullif(p->>'seller_id','')::uuid, o.seller_id, me.uid);
  v_seller_name := coalesce(nullif(p->>'seller_name',''), o.seller_name, me.name);

  -- Hoan xe cu
  for u in select * from public.vehicle_units where sale_code = o.code and status = 'DA_BAN' for update loop
    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='TON_KHO', sale_code=null, updated_at=now() where frame_number = u.frame_number;
    perform public._log_txn('Hủy đơn bán', u.vehicle_id, null, u.location_code, 1, v_before, v_before+1,
      o.code, concat('Sửa đơn: hoàn xe ', u.frame_number), me.uid, me.name);
  end loop;

  -- Xoa ban kem cu
  delete from public.sale_items where sale_code = o.code;

  -- Xe moi
  for f in select jsonb_array_elements(p->'frames') loop
    select * into u from public.vehicle_units where frame_number = f->>'frame_number' for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: %', f->>'frame_number'; end if;
    if u.status not in ('TON_KHO','GIU_CHO') then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang %', u.frame_number, u.status;
    end if;
    v_gia := coalesce((f->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(f->>'discount_type',''),'amount');
    v_dm  := coalesce((f->>'discount_value')::numeric,0);
    v_ck  := case when v_dt='percent' then round(v_gia*least(greatest(v_dm,0),100)/100.0)
                  else least(greatest(v_dm,0)::bigint,v_gia) end;
    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='DA_BAN', sale_code=o.code, updated_at=now() where frame_number=u.frame_number;
    perform public._log_txn('Bán hàng', u.vehicle_id, u.location_code, null, -1, v_before, v_before-1,
      o.code, concat('Sửa đơn: bán xe ', u.frame_number), me.uid, me.name);
  end loop;

  -- Ban kem moi
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

  -- Lay xe dau tien de lay unit_price chinh
  select (f->>'unit_price')::bigint into v_gia from jsonb_array_elements(p->'frames') f limit 1;
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
          then round((coalesce(v_gia,sale_price) + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code=o.code),0))
               * least(greatest(v_dm,0),100)/100.0)
          else least(v_dm::bigint, coalesce(v_gia,sale_price)) end
      else 0 end,
    frame_number  = (select string_agg(f2->>'frame_number',', ' order by f2->>'frame_number')
                     from jsonb_array_elements(p->'frames') f2),
    vehicle_id    = (select vehicle_id from public.vehicle_units where frame_number=(p->'frames'->0->>'frame_number') limit 1),
    quantity      = jsonb_array_length(p->'frames'),
    updated_at    = now()
  where id = o.id;

  return jsonb_build_object('code', o.code, 'id', o.id);
end $$;

do $do$
begin
  raise notice 'XONG 067: fn_ban_hang_v2 dung diem ban va nguoi ban tu form; fn_sua_don_ban cap nhat seller';
end $do$;
