-- ============================================================
-- Migration: Sửa fn_xac_nhan_hoa_don theo yêu cầu:
--  - Bỏ BẮT BUỘC checklist "Quay/chụp khách nhận xe" (giờ là khuyến
--    nghị, không chặn xác nhận HĐ nếu chưa tích).
--  - XÓA HẲN checklist "Bàn giao hóa đơn VAT" (không còn kiểm tra,
--    không còn lưu giá trị này nữa).
--  - Lưu đầy đủ TOÀN BỘ checklist vào cột checklist_giao_xe (jsonb)
--    thay vì chỉ 3 cột rời rạc (warranty_activated/app_activated/
--    coc_giao) — để trang xem lại đơn có đủ dữ liệu hiển thị mọi mục.
-- Chạy 1 lần, độc lập.
-- ============================================================

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
  if not v_coc then
    raise exception 'CHUA_GIAO_COC: phải xác nhận đã bàn giao giấy COC trước khi hoàn thành đơn';
  end if;
  -- BO: khong con bat buoc anh_khach (chuyen thanh khuyen nghi)
  -- XOA HAN: khong con kiem tra hoa_don_vat nua

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh, app_activated = v_app, coc_giao = v_coc
  where id = o.id;
end $$;

-- Don sach du lieu cu: neu don nao da tung luu 'hoa_don_vat' trong checklist_giao_xe
-- (tu truoc khi xoa han muc nay), go bo cho gon, tranh hien thi soi ra khi doc lai.
update public.sales_orders
set checklist_giao_xe = checklist_giao_xe - 'hoa_don_vat'
where checklist_giao_xe ? 'hoa_don_vat';
