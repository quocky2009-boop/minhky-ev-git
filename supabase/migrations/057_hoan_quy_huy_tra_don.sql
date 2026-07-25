-- ============================================================
-- Migration 057 — HỦY ĐƠN / TRẢ HÀNG BÁN có HẠCH TOÁN SỔ QUỸ
--  Nguyen tac ke toan (theo chi dao CEO):
--   * Neu phieu thu goc CUNG NGAY va CHUA CHOT QUY -> tru lui (xoa phieu thu).
--   * Neu da chot quy (ky truoc) -> lap PHIEU CHI hoan tien "Chi tra lai tien
--     cho khach huy/tra don", so tien khop voi phieu thu.
--  Hai thao tac:
--   * fn_xoa_don  (Huy don — don CHUA giao): danh dau 'Đã hủy' + hoan xe + hoan quy.
--   * fn_tra_hang_ban (Tra lai hang ban — don DA giao): 'Đã trả hàng' + hoan xe + hoan quy.
-- Chạy SAU 056. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- Bo sung trang thai 'Đã trả hàng' cho cot luu vet (khong rang buoc check nen chi la gia tri)
alter table public.sales_orders add column if not exists returned_at timestamptz;

-- ===================== HÀM HOÀN QUỸ DÙNG CHUNG =====================
-- Voi moi phieu thu goc (ref_doc = ma don, direction='Thu') cua don:
--   - Neu ngay phieu thu do CHUA bi chot quy -> xoa phieu (tru lui).
--   - Neu DA chot -> tao phieu chi hoan cung so tien, cung tai khoan.
-- Tra ve tong so tien da hoan (de ghi chu).
create or replace function public._hoan_quy_don(p_code text, p_ly_do text, p_uid uuid, p_uname text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r record; v_daclose boolean; v_code text; v_tong bigint := 0;
begin
  for r in select * from public.cash_txns where ref_doc = p_code and direction = 'Thu' loop
    -- ngay phieu thu nay da bi chot quy chua?
    v_daclose := exists (
      select 1 from public.cash_closings c
      where c.account_id = r.account_id and c.close_date >= r.txn_date
    );
    if v_daclose then
      -- Da chot -> lap phieu chi hoan (khong xoa phieu thu goc)
      if public.fn_so_du(r.account_id) >= r.amount then
        v_code := public.fn_gen_code('PC');
        insert into public.cash_txns (code, txn_date, account_id, direction, amount, category,
          counterparty, description, ref_doc, created_by, created_by_name)
        values (v_code, (now() at time zone 'Asia/Ho_Chi_Minh')::date, r.account_id, 'Chi', r.amount,
          'Chi trả lại tiền cho khách hủy/trả đơn', r.counterparty,
          'Hoàn tiền đơn '||p_code||' — '||coalesce(p_ly_do,''), p_code, p_uid, p_uname);
        v_tong := v_tong + r.amount;
      else
        raise exception 'QUY_KHONG_DU: quỹ không đủ số dư để lập phiếu chi hoàn % đ (đơn %). Hãy nạp quỹ hoặc chi tay rồi ghi phiếu chi thủ công.', r.amount, p_code;
      end if;
    else
      -- Chua chot -> tru lui: xoa phieu thu goc
      delete from public.cash_txns where id = r.id;
      v_tong := v_tong + r.amount;
    end if;
  end loop;
  return v_tong;
end $$;

-- ===================== fn_xoa_don: HỦY ĐƠN CHƯA GIAO + HOÀN QUỸ =====================
create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int; v_hoan bigint;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được hủy đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do hủy đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn này đã hủy/trả trước đó'; end if;

  -- Hoan xe
  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null, updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' KHÔNG hoàn kho', me.uid, me.name);
  end if;

  -- Hoan quy (tru lui hoac phieu chi)
  v_hoan := public._hoan_quy_don(o.code, trim(p_ly_do), me.uid, me.name);

  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do) || case when v_hoan > 0 then ' · đã hoàn quỹ '||v_hoan||'đ' else '' end,
    updated_at = now()
  where id = p_id;
end $$;

-- ===================== fn_tra_hang_ban: TRẢ HÀNG (đơn ĐÃ giao) =====================
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

  -- Hoan xe ve kho (kho nhan lai co the khac kho ban ban dau)
  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code then
    v_before := public._count_at(o.vehicle_id, coalesce(nullif(p->>'location_code',''), u.location_code));
    update public.vehicle_units set status = 'TON_KHO', sale_code = null,
      location_code = coalesce(nullif(p->>'location_code',''), u.location_code), updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, coalesce(nullif(p->>'location_code',''), u.location_code),
      1, v_before, v_before + 1, o.code,
      'BGĐ '||me.name||' duyệt TRẢ HÀNG đơn '||o.code||' — lý do: '||v_ly||' · xe '||o.frame_number||' nhập lại kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' duyệt TRẢ HÀNG đơn '||o.code||' — lý do: '||v_ly||' · xe '||o.frame_number||' KHÔNG hoàn kho', me.uid, me.name);
  end if;

  -- Hoan tien khach (tru lui neu chua chot, phieu chi neu da chot)
  v_hoan := public._hoan_quy_don(o.code, v_ly, me.uid, me.name);

  update public.sales_orders set
    status = 'Đã trả hàng',
    returned_at = now(), cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = 'TRẢ HÀNG: '||v_ly || case when v_hoan > 0 then ' · đã hoàn '||v_hoan||'đ' else '' end,
    updated_at = now()
  where id = (p->>'id')::bigint;
end $$;

do $do$
begin
  raise notice 'XONG 057: fn_xoa_don + fn_tra_hang_ban co hoan quy (tru lui/phieu chi); them _hoan_quy_don';
end $do$;
