-- ============================================================
-- Migration 012: THU - CHI & QUY TIEN
-- - Quy tien mat / tai khoan ngan hang (gan duoc theo diem ban)
-- - So thu chi append-only, chot quy hang ngay co so lech
-- - Bao cao tu dong 21h00 (VN) vao channel Discord rieng (pg_cron)
-- - Phan quyen: CHI CEO / ADMIN / MANAGER duoc xem & thao tac
-- Chay SAU 011, 1 lan duy nhat.
-- ============================================================

create extension if not exists pg_cron;

-- Danh muc hang muc thu/chi + webhook rieng (chinh trong Cai dat)
insert into public.app_settings(key, value) values ('thu_categories', 'Bán xe
Cọc xe
Thu nợ
Thu dịch vụ
Thu khác') on conflict do nothing;
insert into public.app_settings(key, value) values ('chi_categories', 'Nhập hàng
Lương
Mặt bằng
Điện nước
Marketing
Vận chuyển
Hoàn cọc
Chi khác') on conflict do nothing;
insert into public.app_settings(key, value) values ('discord_webhook_thuchi', '') on conflict do nothing;

-- ---- QUY TIEN ----
create table public.cash_accounts (
  id bigserial primary key,
  name text not null,
  type text not null default 'Tiền mặt' check (type in ('Tiền mặt','Ngân hàng')),
  location_code text references public.locations(code),
  bank_info text default '',
  opening_balance bigint not null default 0,
  status text not null default 'Hoạt động',
  created_at timestamptz not null default now()
);

-- ---- SO THU CHI (append-only) ----
create table public.cash_txns (
  id bigserial primary key,
  code text unique not null,
  txn_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  account_id bigint not null references public.cash_accounts(id),
  direction text not null check (direction in ('Thu','Chi')),
  amount bigint not null check (amount > 0),
  category text not null,
  counterparty text default '',
  description text default '',
  ref_doc text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index on public.cash_txns (txn_date desc);
create index on public.cash_txns (account_id, txn_date);

-- ---- CHOT QUY HANG NGAY ----
create table public.cash_closings (
  id bigserial primary key,
  account_id bigint not null references public.cash_accounts(id),
  close_date date not null,
  system_balance bigint not null,
  actual_balance bigint not null,
  diff bigint not null,
  note text default '',
  closed_by uuid references public.profiles(id),
  closed_by_name text default '',
  created_at timestamptz not null default now(),
  unique (account_id, close_date)
);

-- ---- RLS: chi CEO/ADMIN/MANAGER ----
alter table public.cash_accounts enable row level security;
alter table public.cash_txns enable row level security;
alter table public.cash_closings enable row level security;
create policy "read_cash_accounts" on public.cash_accounts for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER')));
create policy "read_cash_txns" on public.cash_txns for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER')));
create policy "read_cash_closings" on public.cash_closings for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER')));

-- ---- HAM ----
create or replace function public.fn_so_du(p_account bigint, p_to date default null)
returns bigint language sql security definer set search_path = public stable as $$
  select a.opening_balance
    + coalesce((select sum(case when t.direction='Thu' then t.amount else -t.amount end)
                from public.cash_txns t
                where t.account_id = a.id and (p_to is null or t.txn_date <= p_to)), 0)
  from public.cash_accounts a where a.id = p_account;
$$;

create or replace function public.fn_them_quy(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được quản lý quỹ'; end if;
  if coalesce(p->>'id','') <> '' then
    update public.cash_accounts set
      name = trim(p->>'name'), type = coalesce(nullif(p->>'type',''), type),
      location_code = nullif(p->>'location_code',''), bank_info = coalesce(p->>'bank_info',''),
      opening_balance = coalesce((p->>'opening_balance')::bigint, opening_balance),
      status = coalesce(nullif(p->>'status',''), status)
    where id = (p->>'id')::bigint;
  else
    insert into public.cash_accounts (name, type, location_code, bank_info, opening_balance)
    values (trim(p->>'name'), coalesce(nullif(p->>'type',''),'Tiền mặt'),
            nullif(p->>'location_code',''), coalesce(p->>'bank_info',''),
            coalesce((p->>'opening_balance')::bigint, 0));
  end if;
end $$;

create or replace function public.fn_ghi_thu_chi(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ được ghi thu chi'; end if;
  if coalesce((p->>'amount')::bigint,0) <= 0 then raise exception 'SO_LUONG_SAI: số tiền phải > 0'; end if;
  if not exists (select 1 from public.cash_accounts where id = (p->>'account_id')::bigint and status = 'Hoạt động') then
    raise exception 'KHONG_TIM_THAY: quỹ không tồn tại hoặc đã khóa';
  end if;
  if (p->>'direction') = 'Chi' and public.fn_so_du((p->>'account_id')::bigint) < (p->>'amount')::bigint then
    raise exception 'TON_KHONG_DU: số dư quỹ hiện tại là % đ, không đủ chi', public.fn_so_du((p->>'account_id')::bigint);
  end if;
  v_code := public.fn_gen_code(case when p->>'direction' = 'Thu' then 'PT' else 'PC' end);
  insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, coalesce(nullif(p->>'txn_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
          (p->>'account_id')::bigint, p->>'direction', (p->>'amount')::bigint,
          coalesce(nullif(p->>'category',''),'Khác'), coalesce(p->>'counterparty',''),
          coalesce(p->>'description',''), coalesce(p->>'ref_doc',''), me.uid, me.name);
  return v_code;
end $$;

create or replace function public.fn_chot_quy(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_date date; v_sys bigint;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  v_date := coalesce(nullif(p->>'close_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_sys := public.fn_so_du((p->>'account_id')::bigint, v_date);
  insert into public.cash_closings (account_id, close_date, system_balance, actual_balance, diff, note, closed_by, closed_by_name)
  values ((p->>'account_id')::bigint, v_date, v_sys, (p->>'actual_balance')::bigint,
          (p->>'actual_balance')::bigint - v_sys, coalesce(p->>'note',''), me.uid, me.name)
  on conflict (account_id, close_date) do update set
    system_balance = excluded.system_balance, actual_balance = excluded.actual_balance,
    diff = excluded.diff, note = excluded.note, closed_by = excluded.closed_by,
    closed_by_name = excluded.closed_by_name, created_at = now();
end $$;

-- ---- BAO CAO QUY -> DISCORD (channel rieng) ----
create or replace function public.fn_bao_cao_quy_discord()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text; v_today date; a record; fields jsonb := '[]'::jsonb;
  v_thu bigint; v_chi bigint; v_bal bigint; cl record;
  t_thu bigint := 0; t_chi bigint := 0; t_bal bigint := 0; v_status text; n_unclosed int := 0;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_thuchi';
  if coalesce(v_url,'') = '' then return; end if;
  v_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;

  for a in select * from public.cash_accounts where status = 'Hoạt động' order by type, name loop
    select coalesce(sum(amount),0) into v_thu from public.cash_txns where account_id = a.id and txn_date = v_today and direction = 'Thu';
    select coalesce(sum(amount),0) into v_chi from public.cash_txns where account_id = a.id and txn_date = v_today and direction = 'Chi';
    v_bal := public.fn_so_du(a.id);
    select * into cl from public.cash_closings where account_id = a.id and close_date = v_today;
    if cl is null then
      v_status := '⚠ CHƯA CHỐT QUỸ'; n_unclosed := n_unclosed + 1;
    elsif cl.diff = 0 then v_status := '✅ Đã chốt · khớp';
    else v_status := '🔴 Đã chốt · LỆCH ' || to_char(cl.diff, 'FM999G999G999G999') || ' đ';
    end if;
    fields := fields || jsonb_build_object(
      'name', (case when a.type = 'Tiền mặt' then '💵 ' else '🏦 ' end) || a.name,
      'value', 'Thu: **' || to_char(v_thu,'FM999G999G999G999') || ' đ** · Chi: **' || to_char(v_chi,'FM999G999G999G999')
        || ' đ**' || chr(10) || 'Số dư: **' || to_char(v_bal,'FM999G999G999G999') || ' đ** · ' || v_status,
      'inline', false);
    t_thu := t_thu + v_thu; t_chi := t_chi + v_chi; t_bal := t_bal + v_bal;
  end loop;

  fields := fields || jsonb_build_object('name', '━━━ TỔNG TOÀN HỆ THỐNG ━━━',
    'value', 'Thu hôm nay: **' || to_char(t_thu,'FM999G999G999G999') || ' đ** · Chi hôm nay: **' || to_char(t_chi,'FM999G999G999G999')
      || ' đ**' || chr(10) || 'Tổng số dư các quỹ: **' || to_char(t_bal,'FM999G999G999G999') || ' đ**'
      || case when n_unclosed > 0 then chr(10) || '⚠ Còn **' || n_unclosed || ' quỹ chưa chốt** hôm nay!' else '' end,
    'inline', false);

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('username', 'Minh Kỳ EV · Thu Chi',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '📊 BÁO CÁO QUỸ NGÀY ' || to_char(v_today, 'DD/MM/YYYY'),
        'color', 1219937, 'fields', fields,
        'footer', jsonb_build_object('text', 'Tự động lúc 21h00 · Minh Kỳ EV')))),
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then null;
end $$;

-- Gui bao cao thu (nut trong app)
create or replace function public.fn_test_discord_thuchi()
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_url text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_thuchi';
  if coalesce(v_url,'') = '' then raise exception 'THIEU_THONG_TIN: chưa lưu webhook Thu-Chi'; end if;
  perform public.fn_bao_cao_quy_discord();
end $$;

-- ---- LICH CHAY 21H00 VN (= 14:00 UTC) HANG NGAY ----
do $$ begin
  perform cron.unschedule('bao-cao-quy-21h');
exception when others then null; end $$;
select cron.schedule('bao-cao-quy-21h', '0 14 * * *', $$select public.fn_bao_cao_quy_discord()$$);
