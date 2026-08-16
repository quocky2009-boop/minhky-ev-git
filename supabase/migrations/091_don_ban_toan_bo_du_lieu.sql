-- ============================================================
-- Migration 091: Viết lại fn_ai_don_ban để trả TOÀN BỘ cột của
-- sales_orders (dùng to_jsonb(o) - danh_sach_cam) thay vì liệt kê
-- từng cột cố định. Từ nay khi anh thêm cột mới vào sales_orders
-- (VD: thêm 1 loại thông tin mới), Bot AI TỰ ĐỘNG thấy được, KHÔNG
-- cần sửa lại RPC này nữa — trừ khi cột mới đó là dữ liệu nhạy cảm
-- cần thêm vào danh sách cấm bên dưới.
--
-- Sửa đúng lỗi anh Kỳ báo: thiếu customer_type ("Loại khách hàng":
-- Khách lẻ/Khách buôn/Khách CBNV...) — cột này đã có sẵn trên
-- sales_orders (migration 001 dòng 84), chỉ là RPC cũ quên select.
--
-- DANH SÁCH CẤM (không bao giờ lộ qua Bot dù có thêm cột mới trùng
-- tên): customer_cccd, customer_address, end_customer_address,
-- customer_phone (thay bằng sdt_che đã che số).
--
-- Thêm tham số lọc mới: p_customer_type (VD: "Khách CBNV").
-- Chạy sau 090. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

drop function if exists public.fn_ai_don_ban(date, date, text, text, text, text, int);

create or replace function public.fn_ai_don_ban(
  p_tu_ngay date default null,
  p_den_ngay date default null,
  p_customer_phone text default null,
  p_customer_name text default null,
  p_customer_type text default null,   -- MỚI: lọc theo "Loại khách hàng" (Khách lẻ/Khách buôn/Khách CBNV...)
  p_seller_name text default null,
  p_location_code text default null,
  p_top_n int default 20
)
returns setof jsonb
language sql security definer stable set search_path = public as $$
  select
    (to_jsonb(o) - array['customer_cccd','customer_address','end_customer_address','customer_phone'])
    || jsonb_build_object(
        'sdt_che', case
          when p_customer_phone is not null and o.customer_phone = p_customer_phone then o.customer_phone
          else regexp_replace(o.customer_phone, '(\d{3})\d{3}(\d+)', '\1***\2')
        end,
        'model_xe', v.brand || ' ' || v.name,
        'mau', v.color,
        'dia_diem_ten', l.name,
        'chiet_khau', coalesce(o.discount_amount, 0),
        'khach_phai_tra', o.sale_price * o.quantity - coalesce(o.discount_amount, 0),
        'da_thanh_toan', coalesce(o.paid_amount, 0),
        'con_phai_tra', greatest(o.sale_price * o.quantity - coalesce(o.discount_amount, 0) - coalesce(o.paid_amount, 0), 0)
      )
  from public.sales_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.locations l on l.code = o.location_code
  where o.status <> 'Đã hủy'
    and (p_tu_ngay is null or o.sale_date >= p_tu_ngay)
    and (p_den_ngay is null or o.sale_date <= p_den_ngay)
    and (p_customer_phone is null or o.customer_phone = p_customer_phone)
    and (p_customer_name is null or o.customer_name ilike '%' || p_customer_name || '%')
    and (p_customer_type is null or o.customer_type = p_customer_type)
    and (p_seller_name is null or o.seller_name ilike '%' || p_seller_name || '%')
    and (p_location_code is null or o.location_code = p_location_code)
  order by o.sale_date desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

revoke all on function public.fn_ai_don_ban(date, date, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_don_ban(date, date, text, text, text, text, text, int) to service_role;
