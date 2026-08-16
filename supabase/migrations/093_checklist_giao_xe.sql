-- ============================================================
-- Migration 093: Sửa checklist giao xe khi xác nhận hóa đơn.
--
-- Bỏ khỏi checklist (không còn hỏi/không còn chặn):
--   Đã thu đủ tiền, Đúng số khung/số máy, Bàn giao phụ kiện/sạc/chìa
--   (chỉ bỏ ở FRONTEND — dữ liệu cũ trong checklist_giao_xe không xóa,
--   chỉ không hiển thị/không validate nữa)
--
-- Chuyển thành BẮT BUỘC (validate cả server-side, không chỉ client):
--   coc_giao (Bàn giao giấy COC) — đã có cột riêng trên sales_orders
--   anh_khach (Quay/chụp khách nhận xe) — lưu trong checklist_giao_xe
--
-- Thêm mới:
--   hoa_don_vat (Bàn giao hóa đơn VAT) — BẮT BUỘC, lưu trong checklist_giao_xe
--   khoe_fb (Khách khoe ảnh lên FB/Zalo) — KHÔNG bắt buộc, lưu trong checklist_giao_xe
--
-- Không cần cột mới: checklist_giao_xe (jsonb, migration 070) đã đủ
-- chỗ chứa các key mới. Tool AI fn_ai_don_ban (migration 091) dùng
-- to_jsonb(o) - blacklist nên TỰ ĐỘNG thấy checklist_giao_xe, không
-- cần sửa gì thêm cho phần AI.
-- Chạy sau 092. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_xac_nhan_hoa_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_brand text; v_bh boolean; v_app boolean; v_coc boolean; v_anh boolean; v_vat boolean;
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
  v_anh := coalesce((p->>'anh_khach')::boolean, false);
  v_vat := coalesce((p->>'hoa_don_vat')::boolean, false);

  if not v_bh then
    raise exception 'CHUA_KICH_HOAT_BAO_HANH: phải kích hoạt bảo hành cho xe trước khi hoàn thành đơn';
  end if;
  if upper(coalesce(v_brand,'')) like '%VINFAST%' and not v_app then
    raise exception 'CHUA_KICH_HOAT_APP: xe VinFast bắt buộc kích hoạt app VF eScooter trước khi hoàn thành đơn';
  end if;
  if not v_coc then
    raise exception 'CHUA_GIAO_COC: phải xác nhận đã bàn giao giấy COC trước khi hoàn thành đơn';
  end if;
  if not v_anh then
    raise exception 'CHUA_CHUP_ANH: phải xác nhận đã quay/chụp ảnh khách nhận xe trước khi hoàn thành đơn';
  end if;
  if not v_vat then
    raise exception 'CHUA_GIAO_HOA_DON: phải xác nhận đã bàn giao hóa đơn VAT trước khi hoàn thành đơn';
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
