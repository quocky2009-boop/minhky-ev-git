-- =====================================================================
-- 133_wizard_ghi_don_that.sql
-- Giai doan 2 cua "Tao don ban 4 buoc + Bang gia" (xem 132): cho phep
-- Wizard ghi don ban THAT vao DB, dung ket qua tu fn_tinh_bang_gia.
-- CHI THEM MOI / MO RONG THAM SO (additive, khong doi hanh vi don cu):
--   (1) fn_ban_hang_v2: moi frame nhan them 3 khoa jsonb TUY CHON
--       promo_amount / invoice_total / price_snapshot -> ghi vao 3 cot
--       cung ten da them o migration 132 (sales_orders). Form "Ban hang"
--       cu KHONG gui 3 khoa nay nen hanh vi/du lieu cua don cu KHONG doi
--       (promo_amount mac dinh 0, invoice_total/price_snapshot NULL).
--   (2) fn_gan_khuyen_mai_don_v2: ham MOI (khong dung chung voi ham cu
--       fn_gan_khuyen_mai_don) - nhan mang object {id,amount,kind,
--       value_type,value} thay vi chi bigint[] ID, ghi SNAPSHOT so tien
--       tung chuong trinh KM da ap dung vao sale_order_promotions. Form
--       "Ban hang" cu van goi ham cu (chi gan tag, khong tinh tien) -
--       khong anh huong.
-- =====================================================================

-- (1) fn_ban_hang_v2: them doc f->>'promo_amount', f->>'invoice_total',
-- f->'price_snapshot' tren moi frame va ghi vao sales_orders. Toan bo
-- phan con lai GIU NGUYEN 100% so voi ban dang chay (119/126).
create or replace function public.fn_ban_hang_v2(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      battery_option, promo_amount, invoice_total, price_snapshot)
    values (v_code, coalesce(nullif(p->>'sale_date','')::date, current_date),
      v_sale_loc, u.vehicle_id, 1, u.frame_number,
      p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
      coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
      coalesce(v_list,0), v_gia, v_dt, v_dm,
      v_coc, v_coc, 'Chuyển khoản', v_seller_id, v_seller_name,
      coalesce(p->>'document_status','Đang làm đăng ký'),
      trim(both ' | ' from concat(coalesce(p->>'note',''),
        case when n > 1 or jsonb_array_length(p->'frames') > 1 then concat(' | Lô ', v_batch) else '' end)),
      coalesce(p->'extra','{}'::jsonb) || jsonb_build_object('batch_code', v_batch), v_cust,
      v_battery,
      coalesce((f->>'promo_amount')::bigint, 0), nullif(f->>'invoice_total','')::bigint, f->'price_snapshot');
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
end $function$;

-- (2) fn_gan_khuyen_mai_don_v2: ham MOI, chi dung cho LUC TAO DON MOI tu
-- Wizard (sale_code luc nay chua co dong khuyen mai nao) - ghi snapshot
-- so tien tung KM da ap dung. KHONG dung lam ham "dong bo/sua" nhu ham
-- cu fn_gan_khuyen_mai_don (khong co buoc DELETE cac tag khong con chon,
-- vi khong can thiet cho luong tao moi) - neu sau nay can man hinh SUA
-- khuyen mai cho don tao tu Wizard, phai lam rieng.
create or replace function public.fn_gan_khuyen_mai_don_v2(p_sale_code text, p_promotions jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me record; r jsonb;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_khuyen_mai_don') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền gắn chương trình khuyến mại';
  end if;
  if not exists (select 1 from public.sales_orders where code = p_sale_code) then
    raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại';
  end if;

  for r in select jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb)) loop
    insert into public.sale_order_promotions_log (sale_code, promotion_id, promotion_name, action, by_id, by_name)
    values (p_sale_code, (r->>'id')::bigint, r->>'name', 'THEM', me.uid, me.name);
  end loop;

  insert into public.sale_order_promotions (sale_code, promotion_id, kind, value_type, value, amount_applied, created_by, created_by_name)
  select p_sale_code, (x->>'id')::bigint, x->>'kind', x->>'value_type',
    nullif(x->>'value','')::numeric, coalesce((x->>'amount')::bigint, 0), me.uid, me.name
  from jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb)) x
  on conflict (sale_code, promotion_id) do update set
    kind = excluded.kind, value_type = excluded.value_type, value = excluded.value,
    amount_applied = excluded.amount_applied;
end $function$;
