-- ============================================================
-- Migration 082: Bổ sung "Sửa đơn nhập" / "Hủy đơn nhập" cho
-- module Đơn nhập xe (yêu cầu bổ sung trong màn chi tiết đơn nhập).
-- Chỉ cho hủy/sửa khi TẤT CẢ số khung của đơn vẫn còn TON_KHO
-- (chưa bán / chưa điều chuyển / chưa điều chỉnh) — tránh sai lệch
-- dữ liệu đã phát sinh giao dịch khác.
-- Giới hạn phạm vi: Sửa đơn nhập chỉ cho đổi GIÁ VỐN + GHI CHÚ
-- (không đổi kho/NCC/thêm-bớt số khung để tránh phức tạp hoá tồn kho).
-- LƯU Ý: nếu đơn nhập từng được tạo từ 1 "Đơn đặt hàng nhập" (po_id),
-- hủy đơn nhập KHÔNG tự động trừ lại SL đã nhận trên đơn đặt hàng đó
-- (anh cần vào Đặt hàng nhập sửa SL thủ công nếu có hủy).
-- Chạy sau 081.
-- ============================================================

-- ---------- 1) HỦY ĐƠN NHẬP ----------
create or replace function public.fn_huy_don_nhap(p_doc text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_da_dung int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền hủy đơn nhập'; end if;

  if not exists (select 1 from public.vehicle_units where import_doc = p_doc) then
    raise exception 'KHONG_TIM_THAY: không tìm thấy đơn nhập %', p_doc;
  end if;

  select count(*) into v_da_dung from public.vehicle_units
  where import_doc = p_doc and status <> 'TON_KHO';
  if v_da_dung > 0 then
    raise exception 'KHONG_THE_HUY: có % xe trong đơn đã bán/chuyển/điều chỉnh, không thể hủy đơn', v_da_dung;
  end if;

  delete from public.vehicle_units where import_doc = p_doc;
  delete from public.inventory_txns where doc_code = p_doc and txn_type = 'Nhập hàng';

  perform public._notify_discord(jsonb_build_object('content',
    concat('🗑️ **Đã hủy đơn nhập ', p_doc, '** — bởi ', me.name)));
end $$;

-- ---------- 2) SỬA ĐƠN NHẬP: đổi giá vốn theo từng dòng + ghi chú ----------
create or replace function public.fn_sua_don_nhap(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_doc text; ln jsonb; v_cost bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa đơn nhập'; end if;

  v_doc := p->>'doc';
  if not exists (select 1 from public.vehicle_units where import_doc = v_doc) then
    raise exception 'KHONG_TIM_THAY: không tìm thấy đơn nhập %', v_doc;
  end if;

  for ln in select jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    v_cost := nullif(ln->>'cost_price','')::bigint;
    if v_cost is not null then
      update public.vehicle_units set cost_price = v_cost
      where import_doc = v_doc and vehicle_id = ln->>'vehicle_id';
    end if;
  end loop;

  if coalesce(p->>'note','') <> '' then
    update public.inventory_txns set note = concat(note, ' · [sửa: ', p->>'note', ']')
    where doc_code = v_doc and txn_type = 'Nhập hàng';
  end if;
end $$;
