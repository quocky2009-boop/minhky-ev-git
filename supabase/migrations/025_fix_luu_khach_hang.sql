-- ============================================================
-- Migration 025: FIX fn_luu_khach_hang
-- Loi: "column next_care_date does not exist" vi mig 013 chua
-- chay + phan cham soc da go bo. Viet lai hAm KHONG con phu
-- thuoc cac cot cham soc (next_care_date/next_care_note/
-- interested_vehicle_id/temperature) — chi giu truong toi thieu.
-- An toan chay lai nhieu lan. Chay SAU cac migration truoc.
-- ============================================================

create or replace function public.fn_luu_khach_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; old_row record; v_new_status text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(trim(p->>'name'),'') = '' or coalesce(trim(p->>'phone'),'') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;

  if coalesce(p->>'id','') <> '' then
    select * into old_row from public.customers where id = (p->>'id')::bigint for update;
    if old_row is null then raise exception 'KHONG_TIM_THAY: khách hàng không tồn tại'; end if;
    if me.role <> 'CEO' and old_row.assigned_to <> me.uid and old_row.created_by <> me.uid then
      raise exception 'KHONG_CO_QUYEN: bạn chỉ được sửa khách hàng do mình phụ trách';
    end if;
    v_new_status := coalesce(nullif(p->>'status',''), old_row.status);
    if old_row.status = 'Đã mua' and v_new_status <> 'Đã mua' then
      raise exception 'TRANG_THAI_KHOA: khách đã mua xe, trạng thái "Đã mua" không thể đổi';
    end if;
    update public.customers set
      name = trim(p->>'name'), phone = trim(p->>'phone'),
      cccd = coalesce(p->>'cccd',''), address = coalesce(p->>'address',''),
      customer_type = coalesce(nullif(p->>'customer_type',''), customer_type, 'Khách lẻ'),
      source = coalesce(nullif(p->>'source',''), source, 'Khách vãng lai'),
      status = v_new_status,
      note = coalesce(p->>'note',''), updated_at = now()
    where id = (p->>'id')::bigint
    returning code into v_code;
    return v_code;
  end if;

  v_code := public.fn_gen_code('KH');
  insert into public.customers (code, name, phone, cccd, address, customer_type, source, status,
    assigned_to, assigned_name, note, created_by, created_by_name)
  values (v_code, trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
          coalesce(nullif(p->>'customer_type',''),'Khách lẻ'), coalesce(nullif(p->>'source',''),'Khách vãng lai'),
          coalesce(nullif(p->>'status',''),'Hồ sơ'),
          me.uid, me.name, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;
