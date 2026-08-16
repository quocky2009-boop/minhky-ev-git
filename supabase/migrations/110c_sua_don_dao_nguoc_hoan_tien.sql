-- ============================================================
-- Migration 110c (3/3): Bỏ update tay paid_amount ở fn_sua_don_ban +
-- fn_dao_nguoc_khoan_thu (trigger 110a đã lo tự động). Viết lại
-- fn_hoan_tien_don để hoàn ĐÚNG QUỸ TIỀN GỐC đã vào (không còn mặc
-- định luôn hoàn từ quỹ Tiền mặt bất kể khách trả bằng gì).
-- Chạy sau 110b. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- A) fn_sua_don_ban: bo doan update paid_amount cong them tay ----------
create or replace function public.fn_sua_don_ban(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; it jsonb; pm jsonb; fe jsonb;
  v_gia bigint; v_ck bigint; v_dm numeric; v_dt text; v_before int;
  v_cust bigint; v_seller_id uuid; v_seller_name text;
  v_sp_id bigint; v_cash_code text;
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
    updated_at    = now()
  where id = o.id;

  -- ===== Thu them: paid_amount TU DONG cap nhat qua trigger khi insert sale_payments =====
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
        concat(o.code, '-suathem-', v_sp_id), me.uid, me.name);

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

