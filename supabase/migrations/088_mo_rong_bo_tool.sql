-- ============================================================
-- Migration 088: Mở rộng bộ tool AI — Nhóm 1 (bổ trợ tồn kho) +
-- Nhóm 3 (tài chính/nhân sự) + tool đơn bán kèm khách hàng.
--
-- ⚠️ THAY ĐỔI CHÍNH SÁCH: fn_ai_don_ban lộ TÊN + SĐT (che 3 số giữa
-- trừ khi hỏi đích danh, giống fn_ai_cong_no_khach) khách hàng theo
-- yêu cầu trực tiếp của CEO để AI trả lời "đơn này của khách nào".
-- CCCD (customer_cccd) và địa chỉ (customer_address) VẪN ẨN TUYỆT ĐỐI
-- — không có lý do nghiệp vụ nào cần AI đọc 2 trường này.
--
-- fn_ai_lai_gop và fn_ai_kpi_nhan_vien là dữ liệu tài chính/nhân sự
-- nhạy cảm hơn — cân nhắc giới hạn kênh Discord chỉ CEO dùng.
--
-- Cùng nguyên tắc bảo mật như các migration 084/085: SECURITY DEFINER,
-- STABLE, LIMIT cứng, REVOKE khỏi public/anon/authenticated, chỉ
-- GRANT cho service_role.
-- Chạy sau 087. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ==================== 1) get_supplier_debt ====================
-- Tái dùng nguyên view v_cong_no_phai_tra (migration 069)
create or replace function public.fn_ai_cong_no_ncc(
  p_supplier text default null,
  p_qua_han boolean default false,
  p_top_n int default 20
)
returns table (
  ma_phieu text,
  ncc text,
  dia_diem text,
  tong_tien bigint,
  da_tra bigint,
  con_no bigint,
  qua_han boolean,
  han_thanh_toan date
)
language sql security definer stable set search_path = public as $$
  select v.code, v.supplier, v.location_name, v.tong_tien, v.da_tra, v.con_no, v.qua_han, v.due_date
  from public.v_cong_no_phai_tra v
  where (p_supplier is null or v.supplier ilike '%' || p_supplier || '%')
    and (not p_qua_han or v.qua_han)
  order by v.con_no desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

-- ==================== 2) get_purchase_order_status ====================
-- Bảng nguồn: purchase_orders + purchase_order_lines (migration 081)
create or replace function public.fn_ai_don_dat_hang(
  p_status text default null,   -- 'Chưa nhập' | 'Nhập một phần' | 'Hoàn thành' | 'Đã hủy' | null (tat ca)
  p_supplier text default null,
  p_top_n int default 20
)
returns table (
  ma_don text,
  trang_thai text,
  ncc text,
  dia_diem text,
  ngay_tao timestamptz,
  chi_tiet jsonb
)
language sql security definer stable set search_path = public as $$
  select po.code, po.status, po.supplier, l.name, po.created_at,
    (select jsonb_agg(jsonb_build_object(
        'model_xe', v.brand || ' ' || v.name, 'mau', v.color,
        'sl_dat', pl.qty_ordered, 'sl_da_nhan', pl.qty_received))
     from public.purchase_order_lines pl
     join public.vehicles v on v.id = pl.vehicle_id
     where pl.po_id = po.id)
  from public.purchase_orders po
  join public.locations l on l.code = po.location_code
  where (p_status is null or po.status = p_status)
    and (p_supplier is null or po.supplier ilike '%' || p_supplier || '%')
  order by po.created_at desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

-- ==================== 3) get_transfer_status ====================
-- Bảng nguồn: transfer_orders
create or replace function public.fn_ai_dieu_chuyen(
  p_status text default null,   -- 'Nháp' | 'Đang chuyển' | 'Đã nhận' | 'Đã hủy' | 'Lỗi/chênh lệch' | null
  p_top_n int default 20
)
returns table (
  ma_phieu text,
  tu_kho text,
  den_kho text,
  model_xe text,
  so_luong int,
  trang_thai text,
  ngay_tao timestamptz
)
language sql security definer stable set search_path = public as $$
  select t.code, lf.name, lt.name, (v.brand || ' ' || v.name), t.quantity, t.status, t.requested_at
  from public.transfer_orders t
  join public.locations lf on lf.code = t.from_location
  join public.locations lt on lt.code = t.to_location
  join public.vehicles v on v.id = t.vehicle_id
  where (p_status is null or t.status = p_status)
  order by t.requested_at desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

