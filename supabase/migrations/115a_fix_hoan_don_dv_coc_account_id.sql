-- ============================================================
-- Migration 115 (1/2): Sửa gộp Bug #1, #4, #5 (mức Cao/Khẩn cấp)
-- Chạy sau 114. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- BUG #1: Hủy đơn / Trả hàng chưa đồng bộ sale_payments ----------
-- Thêm bước đánh dấu is_reversed=true cho TOÀN BỘ sale_payments của đơn
-- khi hủy/trả — trigger (migration 110a) sẽ TỰ ĐỘNG tính lại paid_amount
-- về đúng coc_applied (giữ nguyên phần cọc, đúng khớp hành vi _hoan_quy_don
-- hiện tại KHÔNG hoàn phần cọc — chỉ hoàn phần Thu trực tiếp của đơn).
create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được hủy đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do hủy đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn này đã hủy/trả trước đó'; end if;

  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null,
      coc_status = case when coalesce(o.coc_giao,false) and u.coc_status = 'DA_GIAO' then 'DA_VE'
                        else u.coc_status end,
      updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  end if;

  perform public.fn_hoan_ton_hang_hoa(o.code, me.uid, me.name);
  perform public._hoan_quy_don(o.code, trim(p_ly_do), me.uid, me.name);

  -- SUA MOI: dong bo sale_payments de trigger tu tinh lai paid_amount dung
  update public.sale_payments set
    is_reversed = true, reversed_at = now(), reversed_by = me.uid, reversed_by_name = me.name,
    reverse_reason = concat('Hủy đơn bán: ', trim(p_ly_do))
  where sale_code = o.code and not is_reversed;

  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do), updated_at = now()
  where id = p_id;
end $$;

