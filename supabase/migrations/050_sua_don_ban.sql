-- ============================================================
-- Migration 050 — SỬA ĐƠN BÁN CÓ KIỂM SOÁT
-- Chot (da duyet):
--  * Chua xuat HD + chua thu tien -> sua gan nhu toan bo
--  * Chua xuat HD + da thu tien   -> sua duoc, tru cac khoan da thu
--  * DA XUAT HD                   -> KHOA (phai huy xac nhan HD truoc)
--  * Bo xe khoi don -> TRA VE TON KHO + ghi but toan nguoc
--  * Moi thay doi ghi vet vao don_audit_logs
-- Chay SAU 049. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== 1) NHẬT KÝ SỬA ĐƠN =====================
create table if not exists public.don_audit_logs (
  id bigserial primary key,
  sale_code text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  note text default '',
  acted_by uuid references public.profiles(id),
  acted_by_name text default '',
  acted_at timestamptz not null default now()
);
create index if not exists don_audit_idx on public.don_audit_logs (sale_code, acted_at desc);
alter table public.don_audit_logs enable row level security;
drop policy if exists "read_don_audit" on public.don_audit_logs;
create policy "read_don_audit" on public.don_audit_logs for select to authenticated using (true);

-- ===================== 2) KIỂM TRA ĐƠN CÓ SỬA ĐƯỢC KHÔNG =====================
create or replace function public.fn_don_co_sua_duoc(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o record; v_thu bigint;
begin
  select * into o from public.sales_orders where id = p_id;
  if o is null then return jsonb_build_object('ok', false, 'ly_do', 'Đơn không tồn tại'); end if;

  if o.invoice_status = 'Đã xuất HĐ' then
    return jsonb_build_object('ok', false, 'muc', 'khoa',
      'ly_do', concat('Đơn đã xuất hóa đơn số ', o.invoice_no,
                      ' — phải hủy xác nhận hóa đơn (Admin/BGĐ) trước khi sửa.'));
  end if;

  select coalesce(sum(amount), 0) into v_thu from public.sale_payments where sale_code = o.code;
  if coalesce(o.paid_amount, 0) > 0 or v_thu > 0 then
    return jsonb_build_object('ok', true, 'muc', 'han_che',
      'da_thu', greatest(coalesce(o.paid_amount,0), v_thu),
      'ly_do', 'Đơn đã thu tiền — sửa được nhưng không giảm tổng đơn xuống dưới số đã thu.');
  end if;

  return jsonb_build_object('ok', true, 'muc', 'day_du', 'da_thu', 0, 'ly_do', '');
end $$;

-- ===================== 3) SỬA ĐƠN =====================
create or replace function public.fn_sua_don_ban(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; o record; v_check jsonb; v_cu jsonb;
  f jsonb; it jsonb; pm jsonb; u record;
  v_frames_moi text[] := '{}'; v_frames_cu text[]; sk text;
  v_gia bigint; v_ck bigint; v_dm numeric; v_dt text;
  v_tong bigint; v_thu bigint; v_before int; v_bo int := 0; v_them int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa đơn'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;

  v_check := public.fn_don_co_sua_duoc(o.id);
  if not (v_check->>'ok')::boolean then
    raise exception 'KHONG_SUA_DUOC: %', v_check->>'ly_do';
  end if;

  v_cu := to_jsonb(o);

  -- ---------- XE ----------
  -- Danh sach so khung MOI tu form
  select array_agg(upper(btrim(x->>'frame_number'))) into v_frames_moi
  from jsonb_array_elements(coalesce(p->'frames','[]'::jsonb)) x;
  if coalesce(array_length(v_frames_moi,1),0) = 0 then
    raise exception 'THIEU_SO_KHUNG: đơn phải có ít nhất 1 xe';
  end if;

  -- Xe hien dang thuoc don nay
  select array_agg(frame_number) into v_frames_cu
  from public.vehicle_units where sale_code = o.code;
  v_frames_cu := coalesce(v_frames_cu, '{}');

  -- BỎ xe khỏi đơn -> trả về tồn kho + bút toán ngược
  foreach sk in array v_frames_cu loop
    if not (sk = any(v_frames_moi)) then
      select * into u from public.vehicle_units where frame_number = sk for update;
      if u is not null and u.status = 'DA_BAN' then
        v_before := public._count_at(u.vehicle_id, u.location_code);
        update public.vehicle_units set status = 'TON_KHO', sale_code = null, updated_at = now()
        where frame_number = sk;
        perform public._log_txn('Hủy đơn bán', u.vehicle_id, null, u.location_code, 1,
          v_before, v_before + 1, o.code,
          concat('Sửa đơn ', o.code, ': bỏ xe ', sk, ' → hoàn về kho · ', me.name), me.uid, me.name);
        v_bo := v_bo + 1;
      end if;
    end if;
  end loop;

  -- THÊM xe vào đơn -> trừ tồn
  foreach sk in array v_frames_moi loop
    if not (sk = any(v_frames_cu)) then
      select * into u from public.vehicle_units where frame_number = sk for update;
      if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', sk; end if;
      if u.status = 'GIU_CHO' then
        if not public.fn_coc_cho_phep_ban(sk, o.customer_phone) then
          raise exception 'XE_DANG_GIU: xe % đang giữ cho khách khác', sk;
        end if;
        update public.deposits set status = 'DA_BAN' where frame_number = sk and status = 'DANG_GIU';
      elsif u.status <> 'TON_KHO' then
        raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', sk, u.status;
      end if;
      v_before := public._count_at(u.vehicle_id, u.location_code);
      update public.vehicle_units set status = 'DA_BAN', sale_code = o.code, updated_at = now()
      where frame_number = sk;
      perform public._log_txn('Bán hàng', u.vehicle_id, u.location_code, null, -1,
        v_before, v_before - 1, o.code,
        concat('Sửa đơn ', o.code, ': thêm xe ', sk, ' · ', me.name), me.uid, me.name);
      v_them := v_them + 1;
    end if;
  end loop;

  -- ---------- CẬP NHẬT ĐƠN (lấy xe đầu tiên làm xe chính) ----------
  f := (p->'frames')->0;
  v_gia := coalesce((f->>'unit_price')::bigint, o.sale_price);
  v_dt  := coalesce(nullif(f->>'discount_type',''), 'amount');
  v_dm  := coalesce((f->>'discount_value')::numeric, 0);
  v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                else least(greatest(v_dm,0)::bigint, v_gia) end;

  select * into u from public.vehicle_units where frame_number = v_frames_moi[1];

  update public.sales_orders set
    sale_date = coalesce(nullif(p->>'sale_date','')::date, sale_date),
    location_code = coalesce(nullif(p->>'location_code',''), location_code),
    vehicle_id = coalesce(u.vehicle_id, vehicle_id),
    frame_number = array_to_string(v_frames_moi, ', '),
    quantity = array_length(v_frames_moi, 1),
    sale_price = greatest(v_gia - v_ck, 0),
    vehicle_discount_type = v_dt, vehicle_discount_value = v_dm,
    customer_name = coalesce(nullif(p->>'customer_name',''), customer_name),
    customer_phone = coalesce(nullif(p->>'customer_phone',''), customer_phone),
    customer_cccd = coalesce(p->>'customer_cccd', customer_cccd),
    customer_address = coalesce(p->>'customer_address', customer_address),
    customer_type = coalesce(nullif(p->>'customer_type',''), customer_type),
    customer_source = coalesce(nullif(p->>'customer_source',''), customer_source),
    note = coalesce(p->>'note', note),
    extra = coalesce(p->'extra', extra),
    discount_type = coalesce(nullif(p->>'discount_type',''), discount_type),
    discount_value = coalesce((p->>'discount_value')::numeric, discount_value)
  where id = o.id;

  -- ---------- BÁN KÈM: ghi đè toàn bộ ----------
  if p ? 'items' then
    delete from public.sale_items where sale_code = o.code;
    for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
      if coalesce(trim(it->>'name'),'') = '' then continue; end if;
      v_gia := greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0);
      v_dt  := coalesce(nullif(it->>'discount_type',''), 'amount');
      v_dm  := coalesce((it->>'discount_value')::numeric, 0);
      v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                    else least(greatest(v_dm,0)::bigint, v_gia) end;
      insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount,
        payment_method, discount_type, discount_value)
      values (o.code, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
        greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
        greatest(v_gia - v_ck, 0), 'Chuyển khoản', v_dt, v_dm);
    end loop;
  end if;

  -- ---------- CHIẾT KHẤU TỔNG ----------
  update public.sales_orders set discount_amount =
    case when discount_type = 'percent'
      then round((sale_price * quantity
        + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code),0))
        * least(greatest(discount_value,0),100) / 100.0)
      else least(discount_value, sale_price * quantity)::bigint end
  where id = o.id;

  -- ---------- KIỂM TRA: tổng đơn không được nhỏ hơn số đã thu ----------
  select coalesce(sum(amount), 0) into v_thu from public.sale_payments where sale_code = o.code;
  v_thu := greatest(v_thu, coalesce(o.paid_amount, 0));
  select greatest(sale_price * quantity
      + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code),0)
      - discount_amount, 0) into v_tong
  from public.sales_orders where id = o.id;

  if v_tong < v_thu then
    raise exception 'TONG_NHO_HON_DA_THU: tổng đơn sau sửa là %đ nhưng khách đã trả %đ — hoàn tiền chênh lệch trước khi giảm đơn', v_tong, v_thu;
  end if;

  -- ---------- THANH TOÁN: chỉ THÊM dòng mới, không xóa dòng đã thu ----------
  for pm in select jsonb_array_elements(coalesce(p->'new_payments','[]'::jsonb)) loop
    if coalesce((pm->>'amount')::bigint, 0) <= 0 then continue; end if;
    insert into public.sale_payments (sale_code, method, amount, note, created_by, created_by_name)
    values (o.code, coalesce(nullif(pm->>'method',''),'Tiền mặt'), (pm->>'amount')::bigint,
      coalesce(pm->>'note',''), me.uid, me.name);
    perform public._auto_thu(o.location_code, pm->>'method', (pm->>'amount')::bigint,
      'Bán xe', o.customer_name, concat('Đơn ', o.code, ' (sửa đơn)'),
      concat(o.code, '-SUA-', pm->>'method', '-', pm->>'amount'), me.uid, me.name);
  end loop;

  update public.sales_orders set
    paid_amount = coalesce((select sum(amount) from public.sale_payments where sale_code = o.code), paid_amount)
  where id = o.id;

  -- ---------- GHI VẾT ----------
  insert into public.don_audit_logs (sale_code, action, old_data, new_data, note, acted_by, acted_by_name)
  values (o.code, 'sua_don', v_cu, p,
    concat('Bỏ ', v_bo, ' xe · thêm ', v_them, ' xe',
           case when coalesce(p->>'ly_do','') <> '' then concat(' · lý do: ', p->>'ly_do') else '' end),
    me.uid, me.name);

  perform public._notify_discord(jsonb_build_object('content',
    concat('✏️ **Sửa đơn bán ', o.code, '**', E'\n',
      'Khách: ', o.customer_name, E'\n',
      case when v_bo > 0 then concat('➖ Bỏ ', v_bo, ' xe (hoàn về kho)', E'\n') else '' end,
      case when v_them > 0 then concat('➕ Thêm ', v_them, ' xe', E'\n') else '' end,
      'Tổng đơn mới: ', to_char(v_tong, 'FM999,999,999,999'), 'đ',
      E'\n👤 ', me.name,
      case when coalesce(p->>'ly_do','') <> '' then concat(E'\n📝 ', p->>'ly_do') else '' end)));

  return jsonb_build_object('code', o.code, 'tong', v_tong, 'bo_xe', v_bo, 'them_xe', v_them);
end $$;
