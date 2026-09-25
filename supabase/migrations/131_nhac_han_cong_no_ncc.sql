-- 131_nhac_han_cong_no_ncc.sql
-- Muc dich: he thong tu dong nhac han thanh toan cong no NCC (supplier_debts)
-- qua Discord — thay the viec theo doi tay bang Google Sheets.
--
-- Nghiep vu da chot voi anh Ky:
-- 1. Tan suat nhac (dem nguoc toi due_date):
--    - T-5: 1 lan/ngay (09:00)
--    - T-3: 1 lan/ngay (09:00)
--    - T-1: 2 lan/ngay (09:00, 15:00)
--    - Ngay T (den han): 3 lan/ngay (08:00, 12:00, 16:00) + 1 lan luc 30 phut
--      truoc "gio han" — gio han chon la 17:00 (theo xac nhan cua anh Ky) ->
--      moc dac biet la 16:30.
--    - Qua han: 1 lan/gio, 24/7, lap lien tuc toi khi xac nhan da thanh toan
--      (theo xac nhan cua anh Ky — khong gioi han gio hanh chinh).
-- 2. Nguoi bam "Xac nhan da thanh toan": CEO va Ke toan (role CEO + ADMIN).
--
-- Kien truc: mo phong dung pattern outbox + cron da co san cho module Cong
-- viec (xem migration 042_task_discord_cron.sql — task_outbox/fn_task_day_outbox)
-- de nhat quan va giam rui ro: 1 ham "quet" ghi vao bang debt_outbox (idempotent
-- theo debt_id+ngay+slot, tranh gui trung du cron chay lai nhieu lan), 1 ham
-- rieng "day" outbox qua webhook Discord (co retry/backoff nhu ham cua Task).
-- Dung webhook rieng 'discord_webhook_congno' neu co, khong thi fallback ve
-- 'discord_webhook' (kenh chung) — giong cach discord_webhook_task da lam.
--
-- Chay sau 130. Chay lai nhieu lan van an toan (unschedule + schedule lai).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===================== BANG OUTBOX NHAC NO NCC =====================
create table if not exists public.debt_outbox (
  id bigserial primary key,
  debt_id bigint not null references public.supplier_debts(id) on delete cascade,
  event_type text not null default 'nhac_no' check (event_type in ('nhac_no')),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text unique not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count int not null default 0,
  error_message text,
  next_retry_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists debt_outbox_status_idx on public.debt_outbox (status, next_retry_at);
create index if not exists debt_outbox_debt_idx on public.debt_outbox (debt_id);
alter table public.debt_outbox enable row level security;
drop policy if exists "debt_outbox_auth" on public.debt_outbox;
create policy "debt_outbox_auth" on public.debt_outbox for select to authenticated using (true);
-- Ghi chi qua ham SECURITY DEFINER (fn_debt_quet_nhac_no) — khong co policy insert/update rieng.

-- ===================== NOI DUNG TIN NHAN DISCORD =====================
create or replace function public._debt_build_msg(p jsonb)
returns text language plpgsql immutable as $$
declare v_days int := (p->>'so_ngay')::int; v_con_no text;
begin
  v_con_no := to_char((p->>'con_no')::bigint, 'FM999,999,999,999') || 'đ';
  if v_days > 0 then
    return '⏳ **NHẮC HẠN TRẢ NCC** · `' || (p->>'code') || '`' || E'\n' ||
      'NCC: **' || (p->>'supplier') || '**  ·  Còn nợ: **' || v_con_no || '**' || E'\n' ||
      '📅 Hạn thanh toán: ' || (p->>'due_date') || '  ·  Còn ' || v_days || ' ngày';
  elsif v_days = 0 then
    return '🔔 **HÔM NAY LÀ HẠN TRẢ NCC** · `' || (p->>'code') || '`' || E'\n' ||
      'NCC: **' || (p->>'supplier') || '**  ·  Còn nợ: **' || v_con_no || '**' || E'\n' ||
      '📅 Hạn: ' || (p->>'due_date');
  else
    return '🚨 **QUÁ HẠN TRẢ NCC** · `' || (p->>'code') || '`' || E'\n' ||
      'NCC: **' || (p->>'supplier') || '**  ·  Còn nợ: **' || v_con_no || '**' || E'\n' ||
      '📅 Đã quá hạn ' || abs(v_days) || ' ngày (hạn ' || (p->>'due_date') || ')';
  end if;
end $$;

-- ===================== QUET + GHI OUTBOX (idempotent) =====================
create or replace function public.fn_debt_quet_nhac_no()
returns int language plpgsql security definer set search_path = public as $$
declare d record; v_today date; v_now time; v_days int; v_slot text; v_n int := 0; v_key text;
  v_gio_han time := '17:00';
begin
  v_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_now := (now() at time zone 'Asia/Ho_Chi_Minh')::time;

  for d in
    select * from public.supplier_debts
    where status = 'Còn nợ' and due_date is not null and con_no > 0
  loop
    v_days := d.due_date - v_today;
    v_slot := null;

    if v_days = 5 and v_now >= time '09:00' then v_slot := 'd5';
    elsif v_days = 3 and v_now >= time '09:00' then v_slot := 'd3';
    elsif v_days = 1 then
      if v_now >= time '15:00' then v_slot := 'd1b';
      elsif v_now >= time '09:00' then v_slot := 'd1a';
      end if;
    elsif v_days = 0 then
      if v_now >= (v_gio_han - interval '30 minutes') then v_slot := '0pre';
      elsif v_now >= time '16:00' then v_slot := '0c';
      elsif v_now >= time '12:00' then v_slot := '0b';
      elsif v_now >= time '08:00' then v_slot := '0a';
      end if;
    elsif v_days < 0 then
      v_slot := 'ov-' || to_char(v_now, 'HH24');
    end if;

    if v_slot is null then continue; end if;

    v_key := d.id || ':' || v_today || ':' || v_slot;
    if exists (select 1 from public.debt_outbox where idempotency_key = v_key) then continue; end if;

    insert into public.debt_outbox (debt_id, event_type, payload, idempotency_key, status, next_retry_at)
    values (d.id, 'nhac_no', jsonb_build_object(
      'code', d.code, 'supplier', d.supplier, 'con_no', d.con_no,
      'due_date', to_char(d.due_date, 'DD/MM/YYYY'), 'so_ngay', v_days, 'slot', v_slot
    ), v_key, 'pending', now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ===================== DAY OUTBOX QUA DISCORD (co retry) =====================
create or replace function public.fn_debt_day_outbox(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_url text; v_n int := 0; v_body jsonb;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_congno';
  if coalesce(v_url,'') = '' then
    select value into v_url from public.app_settings where key = 'discord_webhook';
  end if;
  if coalesce(v_url,'') = '' then return 0; end if;

  for o in select * from public.debt_outbox
           where status = 'pending' and (next_retry_at is null or next_retry_at <= now())
           order by id limit p_limit
  loop
    begin
      v_body := jsonb_build_object(
        'content', public._debt_build_msg(o.payload),
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
      );
      perform net.http_post(url := v_url, body := v_body,
        headers := '{"Content-Type": "application/json"}'::jsonb);
      update public.debt_outbox set status = 'sent', sent_at = now(), attempt_count = attempt_count + 1
      where id = o.id;
      v_n := v_n + 1;
    exception when others then
      update public.debt_outbox set
        attempt_count = attempt_count + 1,
        error_message = left(SQLERRM, 300),
        status = case when attempt_count + 1 >= 5 then 'failed' else 'pending' end,
        next_retry_at = now() + (power(3, attempt_count + 1) || ' minutes')::interval
      where id = o.id;
    end;
  end loop;
  return v_n;
end $$;

-- ===================== PATCH fn_tra_no_ncc: huy nhac con "pending" khi tra du =====================
-- Chu ky ham KHONG doi (van p jsonb) -> khong can DROP FUNCTION.
-- Toan bo logic goc giu nguyen, chi them 1 khoi: neu tra du (status -> 'Đã
-- thanh toán') thi xoa cac dong debt_outbox status='pending' cua khoan no do
-- de tranh gui nham 1 nhac han ngay sau khi da xac nhan thanh toan.
create or replace function public.fn_tra_no_ncc(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record; v_amount bigint; v_da_du boolean;
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
  v_da_du := d.da_tra + v_amount >= d.tong_tien;
  update public.supplier_debts set
    da_tra = da_tra + v_amount,
    status = case when v_da_du then 'Đã thanh toán' else 'Còn nợ' end,
    updated_at = now()
  where id = d.id;
  if v_da_du then
    delete from public.debt_outbox where debt_id = d.id and status = 'pending';
  end if;
  perform public._auto_chi(d.location_code, coalesce(nullif(p->>'method',''),'Chuyển khoản'),
    v_amount, 'Chi trả NCC', d.supplier,
    concat('Đơn nhập ', d.import_doc), concat('NO-', d.code, '-', v_amount), me.uid, me.name,
    nullif(p->>'account_id','')::bigint);
end $$;

-- ===================== CRON =====================
do $do$ begin perform cron.unschedule('debt-quet-nhac-15p'); exception when others then null; end $do$;
do $do$ begin perform cron.unschedule('debt-outbox-1p'); exception when others then null; end $do$;

-- Quet moi 15 phut (du de bat het cac moc gio le va nhac qua han hang gio)
select cron.schedule('debt-quet-nhac-15p', '*/15 * * * *', $$ select public.fn_debt_quet_nhac_no(); $$);
-- Day outbox moi phut
select cron.schedule('debt-outbox-1p', '* * * * *', $$ select public.fn_debt_day_outbox(20); $$);

-- ===================== KIEM TRA =====================
-- select jobname, schedule from cron.job where jobname like 'debt-%';
-- select oid::regprocedure from pg_proc where proname = 'fn_tra_no_ncc'; -- ky vong 1 dong
-- select public.fn_debt_quet_nhac_no(); -- chay thu, tra ve so nhac moi ghi vao outbox
-- select * from debt_outbox order by id desc limit 20;

-- ===================== ROLLBACK =====================
-- select cron.unschedule('debt-quet-nhac-15p');
-- select cron.unschedule('debt-outbox-1p');
-- drop function if exists public.fn_debt_quet_nhac_no(), public.fn_debt_day_outbox(int), public._debt_build_msg(jsonb);
-- drop table if exists public.debt_outbox;
