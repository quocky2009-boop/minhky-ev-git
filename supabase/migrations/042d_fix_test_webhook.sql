-- ============================================================
-- Migration 042d — VÁ DỨT ĐIỂM lỗi 400 cua fn_task_test_webhook
--
-- Da chung minh: net.http_post gui BINH THUONG (test 3 cach deu 204/200).
-- Vay loi nam trong ham: chuoi 'content' bi rong khi ghep.
-- Nguyen nhan: emoji ✅ + phep noi chuoi || voi bien co the tra NULL
-- (neu me.name la NULL thi CA CHUOI thanh NULL -> content rong -> 400).
--
-- Sua: (1) dung concat() thay || (concat bo qua NULL, khong lam rong chuoi)
--      (2) bo emoji khoi phan ghep, dat trong chuoi co dinh
--      (3) chot chan: neu content rong thi bao loi ro rang, khong goi Discord
-- Chay SAU 042c. Chay lai nhieu lan van an toan.
-- ============================================================

drop function if exists public.fn_task_test_webhook();
create or replace function public.fn_task_test_webhook()
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_url text; v_req bigint; v_code int; v_body text; v_msg text; i int := 0;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;

  select value into v_url from public.app_settings where key = 'discord_webhook_task';
  if coalesce(v_url,'') = '' then raise exception 'CHUA_CAU_HINH: chưa dán webhook kênh công việc'; end if;
  v_url := replace(v_url, 'discordapp.com', 'discord.com');

  -- concat() an toan hon '||': NULL khong lam rong ca chuoi
  v_msg := concat('Ket noi thanh cong - kenh cong viec Minh Ky EV da san sang. (Thu boi ',
                  coalesce(me.name, 'khong ro'), ')');
  if coalesce(btrim(v_msg),'') = '' then
    raise exception 'LOI_NOI_BO: nội dung tin nhắn rỗng';
  end if;

  select net.http_post(
    url := v_url,
    body := jsonb_build_object('content', v_msg),
    headers := jsonb_build_object('Content-Type','application/json')
  ) into v_req;

  while i < 40 loop
    perform pg_sleep(0.2);
    select status_code, left(content::text, 250) into v_code, v_body
    from net._http_response where id = v_req;
    exit when v_code is not null;
    i := i + 1;
  end loop;

  if v_code is null then
    return concat('Da gui (request ', v_req, '), chua co phan hoi. Kiem tra kenh Discord.');
  elsif v_code between 200 and 299 then
    return concat('THANH CONG (ma ', v_code, ') - kiem tra kenh Discord.');
  else
    return concat('LOI (ma ', v_code, '): ', coalesce(v_body,''));
  end if;
end $$;

