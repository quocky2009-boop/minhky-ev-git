-- 175: Phân quyền nhập / xuất Excel theo vai trò (12/11/2026) — đã áp dụng qua Supabase MCP; file này là ghi chú
-- Quyền mới trong role_perms (CEO luôn có):
--   excel_xuat_ban_hang, excel_xuat_kho, excel_xuat_tai_chinh, excel_xuat_khac, excel_nhap
-- Mặc định: ADMIN, MANAGER = bật cả 5; SALES, TECHNICIAN = tắt cả 5.
insert into public.role_perms (role, perm, allowed)
select r.role, p.perm, r.role in ('ADMIN','MANAGER')
from (values ('SALES'),('TECHNICIAN'),('MANAGER'),('ADMIN')) r(role),
     (values ('excel_xuat_ban_hang'),('excel_xuat_kho'),('excel_xuat_tai_chinh'),('excel_xuat_khac'),('excel_nhap')) p(perm)
on conflict (role, perm) do nothing;
-- Máy chủ: các hàm nhập hàng loạt từ file kiểm tra thêm fn_co_quyen('excel_nhap'):
--   fn_cv_import, fn_pt_import, fn_hh_import, fn_import_xe, fn_import_pool (2 bản).
-- Giao diện: lib/excelPerm.js + lib/format.js (downloadXLSX/downloadCSV/readTableFile) chặn thao tác; AppShell ẩn nút.
-- Xuất Excel chỉ chặn được ở giao diện (dữ liệu trên màn hình vẫn theo quyền xem của từng trang).
