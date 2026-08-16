-- ============================================================
-- Migration 096: 2 việc lớn cho module Đơn bán
--
-- A) FIX BUG HỒI QUY: fn_ban_hang_v2 hiện tại (migration 074) gọi
--    _auto_thu() cho MỌI phương thức bao gồm "Trả góp" — nghĩa là
--    tiền trả góp bị ghi nhận NGAY vào quỹ Ngân hàng dù công ty tài
--    chính CHƯA giải ngân thật. Bản gốc (migration 014, fn_ban_hang
--    không có v2) từng làm ĐÚNG: Trả góp -> sale_payments.status =
--    'Chờ giải ngân', KHÔNG đụng cash_txns, đợi xác nhận qua module
--    Giải ngân (fn_xac_nhan_giai_ngan — vẫn còn nguyên, vẫn đang chờ
--    dữ liệu status='Chờ giải ngân' mà từ khi có v2 KHÔNG CÒN AI TẠO
--    RA NỮA). Migration này khôi phục đúng luồng cũ trong fn_ban_hang_v2.
--    Đồng thời lưu lại cash_txn_code + account_id trên từng dòng
--    sale_payments (thiếu từ trước) để việc "đảo ngược" ở phần B có
--    thể xác định đúng quỹ cần trừ lại.
--
-- B) MỚI: fn_dao_nguoc_khoan_thu — CEO/ADMIN đảo ngược 1 khoản thu
--    ghi sai (VD: chọn nhầm Tiền mặt) mà KHÔNG sửa trực tiếp dòng cũ
--    (giữ nguyên để truy vết) — tạo bút toán Chi hoàn lại đúng quỹ cũ,
--    rồi tạo khoản thu mới đúng phương thức.
--
-- Chạy sau 095. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.sale_payments
  add column if not exists is_reversed boolean not null default false,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id),
  add column if not exists reversed_by_name text default '',
  add column if not exists reverse_reason text default '';

-- Noi long check constraint 'method' de dam bao Tra gop van hop le (da co san, giu nguyen)

-- ---------- A) Khoi phuc dung luong Tra gop trong fn_ban_hang_v2 ----------
create or replace function public.fn_ban_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_batch text; v_code text; v_codes text[] := '{}';
  f jsonb; it jsonb; pm jsonb; u record; v_list bigint; v_cust bigint;
  v_before int; v_gia bigint; v_ck bigint; v_dm numeric; v_dt text;
  v_first text; v_coc bigint := 0; d record; n int := 0; v_def bigint;
  v_sale_loc text; v_seller_id uuid; v_seller_name text;
  v_sp_id bigint; v_cash_code text; v_finance text;
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

  -- Ban kem + product_id (trigger se tu tru ton neu co product_id)
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

  -- ===== THANH TOAN: Tien mat/Chuyen khoan ghi thu NGAY; Tra gop -> CHO GIAI NGAN =====
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
        concat('Đơn ', v_first), concat(v_first, '-', pm->>'method', '-', pm->>'amount'), me.uid, me.name);

      if v_cash_code is not null then
        update public.sale_payments set
          cash_txn_code = v_cash_code,
          account_id = (select account_id from public.cash_txns where code = v_cash_code)
        where id = v_sp_id;
      end if;
    end if;
  end loop;

  update public.sales_orders set
    paid_amount = v_coc + coalesce((select sum(amount) from public.sale_payments where sale_code = v_first and not is_reversed), 0),
    payment_method = coalesce((select method from public.sale_payments where sale_code = v_first and not is_reversed order by amount desc limit 1), 'Chuyển khoản'),
    note = trim(both ' | ' from concat(note, case when v_coc > 0 then concat(' | Đã nhận cọc trước: ', v_coc, 'đ') else '' end))
  where code = v_first;

  return jsonb_build_object('batch', v_batch, 'codes', to_jsonb(v_codes), 'count', n, 'first', v_first);
end $$;

-- ---------- B) Đảo ngược khoản thu ghi sai + tạo khoản thu mới đúng ----------
create or replace function public.fn_dao_nguoc_khoan_thu(
  p_payment_id bigint,
  p_ly_do text,
  p_new_method text,
  p_new_amount bigint,
  p_new_finance_company text default null,
  p_old_account_id bigint default null   -- chi can neu du lieu cu thieu cash_txn_code
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; sp record; o record; v_old_acc bigint; v_new_code text; v_new_id bigint; v_pc_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đảo ngược khoản thu'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do đảo ngược'; end if;
  if coalesce(p_new_amount,0) <= 0 then raise exception 'SO_TIEN_SAI: số tiền mới phải > 0'; end if;

  select * into sp from public.sale_payments where id = p_payment_id for update;
  if sp is null then raise exception 'KHONG_TIM_THAY: khoản thu không tồn tại'; end if;
  if sp.is_reversed then raise exception 'DA_DAO_NGUOC: khoản thu này đã được đảo ngược trước đó'; end if;

  select * into o from public.sales_orders where code = sp.sale_code for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại'; end if;

  -- Xac dinh quy cu can hoan lai (chi can neu khoan cu da THAT SU vao quy — khong ap dung cho Tra gop dang Cho giai ngan)
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
  -- Neu status = 'Cho giai ngan': chua tung vao quy that, khong can bút toán Chi.

  update public.sale_payments set
    is_reversed = true, reversed_at = now(), reversed_by = me.uid, reversed_by_name = me.name, reverse_reason = p_ly_do
  where id = p_payment_id;

  -- Tao khoan thu moi dung
  if p_new_method = 'Trả góp' then
    insert into public.sale_payments (sale_code, method, amount, note, status, finance_company, created_by, created_by_name)
    values (o.code, 'Trả góp', p_new_amount, concat('Sửa lại từ khoản thu #', p_payment_id), 'Chờ giải ngân',
      coalesce(p_new_finance_company,''), me.uid, me.name)
    returning id into v_new_id;
  else
    insert into public.sale_payments (sale_code, method, amount, note, status, created_by, created_by_name)
    values (o.code, p_new_method, p_new_amount, concat('Sửa lại từ khoản thu #', p_payment_id), 'Đã thu', me.uid, me.name)
    returning id into v_new_id;

    v_new_code := public._auto_thu(o.location_code, p_new_method, p_new_amount, 'Bán xe', o.customer_name,
      concat('Sửa lại thu - Đơn ', o.code), concat(o.code, '-sua-', v_new_id), me.uid, me.name);
    if v_new_code is not null then
      update public.sale_payments set
        cash_txn_code = v_new_code,
        account_id = (select account_id from public.cash_txns where code = v_new_code)
      where id = v_new_id;
    end if;
  end if;

  update public.sales_orders set
    paid_amount = greatest(coalesce(paid_amount,0) - sp.amount + p_new_amount, 0)
  where code = o.code;

  perform public._notify_discord(jsonb_build_object('content',
    concat('🔄 **Đảo ngược khoản thu** đơn ', o.code, ' — từ ', sp.method, ' ', sp.amount,
      'đ sang ', p_new_method, ' ', p_new_amount, 'đ · lý do: ', p_ly_do, ' · bởi ', me.name)));

  return jsonb_build_object('old_payment_id', p_payment_id, 'new_payment_id', v_new_id);
end $$;
