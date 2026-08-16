-- ============================================================
-- Migration 089: FIX BUG — "Còn chênh lệch chưa thu đủ" tính sai vì
-- so sánh trực tiếp doanh thu GỘP (chưa trừ chiết khấu) với số đã
-- thanh toán, trong khi số khách THỰC SỰ PHẢI TRẢ = doanh thu gộp
-- − chiết khấu. Khi khách đã trả đủ số sau chiết khấu, bot vẫn báo
-- "còn chênh lệch" = đúng bằng số tiền chiết khấu — SAI, gây hiểu
-- lầm là khách còn nợ trong khi thực tế đã thanh toán đủ.
--
-- Đối chiếu đúng với app: app/(app)/ban-hang/[code]/... hiển thị
-- Khách phải trả = Tổng đơn - Chiết khấu; Còn phải trả = Khách phải
-- trả - Đã thanh toán. RPC bây giờ tính đúng theo logic này.
--
-- Ảnh hưởng: fn_ai_don_ban (thêm chiet_khau, khach_phai_tra, sửa lại
-- con_phai_tra cho đúng), fn_ai_doanh_so (thêm tong_chiet_khau,
-- tong_con_phai_thu — số chênh lệch THẬT), fn_ai_ceo_brief (đồng bộ).
-- fn_ai_lai_gop giữ nguyên (đã đúng, dùng v_lai_gop_don có logic riêng
-- không liên quan bug này).
-- Chạy sau 088. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ==================== fn_ai_don_ban — thêm chiết khấu, sửa còn phải trả ====================
drop function if exists public.fn_ai_don_ban(date, date, text, text, text, text, int);

create or replace function public.fn_ai_don_ban(
  p_tu_ngay date default null,
  p_den_ngay date default null,
  p_customer_phone text default null,
  p_customer_name text default null,
  p_seller_name text default null,
  p_location_code text default null,
  p_top_n int default 20
)
returns table (
  ma_don text,
  ngay_ban date,
  ten_khach text,
  sdt_che text,
  model_xe text,
  mau text,
  tong_gia_tri_don bigint,
  chiet_khau bigint,
  khach_phai_tra bigint,
  da_thanh_toan bigint,
  con_phai_tra bigint,
  trang_thai text,
  nhan_vien_ban text,
  dia_diem text
)
language sql security definer stable set search_path = public as $$
  select o.code, o.sale_date, o.customer_name,
    case
      when p_customer_phone is not null and o.customer_phone = p_customer_phone then o.customer_phone
      else regexp_replace(o.customer_phone, '(\d{3})\d{3}(\d+)', '\1***\2')
    end,
    (v.brand || ' ' || v.name), v.color,
    o.sale_price * o.quantity,
    coalesce(o.discount_amount, 0),
    o.sale_price * o.quantity - coalesce(o.discount_amount, 0),
    coalesce(o.paid_amount, 0),
    greatest(o.sale_price * o.quantity - coalesce(o.discount_amount, 0) - coalesce(o.paid_amount, 0), 0),
    o.status, o.seller_name, l.name
  from public.sales_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.locations l on l.code = o.location_code
  where o.status <> 'Đã hủy'
    and (p_tu_ngay is null or o.sale_date >= p_tu_ngay)
    and (p_den_ngay is null or o.sale_date <= p_den_ngay)
    and (p_customer_phone is null or o.customer_phone = p_customer_phone)
    and (p_customer_name is null or o.customer_name ilike '%' || p_customer_name || '%')
    and (p_seller_name is null or o.seller_name ilike '%' || p_seller_name || '%')
    and (p_location_code is null or o.location_code = p_location_code)
  order by o.sale_date desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

-- ==================== fn_ai_doanh_so — thêm chiết khấu + chênh lệch thật ====================
drop function if exists public.fn_ai_doanh_so(date, date, text, text);

