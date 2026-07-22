-- ============================================================
-- Migration 042 — TEAM & TASKS: ĐẨY DISCORD (OUTBOX) + CRON
--  * Gui webhook RIENG cho cong viec (C7: key discord_webhook_task)
--  * Chay bat dong bo: RPC chi ghi outbox, cron day di moi phut
--  * Retry co gian cach, toi da 5 lan, loi khong lam hong tao task
--  * allowed_mentions rong -> KHONG BAO GIO mention @everyone/@here
--  * Canh bao qua han: gui 1 lan, nhac lai sau N gio (Cai dat)
--  * Cron sinh task lap lai hang ngay
-- Chay SAU 041. Chay lai nhieu lan van an toan.
-- YEU CAU: extension pg_cron + pg_net da bat.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===================== 1) GỬI 1 SỰ KIỆN =====================
-- Escape ky tu nguy hiem + chan mention bay
create or replace function public._task_safe(p text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p,''), '@everyone', '@ everyone'), '@here', '@ here'), '```', '`')
$$;

create or replace function public._task_build_msg(p_event text, p_payload jsonb)
returns text language plpgsql immutable as $$
declare d jsonb := p_payload; v text;
begin
  v := case p_event
    when 'created' then
      '📌 **TASK MỚI** · `' || (d->>'code') || '`' || E'\n' ||
      '**' || public._task_safe(d->>'title') || '**' || E'\n' ||
      '👤 Người thực hiện: **' || public._task_safe(d->>'assignee') || '**' || E'\n' ||
      '📤 Người giao: ' || public._task_safe(d->>'assigned_by') || E'\n' ||
      '🏷 Mức độ: **' || (d->>'priority') || '**  ·  ⏰ Hạn: **' || (d->>'due_at') || '**' ||
      coalesce(E'\n🏪 Điểm: ' || (d->>'location'), '') ||
      coalesce(E'\n📝 ' || public._task_safe(d->>'description'), '') ||
      coalesce(E'\n☑ Checklist: ' || nullif(d->>'checklist',''), '') ||
      E'\n📊 Trạng thái: Chưa thực hiện'
    when 'started' then
      '🔵 **ĐÃ BẮT ĐẦU** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || '  ·  ⏰ Hạn: ' || (d->>'due_at')
    when 'submitted' then
      '🟡 **ĐÃ GỬI — CHỜ XÁC NHẬN** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') ||
      coalesce('  ·  ☑ ' || nullif(d->>'checklist',''), '') || E'\n' ||
      '📎 ' || coalesce(d->>'so_link','0') || ' link · ' || coalesce(d->>'so_anh','0') || ' ảnh · '
            || coalesce(d->>'so_file','0') || ' file' || E'\n' ||
      '🕐 Gửi lúc: ' || coalesce(d->>'submitted_at','—') ||
      case when (d->>'dung_han')::boolean then '  ✅ đúng hạn' else '  ⚠️ trễ hạn' end || E'\n' ||
      '📊 Trạng thái: **Chờ xác nhận**' ||
      coalesce(E'\n👀 Cần xác nhận: ' || nullif(d->>'reviewer',''), '')
    when 'revision' then
      '🔁 **CẦN BỔ SUNG** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || E'\n' ||
      '📋 Yêu cầu: ' || public._task_safe(d->>'yeu_cau') || E'\n' ||
      '🙋 Người yêu cầu: ' || public._task_safe(d->>'nguoi_yeu_cau') || '  ·  ⏰ Hạn: ' || (d->>'due_at')
    when 'completed' then
      '✅ **ĐÃ HOÀN THÀNH** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || E'\n' ||
      '⏰ Hạn: ' || (d->>'due_at') || '  ·  🕐 Gửi: ' || coalesce(d->>'submitted_at','—') ||
      case when (d->>'dung_han')::boolean then '  ✅ **đúng hạn**' else '  ⚠️ **trễ hạn**' end ||
      coalesce(E'\n👀 Xác nhận bởi: ' || nullif(d->>'nguoi_xac_nhan',''), '') ||
      coalesce(E'\n💬 ' || nullif(public._task_safe(d->>'ghi_chu'),''), '')
    when 'overdue' then
      '⚠️ **TASK QUÁ HẠN** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || E'\n' ||
      '⏰ Hạn: ' || (d->>'due_at') || '  ·  ⌛ Quá **' || coalesce(d->>'qua_han','?') || '**' || E'\n' ||
      '📊 Hiện tại: ' || (d->>'status_vi') || '  ·  📤 Người giao: ' || public._task_safe(d->>'assigned_by')
    when 'updated' then
      '📝 **TASK ĐƯỢC CẬP NHẬT** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '🔄 ' || public._task_safe(d->>'thay_doi') || E'\n' ||
      '✍️ Người sửa: ' || public._task_safe(d->>'nguoi_sua') ||
      coalesce('  ·  Lý do: ' || nullif(public._task_safe(d->>'ly_do'),''), '')
    else '📋 ' || (d->>'code') || ' · ' || public._task_safe(d->>'title')
  end;
  return v;
end $$;

