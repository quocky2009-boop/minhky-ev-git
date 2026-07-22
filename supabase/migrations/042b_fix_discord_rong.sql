-- ============================================================
-- Migration 042b — VÁ LỖI Discord trả 400 "Cannot send an empty message"
--
-- Nguyen nhan: ham _task_safe dung '\u200b' (ky tu vo hinh) viet trong
-- chuoi SQL thuong -> Postgres hieu la 6 ky tu literal, khi ghep vao
-- JSON lam noi dung 'content' thanh RONG -> Discord tu choi 400.
--
-- Sua: (1) doi cach chan mention — chen dau cach thay vi ky tu vo hinh
--      (2) them chot chan: content rong thi KHONG gui, ghi loi ro rang
--      (3) fn_task_test_webhook doc ket qua that su tu net._http_response
-- Chay SAU 042. Chay lai nhieu lan van an toan.
-- ============================================================

-- ---------- 1) Ham escape: bo \u200b, dung cach don gian ma chac chan ----------
create or replace function public._task_safe(p text)
returns text language sql immutable as $$
  select coalesce(
    nullif(
      replace(
        replace(
          replace(coalesce(p, ''), '@everyone', '@ everyone'),
          '@here', '@ here'),
        '```', '`'),
      ''),
    '')
$$;

-- ---------- 2) Day outbox: khong bao gio gui tin rong ----------
create or replace function public.fn_task_day_outbox(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_url text; v_n int := 0; v_body jsonb; v_msg text;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then
    select value into v_url from public.app_settings where key = 'discord_webhook';
  end if;
  if coalesce(v_url,'') = '' then return 0; end if;
  -- Ten mien cu discordapp.com khong duoc pg_net di theo chuyen huong
  v_url := replace(v_url, 'discordapp.com', 'discord.com');

  for o in select * from public.task_outbox
           where status = 'pending' and (next_retry_at is null or next_retry_at <= now())
           order by id limit p_limit loop
    begin
      v_msg := public._task_build_msg(o.event_type, o.payload);

      -- CHOT CHAN: tin rong -> danh dau loi, khong goi Discord
      if coalesce(btrim(v_msg), '') = '' then
        update public.task_outbox set status = 'failed', attempt_count = attempt_count + 1,
          error_message = 'Nội dung tin nhắn rỗng — kiểm tra _task_build_msg'
        where id = o.id;
        continue;
      end if;

      v_body := jsonb_build_object(
        'content', left(v_msg, 1900),                       -- Discord gioi han 2000 ky tu
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
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

-- ---------- 3) Test webhook: doc ket qua THAT SU tu pg_net ----------
-- LUU Y: ban o 042 tra ve VOID, ban nay tra ve TEXT -> phai drop truoc
drop function if exists public.fn_task_test_webhook();
create or replace function public.fn_task_test_webhook()
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_url text; v_req bigint; v_code int; v_body text; i int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;

  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then
    raise exception 'CHUA_CAU_HINH: chưa dán webhook kênh công việc trong Cài đặt';
  end if;
  v_url := replace(v_url, 'discordapp.com', 'discord.com');

  select net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'content', '✅ Kết nối thành công — kênh công việc Minh Kỳ EV đã sẵn sàng. (Thử bởi ' || me.name || ')',
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  -- pg_net gui bat dong bo -> cho toi da ~3 giay de lay ket qua
  while i < 15 loop
    perform pg_sleep(0.2);
    select status_code, left(content::text, 200) into v_code, v_body
    from net._http_response where id = v_req;
    exit when v_code is not null;
    i := i + 1;
  end loop;

  if v_code is null then
    return 'Đã gửi, chưa có phản hồi. Kiểm tra kênh Discord hoặc chạy: select * from net._http_response order by id desc limit 3;';
  elsif v_code between 200 and 299 then
    return 'THÀNH CÔNG (mã ' || v_code || ') — kiểm tra kênh Discord.';
  else
    return 'LỖI (mã ' || v_code || '): ' || coalesce(v_body, '');
  end if;
end $$;

-- ---------- 4) Dọn các tin lỗi cũ để gửi lại ----------
update public.task_outbox
set status = 'pending', attempt_count = 0, next_retry_at = now(), error_message = ''
where status = 'failed';

-- ---------- 5) Chuẩn hóa luôn webhook đang lưu ----------
update public.app_settings
set value = replace(value, 'discordapp.com', 'discord.com')
where key in ('discord_webhook_task', 'discord_webhook')
  and value like '%discordapp.com%';
