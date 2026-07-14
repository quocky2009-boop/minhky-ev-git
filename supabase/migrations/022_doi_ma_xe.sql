-- ============================================================
-- Migration 022: DOI MA NOI BO (vehicle_id) DAY CHUYEN
-- Ma noi bo la khoa chinh duoc nhieu bang tham chieu -> phai
-- doi dong loat trong 1 giao dich: danh muc, tung xe, ton,
-- lich su, don ban, dieu chuyen, dieu chinh, khach quan tam,
-- danh sach hang, phieu nhap nhap (jsonb).
-- Chi CEO/ADMIN. Chay SAU 021, 1 lan duy nhat.
-- ============================================================

create or replace function public.fn_doi_ma_xe(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_new text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đổi mã nội bộ'; end if;
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
  update public.inventory          set vehicle_id = v_new where vehicle_id = p_old;
  update public.inventory_txns     set vehicle_id = v_new where vehicle_id = p_old;
  update public.sales_orders       set vehicle_id = v_new where vehicle_id = p_old;
  update public.transfer_orders    set vehicle_id = v_new where vehicle_id = p_old;
  update public.stock_adjustments  set vehicle_id = v_new where vehicle_id = p_old;
  update public.customers          set interested_vehicle_id = v_new where interested_vehicle_id = p_old;
  update public.frame_pool         set vehicle_id = v_new where vehicle_id = p_old;

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
end $$;