-- ---------- B) fn_dao_nguoc_khoan_thu: bo doan update paid_amount tay ----------
create or replace function public.fn_dao_nguoc_khoan_thu(
  p_payment_id bigint,
  p_ly_do text,
  p_new_payments jsonb,
  p_old_account_id bigint default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; sp record; o record; v_old_acc bigint; v_pc_code text;
  ln jsonb; v_new_id bigint; v_new_code text; v_new_ids jsonb := '[]'::jsonb;
  v_tong_moi bigint := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đảo ngược khoản thu'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do đảo ngược'; end if;
  if jsonb_array_length(coalesce(p_new_payments,'[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: cần ít nhất 1 phương thức thanh toán mới';
  end if;

  select * into sp from public.sale_payments where id = p_payment_id for update;
  if sp is null then raise exception 'KHONG_TIM_THAY: khoản thu không tồn tại'; end if;
  if sp.is_reversed then raise exception 'DA_DAO_NGUOC: khoản thu này đã được đảo ngược trước đó'; end if;

  select * into o from public.sales_orders where code = sp.sale_code for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại'; end if;

  if sp.status = 'Đã thu' then
    v_old_acc := coalesce(
      (select account_id from public.cash_txns where code = sp.cash_txn_code),
      sp.account_id, p_old_account_id);
    if v_old_acc is null then
      raise exception 'THIEU_QUY: không xác định được quỹ gốc của khoản thu cũ, phải chọn thủ công (p_old_account_id)';
    end if;
    v_pc_code := public.fn_gen_code('PC');
    insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
    values (v_pc_code, v_old_acc, 'Chi', sp.amount, 'Đảo ngược thu sai', o.customer_name,
      concat('Đảo ngược khoản thu #', sp.id, ' (', sp.method, ') đơn ', o.code, '. Lý do: ', p_ly_do), o.code, me.uid, me.name);
  end if;

  update public.sale_payments set
    is_reversed = true, reversed_at = now(), reversed_by = me.uid, reversed_by_name = me.name, reverse_reason = p_ly_do
  where id = p_payment_id;

  for ln in select jsonb_array_elements(p_new_payments) loop
    if coalesce((ln->>'amount')::bigint, 0) <= 0 then continue; end if;
    v_tong_moi := v_tong_moi + (ln->>'amount')::bigint;

    if ln->>'method' = 'Trả góp' then
      insert into public.sale_payments (sale_code, method, amount, note, status, finance_company, created_by, created_by_name)
      values (o.code, 'Trả góp', (ln->>'amount')::bigint, concat('Sửa lại từ khoản thu #', p_payment_id), 'Chờ giải ngân',
        coalesce(ln->>'finance_company',''), me.uid, me.name)
      returning id into v_new_id;
    else
      insert into public.sale_payments (sale_code, method, amount, note, status, created_by, created_by_name)
      values (o.code, ln->>'method', (ln->>'amount')::bigint, concat('Sửa lại từ khoản thu #', p_payment_id), 'Đã thu', me.uid, me.name)
      returning id into v_new_id;

      v_new_code := public._auto_thu(o.location_code, ln->>'method', (ln->>'amount')::bigint, 'Bán xe', o.customer_name,
        concat('Sửa lại thu - Đơn ', o.code), concat(o.code, '-sua-', v_new_id), me.uid, me.name);
      if v_new_code is not null then
        update public.sale_payments set
          cash_txn_code = v_new_code,
          account_id = (select account_id from public.cash_txns where code = v_new_code)
        where id = v_new_id;
      end if;
    end if;

    v_new_ids := v_new_ids || jsonb_build_array(jsonb_build_object(
      'method', ln->>'method', 'amount', (ln->>'amount')::bigint,
      'finance_company', ln->>'finance_company', 'new_payment_id', v_new_id));
  end loop;

  if v_tong_moi <= 0 then raise exception 'SO_TIEN_SAI: tổng số tiền các phương thức mới phải > 0'; end if;

  -- paid_amount TU DONG cap nhat qua trigger (khong con dong update tay o day)

  insert into public.sale_payment_reversals (sale_code, old_payment_id, old_method, old_amount, new_payments, reason, by_id, by_name)
  values (o.code, p_payment_id, sp.method, sp.amount, v_new_ids, p_ly_do, me.uid, me.name);

  perform public._notify_discord(jsonb_build_object('content',
    concat('🔄 **Đảo ngược khoản thu** đơn ', o.code, ' — từ ', sp.method, ' ', sp.amount,
      'đ TÁCH THÀNH ', jsonb_array_length(v_new_ids), ' phương thức (tổng ', v_tong_moi, 'đ) · lý do: ', p_ly_do, ' · bởi ', me.name)));

  return jsonb_build_object('old_payment_id', p_payment_id, 'new_payments', v_new_ids);
end $$;

-- ---------- C) fn_hoan_tien_don_v2: hoan TU DUNG quy tien goc, khong con mac dinh Tien mat ----------
-- Duyet cac dong sale_payments CHUA hoan het, moi nhat truoc, giam tru
-- tung dong (co the hoan mot phan 1 dong). Voi dong da THAT SU vao quy
-- (status Da thu, hoac Da giai ngan) -> lap phieu Chi DUNG tai khoan da
-- nhan tien do. Voi dong con Cho giai ngan (chua thuc vao quy) -> chi
-- huy phan cho doi, KHONG lap phieu Chi (vi chua co tien that de hoan).
create or replace function public.fn_hoan_tien_don_v2(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_amt bigint; v_ly text; r record;
  v_con_lai bigint; v_hoan_dong bigint; v_acc bigint; v_pc_code text; v_available bigint;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' and not public.fn_co_quyen('sua_thanh_toan') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền hoàn tiền';
  end if;
  v_amt := coalesce((p->>'amount')::bigint, 0);
  v_ly := trim(coalesce(p->>'ly_do',''));
  if v_amt <= 0 then raise exception 'THAM_SO_SAI: số tiền hoàn phải > 0'; end if;
  if v_ly = '' then raise exception 'THIEU_THONG_TIN: nhập lý do hoàn tiền'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if v_amt > coalesce(o.paid_amount,0) then
    raise exception 'VUOT_DA_THU: chỉ hoàn tối đa số đã thu (% đ)', coalesce(o.paid_amount,0);
  end if;

  v_con_lai := v_amt;
  for r in
    select * from public.sale_payments
    where sale_code = o.code and not is_reversed and refunded_amount < amount
    order by created_at desc, id desc
    for update
  loop
    exit when v_con_lai <= 0;
    v_available := r.amount - r.refunded_amount;
    v_hoan_dong := least(v_available, v_con_lai);

    -- Xac dinh dung quy tien that da vao (neu co) de lap phieu Chi dung noi
    v_acc := null;
    if r.status = 'Đã thu' then
      v_acc := coalesce((select account_id from public.cash_txns where code = r.cash_txn_code), r.account_id);
    elsif r.status = 'Đã giải ngân' then
      v_acc := (select account_id from public.cash_txns where code = r.disbursed_txn_code);
    end if;
    -- status = 'Chờ giải ngân': chua thuc vao quy -> khong lap phieu Chi, v_acc van null

    if v_acc is not null then
      v_pc_code := public.fn_gen_code('PC');
      insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
      values (v_pc_code, v_acc, 'Chi', v_hoan_dong, 'Chi trả lại tiền cho khách hủy/trả đơn', o.customer_name,
        concat('Hoàn tiền đơn ', o.code, ' (từ khoản thu #', r.id, ' - ', r.method, ') — ', v_ly), o.code, me.uid, me.name);
    end if;

    update public.sale_payments set refunded_amount = refunded_amount + v_hoan_dong where id = r.id;
    v_con_lai := v_con_lai - v_hoan_dong;
  end loop;

  if v_con_lai > 0 then
    raise exception 'KHONG_DU_KHOAN_THU: không tìm đủ khoản thu chưa hoàn để hoàn % đ (còn thiếu % đ) — kiểm tra lại các khoản thu của đơn', v_amt, v_con_lai;
  end if;

  -- paid_amount TU DONG cap nhat qua trigger khi refunded_amount thay doi o tren

  update public.sales_orders set
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Hoàn khách '||v_amt||'đ: '||v_ly||' ('||me.name||')')
  where id = (p->>'id')::bigint;
end $$;