-- Day toi da N su kien dang cho trong outbox
create or replace function public.fn_task_day_outbox(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_url text; v_n int := 0; v_body jsonb;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  -- Chua cau hinh kenh rieng -> dung kenh chung
  if coalesce(v_url,'') = '' then
    select value into v_url from public.app_settings where key = 'discord_webhook';
  end if;
  if coalesce(v_url,'') = '' then return 0; end if;

  for o in select * from public.task_outbox
           where status = 'pending' and (next_retry_at is null or next_retry_at <= now())
           order by id limit p_limit loop
    begin
      v_body := jsonb_build_object(
        'content', public._task_build_msg(o.event_type, o.payload),
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)  -- KHONG mention ai
      );
      perform net.http_post(url := v_url, body := v_body,
        headers := '{"Content-Type": "application/json"}'::jsonb);
      update public.task_outbox set status = 'sent', sent_at = now(), attempt_count = attempt_count + 1
      where id = o.id;
      v_n := v_n + 1;
    exception when others then
      update public.task_outbox set
        attempt_count = attempt_count + 1,
        error_message = left(SQLERRM, 300),
        status = case when attempt_count + 1 >= 5 then 'failed' else 'pending' end,
        next_retry_at = now() + (power(3, attempt_count + 1) || ' minutes')::interval
      where id = o.id;
    end;
  end loop;
  return v_n;
end $$;

-- ===================== 2) CẢNH BÁO QUÁ HẠN (không spam) =====================
create or replace function public.fn_task_quet_qua_han()
returns int language plpgsql security definer set search_path = public as $$
declare t record; v_n int := 0; v_gio numeric; v_key text; v_lan int; v_nhac numeric;
begin
  select coalesce(nullif(value,'')::numeric, 24) into v_nhac
  from public.app_settings where key = 'task_nhac_qua_han_gio';
  v_nhac := coalesce(v_nhac, 24);

  for t in select * from public.v_task_list where is_overdue loop
    v_gio := t.gio_qua_han;
    -- Moc nhac: lan 0 (vua qua han), roi moi v_nhac gio 1 lan
    v_lan := floor(v_gio / greatest(v_nhac, 1))::int;
    v_key := t.id::text || ':overdue:' || v_lan;
    if exists (select 1 from public.task_outbox where idempotency_key = v_key) then continue; end if;

    insert into public.task_outbox (task_id, event_type, payload, idempotency_key, status, next_retry_at)
    values (t.id, 'overdue', jsonb_build_object(
      'code', t.code, 'title', t.title, 'assignee', t.assignee_name,
      'assigned_by', coalesce(nullif(t.assigned_by_name,''), t.created_by_name),
      'due_at', to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY'),
      'qua_han', case when v_gio < 24 then round(v_gio) || ' giờ' else round(v_gio/24) || ' ngày' end,
      'status_vi', case t.status when 'not_started' then 'Chưa thực hiện'
                     when 'in_progress' then 'Đang thực hiện'
                     when 'pending_review' then 'Chờ xác nhận'
                     when 'needs_revision' then 'Cần bổ sung' else t.status end
    ), v_key, 'pending', now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ===================== 3) TEST WEBHOOK (cho Admin bam thu) =====================
create or replace function public.fn_task_test_webhook()
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_url text;
begin
  select * into me from public.fn_me_mkt();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then raise exception 'CHUA_CAU_HINH: chưa dán webhook kênh công việc trong Cài đặt'; end if;
  perform net.http_post(url := v_url,
    body := jsonb_build_object(
      'content', '✅ **Kết nối thành công** — kênh công việc Minh Kỳ EV đã sẵn sàng. (Thử bởi ' || me.name || ')',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;

-- ===================== 4) CRON =====================
-- Go lich cu neu chay lai file
do $do$
begin
  perform cron.unschedule('task-outbox-1p');
exception when others then null; end $do$;
do $do$
begin
  perform cron.unschedule('task-qua-han-1h');
exception when others then null; end $do$;
do $do$
begin
  perform cron.unschedule('task-sinh-ky-6h');
exception when others then null; end $do$;

-- Day outbox moi phut
select cron.schedule('task-outbox-1p', '* * * * *', $$ select public.fn_task_day_outbox(20); $$);
-- Quet qua han moi gio
select cron.schedule('task-qua-han-1h', '0 * * * *', $$ select public.fn_task_quet_qua_han(); $$);
-- Sinh task lap lai: 6h sang gio VN = 23h UTC hom truoc
select cron.schedule('task-sinh-ky-6h', '0 23 * * *', $$ select public.fn_task_sinh_ky(); $$);

-- ===================== 5) KIỂM TRA =====================
do $do$
declare v_job int;
begin
  select count(*) into v_job from cron.job where jobname like 'task-%';
  raise notice 'XONG 042: da lap % lich cron (mong doi 3)', v_job;
end $do$;

-- ============================================================
-- ROLLBACK:
--   select cron.unschedule('task-outbox-1p');
--   select cron.unschedule('task-qua-han-1h');
--   select cron.unschedule('task-sinh-ky-6h');
--   drop function if exists public.fn_task_day_outbox(int),
--     public.fn_task_quet_qua_han(), public.fn_task_test_webhook(),
--     public._task_build_msg(text, jsonb), public._task_safe(text);
-- ============================================================
