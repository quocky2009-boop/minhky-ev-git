-- ============================================================
-- Migration 010: Module KHACH HANG (CRM gon)
-- - Ma KH tu sinh, canh bao trung SDT (phia giao dien)
-- - Don ban tu dong tao/cap nhat ho so khach & gan lien ket
-- Chay SAU 008, 1 lan duy nhat.
-- ============================================================

create table public.customers (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  phone text not null,
  phone_digits text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  cccd text default '',
  address text default '',
  customer_type text default 'Khách lẻ',
  source text default 'Khách vãng lai',
  status text not null default 'Lead mới' check (status in ('Lead mới','Đang tư vấn','Hẹn xem xe','Đã mua','Không mua','Chăm sóc lại')),
  assigned_to uuid references public.profiles(id),
  assigned_name text default '',
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  last_purchase_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.customers (phone_digits);
create index on public.customers (status);

alter table public.sales_orders add column if not exists customer_id bigint references public.customers(id);

alter table public.customers enable row level security;
create policy "read_customers" on public.customers for select to authenticated using (true);

-- Tao / cap nhat khach hang (moi vai tro dang nhap)
create or replace function public.fn_luu_khach_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(trim(p->>'name'),'') = '' or coalesce(trim(p->>'phone'),'') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  if coalesce(p->>'id','') <> '' then
    update public.customers set
      name = trim(p->>'name'), phone = trim(p->>'phone'),
      cccd = coalesce(p->>'cccd',''), address = coalesce(p->>'address',''),
      customer_type = coalesce(nullif(p->>'customer_type',''),'Khách lẻ'),
      source = coalesce(nullif(p->>'source',''),'Khách vãng lai'),
      status = coalesce(nullif(p->>'status',''), status),
      note = coalesce(p->>'note',''), updated_at = now()
    where id = (p->>'id')::bigint
    returning code into v_code;
    return v_code;
  end if;
  v_code := public.fn_gen_code('KH');
  insert into public.customers (code, name, phone, cccd, address, customer_type, source, status, assigned_to, assigned_name, note, created_by, created_by_name)
  values (v_code, trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
          coalesce(nullif(p->>'customer_type',''),'Khách lẻ'), coalesce(nullif(p->>'source',''),'Khách vãng lai'),
          coalesce(nullif(p->>'status',''),'Lead mới'), me.uid, me.name, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- Noi bo: tim/tao khach theo SDT khi co don ban, gan don vao khach
create or replace function public._upsert_customer_from_sale(
  p_name text, p_phone text, p_cccd text, p_address text, p_type text, p_source text,
  p_uid uuid, p_uname text
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  select id into v_id from public.customers where phone_digits = v_digits limit 1;
  if v_id is not null then
    update public.customers set
      status = 'Đã mua', last_purchase_at = now(), updated_at = now(),
      cccd = case when coalesce(cccd,'')='' then coalesce(p_cccd,'') else cccd end,
      address = case when coalesce(address,'')='' then coalesce(p_address,'') else address end
    where id = v_id;
  else
    insert into public.customers (code, name, phone, cccd, address, customer_type, source, status, assigned_to, assigned_name, created_by, created_by_name, last_purchase_at)
    values (public.fn_gen_code('KH'), p_name, p_phone, coalesce(p_cccd,''), coalesce(p_address,''),
            coalesce(p_type,'Khách lẻ'), coalesce(p_source,'Khách vãng lai'), 'Đã mua', p_uid, p_uname, p_uid, p_uname, now())
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- BAN HANG: giu nguyen logic so khung + tu dong gan khach hang
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
        v_frames text[]; v_cust bigint;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  n := coalesce(array_length(v_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe theo số khung'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  v_before := public._count_at(p->>'vehicle_id', p->>'location_code');
  v_code := public.fn_gen_code('BH');
  foreach f in array v_frames loop
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f, u.status; end if;
    if u.location_code <> p->>'location_code' or u.vehicle_id <> p->>'vehicle_id' then
      raise exception 'SAI_KHO_HOAC_XE: xe % không thuộc kho/mã xe đã chọn', f;
    end if;
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now() where frame_number = f;
  end loop;
  perform public._log_txn('Bán hàng', p->>'vehicle_id', p->>'location_code', null, -n, v_before, v_before - n,
    v_code, 'KH '||(p->>'customer_name')||' · SK: '||array_to_string(v_frames,', '), me.uid, me.name);
  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);
  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
  values (v_code, p->>'location_code', p->>'vehicle_id', n, array_to_string(v_frames,', '),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), coalesce((p->>'sale_price')::bigint, v_list, 0),
    coalesce(p->>'payment_method','Chuyển khoản'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''),
    coalesce(p->'extra','{}'::jsonb), v_cust);
  return v_code;
end $$;

-- Gan cac don ban CU vao ho so khach (chay 1 lan luc migrate)
do $$
declare r record; v_cust bigint;
begin
  for r in select distinct on (regexp_replace(customer_phone,'\D','','g'))
           customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source
           from public.sales_orders where customer_id is null and coalesce(customer_phone,'') <> '' loop
    v_cust := public._upsert_customer_from_sale(r.customer_name, r.customer_phone, r.customer_cccd, r.customer_address, r.customer_type, r.customer_source, null, 'Hệ thống');
  end loop;
  update public.sales_orders s set customer_id = c.id
  from public.customers c
  where s.customer_id is null
    and regexp_replace(s.customer_phone,'\D','','g') = c.phone_digits;
end $$;
