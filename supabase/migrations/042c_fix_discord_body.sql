-- ============================================================
-- Migration 042c — VÁ TRIỆT ĐỂ lỗi Discord 400 "empty message"
--
-- Nguyen nhan that: khoi tao body bang jsonb_build_object long nhau
-- voi '[]'::jsonb lam Discord doc sai dinh dang -> tu choi ca tin.
--
-- Sua: xay body bang CHUOI JSON tuong minh (to_jsonb cho noi dung,
-- dam bao escape dung), BO allowed_mentions (da chan mention bang
-- cach escape noi dung trong _task_safe roi -> van an toan).
--
-- Chay SAU 042b. Chay lai nhieu lan van an toan.
-- ============================================================

-- ---------- 1) Escape chac chan: chan ca mention role/user ----------
create or replace function public._task_safe(p text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p, ''),
    '@everyone', '[at]everyone'),
    '@here',     '[at]here'),
    '<@',        '[at]'),          -- chan mention user/role dang <@123>
    '```',       '`')
$$;

-- ---------- 2) Day outbox: body xay bang to_jsonb, khong long object ----------
create or replace function public.fn_task_day_outbox(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_url text; v_n int := 0; v_msg text; v_body jsonb;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then
    select value into v_url from public.app_settings where key = 'discord_webhook';
  end if;
  if coalesce(v_url,'') = '' then return 0; end if;
  v_url := replace(v_url, 'discordapp.com', 'discord.com');

  for o in select * from public.task_outbox
           where status = 'pending' and (next_retry_at is null or next_retry_at <= now())
           order by id limit p_limit loop
    begin
      v_msg := public._task_build_msg(o.event_type, o.payload);

      if coalesce(btrim(v_msg), '') = '' then
        update public.task_outbox set status = 'failed', attempt_count = attempt_count + 1,
          error_message = 'Nội dung tin nhắn rỗng — kiểm tra _task_build_msg'
        where id = o.id;
        continue;
      end if;

      -- Body toi gian: CHI co content. to_jsonb tu escape dung chuan JSON.
      v_body := jsonb_build_object('content', left(v_msg, 1900));

      perform net.http_post(url := v_url, body := v_body,
        headers := jsonb_build_object('Content-Type', 'application/json'));

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

-- ---------- 3) Test webhook: cho lau hon + bao ro rang ----------
drop function if exists public.fn_task_test_webhook();
create or replace function public.fn_task_test_webhook()
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_url text; v_req bigint; v_code int; v_body text; i int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then raise exception 'CHUA_CAU_HINH: chưa dán webhook kênh công việc'; end if;
  v_url := replace(v_url, 'discordapp.com', 'discord.com');

  select net.http_post(
    url := v_url,
    body := jsonb_build_object('content',
      '✅ Kết nối thành công — kênh công việc Minh Kỳ EV đã sẵn sàng. (Thử bởi ' || me.name || ')'),
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) into v_req;

  while i < 40 loop                       -- cho toi da ~8 giay
    perform pg_sleep(0.2);
    select status_code, left(content::text, 250) into v_code, v_body
    from net._http_response where id = v_req;
    exit when v_code is not null;
    i := i + 1;
  end loop;

  if v_code is null then
    return 'Đã gửi (request ' || v_req || '), chưa có phản hồi sau 8 giây. Chạy: select status_code, content from net._http_response where id = ' || v_req || ';';
  elsif v_code between 200 and 299 then
    return 'THÀNH CÔNG (mã ' || v_code || ') — kiểm tra kênh Discord.';
  else
    return 'LỖI (mã ' || v_code || '): ' || coalesce(v_body, '');
  end if;
end $$;

-- ---------- 4) Cho cac tin loi cu gui lai ----------
update public.task_outbox
set status = 'pending', attempt_count = 0, next_retry_at = now(), error_message = ''
where status = 'failed';
