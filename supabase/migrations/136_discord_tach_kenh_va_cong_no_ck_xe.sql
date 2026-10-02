-- =====================================================================
-- 136_discord_tach_kenh_va_cong_no_ck_xe.sql  (da ap dung len DB qua MCP)
-- 1) Tach 2 kenh Discord: discord_webhook = kenh TON KHO (xuat/nhap/ton),
--    discord_webhook_don_ban = kenh DON BAN (tao/sua/huy/hoan/khach le cuoi).
-- 2) Sua don chi doi thong tin (cung so khung): KHONG con ban tin ton kho
--    "Huy don ban +1 / Ban hang -1". Chi bao khi xe THUC SU doi
--    (deferred trigger gop cap hoan/ban cung xe trong 1 giao dich).
-- 3) Cong no sai: v_khach_tong_quan, v_cong_no_don, v_cong_no_phai_thu,
--    v_don_ban_tong khong tru chiet khau xe (vehicle_discount_*) -> don co CK
--    bi tinh la con no. Them _tong_don(o) = cong thuc tong don cua giao dien
--    (gia*sl - CK xe + ban kem - CK tong don) va dung cho 4 view.
--    v_khach_tong_quan.con_no tinh theo TONG khach (sum(tong don - da tra)),
--    de don buon nhieu xe (thanh toan ghi tren don dau) khong bi bao con no.
-- 4) Tin chi tiet don: "Da coc truoc" gom ca cac khoan thanh toan ghi chu "Dat coc...".
-- 5) Bo tin text cu "Bo sung khach le cuoi" gui vao kenh ton kho (da co tin chi tiet o kenh don ban).
-- Noi dung ham/view: xem lich su ap dung (pg_get_functiondef) — file nay ghi lai y dinh.
-- =====================================================================
-- Ham/trigger moi:
--   public._trg_txn_discord()            -- bo qua ghi chu 'Sua don: hoan xe/ban xe %'
--   public._trg_txn_sua_don_discord()    -- constraint trigger deferred trg_txn_sua_don_discord tren inventory_txns
--   public._tong_don(public.sales_orders) returns numeric
--   views: v_khach_tong_quan, v_cong_no_don, v_cong_no_phai_thu, v_don_ban_tong (create or replace, giu nguyen cot)

-- ============================ SQL ============================
create or replace function public._tong_don(o public.sales_orders)
returns numeric language sql stable as $$
  select greatest(
    o.sale_price * o.quantity
    - (case when o.vehicle_discount_type = 'percent'
         then round(o.sale_price * o.quantity * coalesce(o.vehicle_discount_value,0) / 100.0)
         else coalesce(o.vehicle_discount_value,0) end)
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.discount_amount, 0), 0)::numeric
$$;

create or replace view public.v_khach_tong_quan as
 SELECT id AS customer_id,
    COALESCE(( SELECT count(*) FROM sales_orders o WHERE o.customer_id = c.id AND o.status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])), 0::bigint) AS so_don,
    COALESCE(( SELECT sum(public._tong_don(o)) FROM sales_orders o WHERE o.customer_id = c.id AND o.status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])), 0::numeric) AS tong_mua,
    GREATEST(COALESCE(( SELECT sum(public._tong_don(o) - COALESCE(o.paid_amount, 0)::numeric) FROM sales_orders o WHERE o.customer_id = c.id AND o.status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])), 0::numeric), 0::numeric) AS con_no,
    ( SELECT count(*) FROM dv_tickets t WHERE t.customer_id = c.id) AS so_phieu_dv,
    ( SELECT count(*) FROM test_drives t WHERE t.customer_id = c.id) AS so_lai_thu,
    ( SELECT count(*) FROM customer_care_logs k WHERE k.customer_id = c.id) AS so_lan_cham_soc,
    ( SELECT max(k.contact_at) FROM customer_care_logs k WHERE k.customer_id = c.id) AS cham_soc_gan_nhat,
    ( SELECT min(k.next_contact_at) FROM customer_care_logs k WHERE k.customer_id = c.id AND k.next_contact_at >= CURRENT_DATE) AS hen_ke_tiep,
    ( SELECT max(o.sale_date) FROM sales_orders o WHERE o.customer_id = c.id AND o.status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])) AS ngay_mua_cuoi,
    ( SELECT count(*) FROM sales_orders o WHERE o.customer_id = c.id AND o.status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])) AS so_xe
   FROM customers c;

create or replace view public.v_cong_no_don as
 SELECT id, code, sale_date, location_code, customer_id, customer_name, customer_phone, customer_type, seller_name,
    public._tong_don(o) AS tong_don,
    COALESCE(paid_amount, 0::bigint) AS da_tra,
    (public._tong_don(o) - COALESCE(paid_amount, 0::bigint)::numeric) AS con_no,
    (CURRENT_DATE - sale_date) AS tuoi_no
   FROM sales_orders o
  WHERE (public._tong_don(o) - COALESCE(paid_amount, 0::bigint)::numeric) > 0::numeric;

create or replace view public.v_don_ban_tong as
 SELECT id, code, sale_date, location_code, customer_name, customer_phone, sale_price, quantity,
    (sale_price * quantity) AS tien_xe,
    COALESCE(( SELECT sum(i.amount) FROM sale_items i WHERE i.sale_code = o.code), 0::numeric) AS tien_kem,
    discount_amount,
    public._tong_don(o) AS tong_don,
    COALESCE(paid_amount, 0::bigint) AS da_tra,
    GREATEST(public._tong_don(o) - COALESCE(paid_amount, 0::bigint)::numeric, 0::numeric) AS con_lai,
    (extra ->> 'batch_code'::text) AS batch_code
   FROM sales_orders o;

create or replace view public.v_cong_no_phai_thu as
 SELECT id, code, sale_date, due_date, debt_note, customer_id, customer_name, customer_phone, customer_type, location_code,
    seller_id, seller_name, sale_price, quantity, discount_amount,
    public._tong_don(o) AS tong_don,
    COALESCE(paid_amount, 0::bigint) AS da_tra,
    GREATEST(public._tong_don(o) - COALESCE(paid_amount, 0::bigint)::numeric, 0::numeric) AS con_no,
    invoice_status, vehicle_id, frame_number,
    (CURRENT_DATE - COALESCE(due_date, (sale_date + 30))) AS so_ngay_qua_han,
        CASE
            WHEN CURRENT_DATE <= COALESCE(due_date, (sale_date + 30)) THEN 'Chưa đến hạn'::text
            WHEN (CURRENT_DATE - COALESCE(due_date, (sale_date + 30))) BETWEEN 1 AND 7 THEN 'Quá hạn 1–7 ngày'::text
            WHEN (CURRENT_DATE - COALESCE(due_date, (sale_date + 30))) BETWEEN 8 AND 30 THEN 'Quá hạn 8–30 ngày'::text
            ELSE 'Quá hạn trên 30 ngày'::text
        END AS nhom_qua_han
   FROM sales_orders o
  WHERE status <> ALL (ARRAY['Đã hủy'::text, 'Đã trả hàng'::text])
    AND GREATEST(public._tong_don(o) - COALESCE(paid_amount, 0::bigint)::numeric, 0::numeric) > 0::numeric;

-- _trg_txn_discord + _trg_txn_sua_don_discord + trigger trg_txn_sua_don_discord:
-- xem pg_get_functiondef; y tuong: bo qua ghi chu 'Sửa đơn: hoàn xe %' / 'Sửa đơn: bán xe %' o trigger
-- tung dong, rieng constraint trigger deferred chi gui khi KHONG co dong doi ung cung so khung trong giao dich.