-- ---------- Ap dung cung cach cho ham day outbox ----------
create or replace function public.fn_task_day_outbox(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare o record; v_url text; v_n int := 0; v_msg text;
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
          error_message = 'Noi dung rong - kiem tra _task_build_msg'
        where id = o.id;
        continue;
      end if;

      perform net.http_post(url := v_url,
        body := jsonb_build_object('content', left(v_msg, 1900)),
        headers := jsonb_build_object('Content-Type','application/json'));

      update public.task_outbox set status = 'sent', sent_at = now(), attempt_count = attempt_count + 1
      where id = o.id;
      v_n := v_n + 1;
    exception when others then
      update public.task_outbox set attempt_count = attempt_count + 1,
        error_message = left(SQLERRM, 300),
        status = case when attempt_count + 1 >= 5 then 'failed' else 'pending' end,
        next_retry_at = now() + (power(3, attempt_count + 1) || ' minutes')::interval
      where id = o.id;
    end;
  end loop;
  return v_n;
end $$;

-- ---------- Ham dung tin nhan: dung concat() de NULL khong lam rong ----------
create or replace function public._task_build_msg(p_event text, p_payload jsonb)
returns text language plpgsql immutable as $$
declare d jsonb := p_payload; v text;
begin
  v := case p_event
    when 'created' then concat(
      '📌 **TASK MỚI** · `', d->>'code', '`', E'\n',
      '**', public._task_safe(d->>'title'), '**', E'\n',
      '👤 Người thực hiện: **', public._task_safe(d->>'assignee'), '**', E'\n',
      '📤 Người giao: ', public._task_safe(d->>'assigned_by'), E'\n',
      '🏷 Mức độ: **', d->>'priority', '**  ·  ⏰ Hạn: **', d->>'due_at', '**',
      case when coalesce(d->>'location','') <> '' then concat(E'\n🏪 Điểm: ', d->>'location') else '' end,
      case when coalesce(d->>'description','') <> '' then concat(E'\n📝 ', public._task_safe(d->>'description')) else '' end,
      case when coalesce(d->>'checklist','') <> '' then concat(E'\n☑ Checklist: ', d->>'checklist') else '' end,
      E'\n📊 Trạng thái: Chưa thực hiện')
    when 'started' then concat(
      '🔵 **ĐÃ BẮT ĐẦU** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '👤 ', public._task_safe(d->>'assignee'), '  ·  ⏰ Hạn: ', d->>'due_at')
    when 'submitted' then concat(
      '🟡 **ĐÃ GỬI — CHỜ XÁC NHẬN** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '👤 ', public._task_safe(d->>'assignee'),
      case when coalesce(d->>'checklist','') <> '' then concat('  ·  ☑ ', d->>'checklist') else '' end, E'\n',
      '📎 ', coalesce(d->>'so_link','0'), ' link · ', coalesce(d->>'so_anh','0'), ' ảnh · ',
      coalesce(d->>'so_file','0'), ' file', E'\n',
      '🕐 Gửi lúc: ', coalesce(d->>'submitted_at','—'),
      case when coalesce((d->>'dung_han')::boolean, false) then '  ✅ đúng hạn' else '  ⚠️ trễ hạn' end, E'\n',
      '📊 Trạng thái: **Chờ xác nhận**',
      case when coalesce(d->>'reviewer','') <> '' then concat(E'\n👀 Cần xác nhận: ', d->>'reviewer') else '' end)
    when 'revision' then concat(
      '🔁 **CẦN BỔ SUNG** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '👤 ', public._task_safe(d->>'assignee'), E'\n',
      '📋 Yêu cầu: ', public._task_safe(d->>'yeu_cau'), E'\n',
      '🙋 Người yêu cầu: ', public._task_safe(d->>'nguoi_yeu_cau'), '  ·  ⏰ Hạn: ', d->>'due_at')
    when 'completed' then concat(
      '✅ **ĐÃ HOÀN THÀNH** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '👤 ', public._task_safe(d->>'assignee'), E'\n',
      '⏰ Hạn: ', d->>'due_at', '  ·  🕐 Gửi: ', coalesce(d->>'submitted_at','—'),
      case when coalesce((d->>'dung_han')::boolean, false) then '  ✅ **đúng hạn**' else '  ⚠️ **trễ hạn**' end,
      case when coalesce(d->>'nguoi_xac_nhan','') <> '' then concat(E'\n👀 Xác nhận bởi: ', d->>'nguoi_xac_nhan') else '' end,
      case when coalesce(d->>'ghi_chu','') <> '' then concat(E'\n💬 ', public._task_safe(d->>'ghi_chu')) else '' end)
    when 'overdue' then concat(
      '⚠️ **TASK QUÁ HẠN** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '👤 ', public._task_safe(d->>'assignee'), E'\n',
      '⏰ Hạn: ', d->>'due_at', '  ·  ⌛ Quá **', coalesce(d->>'qua_han','?'), '**', E'\n',
      '📊 Hiện tại: ', d->>'status_vi', '  ·  📤 Người giao: ', public._task_safe(d->>'assigned_by'))
    when 'updated' then concat(
      '📝 **TASK ĐƯỢC CẬP NHẬT** · `', d->>'code', '`', E'\n',
      public._task_safe(d->>'title'), E'\n',
      '🔄 ', public._task_safe(d->>'thay_doi'), E'\n',
      '✍️ Người sửa: ', public._task_safe(d->>'nguoi_sua'),
      case when coalesce(d->>'ly_do','') <> '' then concat('  ·  Lý do: ', public._task_safe(d->>'ly_do')) else '' end)
    else concat('📋 ', d->>'code', ' · ', public._task_safe(d->>'title'))
  end;
  return coalesce(nullif(btrim(v), ''), concat('Task ', coalesce(d->>'code','?'), ' - ', p_event));
end $$;

-- Cho cac tin loi cu gui lai
update public.task_outbox
set status = 'pending', attempt_count = 0, next_retry_at = now(), error_message = ''
where status = 'failed';
