-- ============================================================
-- Migration 113 (1/2): THIẾT KẾ LẠI cách xác định tài khoản Ngân
-- hàng — theo đúng thực tế: tài khoản ngân hàng gắn với PHÁP NHÂN
-- (công ty), pháp nhân xác định theo HÃNG XE đang bán, KHÔNG theo
-- cửa hàng. Quỹ Tiền mặt VẪN giữ theo cửa hàng như cũ (đã xác nhận).
--
-- Vì 1 pháp nhân có thể có NHIỀU tài khoản ngân hàng không cố định,
-- hệ thống KHÔNG tự động đoán — nhân viên phải TỰ CHỌN đúng tài
-- khoản khách đã chuyển vào lúc nhập đơn.
-- Chạy sau 112. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- A) Bảng pháp nhân ----------
create table if not exists public.companies (
  id bigserial primary key,
  name text unique not null,
  note text default '',
  status text not null default 'Hoạt động'
);

insert into public.companies (name) values
  ('Công ty TNHH Ngân Thái Sơn'),
  ('Công ty TNHH Minh Kỳ')
on conflict (name) do nothing;

-- ---------- B) brands.company_id: hang xe -> phap nhan phu trach ----------
alter table public.brands add column if not exists company_id bigint references public.companies(id);

update public.brands set company_id = (select id from public.companies where name = 'Công ty TNHH Ngân Thái Sơn')
where name ilike '%vinfast%' and company_id is null;

update public.brands set company_id = (select id from public.companies where name = 'Công ty TNHH Minh Kỳ')
where company_id is null;  -- moi hang con lai (TAILG va hang khac) -> Minh Ky

-- ---------- C) cash_accounts.company_id: tai khoan Ngan hang gan theo phap nhan ----------
alter table public.cash_accounts add column if not exists company_id bigint references public.companies(id);

-- ---------- D) fn_them_quy: nhan them company_id ----------
create or replace function public.fn_them_quy(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_chot') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được tạo/sửa quỹ';
  end if;
  if coalesce(p->>'type','Tiền mặt') = 'Ngân hàng' and nullif(p->>'company_id','') is null then
    raise exception 'THIEU_PHAP_NHAN: tài khoản Ngân hàng bắt buộc chọn Pháp nhân sở hữu';
  end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.cash_accounts (name, type, location_code, company_id, bank_info, opening_balance)
    values (p->>'name', coalesce(p->>'type','Tiền mặt'), nullif(p->>'location_code',''),
            nullif(p->>'company_id','')::bigint, coalesce(p->>'bank_info',''), coalesce((p->>'opening_balance')::bigint, 0))
    returning id into v_id;
  else
    update public.cash_accounts set name = p->>'name', type = coalesce(p->>'type', type),
      location_code = nullif(p->>'location_code',''), company_id = nullif(p->>'company_id','')::bigint,
      bank_info = coalesce(p->>'bank_info', bank_info),
      opening_balance = coalesce((p->>'opening_balance')::bigint, opening_balance),
      status = coalesce(p->>'status', status)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------- E) v_quy_so_du: them ten phap nhan de hien thi ----------
-- DROP truoc vi Postgres khong cho CREATE OR REPLACE VIEW doi thu tu/ten
-- cot hien co (loi 42P16) — giu dung thu tu cot GOC, chi them cot MOI
-- vao CUOI cung de khong pha vo bat ky noi nao dang doc theo vi tri cot.
drop view if exists public.v_quy_so_du;
create view public.v_quy_so_du as
select a.id, a.name, a.type, a.location_code, a.status, a.opening_balance,
  a.opening_balance
    + coalesce((select sum(case when t.direction = 'Thu' then t.amount else -t.amount end)
                from public.cash_txns t where t.account_id = a.id), 0) as so_du,
  a.company_id, c.name as company_name
from public.cash_accounts a
left join public.companies c on c.id = a.company_id;

-- ---------- F) fn_luu_phap_nhan: CEO/ADMIN quan ly phap nhan ----------
create or replace function public.fn_luu_phap_nhan(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên pháp nhân'; end if;

  if nullif(p->>'id','') is null then
    insert into public.companies (name, note, status) values (trim(p->>'name'), coalesce(p->>'note',''), coalesce(nullif(p->>'status',''),'Hoạt động'));
  else
    update public.companies set name = trim(p->>'name'), note = coalesce(p->>'note',''), status = coalesce(nullif(p->>'status',''), status)
    where id = (p->>'id')::bigint;
  end if;
end $$;
