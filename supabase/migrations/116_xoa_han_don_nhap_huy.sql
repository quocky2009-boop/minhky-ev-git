-- ============================================================
-- Migration: Xóa hẳn (hard-delete) các số khung DA_XOA của 1 đơn
-- nhập ĐÃ HỦY — thay thế thao tác chạy SQL tay bằng nút bấm trên UI.
--
-- AN TOÀN: chỉ cho phép xóa khi TẤT CẢ số khung của đơn đó đang ở
-- trạng thái DA_XOA (tức đơn đã được Hủy đúng quy trình trước đó) —
-- không cho xóa đơn còn xe đang TON_KHO/DA_BAN/DANG_CHUYEN/GIU_CHO,
-- tránh xóa nhầm dữ liệu đang hoạt động. Chỉ CEO/ADMIN được thực hiện
-- vì đây là hành động KHÔNG THỂ HOÀN TÁC.
-- Chạy 1 lần, không phụ thuộc migration nào khác trong phiên gần đây.
-- ============================================================

create or replace function public.fn_xoa_han_don_nhap_huy(p_doc text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_tong int; v_chua_huy int; v_so_xoa int; v_so_log int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được xóa hẳn đơn nhập (hành động không thể hoàn tác)';
  end if;

  select count(*) into v_tong from public.vehicle_units where import_doc = p_doc;
  if v_tong = 0 then raise exception 'KHONG_TIM_THAY: không có số khung nào thuộc đơn %', p_doc; end if;

  select count(*) into v_chua_huy from public.vehicle_units
  where import_doc = p_doc and status <> 'DA_XOA';
  if v_chua_huy > 0 then
    raise exception 'CHUA_HUY_HET: đơn % còn % xe CHƯA ở trạng thái đã hủy (đang tồn kho/đã bán/đang chuyển) — chỉ xóa hẳn được đơn đã Hủy đơn nhập trọn vẹn trước đó', p_doc, v_chua_huy;
  end if;

  delete from public.inventory_txns where doc_code = p_doc;
  get diagnostics v_so_log = row_count;

  delete from public.vehicle_units where import_doc = p_doc;
  get diagnostics v_so_xoa = row_count;

  perform public._notify_discord(jsonb_build_object('content',
    concat('🗑️ **XÓA HẲN đơn nhập đã hủy** ', p_doc, ' — ', v_so_xoa, ' số khung + ', v_so_log,
      ' dòng lịch sử bị xóa vĩnh viễn khỏi database — bởi ', me.name)));

  return jsonb_build_object('so_xe_xoa', v_so_xoa, 'so_dong_log_xoa', v_so_log);
end $$;

revoke all on function public.fn_xoa_han_don_nhap_huy(text) from public, anon, authenticated;
grant execute on function public.fn_xoa_han_don_nhap_huy(text) to authenticated;
