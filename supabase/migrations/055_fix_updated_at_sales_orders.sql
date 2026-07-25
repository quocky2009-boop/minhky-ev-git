-- ============================================================
-- Migration 055 — FIX: sales_orders thiếu cột updated_at
--  Lỗi: column "updated_at" of relation "sales_orders" does not exist
--  (fn_xoa_don / fn_mo_lai_don ở 054 có set updated_at nhưng bảng chưa có cột).
--  Sửa: thêm cột updated_at (mặc định = created_at cho dòng cũ), rồi tạo lại
--  2 hàm cho chắc. Chạy SAU 054. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- 1) Them cot updated_at (dong cu lay theo created_at)
alter table public.sales_orders add column if not exists updated_at timestamptz;
update public.sales_orders set updated_at = created_at where updated_at is null;
alter table public.sales_orders alter column updated_at set default now();

-- 2) Tao lai fn_xoa_don (giong 054, dam bao dung tren DB da co cot)
create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được hủy đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do hủy đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.status = 'Đã hủy' then raise exception 'DA_HUY: đơn này đã bị hủy trước đó'; end if;

  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null, updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' hủy đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' KHÔNG hoàn kho (đã bán lại/không còn)', me.uid, me.name);
  end if;

  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do),
    updated_at = now()
  where id = p_id;
end $$;

-- 3) Tao lai fn_mo_lai_don
create or replace function public.fn_mo_lai_don(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được mở lại đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.status <> 'Đã hủy' then raise exception 'TRANG_THAI_SAI: đơn không ở trạng thái Đã hủy'; end if;
  update public.sales_orders set status = 'Đã trừ tồn',
    cancel_reason = '', cancelled_at = null, cancelled_by = null, cancelled_by_name = '', updated_at = now()
  where id = p_id;
  perform public._log_txn('Bán hàng', o.vehicle_id, null, null, 0, 0, 0,
    o.code, 'BGĐ '||me.name||' mở lại đơn '||o.code||' (đã hủy trước đó) — lưu ý kiểm tra lại tồn xe', me.uid, me.name);
end $$;

do $do$
begin
  raise notice 'XONG 055: da them cot updated_at cho sales_orders; fn_xoa_don/fn_mo_lai_don OK';
end $do$;
