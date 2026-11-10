-- 173: Rà soát bảo mật — khóa quyền gọi hàm (10/11/2026)
-- (đã áp dụng trực tiếp qua Supabase MCP; file này là ghi chú)
-- Trước đó 299/333 hàm trong schema public gọi được bằng anon key (chưa đăng nhập), gồm cả hàm nội bộ
-- SECURITY DEFINER không tự kiểm tra quyền như _auto_thu, _auto_chi, _apply_stock_change, _hoan_quy_don, _lo_phan_bo.
--  1) REVOKE EXECUTE ... FROM public, anon trên toàn bộ hàm (app bắt buộc đăng nhập, không trang nào gọi RPC khi chưa đăng nhập).
--  2) REVOKE EXECUTE ... FROM authenticated với hàm nội bộ: tên bắt đầu bằng "_" + SECURITY DEFINER (trừ hàm trigger,
--     _lo_tong và _quy_xem_duoc vì dùng trong view/RLS), và các hàm chỉ dành cho cron / nội bộ:
--     fn_hoan_ton_hang_hoa, fn_xuat_hang_hoa, fn_debt_day_outbox, fn_debt_quet_nhac_no,
--     fn_task_nhac_sap_den_han, fn_task_quet_qua_han, fn_bao_cao_quy_discord.
--     Các hàm này vẫn chạy bình thường khi được gọi từ hàm nghiệp vụ SECURITY DEFINER hoặc pg_cron.
--  3) Hàm fn_ai_* giữ nguyên: chỉ service_role.
--  4) Quyền mặc định cho hàm tạo mới: không cấp cho anon/public; cấp authenticated + service_role.
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