-- ==================== 4) get_gross_margin ====================
-- Tái dùng nguyên view v_lai_gop_don (migration 036) — dữ liệu tài
-- chính nhạy cảm, cân nhắc giới hạn kênh CEO.
create or replace function public.fn_ai_lai_gop(
  p_tu_ngay date,
  p_den_ngay date,
  p_location_code text default null
)
returns table (
  tong_don int,
  tong_doanh_thu bigint,
  tong_gia_von bigint,
  tong_lai_gop bigint,
  ty_le_lai_gop numeric
)
language plpgsql security definer stable set search_path = public as $$
begin
  if p_tu_ngay is null or p_den_ngay is null or p_tu_ngay > p_den_ngay then
    raise exception 'THAM_SO_SAI: khoảng ngày không hợp lệ';
  end if;
  if p_den_ngay - p_tu_ngay > 92 then
    raise exception 'THAM_SO_SAI: khoảng ngày tối đa 92 ngày mỗi lần gọi';
  end if;

  return query
  select count(*)::int, sum(v.doanh_thu)::bigint, sum(v.gia_von)::bigint, sum(v.lai_gop)::bigint,
    round(case when sum(v.doanh_thu) > 0 then sum(v.lai_gop)::numeric / sum(v.doanh_thu) * 100 else 0 end, 1)
  from public.v_lai_gop_don v
  where v.sale_date between p_tu_ngay and p_den_ngay
    and (p_location_code is null or v.location_code = p_location_code);
end $$;

-- ==================== 5) get_employee_kpi ====================
-- Xep hang nhan vien ban theo doanh thu (dung cong thuc khop KPI Bao cao)
create or replace function public.fn_ai_kpi_nhan_vien(
  p_tu_ngay date,
  p_den_ngay date,
  p_top_n int default 10
)
returns table (
  nhan_vien text,
  so_don int,
  so_xe int,
  tong_doanh_thu bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if p_tu_ngay is null or p_den_ngay is null or p_tu_ngay > p_den_ngay then
    raise exception 'THAM_SO_SAI: khoảng ngày không hợp lệ';
  end if;
  if p_den_ngay - p_tu_ngay > 92 then
    raise exception 'THAM_SO_SAI: khoảng ngày tối đa 92 ngày mỗi lần gọi';
  end if;

  return query
  select o.seller_name, count(*)::int, sum(o.quantity)::int, sum(o.sale_price * o.quantity)::bigint
  from public.sales_orders o
  where o.status <> 'Đã hủy' and o.sale_date between p_tu_ngay and p_den_ngay
  group by o.seller_name
  order by sum(o.sale_price * o.quantity) desc
  limit least(coalesce(p_top_n, 10), 50);
end $$;

-- ==================== 6) get_sales_orders_list (kèm thông tin khách hàng) ====================
-- ⚠️ Lộ ten_khach + sdt_che (che 3 so giua tru khi hoi dung SDT).
-- KHONG BAO GIO lo customer_cccd / customer_address.
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
  gia_ban bigint,
  da_thanh_toan bigint,
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
    (v.brand || ' ' || v.name), v.color, o.sale_price * o.quantity, coalesce(o.paid_amount,0),
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

-- ==================== CẤU HÌNH QUYỀN TỐI THIỂU ====================
revoke all on function public.fn_ai_cong_no_ncc(text, boolean, int) from public, anon, authenticated;
grant execute on function public.fn_ai_cong_no_ncc(text, boolean, int) to service_role;

revoke all on function public.fn_ai_don_dat_hang(text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_don_dat_hang(text, text, int) to service_role;

revoke all on function public.fn_ai_dieu_chuyen(text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_dieu_chuyen(text, int) to service_role;

revoke all on function public.fn_ai_lai_gop(date, date, text) from public, anon, authenticated;
grant execute on function public.fn_ai_lai_gop(date, date, text) to service_role;

revoke all on function public.fn_ai_kpi_nhan_vien(date, date, int) from public, anon, authenticated;
grant execute on function public.fn_ai_kpi_nhan_vien(date, date, int) to service_role;

revoke all on function public.fn_ai_don_ban(date, date, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_don_ban(date, date, text, text, text, text, int) to service_role;
