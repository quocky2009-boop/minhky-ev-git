-- ============================================================
-- Migration 011: Khoa trang thai "Da mua", phan quyen xem/sua
-- theo Sales phu trach, them Tinh trang Lead (Hot/Warm/Cold),
-- va Lich su cham soc khach hang.
-- Chay SAU 010, 1 lan duy nhat.
-- ============================================================

alter table public.customers add column if not exists temperature text check (temperature in ('Hot','Warm','Cold'));

create table public.customer_care_logs (
  id bigserial primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  care_date date not null default current_date,
  content text not null,
  result text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index on public.customer_care_logs (customer_id, care_date desc);

-- ---- PHAN QUYEN XEM: CEO xem tat ca; con lai chi xem KH minh phu trach/tao ----
drop policy if exists "read_customers" on public.customers;
create policy "read_customers" on public.customers for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO')
  or assigned_to = auth.uid() or created_by = auth.uid()
);

alter table public.customer_care_logs enable row level security;
create policy "read_care_logs" on public.customer_care_logs for select to authenticated using (
  exists (
    select 1 from public.customers c, public.profiles p
    where c.id = customer_care_logs.customer_id and p.id = auth.uid()
      and (p.role = 'CEO' or c.assigned_to = auth.uid() or c.created_by = auth.uid())
  )
);

-- ---- LUU KHACH HANG: kiem tra quyen + khoa trang thai "Da mua" ----
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
      note = coalesce(p->>'note',''), updated_at = now()
    where id = (p->>'id')::bigint
    returning code into v_code;
    return v_code;
  end if;

  v_code := public.fn_gen_code('KH');
  insert into public.customers (code, name, phone, cccd, address, customer_type, source, status, temperature, assigned_to, assigned_name, note, created_by, created_by_name)
  values (v_code, trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
          coalesce(nullif(p->>'customer_type',''),'Khách lẻ'), coalesce(nullif(p->>'source',''),'Khách vãng lai'),
          coalesce(nullif(p->>'status',''),'Lead mới'), nullif(p->>'temperature',''),
          me.uid, me.name, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- ---- LICH SU CHAM SOC: them dong moi (kiem tra quyen theo khach) ----
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
  update public.customers set updated_at = now() where id = (p->>'customer_id')::bigint;
end $$;

create or replace function public.fn_xoa_cham_soc(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; log record;
begin
  select * into me from public.fn_me();
  select * into log from public.customer_care_logs where id = p_id;
  if log is null then raise exception 'KHONG_TIM_THAY'; end if;
  if me.role <> 'CEO' and log.created_by <> me.uid then raise exception 'KHONG_CO_QUYEN: chỉ người ghi hoặc CEO được xóa'; end if;
  delete from public.customer_care_logs where id = p_id;
end $$;