create or replace function public.fn_ai_doanh_so(
  p_tu_ngay date,
  p_den_ngay date,
  p_location_code text default null,
  p_nhom_theo text default 'ngay'
)
returns table (
  nhom text,
  so_don int,
  tong_doanh_thu bigint,
  tong_chiet_khau bigint,
  tong_khach_phai_tra bigint,
  tong_da_thu bigint,
  tong_con_phai_thu bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if p_nhom_theo not in ('ngay','nguoi_ban','dia_diem') then
    raise exception 'THAM_SO_SAI: nhom_theo chỉ nhận ngay/nguoi_ban/dia_diem';
  end if;
  if p_tu_ngay is null or p_den_ngay is null or p_tu_ngay > p_den_ngay then
    raise exception 'THAM_SO_SAI: khoảng ngày không hợp lệ';
  end if;
  if p_den_ngay - p_tu_ngay > 92 then
    raise exception 'THAM_SO_SAI: khoảng ngày tối đa 92 ngày mỗi lần gọi';
  end if;

  return query
  select
    case p_nhom_theo
      when 'ngay' then o.sale_date::text
      when 'nguoi_ban' then o.seller_name
      else l.name
    end,
    count(distinct o.id)::int,
    sum(o.sale_price * o.quantity)::bigint,
    sum(coalesce(o.discount_amount, 0))::bigint,
    sum(o.sale_price * o.quantity - coalesce(o.discount_amount, 0))::bigint,
    sum(coalesce(o.paid_amount, 0))::bigint,
    sum(greatest(o.sale_price * o.quantity - coalesce(o.discount_amount, 0) - coalesce(o.paid_amount, 0), 0))::bigint
  from public.sales_orders o
  join public.locations l on l.code = o.location_code
  where o.status <> 'Đã hủy'
    and o.sale_date between p_tu_ngay and p_den_ngay
    and (p_location_code is null or o.location_code = p_location_code)
  group by
    case p_nhom_theo
      when 'ngay' then o.sale_date::text
      when 'nguoi_ban' then o.seller_name
      else l.name
    end
  order by 3 desc
  limit 200;
end $$;

-- ==================== fn_ai_ceo_brief — đồng bộ công thức ====================
create or replace function public.fn_ai_ceo_brief(p_ngay date default current_date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_doanh_so record; v_cong_no record; v_task record; v_quy jsonb;
begin
  select count(distinct o.id) as so_don,
    sum(o.sale_price * o.quantity) as tong_doanh_thu,
    sum(o.sale_price * o.quantity - coalesce(o.discount_amount, 0) - coalesce(o.paid_amount, 0)) as tong_con_phai_thu
  into v_doanh_so
  from public.sales_orders o
  where o.status <> 'Đã hủy' and o.sale_date = p_ngay;

  select count(distinct coalesce(customer_id::text, customer_phone)) as so_khach,
    sum(con_no) as tong_no
  into v_cong_no
  from public.v_cong_no_phai_thu
  where so_ngay_qua_han > 0;

  select qua_han, sap_den_han into v_task from public.v_task_dashboard;

  select jsonb_agg(jsonb_build_object('ten_tai_khoan', name, 'so_du', so_du))
  into v_quy
  from public.v_quy_so_du where status = 'Hoạt động';

  return jsonb_build_object(
    'ngay', p_ngay,
    'doanh_so', jsonb_build_object(
      'so_don', coalesce(v_doanh_so.so_don,0),
      'tong_doanh_thu', coalesce(v_doanh_so.tong_doanh_thu,0),
      'tong_con_phai_thu_trong_ngay', greatest(coalesce(v_doanh_so.tong_con_phai_thu,0), 0)
    ),
    'cong_no_qua_han', jsonb_build_object('so_khach', coalesce(v_cong_no.so_khach,0), 'tong_no', coalesce(v_cong_no.tong_no,0)),
    'quy_hien_tai', coalesce(v_quy, '[]'::jsonb),
    'cong_viec_qua_han', coalesce(v_task.qua_han, 0),
    'cong_viec_sap_den_han', coalesce(v_task.sap_den_han, 0)
  );
end $$;

-- ==================== CẤP LẠI QUYỀN (DROP FUNCTION đã xóa mất GRANT cũ) ====================
revoke all on function public.fn_ai_don_ban(date, date, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_don_ban(date, date, text, text, text, text, int) to service_role;

revoke all on function public.fn_ai_doanh_so(date, date, text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_doanh_so(date, date, text, text) to service_role;
