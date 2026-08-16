-- ============================================================
-- Migration 100: get_daily_business_report — 1 tool duy nhất tổng
-- hợp bức tranh cuối ngày, TÁCH RIÊNG theo từng điểm bán/khu vực:
--   1) Kinh doanh xe (doanh thu, số đơn, số xe)
--   2) Dịch vụ (số phiếu, doanh thu, số quá hạn)
--   3) Tài chính thu-chi (tổng thu, tổng chi trong ngày qua sổ quỹ)
--   4) Công nợ (khách quá hạn tại điểm bán đó)
--   5) Kho — nhập/xuất trong ngày + tồn cuối ngày
--
-- Gộp thành 1 lần gọi để Bot không phải gọi 6-7 tool riêng mỗi tối.
-- Chạy sau 099. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ai_bao_cao_cuoi_ngay(p_ngay date default current_date)
returns table (
  dia_diem text,
  khu_vuc text,
  kinh_doanh_xe jsonb,
  dich_vu jsonb,
  thu_chi jsonb,
  cong_no_qua_han jsonb,
  kho jsonb
)
language sql security definer stable set search_path = public as $$
  select
    l.name,
    l.region,

    -- 1) Kinh doanh xe
    jsonb_build_object(
      'so_don', coalesce((select count(*) from public.sales_orders o
        where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy'), 0),
      'so_xe', coalesce((select sum(o.quantity) from public.sales_orders o
        where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy'), 0),
      'doanh_thu', coalesce((select sum(o.sale_price * o.quantity) from public.sales_orders o
        where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy'), 0)
    ),

    -- 2) Dich vu
    jsonb_build_object(
      'so_phieu', coalesce((select count(*) from public.dv_tickets t
        where t.location_code = l.code and t.created_at::date = p_ngay), 0),
      'doanh_thu', coalesce((select sum(v.tong_tien) from public.v_dv_dashboard v
        where v.location_code = l.code and v.created_at::date = p_ngay), 0),
      'so_qua_han', coalesce((select count(*) from public.v_dv_dashboard v
        where v.location_code = l.code and v.qua_han), 0)
    ),

    -- 3) Thu chi (so quy) trong ngay tai cac tai khoan quy cua diem ban nay
    jsonb_build_object(
      'tong_thu', coalesce((select sum(c.amount) from public.cash_txns c
        join public.cash_accounts a on a.id = c.account_id
        where a.location_code = l.code and c.txn_date = p_ngay and c.direction = 'Thu'), 0),
      'tong_chi', coalesce((select sum(c.amount) from public.cash_txns c
        join public.cash_accounts a on a.id = c.account_id
        where a.location_code = l.code and c.txn_date = p_ngay and c.direction = 'Chi'), 0)
    ),

    -- 4) Cong no qua han cua khach thuoc diem ban nay
    jsonb_build_object(
      'so_khach', coalesce((select count(distinct coalesce(v.customer_id::text, v.customer_phone))
        from public.v_cong_no_phai_thu v where v.location_code = l.code and v.so_ngay_qua_han > 0), 0),
      'tong_no', coalesce((select sum(v.con_no) from public.v_cong_no_phai_thu v
        where v.location_code = l.code and v.so_ngay_qua_han > 0), 0)
    ),

    -- 5) Kho: nhap/xuat trong ngay + ton cuoi ngay
    jsonb_build_object(
      'nhap_trong_ngay', coalesce((select count(*) from public.vehicle_units u
        where u.location_code = l.code and u.imported_at::date = p_ngay and u.status <> 'DA_XOA'), 0),
      'xuat_ban_trong_ngay', coalesce((select count(*) from public.sales_orders o
        where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy'), 0),
      'ton_kha_dung_cuoi_ngay', coalesce((select count(*) from public.vehicle_units u
        where u.location_code = l.code and u.status in ('TON_KHO','DANG_CHUYEN')), 0)
    )
  from public.locations l
  where l.status = 'Hoạt động'
  order by l.region, l.name;
$$;

revoke all on function public.fn_ai_bao_cao_cuoi_ngay(date) from public, anon, authenticated;
grant execute on function public.fn_ai_bao_cao_cuoi_ngay(date) to service_role;
