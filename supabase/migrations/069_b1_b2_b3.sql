-- ============================================================
-- Migration 069 — B1 + B2 + B3
--  B1: Cong no phai tra NCC — them cot vao inventory_txns + bang supplier_debts
--  B2: Luong duyet phieu chi thu cong — them status + approved_by vao cash_txns
--  B3: Lich su nhac no — bang debt_reminders
-- Chạy SAU 068. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== B1: CÔNG NỢ PHẢI TRẢ NCC =====================
create table if not exists public.supplier_debts (
  id bigserial primary key,
  code text unique not null,
  import_doc text not null,           -- ma phieu nhap (inventory_txns.doc_code)
  supplier text not null default '',
  location_code text references public.locations(code),
  tong_tien bigint not null default 0,
  da_tra bigint not null default 0,
  con_no bigint generated always as (tong_tien - da_tra) stored,
  due_date date,
  status text not null default 'Còn nợ' check (status in ('Còn nợ','Đã thanh toán','Quá hạn')),
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.supplier_debts enable row level security;
create policy "supplier_debts_auth" on public.supplier_debts for all to authenticated using (true) with check (true);

-- Bang ghi nhan tung lan tra tien NCC
create table if not exists public.supplier_debt_payments (
  id bigserial primary key,
  debt_id bigint not null references public.supplier_debts(id),
  amount bigint not null,
  paid_at date not null default current_date,
  method text not null default 'Chuyển khoản',
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
alter table public.supplier_debt_payments enable row level security;
create policy "sdp_auth" on public.supplier_debt_payments for all to authenticated using (true) with check (true);

-- Ham tao no NCC khi nhap xe
create or replace function public.fn_tao_no_ncc(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/Quản lý/BGĐ được ghi nợ NCC';
  end if;
  if coalesce((p->>'tong_tien')::bigint, 0) <= 0 then
    raise exception 'THIEU_THONG_TIN: tổng tiền phải lớn hơn 0';
  end if;
  v_code := public.fn_gen_code('NO');
  insert into public.supplier_debts (code, import_doc, supplier, location_code, tong_tien, da_tra, due_date, note, created_by, created_by_name)
  values (v_code, p->>'import_doc', coalesce(p->>'supplier',''), nullif(p->>'location_code',''),
    (p->>'tong_tien')::bigint, coalesce((p->>'da_tra')::bigint, 0),
    nullif(p->>'due_date','')::date, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- Ham ghi nhan tra no NCC
create or replace function public.fn_tra_no_ncc(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record; v_amount bigint;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into d from public.supplier_debts where id = (p->>'debt_id')::bigint for update;
  if d is null then raise exception 'KHONG_TIM_THAY'; end if;
  v_amount := (p->>'amount')::bigint;
  if v_amount <= 0 then raise exception 'THIEU_THONG_TIN: số tiền phải > 0'; end if;
  if d.da_tra + v_amount > d.tong_tien then
    raise exception 'VUOT_SO_NO: tổng trả (%) vượt quá số nợ (%)', d.da_tra + v_amount, d.tong_tien;
  end if;
  insert into public.supplier_debt_payments (debt_id, amount, paid_at, method, note, created_by, created_by_name)
  values (d.id, v_amount, coalesce(nullif(p->>'paid_at','')::date, current_date),
    coalesce(nullif(p->>'method',''),'Chuyển khoản'), coalesce(p->>'note',''), me.uid, me.name);
  update public.supplier_debts set
    da_tra = da_tra + v_amount,
    status = case when da_tra + v_amount >= tong_tien then 'Đã thanh toán' else 'Còn nợ' end,
    updated_at = now()
  where id = d.id;
  -- Sinh phieu chi vao quy
  perform public._auto_thu(d.location_code, coalesce(nullif(p->>'method',''),'Chuyển khoản'),
    v_amount, 'Chi trả NCC', d.supplier,
    concat('Đơn nhập ', d.import_doc), concat('NO-', d.code, '-', v_amount), me.uid, me.name);
end $$;

-- View cong no phai tra NCC
create or replace view public.v_cong_no_phai_tra as
select d.*, l.name as location_name,
  coalesce(d.due_date < current_date and d.status = 'Còn nợ', false) as qua_han,
  (current_date - coalesce(d.due_date, d.created_at::date + 30))::int as so_ngay_qua_han
from public.supplier_debts d
left join public.locations l on l.code = d.location_code
where d.status <> 'Đã thanh toán';
grant select on public.v_cong_no_phai_tra to authenticated;

-- ===================== B2: LUỒNG DUYỆT PHIẾU CHI THỦ CÔNG =====================
alter table public.cash_txns add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending','approved','rejected'));
alter table public.cash_txns add column if not exists approved_by uuid references public.profiles(id);
alter table public.cash_txns add column if not exists approved_by_name text default '';
alter table public.cash_txns add column if not exists approved_at timestamptz;
alter table public.cash_txns add column if not exists reject_reason text default '';

-- Phieu chi thu cong moi (direction=Chi, khong co ref_doc) -> bat dau o pending neu la SALES/TECHNICIAN
-- Phieu chi tu dong (ref_doc co) -> approved luon
-- Ham duyet phieu chi
create or replace function public.fn_duyet_phieu_chi(p_id bigint, p_chap_nhan boolean, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/BGĐ được duyệt phiếu chi';
  end if;
  select * into t from public.cash_txns where id = p_id;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.direction <> 'Chi' then raise exception 'KHONG_PHU_HOP: chỉ duyệt phiếu chi'; end if;
  if t.approval_status <> 'pending' then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái chờ duyệt'; end if;
  update public.cash_txns set
    approval_status = case when p_chap_nhan then 'approved' else 'rejected' end,
    approved_by = me.uid, approved_by_name = me.name, approved_at = now(),
    reject_reason = case when not p_chap_nhan then coalesce(trim(p_ly_do),'') else '' end
  where id = p_id;
end $$;

-- Sua fn_ghi_thu_chi: phieu chi thu cong cua SALES -> pending
create or replace function public.fn_ghi_thu_chi(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_dir text; v_pending boolean;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  v_dir := p->>'direction';
  if v_dir not in ('Thu','Chi') then raise exception 'THIEU_THONG_TIN: direction phải là Thu hoặc Chi'; end if;
  if coalesce((p->>'amount')::bigint,0) <= 0 then raise exception 'THIEU_THONG_TIN: số tiền phải lớn hơn 0'; end if;
  -- Phieu chi thu cong (khong co ref_doc) cua SALES/TECHNICIAN -> pending cho duyet
  v_pending := v_dir = 'Chi'
    and coalesce(nullif(p->>'ref_doc',''), null) is null
    and me.role in ('SALES','TECHNICIAN');
  v_code := public.fn_gen_code(case when v_dir='Thu' then 'PT' else 'PC' end);
  insert into public.cash_txns (code, txn_date, account_id, direction, amount, category,
    counterparty, description, ref_doc, created_by, created_by_name, approval_status)
  values (v_code,
    coalesce(nullif(p->>'txn_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    coalesce(nullif(p->>'account_id','')::bigint, public._quy_mac_dinh(me.uid, v_dir)),
    v_dir, (p->>'amount')::bigint, coalesce(nullif(p->>'category',''),'Khác'),
    coalesce(p->>'counterparty',''), coalesce(p->>'description',''),
    coalesce(nullif(p->>'ref_doc',''), null),
    me.uid, me.name,
    case when v_pending then 'pending' else 'approved' end);
  return v_code;
end $$;

-- ===================== B3: LỊCH SỬ NHẮC NỢ =====================
create table if not exists public.debt_reminders (
  id bigserial primary key,
  order_id bigint not null references public.sales_orders(id),
  order_code text not null,
  customer_name text not null default '',
  remind_at timestamptz not null default now(),
  channel text not null default 'Gọi điện'
    check (channel in ('Gọi điện','Nhắn tin','Zalo','Gặp trực tiếp','Email')),
  content text not null default '',
  result text default '',
  next_remind_date date,
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
alter table public.debt_reminders enable row level security;
create policy "debt_reminders_auth" on public.debt_reminders for all to authenticated using (true) with check (true);
create index if not exists debt_reminders_order_idx on public.debt_reminders (order_id);

-- Ham ghi nhan nhac no
create or replace function public.fn_ghi_nhac_no(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; o record;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select * into o from public.sales_orders where id = (p->>'order_id')::bigint;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  insert into public.debt_reminders (order_id, order_code, customer_name, channel, content, result, next_remind_date, created_by, created_by_name)
  values (o.id, o.code, o.customer_name,
    coalesce(nullif(p->>'channel',''),'Gọi điện'),
    coalesce(p->>'content',''), coalesce(p->>'result',''),
    nullif(p->>'next_remind_date','')::date,
    me.uid, me.name)
  returning id into v_id;
  -- Cap nhat debt_note tren don neu co
  if coalesce(p->>'debt_note','') <> '' then
    update public.sales_orders set debt_note = p->>'debt_note', updated_at = now() where id = o.id;
  end if;
  -- Cap nhat due_date neu co
  if nullif(p->>'due_date','') is not null then
    update public.sales_orders set due_date = (p->>'due_date')::date, updated_at = now() where id = o.id;
  end if;
  return v_id;
end $$;

do $do$
begin
  raise notice 'XONG 069: B1 supplier_debts + B2 cash_txns approval + B3 debt_reminders';
end $do$;
