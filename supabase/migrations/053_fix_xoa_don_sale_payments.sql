-- ============================================================
-- Migration 053 — FIX XÓA ĐƠN BÁN: dọn sale_payments trước khi xóa
--  Lỗi: update or delete on table "sales_orders" violates foreign key
--       constraint "sale_payments_sale_code_fkey" on table "sale_payments".
--  Nguyên nhân: fn_xoa_don (viết ở migration 028) xóa sale_items và
--  sale_adjust_requests nhưng CHƯA xóa sale_payments — bảng này được thêm
--  sau (014/045). Đơn nào đã phát sinh dòng thanh toán sẽ bị FK chặn.
--  Sửa: xóa toàn bộ dòng con tham chiếu tới đơn trước khi xóa đơn.
--  Lưu ý: sale_payments KHÔNG tự ghi sổ quỹ (Sổ Thu Chi là app riêng),
--  nên xóa dòng thanh toán ở đây không ảnh hưởng số liệu quỹ.
-- Chạy SAU 052. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_xoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; u record; v_before int;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc được xóa đơn bán'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: phải nhập lý do xóa đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;

  -- Hoan xe ve ton kho (neu chiec nay van dang gan voi don nay)
  select * into u from public.vehicle_units where frame_number = o.frame_number for update;
  if u is not null and u.sale_code = o.code and u.status = 'DA_BAN' then
    v_before := public._count_at(o.vehicle_id, u.location_code);
    update public.vehicle_units set status = 'TON_KHO', sale_code = null, updated_at = now()
    where frame_number = o.frame_number;
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, u.location_code, 1, v_before, v_before + 1,
      o.code, 'BGĐ '||me.name||' xóa đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' hoàn về kho', me.uid, me.name);
  else
    perform public._log_txn('Hủy đơn bán', o.vehicle_id, null, null, 0, 0, 0,
      o.code, 'BGĐ '||me.name||' xóa đơn '||o.code||' — lý do: '||trim(p_ly_do)||' · xe '||o.frame_number||' KHÔNG hoàn kho (đã bán lại/không còn)', me.uid, me.name);
  end if;

  -- Don sach TAT CA dong con tham chieu toi don (theo sale_code) truoc khi xoa don
  delete from public.sale_payments        where sale_code = o.code;
  delete from public.sale_adjust_requests where sale_code = o.code;
  delete from public.sale_items           where sale_code = o.code;
  delete from public.sales_orders where id = p_id;
end $$;

do $do$
begin
  raise notice 'XONG 053: fn_xoa_don da don sale_payments truoc khi xoa don';
end $do$;

-- ============================================================
-- ROLLBACK: chay lai ban 028 de tra fn_xoa_don ve cu (se lai loi FK sale_payments).
-- ============================================================
