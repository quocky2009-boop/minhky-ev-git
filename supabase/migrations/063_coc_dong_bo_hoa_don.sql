-- ============================================================
-- Migration 063 — GIẤY COC: đồng bộ trạng thái khi xác nhận/hủy hóa đơn
--  1) sales_orders thêm cột coc_giao boolean (đã giao COC cho khách).
--  2) fn_xac_nhan_hoa_don: nhận thêm tham số coc_giao; nếu true thì
--     đặt coc_status = 'DA_GIAO' trên xe.
--  3) fn_huy_xac_nhan_hoa_don: khi hủy xác nhận HĐ, nếu đơn có coc_giao=true
--     thì hoàn COC về 'DA_VE' (COC đã nhận về kho nhưng chưa giao lại).
--  4) fn_xoa_don + fn_tra_hang_ban: khi hủy/trả đơn, nếu coc_giao=true
--     thì đặt coc_status = 'DA_VE' (xe về kho, COC cũng về kho cùng).
-- Chạy SAU 062. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.sales_orders add column if not exists coc_giao boolean not null default false;

-- ===================== 1) fn_xac_nhan_hoa_don =====================
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

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh, app_activated = v_app, coc_giao = v_coc
  where id = o.id;

  -- Neu xac nhan da giao COC: cap nhat trang thai COC tren xe
  if v_coc then
    update public.vehicle_units set
      coc_status = 'DA_GIAO',
      coc_received_at = coalesce(coc_received_at, current_date),
      updated_at = now()
    where frame_number = o.frame_number and coc_status <> 'DA_GIAO';
  end if;
end $$;

-- ===================== 2) fn_huy_xac_nhan_hoa_don =====================
create or replace function public.fn_huy_xac_nhan_hoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được hủy xác nhận hóa đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.invoice_status <> 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn chưa xác nhận HĐ'; end if;

  update public.sales_orders set
    invoice_status = 'Chờ xuất HĐ', invoice_no = '', invoice_date = null,
    invoice_by = null, invoice_by_name = '', invoice_at = null,
    warranty_activated = false, app_activated = false, coc_giao = false,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Hủy xác nhận HĐ '||coalesce(nullif(o.invoice_no,''),'(trống)')||' bởi '||me.name||
      coalesce(nullif(' — lý do: '||p_ly_do,' — lý do: '),''))
  where id = p_id;

  -- Neu don da xac nhan giao COC: hoan ve DA_VE (COC ve kho lai voi xe)
  if coalesce(o.coc_giao, false) then
    update public.vehicle_units set
      coc_status = 'DA_VE', updated_at = now()
    where frame_number = o.frame_number and coc_status = 'DA_GIAO';
  end if;
end $$;

-- ===================== 3) fn_xoa_don: huy don + dong bo COC =====================
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

  -- Hoan xe
  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null,
      -- Dong bo COC: neu da xac nhan giao COC thi hoan ve DA_VE
      coc_status = case when coalesce(o.coc_giao,false) and u.coc_status = 'DA_GIAO' then 'DA_VE'
                        else u.coc_status end,
      updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · KHÔNG hoàn kho', me.uid, me.name);
  end if;

  perform public._hoan_quy_don(o.code, trim(p_ly_do), me.uid, me.name);

  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do), updated_at = now()
  where id = p_id;
end $$;

-- ===================== 4) fn_tra_hang_ban: tra hang + dong bo COC =====================
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
      -- Dong bo COC: khach tra xe, COC ve kho lai
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

  update public.sales_orders set
    status = 'Đã trả hàng',
    returned_at = now(), cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = 'TRẢ HÀNG: '||v_ly || case when v_hoan > 0 then ' · đã hoàn '||v_hoan||'đ' else '' end,
    updated_at = now()
  where id = (p->>'id')::bigint;
end $$;

do $do$
begin
  raise notice 'XONG 063: coc_giao trong xac_nhan HĐ; dong bo COC khi huy xac nhan / huy don / tra hang';
end $do$;
