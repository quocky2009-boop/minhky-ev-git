-- 169: VAT dịch vụ + Kho phụ tùng (vị trí, điều chỉnh tồn, báo cáo XNT) + import Hàng hóa
-- (đã áp dụng trực tiếp qua Supabase MCP ngày 05/11/2026; file này là ghi chú mô tả)
--
-- 1) VAT giá bán dịch vụ
--    - dv_services.vat_pct, parts.vat_pct: % VAT riêng của từng công việc / phụ tùng (null = dùng mức mặc định)
--    - app_settings: vat_cong_viec_pct, vat_phu_tung_pct (mặc định 8) — sửa ở Cài đặt
--    - repair_order_lines: vat_pct, tien_vat, thanh_tien_vat (dòng cũ: vat 0, thanh_tien_vat = thanh_tien)
--    - _vat_mac_dinh(loai): đọc mức mặc định theo loại dòng
--    - fn_lsc_luu_dong: vat = vat_pct client gửi (dòng cũ giữ nguyên) > vat danh mục > mặc định;
--      tien_vat = round(thanh_tien × vat / 100); thanh_tien_vat = thanh_tien + tien_vat
--      Giá trong danh mục được hiểu là giá CHƯA VAT.
--    - _lsc_tinh_tong: cộng coalesce(thanh_tien_vat, thanh_tien) → tổng khách trả đã gồm VAT
--    - fn_cv_luu, fn_cv_import, fn_pt_luu_part, fn_pt_import: nhận thêm vat_pct
--
-- 2) Kho phụ tùng
--    - parts_stock.vi_tri: vị trí lưu trữ theo từng kho; fn_pt_luu_vi_tri(p {part_id, location_code, vi_tri})
--    - pt_txns.txn_type thêm 'DIEU_CHINH'
--    - pt_dieu_chinh (ADJ-yyyymmdd-nnnn, kho, phương thức THU_CONG/FILE, tổng/thành công/lỗi, trạng thái)
--      pt_dieu_chinh_dong (từng dòng: tồn trước, tồn mới, chênh lệch, kết quả, lỗi)
--    - fn_pt_dieu_chinh(p {location_code, phuong_thuc, file_name, note, lines:[{ma|part_id, qty_moi, vi_tri, ly_do}]})
--      quyền pt_kiem_ke; mỗi dòng đặt lại tồn thực tế; dòng lỗi (sai mã, số âm/lẻ, PT theo serial) được ghi lại,
--      không làm hỏng các dòng khác.
--    - fn_pt_xnt(p_from, p_to, p_locs): báo cáo xuất nhập tồn theo kỳ
--      tồn cuối = tồn hiện tại − phát sinh sau kỳ; tồn đầu = tồn cuối − nhập + xuất trong kỳ
--
-- 3) Danh mục > Hàng hóa
--    - fn_hh_import(p {rows:[{code,name,group_name,unit,cost_price,sale_price,min_qty,barcode,note,location_code,qty}]})
--      quyền sua_danh_muc; thêm mới/cập nhật theo mã; qty > 0 = nhập tồn đầu kỳ vào products_stock + product_txns (phiếu PNHH)

alter table public.dv_services add column if not exists vat_pct numeric(5,2) check (vat_pct is null or (vat_pct >= 0 and vat_pct <= 100));
alter table public.parts add column if not exists vat_pct numeric(5,2) check (vat_pct is null or (vat_pct >= 0 and vat_pct <= 100));
alter table public.repair_order_lines add column if not exists vat_pct numeric(5,2) not null default 0;
alter table public.repair_order_lines add column if not exists tien_vat bigint not null default 0;
alter table public.repair_order_lines add column if not exists thanh_tien_vat bigint;
update public.repair_order_lines set thanh_tien_vat = thanh_tien where thanh_tien_vat is null;
insert into public.app_settings (key, value) values ('vat_cong_viec_pct', '8'), ('vat_phu_tung_pct', '8') on conflict (key) do nothing;

alter table public.parts_stock add column if not exists vi_tri text not null default '';
-- pt_txns_txn_type_check: thêm 'DIEU_CHINH'
-- bảng pt_dieu_chinh, pt_dieu_chinh_dong (RLS: authenticated chỉ đọc; ghi qua RPC)
-- Các hàm: _vat_mac_dinh, _lsc_tinh_tong, fn_lsc_luu_dong, fn_cv_luu, fn_cv_import, fn_pt_luu_part, fn_pt_import,
--          fn_pt_dieu_chinh, fn_pt_luu_vi_tri, fn_pt_xnt, fn_hh_import (định nghĩa đầy đủ trong database)
