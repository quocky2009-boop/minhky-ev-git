-- ============================================================
-- Migration 013: VIEC CAN CHAM SOC (lich hen cham soc tiep theo)
-- - Them cot ngay hen + ghi chu hen vao customers
-- - Ghi cham soc co the dat luon lich hen lan sau
-- Khong dung du lieu cu. Chay SAU 012, 1 lan duy nhat.
-- ============================================================

alter table public.customers add column if not exists next_care_date date;
alter table public.customers add column if not exists next_care_note text default '';
create index if not exists customers_next_care_idx on public.customers (next_care_date) where next_care_date is not null;

-- LUU KHACH HANG: them 2 truong lich hen (giu nguyen khoa "Da mua" + phan quyen tu 011)
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
      customer_type = coalesce(nullif(p->>'customer_type',''),'Khách lẻ'),
      source = coalesce(nullif(p->>'source',''),'Khách vãng lai'),
      status = v_new_status,
      temperature = nullif(p->>'temperature',''),
      next_care_date = case when p ? 'next_care_date' then nullif(p->>'next_care_date','')::date else next_care_date end,
      next_care_note = case when p ? 'next_care_note' then coalesce(p->>'next_care_note','') else next_care_note end,
      note = coalesce(p->>'note',''), updated_at = now()
    where id = (p->>'id')::bigint
    returning code into v_code;
    return v_code;
  end if;

  v_code := public.fn_gen_code('KH');
  insert into public.customers (code, name, phone, cccd, address, customer_type, source, status, temperature,
    next_care_date, next_care_note, assigned_to, assigned_name, note, created_by, created_by_name)
  values (v_code, trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
          coalesce(nullif(p->>'customer_type',''),'Khách lẻ'), coalesce(nullif(p->>'source',''),'Khách vãng lai'),
          coalesce(nullif(p->>'status',''),'Lead mới'), nullif(p->>'temperature',''),
          nullif(p->>'next_care_date','')::date, coalesce(p->>'next_care_note',''),
          me.uid, me.name, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- GHI CHAM SOC: them tuy chon dat lich hen lan sau ngay trong 1 thao tac
create or replace function public.fn_luu_cham_soc(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; cust record;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select * into cust from public.customers where id = (p->>'customer_id')::bigint;
  if cust is null then raise exception 'KHONG_TIM_THAY: khách hàng không tồn tại'; end if;
  if me.role <> 'CEO' and cust.assigned_to <> me.uid and cust.created_by <> me.uid then
    raise exception 'KHONG_CO_QUYEN: bạn chỉ được ghi chăm sóc cho khách mình phụ trách';
  end if;
  if coalesce(trim(p->>'content'),'') = '' then raise exception 'THIEU_THONG_TIN: cần nhập nội dung chăm sóc'; end if;
  insert into public.customer_care_logs (customer_id, care_date, content, result, created_by, created_by_name)
  values ((p->>'customer_id')::bigint, coalesce(nullif(p->>'care_date','')::date, current_date),
          trim(p->>'content'), coalesce(p->>'result',''), me.uid, me.name);
  update public.customers set
    updated_at = now(),
    next_care_date = case when p ? 'next_care_date' then nullif(p->>'next_care_date','')::date else next_care_date end,
    next_care_note = case when p ? 'next_care_note' then coalesce(p->>'next_care_note','') else next_care_note end
  where id = (p->>'customer_id')::bigint;
end $$;
