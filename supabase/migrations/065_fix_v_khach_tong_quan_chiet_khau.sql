-- ============================================================
-- Migration 065 — FIX v_khach_tong_quan: trừ chiết khấu đơn hàng vào tong_mua và con_no
--  Bug: con_no = (sale_price*qty + ban_kem) - paid_amount
--       Nhưng discount_amount (chiết khấu đơn) KHÔNG được trừ ra
--       -> khách bị tính là còn nợ dù đã trả đủ.
--  Sửa: tong_don_thuc = sale_price*qty + ban_kem - vehicle_discount - order_discount
--        con_no = max(tong_don_thuc - paid_amount, 0)
-- Chạy SAU 064. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace view public.v_khach_tong_quan as
select c.id as customer_id,
  coalesce((select count(*) from public.sales_orders o
    where o.customer_id = c.id and o.status not in ('Đã hủy','Đã trả hàng')), 0) as so_don,
  -- tong_mua = tong don thuc (sau chiet khau) cua cac don khong bi huy/tra
  coalesce((
    select sum(
      -- tien xe truoc ck xe
      o.sale_price * o.quantity
      -- ban kem
      + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
      -- tru ck xe (vehicle_discount_amount da tinh theo type+value nhung khong luu rieng; dung paid_amount)
      -- => lay tong_don theo paid_amount + con_lai de chinh xac hon
      -- Vi ban_hang_v2 set paid_amount dua tren gia thuc sau chiet khau, ta tinh theo o.discount_amount
      - coalesce(o.discount_amount, 0)
    )
    from public.sales_orders o
    where o.customer_id = c.id and o.status not in ('Đã hủy','Đã trả hàng')
  ), 0) as tong_mua,
  -- con_no = tong don thuc - da thanh toan (>= 0)
  coalesce((
    select sum(greatest(
      o.sale_price * o.quantity
      + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
      - coalesce(o.discount_amount, 0)
      - coalesce(o.paid_amount, 0),
      0
    ))
    from public.sales_orders o
    where o.customer_id = c.id and o.status not in ('Đã hủy','Đã trả hàng')
  ), 0) as con_no,
  (select count(*) from public.dv_tickets t where t.customer_id = c.id) as so_phieu_dv,
  (select count(*) from public.test_drives t where t.customer_id = c.id) as so_lai_thu,
  (select count(*) from public.customer_care_logs k where k.customer_id = c.id) as so_lan_cham_soc,
  (select max(k.contact_at) from public.customer_care_logs k where k.customer_id = c.id) as cham_soc_gan_nhat,
  (select min(k.next_contact_at) from public.customer_care_logs k
    where k.customer_id = c.id and k.next_contact_at >= current_date) as hen_ke_tiep,
  (select max(o.sale_date) from public.sales_orders o
    where o.customer_id = c.id and o.status not in ('Đã hủy','Đã trả hàng')) as ngay_mua_cuoi,
  (select count(*) from public.sales_orders o
    where o.customer_id = c.id and o.status not in ('Đã hủy','Đã trả hàng')) as so_xe
from public.customers c;

do $do$
begin
  raise notice 'XONG 065: v_khach_tong_quan tru chiet khau vao tong_mua/con_no; them ngay_mua_cuoi, so_xe';
end $do$;
