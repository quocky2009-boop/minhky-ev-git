-- ============================================================
-- Migration 060 — HỦY PHIẾU THU/CHI THỦ CÔNG (phục vụ chọn nhiều & hủy)
--  Chi cho huy phieu THU CONG (khong co ref_doc — khong gan don/DV/coc).
--  Chan huy neu ngay phieu da bi CHOT QUY (tranh lam sai so lieu da chot).
--  Chi CEO / nguoi co quyen thu_chi_chot duoc huy.
-- Chạy SAU 059. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_huy_phieu_thu_chi(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' and not public.fn_co_quyen('thu_chi_chot') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền hủy phiếu quỹ';
  end if;
  select * into t from public.cash_txns where id = p_id;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if coalesce(t.ref_doc,'') <> '' then
    raise exception 'PHIEU_TU_DONG: phiếu % gắn với chứng từ gốc %, không hủy trực tiếp — xử lý từ đơn/dịch vụ gốc', t.code, t.ref_doc;
  end if;
  if exists (select 1 from public.cash_closings c where c.account_id = t.account_id and c.close_date >= t.txn_date) then
    raise exception 'DA_CHOT_QUY: phiếu % thuộc ngày đã chốt quỹ — không hủy được. Lập phiếu điều chỉnh ngược thay thế.', t.code;
  end if;
  delete from public.cash_txns where id = p_id;
end $$;

do $do$
begin
  raise notice 'XONG 060: them fn_huy_phieu_thu_chi (chi phieu thu cong, chua chot quy)';
end $do$;
