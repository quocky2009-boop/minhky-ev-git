-- ============================================================
-- Migration 085: 5 RPC CHỈ ĐỌC còn lại cho Bot AI "Minh Trí"
-- get_product_stock, get_parts_stock, get_sales_summary,
-- get_customer_debt, get_daily_ceo_brief
--
-- Cùng nguyên tắc bảo mật như migration 084 (fn_ai_ton_xe):
--   - SECURITY DEFINER, STABLE, LIMIT cứng
--   - REVOKE khỏi public/anon/authenticated, chỉ GRANT cho service_role
--   - Không nhận SQL tự do, tham số whitelist cố định
-- Chạy sau 084. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ==================== 1) get_product_stock ====================
-- Bảng nguồn: products (KHÔNG tách tồn theo kho — đã xác nhận Giai đoạn 1)
create or replace function public.fn_ai_ton_hang_hoa(
  p_name text default null,
  p_duoi_dinh_muc boolean default false
)
returns table (
  ten text,
  don_vi text,
  ton int,
  muc_toi_thieu int,
  canh_bao boolean
)
language sql security definer stable set search_path = public as $$
  select p.name, p.unit, p.stock_qty, p.min_qty, (p.stock_qty < p.min_qty)
  from public.products p
  where p.status = 'Hoạt động'
    and (p_name is null or p.name ilike '%' || p_name || '%')
    and (not p_duoi_dinh_muc or p.stock_qty < p.min_qty)
  order by p.stock_qty asc
  limit 200;
$$;

-- ==================== 2) get_parts_stock ====================
-- Bảng nguồn: parts + parts_stock (tách theo kho); part_units khi track_serial=true
create or replace function public.fn_ai_ton_phu_tung(
  p_location_code text default null,
  p_name text default null
)
returns table (
  ten_phu_tung text,
  dia_diem text,
  ton int,
  don_vi text,
  theo_serial boolean
)
language sql security definer stable set search_path = public as $$
  select pt.name, l.name, ps.qty, pt.unit, pt.track_serial
  from public.parts_stock ps
  join public.parts pt on pt.id = ps.part_id
  join public.locations l on l.code = ps.location_code
  where pt.status = 'Hoạt động'
    and (p_location_code is null or l.code = p_location_code)
    and (p_name is null or pt.name ilike '%' || p_name || '%')
  order by ps.qty asc
  limit 200;
$$;

-- ==================== 3) get_sales_summary ====================
-- Bảng nguồn: sales_orders + sale_items (loại đơn Đã hủy)
-- Giới hạn khoảng ngày <= 92 ngày để tránh quét toàn bộ lịch sử.
create or replace function public.fn_ai_doanh_so(
  p_tu_ngay date,
  p_den_ngay date,
  p_location_code text default null,
  p_nhom_theo text default 'ngay'   -- 'ngay' | 'nguoi_ban' | 'dia_diem'
)
returns table (
  nhom text,
  so_don int,
  tong_doanh_thu bigint,
  tong_da_thu bigint
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
    sum(greatest(
      o.sale_price * o.quantity
      + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
      - coalesce(o.discount_amount, 0), 0))::bigint,
    sum(coalesce(o.paid_amount, 0))::bigint
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

-- ==================== 4) get_customer_debt ====================
-- Tái dùng nguyên view v_cong_no_phai_thu (migration 068) — không tự chế công thức.
-- SĐT che 3 số giữa trừ khi hỏi đích danh đúng SĐT đầy đủ.
create or replace function public.fn_ai_cong_no_khach(
  p_customer_phone text default null,
  p_qua_han_ngay int default null,
  p_top_n int default 20
)
returns table (
  ten_khach text,
  sdt_che text,
  tong_no bigint,
  tuoi_no_ngay int,
  don_cu_nhat date
)
language sql security definer stable set search_path = public as $$
  select
    max(v.customer_name),
    case
      when p_customer_phone is not null and max(v.customer_phone) = p_customer_phone then max(v.customer_phone)
      else regexp_replace(max(v.customer_phone), '(\d{3})\d{3}(\d+)', '\1***\2')
    end,
    sum(v.con_no)::bigint,
    max(v.so_ngay_qua_han),
    min(v.sale_date)
  from public.v_cong_no_phai_thu v
  where (p_customer_phone is null or v.customer_phone = p_customer_phone)
    and (p_qua_han_ngay is null or v.so_ngay_qua_han >= p_qua_han_ngay)
  group by coalesce(v.customer_id::text, v.customer_phone)
  order by sum(v.con_no) desc
  limit least(coalesce(p_top_n, 20), 100);
$$;

-- ==================== 5) get_daily_ceo_brief ====================
-- Gộp tóm tắt từ các view/bảng đã có sẵn — không tự chế công thức mới.
create or replace function public.fn_ai_ceo_brief(p_ngay date default current_date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_doanh_so record; v_cong_no record; v_task record; v_quy jsonb;
begin
  select count(distinct o.id) as so_don,
    sum(greatest(
      o.sale_price * o.quantity
      + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
      - coalesce(o.discount_amount, 0), 0)) as tong_doanh_thu
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
    'doanh_so' , jsonb_build_object('so_don', coalesce(v_doanh_so.so_don,0), 'tong_doanh_thu', coalesce(v_doanh_so.tong_doanh_thu,0)),
    'cong_no_qua_han', jsonb_build_object('so_khach', coalesce(v_cong_no.so_khach,0), 'tong_no', coalesce(v_cong_no.tong_no,0)),
    'quy_hien_tai', coalesce(v_quy, '[]'::jsonb),
    'cong_viec_qua_han', coalesce(v_task.qua_han, 0),
    'cong_viec_sap_den_han', coalesce(v_task.sap_den_han, 0)
  );
end $$;

-- ==================== CẤU HÌNH QUYỀN TỐI THIỂU CHO CẢ 5 HÀM ====================
revoke all on function public.fn_ai_ton_hang_hoa(text, boolean) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_hang_hoa(text, boolean) to service_role;

revoke all on function public.fn_ai_ton_phu_tung(text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_phu_tung(text, text) to service_role;

revoke all on function public.fn_ai_doanh_so(date, date, text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_doanh_so(date, date, text, text) to service_role;

revoke all on function public.fn_ai_cong_no_khach(text, int, int) from public, anon, authenticated;
grant execute on function public.fn_ai_cong_no_khach(text, int, int) to service_role;

revoke all on function public.fn_ai_ceo_brief(date) from public, anon, authenticated;
grant execute on function public.fn_ai_ceo_brief(date) to service_role;
