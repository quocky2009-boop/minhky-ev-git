-- 130_fix_doi_ma_xe_trung_inventory.sql
-- Loi 1 (bao cao thuc te): doi ma noi bo xe co ton kho > 0 bi
-- "duplicate key value violates unique constraint inventory_pkey".
--
-- Nguyen nhan: trigger trg_units_sync (migration 004) tu dong UPSERT vao
-- inventory(vehicle_id, location_code) moi khi vehicle_units thay doi.
-- Trong fn_doi_ma_xe, buoc "update vehicle_units set vehicle_id = v_new"
-- chay TRUOC va lam trigger nay tu tao san dong inventory (v_new, loc)
-- cho MOI kho co ton (tuc co dong vehicle_units). Buoc ke tiep
-- "update inventory set vehicle_id = v_new where vehicle_id = p_old" sau
-- do co gang ghi de len dung khoa (v_new, loc) da ton tai -> dung
-- inventory_pkey. Chi xay ra o kho co ton > 0 vi kho ton = 0 khong co
-- dong vehicle_units nen trigger khong chay.
--
-- Fix 1: doi UPDATE thanh DELETE cac dong inventory con lai cua ma cu.
-- Nhung dong nay luon la du lieu da loi thoi (kho co ton da duoc trigger
-- dong bo dung sang ma moi o buoc truoc do; kho ton = 0 thi xoa cung
-- khong mat gi).
--
-- Loi 2 (phat hien khi test bang transaction + rollback tren du lieu
-- that): fn_doi_ma_xe duoc viet tu migration 022, TRUOC KHI cac bang
-- purchase_order_lines (081), test_drives (029), deposits (036), co_hoi
-- (075) duoc tao va gan FK toi vehicles(id) -> ham chua tung duoc cap
-- nhat de "day chuyen" ma moi sang 5 cot nay. Neu ma dang doi co du
-- lieu tham chieu o bat ky bang nao trong so nay, cau "delete from
-- vehicles where id = p_old" o cuoi ham se bao loi khoa ngoai khac
-- (vd purchase_order_lines_vehicle_id_fkey), khong phai loi inventory
-- nhung cung lam doi ma that bai.
--
-- Fix 2: doi chieu toan bo FK dang tro toi vehicles(id) hien co tren DB
-- that (truy van pg_constraint truoc khi sua, xem cuoi file) -> them 5
-- dong UPDATE con thieu: purchase_order_lines.vehicle_id,
-- test_drives.interested_vehicle_id, test_drives.test_drive_vehicle_id,
-- deposits.vehicle_id, co_hoi.interested_vehicle_id.
--
-- Toan bo logic con lai cua ham (kiem tra quyen, insert danh muc moi,
-- xu ly import_drafts) giu nguyen 100%.
--
-- KHONG doi chu ky ham (van la fn_doi_ma_xe(text,text)) -> khong can
-- DROP FUNCTION, CREATE OR REPLACE la du.

CREATE OR REPLACE FUNCTION public.fn_doi_ma_xe(p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare me record; v_new text;
begin
  select * into me from public.fn_me();
  if not public.fn_co_quyen('sua_danh_muc') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đổi mã nội bộ'; end if;
  v_new := upper(regexp_replace(trim(p_new), '\s+', '_', 'g'));
  if coalesce(v_new,'') = '' then raise exception 'THIEU_THONG_TIN: mã mới không được để trống'; end if;
  if v_new = p_old then raise exception 'KHONG_CHENH_LECH: mã mới trùng mã hiện tại'; end if;
  if not exists (select 1 from public.vehicles where id = p_old) then
    raise exception 'KHONG_TIM_THAY: mã % không tồn tại', p_old;
  end if;
  if exists (select 1 from public.vehicles where id = v_new) then
    raise exception 'TRUNG_MA: mã % đã được dùng cho xe khác', v_new;
  end if;

  -- 1) Tao ban ghi danh muc voi ma moi (copy nguyen thuoc tinh)
  insert into public.vehicles (id, brand, name, color, mfr_code, list_price, min_stock, created_at)
  select v_new, brand, name, color, mfr_code, list_price, min_stock, created_at
  from public.vehicles where id = p_old;

  -- 2) Chuyen toan bo tham chieu sang ma moi
  update public.vehicle_units      set vehicle_id = v_new where vehicle_id = p_old;
  -- SUA: trigger trg_units_sync o dong tren da tu dong tao/cap nhat dung
  -- dong inventory(v_new, loc) cho moi kho co ton -> XOA (khong UPDATE)
  -- cac dong inventory con lai cua ma cu de tranh dung khoa + de vehicles
  -- xoa duoc o buoc 4.
  delete from public.inventory      where vehicle_id = p_old;
  update public.inventory_txns     set vehicle_id = v_new where vehicle_id = p_old;
  update public.sales_orders       set vehicle_id = v_new where vehicle_id = p_old;
  update public.transfer_orders    set vehicle_id = v_new where vehicle_id = p_old;
  update public.stock_adjustments  set vehicle_id = v_new where vehicle_id = p_old;
  update public.customers          set interested_vehicle_id = v_new where interested_vehicle_id = p_old;
  update public.frame_pool         set vehicle_id = v_new where vehicle_id = p_old;
  -- SUA: 5 dong FK con thieu (bang tao sau migration 022, chua tung duoc
  -- fn_doi_ma_xe cap nhat) -> phat hien qua test transaction+rollback.
  update public.purchase_order_lines set vehicle_id = v_new where vehicle_id = p_old;
  update public.test_drives        set interested_vehicle_id = v_new where interested_vehicle_id = p_old;
  update public.test_drives        set test_drive_vehicle_id = v_new where test_drive_vehicle_id = p_old;
  update public.deposits           set vehicle_id = v_new where vehicle_id = p_old;
  update public.co_hoi             set interested_vehicle_id = v_new where interested_vehicle_id = p_old;

  -- 3) Phieu nhap nhap: rows la jsonb [{frame_number, vehicle_id}]
  update public.import_drafts d
  set rows = (
    select coalesce(jsonb_agg(
      case when e->>'vehicle_id' = p_old
           then jsonb_set(e, '{vehicle_id}', to_jsonb(v_new))
           else e end), '[]'::jsonb)
    from jsonb_array_elements(d.rows) e
  )
  where d.rows @> jsonb_build_array(jsonb_build_object('vehicle_id', p_old));

  -- 4) Xoa ban ghi ma cu
  delete from public.vehicles where id = p_old;
end $function$;

-- Xac minh sau khi chay:
-- select oid::regprocedure from pg_proc where proname = 'fn_doi_ma_xe';
-- Test: chon 1 ma xe DANG CO TON KHO > 0, doi ma noi bo -> phai thanh
-- cong, khong con loi inventory_pkey; kiem tra:
--   select * from inventory where vehicle_id in ('<ma_cu>','<ma_moi>');
-- -> chi con dong cua ma moi, dung so luong nhu truoc khi doi.
