-- ============================================================
-- Migration 083: Phân quyền DỮ LIỆU khách hàng theo Sales / Khu vực
--
-- Yêu cầu: KH do Sales nào tạo thì chỉ Sales đó thấy; Cửa hàng trưởng
-- (MANAGER) thấy KH của các Sales thuộc KHU VỰC mình quản lý.
--
-- Ghi chú thiết kế: hệ thống ĐÃ CÓ sẵn khái niệm khu vực
-- (profiles.region + locations.region, danh sách quản trong Cài đặt →
-- app_settings key 'regions'), và module Công việc đã dùng đúng pattern
-- "MANAGER quản theo region". Vì vậy KHÔNG tạo bảng khu vực mới —
-- tái sử dụng profiles.region để giảm rủi ro.
--
-- Quy tắc sau migration này:
--   CEO / ADMIN                  → xem TẤT CẢ khách hàng
--   MANAGER có region            → xem KH của mọi user cùng region + KH của mình
--   MANAGER không set region     → xem TẤT CẢ (coi như quản toàn hệ thống)
--   SALES / TECHNICIAN / khác    → chỉ xem KH mình tạo hoặc được giao
--
-- Dùng hàm SECURITY DEFINER để policy không phụ thuộc RLS của profiles
-- và để tái dùng cho cả bảng customer_care_logs.
-- Chạy sau 082. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- 1) HÀM KIỂM TRA PHẠM VI XEM KHÁCH HÀNG ----------
create or replace function public.fn_kh_trong_pham_vi(p_assigned uuid, p_created uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case
      -- CEO / ADMIN: toan quyen
      when exists (select 1 from public.profiles p
                   where p.id = auth.uid() and p.role in ('CEO','ADMIN'))
        then true
      -- MANAGER khong set khu vuc: coi nhu quan toan he thong
      when exists (select 1 from public.profiles p
                   where p.id = auth.uid() and p.role = 'MANAGER'
                     and coalesce(p.region,'') = '')
        then true
      -- MANAGER co khu vuc: xem KH cua moi user cung khu vuc
      when exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.role = 'MANAGER' and coalesce(me.region,'') <> ''
          and exists (
            select 1 from public.profiles owner
            where owner.id in (p_assigned, p_created)
              and coalesce(owner.region,'') = me.region
          ))
        then true
      -- Con lai: chi KH cua chinh minh
      else coalesce(p_assigned, p_created) is not null
           and auth.uid() in (p_assigned, p_created)
    end
$$;

-- ---------- 2) ÁP DỤNG CHO BẢNG customers ----------
drop policy if exists "read_customers" on public.customers;
create policy "read_customers" on public.customers for select to authenticated
using ( public.fn_kh_trong_pham_vi(assigned_to, created_by) );

-- ---------- 3) ÁP DỤNG CHO LỊCH SỬ CHĂM SÓC ----------
drop policy if exists "read_care_logs" on public.customer_care_logs;
create policy "read_care_logs" on public.customer_care_logs for select to authenticated
using (
  exists (
    select 1 from public.customers c
    where c.id = customer_care_logs.customer_id
      and public.fn_kh_trong_pham_vi(c.assigned_to, c.created_by)
  )
);
