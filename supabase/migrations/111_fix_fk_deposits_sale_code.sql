-- ============================================================
-- Migration 111: Fix lỗi "insert or update on table deposits
-- violates foreign key constraint deposits_sale_code_fkey" khi bán
-- xe đang giữ cọc.
--
-- Nguyên nhân: trong fn_ban_hang_v2, vehicle_units được UPDATE gán
-- sale_code TRƯỚC khi dòng sales_orders tương ứng được INSERT (cùng
-- 1 transaction) — trigger _trg_deposits_link_sale (migration 095)
-- chạy ngay lúc đó, cố gán deposits.sale_code = mã đơn CHƯA TỒN TẠI.
--
-- Cách sửa AN TOÀN: đổi khóa ngoại deposits_sale_code_fkey thành
-- DEFERRABLE INITIALLY DEFERRED — Postgres sẽ chỉ kiểm tra khóa ngoại
-- này lúc KẾT THÚC giao dịch (COMMIT), lúc đó dòng sales_orders chắc
-- chắn đã tồn tại. KHÔNG cần sửa lại thứ tự các câu lệnh trong
-- fn_ban_hang_v2 đang chạy ổn định.
-- Chạy sau 110c. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.deposits drop constraint if exists deposits_sale_code_fkey;
alter table public.deposits add constraint deposits_sale_code_fkey
  foreign key (sale_code) references public.sales_orders(code)
  deferrable initially deferred;
