-- ============================================================
-- Migration 076 — MODULE LỊCH HẸN (CALENDAR)
--  Bang appointments: lich hen rieng, co the gan voi khach hang,
--  cong hien voi tasks (due_at) tren cung 1 view lich
-- Chạy SAU 075. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create table if not exists public.appointments (
  id bigserial primary key,
  title text not null,
  description text default '',
  appt_type text not null default 'Khác'
    check (appt_type in ('Gọi điện','Gặp khách','Lái thử','Giao xe','Nội bộ','Khác')),
  customer_id bigint references public.customers(id),
  customer_name text default '',
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  assigned_to uuid references public.profiles(id),
  assigned_name text default '',
  location_code text references public.locations(code),
  status text not null default 'Sắp tới' check (status in ('Sắp tới','Đã xong','Đã hủy')),
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appt_start_idx on public.appointments (start_at);
create index if not exists appt_assigned_idx on public.appointments (assigned_to, start_at);
alter table public.appointments enable row level security;
create policy "appointments_auth" on public.appointments for all to authenticated using (true) with check (true);

-- Ham tao/sua lich hen
create or replace function public.fn_luu_lich_hen(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(trim(p->>'title'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tiêu đề'; end if;
  if coalesce(p->>'start_at','') = '' then raise exception 'THIEU_THONG_TIN: chọn thời gian'; end if;

  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.appointments set
      title = p->>'title', description = coalesce(p->>'description',''),
      appt_type = coalesce(nullif(p->>'appt_type',''),'Khác'),
      customer_id = nullif(p->>'customer_id','')::bigint,
      customer_name = coalesce(p->>'customer_name',''),
      start_at = (p->>'start_at')::timestamptz,
      end_at = nullif(p->>'end_at','')::timestamptz,
      all_day = coalesce((p->>'all_day')::boolean,false),
      assigned_to = coalesce(nullif(p->>'assigned_to','')::uuid, me.uid),
      assigned_name = coalesce(nullif(p->>'assigned_name',''), me.name),
      location_code = nullif(p->>'location_code',''),
      status = coalesce(nullif(p->>'status',''),'Sắp tới'),
      note = coalesce(p->>'note',''),
      updated_at = now()
    where id = (p->>'id')::bigint
    returning id into v_id;
  else
    insert into public.appointments (title, description, appt_type, customer_id, customer_name,
      start_at, end_at, all_day, assigned_to, assigned_name, location_code, note,
      created_by, created_by_name)
    values (p->>'title', coalesce(p->>'description',''),
      coalesce(nullif(p->>'appt_type',''),'Khác'),
      nullif(p->>'customer_id','')::bigint, coalesce(p->>'customer_name',''),
      (p->>'start_at')::timestamptz, nullif(p->>'end_at','')::timestamptz,
      coalesce((p->>'all_day')::boolean,false),
      coalesce(nullif(p->>'assigned_to','')::uuid, me.uid),
      coalesce(nullif(p->>'assigned_name',''), me.name),
      nullif(p->>'location_code',''), coalesce(p->>'note',''),
      me.uid, me.name)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Ham xoa lich hen
create or replace function public.fn_xoa_lich_hen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.appointments where id = p_id;
end $$;

do $do$
begin
  raise notice 'XONG 076: bang appointments + fn_luu_lich_hen + fn_xoa_lich_hen';
end $do$;