create or replace function public.fn_tra_hang_ban(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int; v_hoan bigint; v_ly text;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được duyệt trả hàng'; end if;
  v_ly := trim(coalesce(p->>'ly_do',''));
  if v_ly = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do trả hàng'; end if;
  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn này đã hủy/trả trước đó'; end if;

  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code then
    v_before := public._count_at(o.vehicle_id, coalesce(nullif(p->>'location_code',''), u.location_code));
    update public.vehicle_units set status = 'TON_KHO', sale_code = null,
      location_code = coalesce(nullif(p->>'location_code',''), u.location_code),
      coc_status = case when u.coc_status = 'DA_GIAO' then 'DA_VE' else u.coc_status end,
      updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, coalesce(nullif(p->>'location_code',''), u.location_code),
      1, v_before, v_before + 1, o.code,
      'BGĐ '||me.name||' duyệt TRẢ HÀNG đơn '||o.code||' — lý do: '||v_ly||' · xe '||o.frame_number||' nhập lại kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' duyệt TRẢ HÀNG đơn '||o.code||' — lý do: '||v_ly||' · KHÔNG hoàn kho', me.uid, me.name);
  end if;

  v_hoan := public._hoan_quy_don(o.code, v_ly, me.uid, me.name);

  -- SUA MOI: dong bo sale_payments de trigger tu tinh lai paid_amount dung
  update public.sale_payments set
    is_reversed = true, reversed_at = now(), reversed_by = me.uid, reversed_by_name = me.name,
    reverse_reason = concat('Trả hàng: ', v_ly)
  where sale_code = o.code and not is_reversed;

  update public.sales_orders set
    status = 'Đã trả hàng',
    returned_at = now(), cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = 'TRẢ HÀNG: '||v_ly || case when v_hoan > 0 then ' · đã hoàn '||v_hoan||'đ' else '' end,
    updated_at = now()
  where id = (p->>'id')::bigint;
end $$;

-- ---------- BUG #4/#5: fn_dv_thu_tien va fn_dat_coc chua truyen account_id ----------
-- Neu KHONG sua, sau khi da co migration 113b (bat buoc account_id cho
-- Ngan hang), 2 luong nay se BAO LOI ngay khi thu tien/dat coc bang
-- Chuyen khoan. Sua o day de khong bao gio gap phai.
create or replace function public.fn_dv_thu_tien(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; t record; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_thu_tien') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền thu tiền'; end if;
  select * into t from public.dv_tickets where id = (p->>'ticket_id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;
  if me.role not in ('ADMIN','CEO') and not exists (
    select 1 from public.dv_collectors c where c.user_id = me.uid and c.location_code = t.location_code and c.active
  ) then
    raise exception 'KHONG_TRONG_DANH_SACH: bạn chưa được chỉ định thu tiền tại điểm % — nhờ CHT gán trong Cài đặt', t.location_code;
  end if;
  if coalesce((p->>'amount')::bigint, 0) <= 0 then raise exception 'THAM_SO_SAI: số tiền phải > 0'; end if;
  if (p->>'method') = 'Tiền mặt' and jsonb_array_length(coalesce(p->'evidence','[]'::jsonb)) = 0 then
    raise exception 'THIEU_ANH: thu tiền mặt bắt buộc chụp ảnh phiếu thu/giao dịch';
  end if;
  v_code := public.fn_next_code('PTDV');
  insert into public.dv_payments (code, ticket_id, method, amount, evidence, collected_by, collected_by_name, note)
  values (v_code, t.id, p->>'method', (p->>'amount')::bigint, coalesce(p->'evidence','[]'::jsonb), me.uid, me.name, coalesce(p->>'note',''));

  -- SUA MOI: truyen them account_id (bat buoc voi phuong thuc thuoc quy Ngan hang)
  perform public._auto_thu(t.location_code, p->>'method', (p->>'amount')::bigint,
    'Thu dịch vụ', t.customer_name, 'Phiếu DV '||t.code||' — '||v_code, v_code, me.uid, me.name,
    nullif(p->>'account_id','')::bigint);

  perform public._dv_log('ticket', t.code, 'thu_tien', null, jsonb_build_object('code', v_code, 'method', p->>'method', 'amount', p->>'amount'), '');
  perform public._notify_discord(jsonb_build_object('content',
    '💵 **Thu tiền DV** '||v_code||' · phiếu '||t.code||' · '||(p->>'method')||' '||(p->>'amount')||'đ · '||me.name||' · điểm '||t.location_code));
  return v_code;
end $$;

create or replace function public.fn_dat_coc(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; u record; v_cust bigint; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền đặt cọc'; end if;
  select * into u from public.vehicle_units where frame_number = p->>'frame_number' for update;
  if u is null then raise exception 'SO_KHUNG_KHONG_CO'; end if;
  if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe đang ở trạng thái %', u.status; end if;
  if coalesce(trim(p->>'customer_name'),'') = '' or coalesce(trim(p->>'customer_phone'),'') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;

  v_cust := nullif(p->>'customer_id','')::bigint;
  if v_cust is null then
    v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', '',
      coalesce(p->>'customer_address',''), 'Khách lẻ', 'Đặt cọc', me.uid, me.name);
  end if;
  v_code := public.fn_next_code('COC');
  insert into public.deposits (code, frame_number, vehicle_id, location_code, customer_id,
    customer_name, customer_phone, amount, hold_until, note, created_by, created_by_name)
  values (v_code, u.frame_number, u.vehicle_id, u.location_code, v_cust,
    p->>'customer_name', p->>'customer_phone', coalesce((p->>'amount')::bigint, 0),
    (p->>'hold_until')::date, coalesce(p->>'note',''), me.uid, me.name);
  update public.vehicle_units set status = 'GIU_CHO', updated_at = now() where frame_number = u.frame_number;

  -- SUA MOI: truyen them account_id (bat buoc voi phuong thuc thuoc quy Ngan hang)
  perform public._auto_thu(u.location_code, coalesce(p->>'payment_method','Tiền mặt'),
    coalesce((p->>'amount')::bigint, 0), 'Thu tiền cọc', p->>'customer_name',
    'Cọc giữ xe '||v_code||' · SK '||u.frame_number, v_code, me.uid, me.name,
    nullif(p->>'account_id','')::bigint);

  perform public._notify_discord(jsonb_build_object('content',
    '📌 **Đặt cọc/Giữ xe** '||v_code||' · SK '||u.frame_number||' · '||(p->>'amount')||'đ · KH '||(p->>'customer_name')||' · '||me.name));
  return v_code;
end $$;
