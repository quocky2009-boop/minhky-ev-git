-- ============================================================
-- Migration 068 — QUẢN LÝ CÔNG NỢ PHẢI THU
--  A2: Thêm due_date (hạn thanh toán) vào sales_orders.
--  A3: View v_cong_no_phai_thu — gom công nợ, tính quá hạn, phân nhóm.
-- Chạy SAU 067. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== A2: cột hạn thanh toán =====================
alter table public.sales_orders add column if not exists due_date date;
alter table public.sales_orders add column if not exists debt_note text default '';
-- due_date = null nghia la khong co han cu the (no theo don thong thuong)
-- debt_note = ghi chep cam ket, nhac no

-- ===================== A3: view công nợ phải thu =====================
drop view if exists public.v_cong_no_phai_thu;
create view public.v_cong_no_phai_thu as
select
  o.id, o.code, o.sale_date, o.due_date, o.debt_note,
  o.customer_id, o.customer_name, o.customer_phone, o.customer_type,
  o.location_code, o.seller_id, o.seller_name,
  o.sale_price, o.quantity, o.discount_amount,
  -- Tong don thuc (sau chiet khau + ban kem)
  greatest(
    o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.discount_amount, 0),
    0
  ) as tong_don,
  coalesce(o.paid_amount, 0) as da_tra,
  greatest(
    o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.discount_amount, 0)
    - coalesce(o.paid_amount, 0),
    0
  ) as con_no,
  o.invoice_status, o.vehicle_id, o.frame_number,
  -- So ngay qua han (tinh tu due_date neu co, khong thi tu sale_date + 30 ngay)
  (current_date - coalesce(o.due_date, o.sale_date + interval '30 days')::date)::int as so_ngay_qua_han,
  -- Phan nhom qua han
  case
    when current_date <= coalesce(o.due_date, o.sale_date + interval '30 days')::date
      then 'Chưa đến hạn'
    when (current_date - coalesce(o.due_date, o.sale_date + interval '30 days')::date) between 1 and 7
      then 'Quá hạn 1–7 ngày'
    when (current_date - coalesce(o.due_date, o.sale_date + interval '30 days')::date) between 8 and 30
      then 'Quá hạn 8–30 ngày'
    else 'Quá hạn trên 30 ngày'
  end as nhom_qua_han
from public.sales_orders o
where o.status not in ('Đã hủy', 'Đã trả hàng')
  and greatest(
    o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.discount_amount, 0)
    - coalesce(o.paid_amount, 0),
    0
  ) > 0;

-- RLS cho view (security definer qua function)
grant select on public.v_cong_no_phai_thu to authenticated;

do $do$
begin
  raise notice 'XONG 068: them due_date/debt_note vao sales_orders; tao v_cong_no_phai_thu';
end $do$;
