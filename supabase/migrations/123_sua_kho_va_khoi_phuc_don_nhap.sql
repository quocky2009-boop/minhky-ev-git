-- ============================================================
-- Migration: 2 tính năng bổ sung cho Nhập hàng —
--  A) fn_sua_kho_don_nhap: sửa lại KHO NHẬP cho đơn đang hoạt động
--     (chưa hủy) — chỉ cho phép khi TOÀN BỘ xe trong đơn vẫn nguyên
--     trạng thái TON_KHO (chưa bán/chuyển/điều chỉnh). Áp dụng cho
--     cả MANAGER (Cửa hàng trưởng), không chỉ CEO/ADMIN.
--  B) fn_khoi_phuc_don_nhap_huy: khôi phục đơn ĐÃ HỦY (nhưng CHƯA
--     "Xóa hẳn") về lại TON_KHO — an toàn vì dòng dữ liệu vẫn còn
--     nguyên (chỉ đổi status), không xung đột khóa chính số khung.
-- Chạy 1 lần, độc lập.
-- ============================================================

create or replace function public.fn_sua_kho_don_nhap(p_doc text, p_location_code text)
returns int language plpgsql security definer set search_path = public as $$
declare me record; v_khac_trang_thai int; v_n int; v_kho_cu text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_kho_nhap') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa kho nhập';
  end if;
  if coalesce(nullif(p_location_code,''),'') = '' then
    raise exception 'THIEU_THONG_TIN: chọn kho mới';
  end if;
  if not exists (select 1 from public.locations where code = p_location_code) then
    raise exception 'KHO_KHONG_CO: kho đã chọn không tồn tại';
  end if;

  if not exists (select 1 from public.vehicle_units where import_doc = p_doc) then
    raise exception 'KHONG_TIM_THAY: không tìm thấy đơn nhập %', p_doc;
  end if;

  select count(*) into v_khac_trang_thai from public.vehicle_units
  where import_doc = p_doc and status <> 'TON_KHO';
  if v_khac_trang_thai > 0 then
    raise exception 'KHONG_THE_SUA: có % xe trong đơn không còn ở trạng thái Tồn kho (đã bán/chuyển/hủy) — chỉ sửa kho được khi TOÀN BỘ xe còn nguyên tồn kho', v_khac_trang_thai;
  end if;

  select location_code into v_kho_cu from public.vehicle_units where import_doc = p_doc limit 1;
  if v_kho_cu = p_location_code then
    raise exception 'KHO_TRUNG: kho mới trùng với kho hiện tại, không có gì để sửa';
  end if;

  update public.vehicle_units set location_code = p_location_code, updated_at = now()
  where import_doc = p_doc;
  get diagnostics v_n = row_count;

  update public.inventory_txns set
    note = concat(note, ' · [SỬA KHO: từ ', v_kho_cu, ' → ', p_location_code, ' bởi ', me.name, ' lúc ', to_char(now(),'DD/MM/YYYY HH24:MI'), ']')
  where doc_code = p_doc and txn_type = 'Nhập hàng';

  perform public._notify_discord(jsonb_build_object('content',
    concat('📦 **Sửa kho nhập** đơn ', p_doc, ' — ', v_n, ' xe chuyển từ kho ', v_kho_cu, ' → ', p_location_code, ' · ', me.name)));

  return v_n;
end $$;

create or replace function public.fn_khoi_phuc_don_nhap_huy(p_doc text)
returns int language plpgsql security definer set search_path = public as $$
declare me record; v_n int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_kho_nhap') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền khôi phục đơn nhập';
  end if;

  if not exists (select 1 from public.vehicle_units where import_doc = p_doc) then
    raise exception 'KHONG_TIM_THAY: không tìm thấy đơn nhập %', p_doc;
  end if;
  if not exists (select 1 from public.vehicle_units where import_doc = p_doc and status = 'DA_XOA') then
    raise exception 'CHUA_HUY: đơn này chưa ở trạng thái đã hủy, không cần khôi phục';
  end if;

  update public.vehicle_units set
    status = 'TON_KHO', removed_reason = null, updated_at = now()
  where import_doc = p_doc and status = 'DA_XOA';
  get diagnostics v_n = row_count;

  update public.inventory_txns set
    note = concat(note, ' · [ĐÃ KHÔI PHỤC bởi ', me.name, ' lúc ', to_char(now(),'DD/MM/YYYY HH24:MI'), ']')
  where doc_code = p_doc and txn_type = 'Nhập hàng';

  perform public._notify_discord(jsonb_build_object('content',
    concat('↩️ **Khôi phục đơn nhập đã hủy** ', p_doc, ' — ', v_n, ' xe trở lại Tồn kho · ', me.name)));

  return v_n;
end $$;
