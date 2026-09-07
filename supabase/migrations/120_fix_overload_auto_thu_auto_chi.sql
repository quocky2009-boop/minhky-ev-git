-- ============================================================
-- Migration KHẨN CẤP: Fix lỗi "function public._auto_thu(...) does
-- not exist" khi tạo đơn bán.
--
-- NGUYÊN NHÂN: migration 110b/113b thêm tham số MỚI (p_account_id)
-- vào _auto_thu — vì THÊM tham số mới (không sửa tham số cũ), Postgres
-- coi đây là 1 HÀM KHÁC (chữ ký khác số lượng tham số), nên
-- "CREATE OR REPLACE" KHÔNG ghi đè bản cũ (9 tham số, từ migration
-- 038) mà tạo thêm bản mới (10 tham số) TỒN TẠI SONG SONG. Khi gọi
-- hàm với 1 tham số truyền NULL chưa ép kiểu rõ ràng, Postgres không
-- phân giải được nên báo "does not exist" dù bản đúng vẫn có ở đó.
--
-- CÁCH SỬA: xóa tường minh bản CŨ (9 tham số) để chỉ còn đúng 1 bản
-- (10 tham số) — không còn nhập nhằng overload nữa.
-- Chạy ngay lập tức, độc lập, không phụ thuộc migration nào khác.
-- ============================================================

drop function if exists public._auto_thu(text, text, bigint, text, text, text, text, uuid, text);
drop function if exists public._auto_chi(text, text, bigint, text, text, text, text, uuid, text);

-- Ra soat them: 2 ham khac cung mac loi giong het (them tham so moi
-- thay vi sua tham so cu, tao overload thua) — xoa ban CU cua ca 2:
drop function if exists public.fn_huy_coc(bigint, text);
drop function if exists public.fn_dao_nguoc_khoan_thu(bigint, text, text, bigint, text, bigint);

-- Xac nhan chi con dung 1 ban duy nhat cho moi ham (chay thu de kiem tra sau khi migration xong):
-- select oid::regprocedure from pg_proc where proname in ('_auto_thu','_auto_chi','fn_huy_coc','fn_dao_nguoc_khoan_thu');
-- Ky vong: dung 1 dong cho moi ten ham.

-- ============================================================
-- Bo sung: bat buoc Ma don DMS khi Xac nhan HD (truoc day chi la
-- "dien khi giao xe neu co", gio bat buoc giong So hoa don).
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
  if coalesce(trim(p->>'dms_code'),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập Mã đơn DMS khi xác nhận';
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

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh, app_activated = v_app, coc_giao = v_coc,
    dms_code = trim(p->>'dms_code')
  where id = o.id;
end $$;
