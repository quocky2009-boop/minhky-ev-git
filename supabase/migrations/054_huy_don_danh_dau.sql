-- ============================================================
-- Migration 054 — HỦY ĐƠN BÁN THEO CƠ CHẾ "ĐÁNH DẤU ĐÃ HỦY" (giữ lưu vết)
--  Thay cho xóa cứng (028/053). Đơn hủy:
--   * status = 'Đã hủy' (không xóa khỏi DB) — vẫn xem lại được, giữ payments/items.
--   * Xe hoàn về TON_KHO (nếu chiếc này còn gắn với đơn).
--   * Phiếu cọc (nếu có) trả về DANG_GIU để xử lý riêng, hoặc giữ nguyên tùy chính sách.
--   * Ghi 1 dòng lịch sử "Hủy đơn bán" kèm lý do.
--  Bổ sung cột huy_* để lưu ai hủy / khi nào / lý do.
-- Chạy SAU 053. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- Cot luu vet huy don
alter table public.sales_orders add column if not exists cancelled_at   timestamptz;
alter table public.sales_orders add column if not exists cancelled_by   uuid references public.profiles(id);
alter table public.sales_orders add column if not exists cancelled_by_name text default '';
alter table public.sales_orders add column if not exists cancel_reason  text default '';
create index if not exists sales_orders_status_idx on public.sales_orders (status);

-- fn_xoa_don: giu ten ham (frontend dang goi) nhung doi hanh vi -> danh dau huy
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

  -- Hoan xe ve ton kho (neu chiec nay van dang gan voi don nay)
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

  -- Danh dau huy (KHONG xoa payments/items/adjust — giu lai de luu vet)
  update public.sales_orders set
    status = 'Đã hủy',
    cancelled_at = now(), cancelled_by = me.uid, cancelled_by_name = me.name,
    cancel_reason = trim(p_ly_do),
    updated_at = now()
  where id = p_id;
end $$;

-- (Tuy chon) Ham mo lai don da huy — phong khi huy nham.
-- Chi hoan trang thai don; KHONG tu dong giu lai xe (xe co the da ban cho don khac).
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
  raise notice 'XONG 054: fn_xoa_don -> danh dau Da huy (giu luu vet); them fn_mo_lai_don';
end $do$;

-- ============================================================
-- ROLLBACK: chay lai 053 de tra fn_xoa_don ve xoa cung.
--   drop function if exists public.fn_mo_lai_don(bigint);
-- ============================================================
