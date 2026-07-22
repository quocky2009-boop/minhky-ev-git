-- ============================================================
-- Migration 038b — VÁ LỖI khi chạy 038
-- Loi: "cannot change return type of existing function"
-- Nguyen nhan: fn_them_quy o 012 tra ve VOID, ban moi tra ve BIGINT.
-- Postgres khong cho doi kieu tra ve bang create or replace.
--
-- CACH DUNG: chay file NAY TRUOC, roi chay lai 038 tu dau.
-- (038 chay lai duoc nhieu lan, khong sao.)
-- ============================================================

-- Xoa ham cu de tao lai voi kieu tra ve moi
drop function if exists public.fn_them_quy(jsonb);

-- Tao lai ngay tai day (de neu anh khong chay lai 038 van dung duoc)
create or replace function public.fn_them_quy(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_chot') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được tạo/sửa quỹ';
  end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.cash_accounts (name, type, location_code, bank_info, opening_balance)
    values (p->>'name', coalesce(p->>'type','Tiền mặt'), nullif(p->>'location_code',''),
            coalesce(p->>'bank_info',''), coalesce((p->>'opening_balance')::bigint, 0))
    returning id into v_id;
  else
    update public.cash_accounts set name = p->>'name', type = coalesce(p->>'type', type),
      location_code = nullif(p->>'location_code',''), bank_info = coalesce(p->>'bank_info', bank_info),
      opening_balance = coalesce((p->>'opening_balance')::bigint, opening_balance),
      status = coalesce(p->>'status', status)
    where id = v_id;
  end if;
  return v_id;
end $$;
