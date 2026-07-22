-- ============================================================
-- Migration 041 — TEAM & TASKS: HÀM NGHIỆP VỤ + OUTBOX DISCORD
--  * Tao task (don le / hang loat / tu mau) — C2: tu tao viec ca nhan
--  * Bat dau -> tich checklist -> gui ket qua (kiem tra du bang chung)
--  * Duyet / yeu cau bo sung / huy — nhan vien KHONG tu completed
--  * Task lap lai: sinh instance, chong trung bang instance_key
--  * DISCORD: chi GHI VAO OUTBOX (khong goi truc tiep) -> 042 day di
--  * View dashboard 3 cap
-- Chay SAU 040. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== HELPER =====================
create or replace function public._task_log(p_task bigint, p_action text, p_old jsonb, p_new jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  insert into public.task_audit_logs (task_id, action, old_data, new_data, note, acted_by, acted_by_name)
  values (p_task, p_action, p_old, p_new, coalesce(p_note,''), me.uid, me.name);
end $$;

-- Day su kien vao OUTBOX (khong goi Discord o day -> tao task khong bao gio bi cham/hong)
create or replace function public._task_outbox(p_task bigint, p_event text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_key text; v_cl text; v_n int; v_done int;
begin
  select * into t from public.tasks where id = p_task;
  if t is null then return; end if;

  -- Khoa chong trung: task + su kien + so lan sua (de lan gui lai van khac key)
  v_key := p_task::text || ':' || p_event || ':' || t.status || ':' || t.revision_count;
  if exists (select 1 from public.task_outbox where idempotency_key = v_key) then return; end if;

  select count(*), count(*) filter (where is_completed) into v_n, v_done
  from public.task_checklist_items where task_id = p_task;
  v_cl := case when v_n > 0 then v_done || '/' || v_n else '' end;

  insert into public.task_outbox (task_id, event_type, payload, idempotency_key, status, next_retry_at)
  values (p_task, p_event, jsonb_build_object(
    'code', t.code, 'title', t.title, 'description', left(coalesce(t.description,''), 300),
    'assignee', t.assignee_name, 'assigned_by', coalesce(nullif(t.assigned_by_name,''), t.created_by_name),
    'reviewer', t.reviewer_name, 'priority', t.priority, 'status', t.status,
    'due_at', to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'),
    'location', t.location_code, 'checklist', v_cl,
    'submitted_at', case when t.submitted_at is null then null
                    else to_char(t.submitted_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY') end,
    'dung_han', case when t.submitted_at is null then null else (t.submitted_at <= t.due_at) end
  ) || coalesce(p_extra, '{}'::jsonb), v_key, 'pending', now());
end $$;

-- ===================== 1) TẠO TASK =====================
create or replace function public.fn_task_tao(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_id bigint; v_assignee uuid; v_region text; v_tu_tao boolean;
  a record; r jsonb; v_tpl record; v_pri text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;

  v_assignee := coalesce(nullif(p->>'assignee_id','')::uuid, me.uid);
  v_tu_tao := (v_assignee = me.uid) and coalesce((p->>'is_personal')::boolean, false);

  -- C2: tu tao viec cho chinh minh chi can quyen task_tu_tao; giao cho NGUOI KHAC can task_giao_viec
  if v_tu_tao then
    if not public.fn_co_quyen('task_tu_tao') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo việc'; end if;
  else
    if not public.fn_co_quyen('task_giao_viec') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền giao việc cho người khác'; end if;
  end if;

  if coalesce(trim(p->>'title'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên công việc'; end if;
  if (p->>'due_at') is null then raise exception 'THIEU_THONG_TIN: chọn hạn hoàn thành'; end if;

  select * into a from public.profiles where id = v_assignee;
  if a is null then raise exception 'KHONG_TIM_THAY: người thực hiện không tồn tại'; end if;

  -- MANAGER chi giao trong khu vuc minh
  if me.role = 'MANAGER' and me.region is not null and not v_tu_tao
     and coalesce(a.region,'') <> me.region then
    raise exception 'NGOAI_PHAM_VI: % không thuộc khu vực bạn quản lý', a.name;
  end if;

  v_region := coalesce(a.region, me.region);
  v_pri := coalesce(nullif(p->>'priority',''), 'Bình thường');

  -- Lay tu mau neu co. LUU Y: phai LUON gan v_tpl (ke ca khong co mau),
  -- neu khong Postgres bao "record v_tpl is not assigned yet" khi doc v_tpl.description
  select * into v_tpl from public.task_templates
  where id = nullif(p->>'template_id','')::bigint;

  v_code := public.fn_next_code('TASK');
  insert into public.tasks (code, title, description, completion_criteria, category_id, tags,
    location_code, region, created_by, created_by_name, assigned_by, assigned_by_name,
    assignee_id, assignee_name, reviewer_id, reviewer_name, priority,
    start_at, due_at, requires_review, require_text_result, require_link, require_image,
    require_file, require_all_checklist, minimum_image_count, template_id,
    recurrence_series_id, recurrence_instance_key, batch_id, batch_title, is_personal,
    attachments, status)
  values (v_code, trim(p->>'title'), coalesce(nullif(p->>'description',''), v_tpl.description, ''),
    coalesce(nullif(p->>'completion_criteria',''), v_tpl.completion_criteria, ''),
    coalesce(nullif(p->>'category_id','')::bigint, v_tpl.category_id),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb)) x), '{}'),
    nullif(p->>'location_code',''), v_region,
    me.uid, me.name, me.uid, me.name,
    v_assignee, a.name,
    nullif(p->>'reviewer_id','')::uuid,
    (select name from public.profiles where id = nullif(p->>'reviewer_id','')::uuid),
    v_pri,
    nullif(p->>'start_at','')::timestamptz, (p->>'due_at')::timestamptz,
    coalesce((p->>'requires_review')::boolean, v_tpl.requires_review, true),
    coalesce((p->>'require_text_result')::boolean, v_tpl.require_text_result, false),
    coalesce((p->>'require_link')::boolean, v_tpl.require_link, false),
    coalesce((p->>'require_image')::boolean, v_tpl.require_image, false),
    coalesce((p->>'require_file')::boolean, v_tpl.require_file, false),
    coalesce((p->>'require_all_checklist')::boolean, v_tpl.require_all_checklist, false),
    coalesce((p->>'minimum_image_count')::int, v_tpl.minimum_image_count, 0),
    nullif(p->>'template_id','')::bigint,
    nullif(p->>'recurrence_series_id','')::bigint, nullif(p->>'recurrence_instance_key',''),
    nullif(p->>'batch_id',''), coalesce(p->>'batch_title',''), v_tu_tao,
    coalesce(p->'attachments','[]'::jsonb), 'not_started')
  returning id into v_id;

  -- Checklist: tu mau hoac tu form
  if v_tpl.id is not null and not (p ? 'checklist') then
    insert into public.task_checklist_items (task_id, title, sort_order, is_required)
    select v_id, i.title, i.sort_order, i.is_required
    from public.task_template_items i where i.template_id = v_tpl.id;
  else
    for r in select jsonb_array_elements(coalesce(p->'checklist','[]'::jsonb)) loop
      if coalesce(trim(r->>'title'),'') <> '' then
        insert into public.task_checklist_items (task_id, title, sort_order, is_required)
        values (v_id, trim(r->>'title'), coalesce((r->>'sort_order')::int, 0), coalesce((r->>'is_required')::boolean, false));
      end if;
    end loop;
  end if;

  -- Nguoi phoi hop
  for r in select jsonb_array_elements(coalesce(p->'collaborators','[]'::jsonb)) loop
    insert into public.task_collaborators (task_id, user_id, user_name, can_check, added_by)
    select v_id, pr.id, pr.name, coalesce((r->>'can_check')::boolean, true), me.uid
    from public.profiles pr where pr.id = (r->>'user_id')::uuid
    on conflict (task_id, user_id) do nothing;
  end loop;

  perform public._task_log(v_id, 'create', null, p, '');
  if not v_tu_tao then perform public._task_outbox(v_id, 'created'); end if;
  return v_code;
end $$;

-- Giao viec HANG LOAT: moi nguoi 1 task rieng, cung batch_id
create or replace function public.fn_task_giao_hang_loat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_batch text; u text; v_code text; v_codes text[] := '{}';
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('task_giao_viec') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền giao việc'; end if;
  if jsonb_array_length(coalesce(p->'assignees','[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: chọn ít nhất 1 người thực hiện';
  end if;
  v_batch := public.fn_next_code('BATCH');
  for u in select jsonb_array_elements_text(p->'assignees') loop
    v_code := public.fn_task_tao(
      (p - 'assignees') || jsonb_build_object(
        'assignee_id', u, 'batch_id', v_batch,
        'batch_title', coalesce(p->>'batch_title', p->>'title'), 'is_personal', false));
    v_codes := array_append(v_codes, v_code);
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'codes', to_jsonb(v_codes), 'count', array_length(v_codes,1));
end $$;

-- ===================== 2) NHÂN VIÊN THỰC HIỆN =====================
create or replace function public.fn_task_bat_dau(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  select * into t from public.tasks where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.assignee_id <> me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: chỉ người được giao mới bắt đầu được';
  end if;
  if t.status <> 'not_started' then raise exception 'TRANG_THAI_SAI: việc đã bắt đầu hoặc đã đóng'; end if;
  update public.tasks set status = 'in_progress', actual_started_at = now() where id = p_id;
  perform public._task_log(p_id, 'start', null, null, '');
  -- Chi bao Discord voi muc uu tien cao (theo Cai dat)
  if t.priority = any (string_to_array(coalesce((select value from public.app_settings where key='task_bao_start_muc'),'Cao,Khẩn cấp'), ',')) then
    perform public._task_outbox(p_id, 'started');
  end if;
end $$;

create or replace function public.fn_task_tich_checklist(p_item bigint, p_done boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; i record; t record; v_ok boolean;
begin
  select * into me from public.fn_me_mkt();
  select * into i from public.task_checklist_items where id = p_item for update;
  if i is null then raise exception 'KHONG_TIM_THAY'; end if;
  select * into t from public.tasks where id = i.task_id;
  if t.status in ('completed','cancelled') then raise exception 'TRANG_THAI_SAI: việc đã đóng'; end if;

  v_ok := (t.assignee_id = me.uid)
       or me.role in ('ADMIN','CEO')
       or exists (select 1 from public.task_collaborators c where c.task_id = t.id and c.user_id = me.uid and c.can_check)
       or (me.role = 'MANAGER' and (me.region is null or t.region = me.region));
  if not v_ok then raise exception 'KHONG_CO_QUYEN: bạn không được tích checklist việc này'; end if;

  update public.task_checklist_items set
    is_completed = p_done,
    completed_by = case when p_done then me.uid else null end,
    completed_by_name = case when p_done then me.name else '' end,
    completed_at = case when p_done then now() else null end,
    note = coalesce(p_note, note)
  where id = p_item;
  -- Tich xong ma viec chua bat dau -> tu chuyen dang thuc hien
  if p_done and t.status = 'not_started' then
    update public.tasks set status = 'in_progress', actual_started_at = coalesce(actual_started_at, now()) where id = t.id;
  end if;
  perform public._task_log(t.id, case when p_done then 'check' else 'uncheck' end,
    null, jsonb_build_object('item', i.title), '');
end $$;

-- Gui ket qua: kiem tra DU BANG CHUNG + checklist bat buoc
create or replace function public.fn_task_gui_ket_qua(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_id bigint; v_files jsonb; v_anh int; v_ver int; v_thieu int;
begin
  select * into me from public.fn_me_mkt();
  v_id := (p->>'task_id')::bigint;
  select * into t from public.tasks where id = v_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.assignee_id <> me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: chỉ người được giao mới gửi kết quả';
  end if;
  if t.status not in ('in_progress','not_started','needs_revision') then
    raise exception 'TRANG_THAI_SAI: việc đang ở trạng thái % — không gửi được', t.status;
  end if;

  v_files := coalesce(p->'files', '[]'::jsonb);
  select count(*) into v_anh from jsonb_array_elements(v_files) f
  where coalesce(f->>'type','') like 'image%' or lower(coalesce(f->>'name','')) ~ '\.(jpg|jpeg|png|webp|heic)$';

  -- Kiem tra yeu cau bang chung
  if t.require_text_result and coalesce(trim(p->>'result_text'),'') = '' then
    raise exception 'THIEU_BANG_CHUNG: việc này bắt buộc ghi kết quả bằng chữ';
  end if;
  if t.require_link and coalesce(trim(p->>'result_link'),'') = '' then
    raise exception 'THIEU_BANG_CHUNG: việc này bắt buộc có link';
  end if;
  if t.require_image and v_anh < greatest(t.minimum_image_count, 1) then
    raise exception 'THIEU_BANG_CHUNG: cần ít nhất % ảnh (đang có %)', greatest(t.minimum_image_count,1), v_anh;
  end if;
  if t.require_file and jsonb_array_length(v_files) = 0 then
    raise exception 'THIEU_BANG_CHUNG: việc này bắt buộc đính kèm file';
  end if;
  if t.require_all_checklist then
    select count(*) into v_thieu from public.task_checklist_items
    where task_id = v_id and is_required and not is_completed;
    if v_thieu > 0 then
      raise exception 'CHUA_XONG_CHECKLIST: còn % mục bắt buộc chưa tích', v_thieu;
    end if;
  end if;

  select coalesce(max(version_number),0) + 1 into v_ver from public.task_results where task_id = v_id;
  update public.task_results set is_current = false where task_id = v_id;
  insert into public.task_results (task_id, version_number, is_current, result_text, result_link, files,
    submitted_by, submitted_by_name)
  values (v_id, v_ver, true, coalesce(p->>'result_text',''), coalesce(p->>'result_link',''), v_files, me.uid, me.name);

  -- requires_review = false -> hoan thanh luon; nguoc lai cho duyet
  if t.requires_review then
    update public.tasks set status = 'pending_review', submitted_at = now() where id = v_id;
    perform public._task_log(v_id, 'submit', null, jsonb_build_object('version', v_ver), '');
    perform public._task_outbox(v_id, 'submitted', jsonb_build_object(
      'so_link', case when coalesce(p->>'result_link','') = '' then 0 else 1 end,
      'so_anh', v_anh, 'so_file', jsonb_array_length(v_files)));
  else
    update public.tasks set status = 'completed', submitted_at = now(),
      completed_at = now(), completed_by = me.uid, completed_by_name = me.name where id = v_id;
    perform public._task_log(v_id, 'submit_auto_complete', null, null, '');
    perform public._task_outbox(v_id, 'completed');
  end if;
end $$;

-- ===================== 3) DUYỆT / BỔ SUNG / HỦY =====================
create or replace function public.fn_task_duyet(p_id bigint, p_action text, p_note text, p_han_moi timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('task_duyet') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền duyệt việc'; end if;
  select * into t from public.tasks where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if me.role = 'MANAGER' and me.region is not null and coalesce(t.region,'') <> me.region then
    raise exception 'KHONG_CO_QUYEN: việc này không thuộc khu vực bạn quản lý';
  end if;
  if t.assignee_id = me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: không được tự duyệt việc của chính mình';
  end if;
  if t.status <> 'pending_review' then raise exception 'TRANG_THAI_SAI: việc chưa ở trạng thái Chờ xác nhận'; end if;

  if p_action = 'approve' then
    update public.tasks set status = 'completed', completed_at = now(),
      completed_by = me.uid, completed_by_name = me.name, completion_note = coalesce(p_note,'')
    where id = p_id;
    perform public._task_log(p_id, 'approve', jsonb_build_object('status', t.status), jsonb_build_object('status','completed'), p_note);
    perform public._task_outbox(p_id, 'completed', jsonb_build_object('nguoi_xac_nhan', me.name, 'ghi_chu', coalesce(p_note,'')));
  elsif p_action = 'revise' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc ghi rõ nội dung cần bổ sung'; end if;
    update public.tasks set status = 'needs_revision', revision_count = revision_count + 1,
      completion_note = p_note, due_at = coalesce(p_han_moi, due_at)
    where id = p_id;
    perform public._task_log(p_id, 'revise', jsonb_build_object('status', t.status), jsonb_build_object('status','needs_revision'), p_note);
    perform public._task_outbox(p_id, 'revision', jsonb_build_object('yeu_cau', p_note, 'nguoi_yeu_cau', me.name));
  else
    raise exception 'THAM_SO_SAI: action phải là approve hoặc revise';
  end if;
end $$;

create or replace function public.fn_task_huy(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  select * into t from public.tasks where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  -- Viec ca nhan tu tao thi tu huy duoc; con lai can quyen
  if not (t.is_personal and t.created_by = me.uid) and not public.fn_co_quyen('task_huy') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền hủy việc';
  end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do hủy'; end if;
  if t.status = 'completed' then raise exception 'TRANG_THAI_SAI: việc đã hoàn thành — không hủy được'; end if;
  update public.tasks set status = 'cancelled', cancelled_at = now(), cancelled_by = me.uid,
    cancellation_reason = p_ly_do where id = p_id;
  perform public._task_log(p_id, 'cancel', jsonb_build_object('status', t.status), null, p_ly_do);
end $$;

-- Sua task (deadline / nguoi phu trach / noi dung) — luu vet + bao Discord
create or replace function public.fn_task_sua(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_id bigint; a record; v_doi text := '';
begin
  select * into me from public.fn_me_mkt();
  v_id := (p->>'id')::bigint;
  select * into t from public.tasks where id = v_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if not (t.is_personal and t.created_by = me.uid) and not public.fn_co_quyen('task_giao_viec') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa việc này';
  end if;
  if t.status in ('completed','cancelled') then raise exception 'TRANG_THAI_SAI: việc đã đóng'; end if;

  if coalesce(p->>'assignee_id','') <> '' and (p->>'assignee_id')::uuid <> t.assignee_id then
    select * into a from public.profiles where id = (p->>'assignee_id')::uuid;
    if a is null then raise exception 'KHONG_TIM_THAY: người thực hiện mới không tồn tại'; end if;
    if me.role = 'MANAGER' and me.region is not null and coalesce(a.region,'') <> me.region then
      raise exception 'NGOAI_PHAM_VI: % không thuộc khu vực bạn quản lý', a.name;
    end if;
    v_doi := v_doi || 'Người phụ trách: ' || t.assignee_name || ' → ' || a.name || '. ';
    update public.tasks set assignee_id = a.id, assignee_name = a.name, region = coalesce(a.region, region) where id = v_id;
  end if;

  if coalesce(p->>'due_at','') <> '' and (p->>'due_at')::timestamptz <> t.due_at then
    v_doi := v_doi || 'Hạn: ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM')
          || ' → ' || to_char((p->>'due_at')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM') || '. ';
    update public.tasks set due_at = (p->>'due_at')::timestamptz where id = v_id;
  end if;

  update public.tasks set
    title = coalesce(nullif(p->>'title',''), title),
    description = coalesce(p->>'description', description),
    completion_criteria = coalesce(p->>'completion_criteria', completion_criteria),
    priority = coalesce(nullif(p->>'priority',''), priority),
    reviewer_id = coalesce(nullif(p->>'reviewer_id','')::uuid, reviewer_id)
  where id = v_id;

  perform public._task_log(v_id, 'update', to_jsonb(t), p, v_doi);
  if v_doi <> '' then
    perform public._task_outbox(v_id, 'updated', jsonb_build_object('thay_doi', v_doi, 'nguoi_sua', me.name,
      'ly_do', coalesce(p->>'reason','')));
  end if;
end $$;

-- Binh luan
create or replace function public.fn_task_binh_luan(p_id bigint, p_content text, p_files jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_cid bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.task_co_quyen_xem(p_id) then raise exception 'KHONG_CO_QUYEN: bạn không xem được việc này'; end if;
  if coalesce(btrim(p_content),'') = '' and jsonb_array_length(coalesce(p_files,'[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: nhập nội dung bình luận';
  end if;
  insert into public.task_comments (task_id, user_id, user_name, content, files)
  values (p_id, me.uid, me.name, coalesce(p_content,''), coalesce(p_files,'[]'::jsonb))
  returning id into v_cid;
  return v_cid;
end $$;

-- ===================== 4) MẪU + LẶP LẠI =====================
create or replace function public.fn_task_luu_mau(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; r jsonb;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('task_mau') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền quản lý mẫu công việc'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.task_templates (code, name, description, completion_criteria, category_id,
      default_priority, default_duration_hours, requires_review, require_text_result, require_link,
      require_image, require_file, require_all_checklist, minimum_image_count, created_by)
    values (upper(coalesce(nullif(p->>'code',''), 'TPL-' || extract(epoch from now())::bigint)),
      p->>'name', coalesce(p->>'description',''), coalesce(p->>'completion_criteria',''),
      nullif(p->>'category_id','')::bigint, coalesce(p->>'default_priority','Bình thường'),
      coalesce((p->>'default_duration_hours')::numeric, 24),
      coalesce((p->>'requires_review')::boolean, true), coalesce((p->>'require_text_result')::boolean, false),
      coalesce((p->>'require_link')::boolean, false), coalesce((p->>'require_image')::boolean, false),
      coalesce((p->>'require_file')::boolean, false), coalesce((p->>'require_all_checklist')::boolean, false),
      coalesce((p->>'minimum_image_count')::int, 0), me.uid)
    returning id into v_id;
  else
    update public.task_templates set name = p->>'name', description = coalesce(p->>'description', description),
      completion_criteria = coalesce(p->>'completion_criteria', completion_criteria),
      category_id = coalesce(nullif(p->>'category_id','')::bigint, category_id),
      default_priority = coalesce(p->>'default_priority', default_priority),
      default_duration_hours = coalesce((p->>'default_duration_hours')::numeric, default_duration_hours),
      requires_review = coalesce((p->>'requires_review')::boolean, requires_review),
      require_text_result = coalesce((p->>'require_text_result')::boolean, require_text_result),
      require_link = coalesce((p->>'require_link')::boolean, require_link),
      require_image = coalesce((p->>'require_image')::boolean, require_image),
      require_file = coalesce((p->>'require_file')::boolean, require_file),
      require_all_checklist = coalesce((p->>'require_all_checklist')::boolean, require_all_checklist),
      minimum_image_count = coalesce((p->>'minimum_image_count')::int, minimum_image_count),
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
  end if;
  if p ? 'items' then
    delete from public.task_template_items where template_id = v_id;
    for r in select jsonb_array_elements(p->'items') loop
      if coalesce(trim(r->>'title'),'') <> '' then
        insert into public.task_template_items (template_id, title, sort_order, is_required)
        values (v_id, trim(r->>'title'), coalesce((r->>'sort_order')::int,0), coalesce((r->>'is_required')::boolean,false));
      end if;
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.fn_task_luu_lich_lap(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('task_lap_lai') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo việc lặp lại'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.task_recurrence_series (title, template_id, rule_type, weekdays, day_of_month,
      due_time, assignee_id, reviewer_id, location_code, priority, category_id, description,
      start_date, end_date, created_by)
    values (p->>'title', nullif(p->>'template_id','')::bigint, p->>'rule_type',
      coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p->'weekdays','[]'::jsonb)) x), '{}'),
      nullif(p->>'day_of_month','')::int, coalesce(nullif(p->>'due_time','')::time, '17:00'),
      (p->>'assignee_id')::uuid, nullif(p->>'reviewer_id','')::uuid, nullif(p->>'location_code',''),
      coalesce(p->>'priority','Bình thường'), nullif(p->>'category_id','')::bigint,
      coalesce(p->>'description',''), coalesce(nullif(p->>'start_date','')::date, current_date),
      nullif(p->>'end_date','')::date, me.uid)
    returning id into v_id;
  else
    update public.task_recurrence_series set title = p->>'title', rule_type = coalesce(p->>'rule_type', rule_type),
      weekdays = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'weekdays') x), weekdays),
      day_of_month = nullif(p->>'day_of_month','')::int,
      due_time = coalesce(nullif(p->>'due_time','')::time, due_time),
      assignee_id = coalesce(nullif(p->>'assignee_id','')::uuid, assignee_id),
      reviewer_id = nullif(p->>'reviewer_id','')::uuid,
      location_code = nullif(p->>'location_code',''),
      priority = coalesce(p->>'priority', priority), description = coalesce(p->>'description', description),
      end_date = nullif(p->>'end_date','')::date,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- Sinh task cho cac chuoi lap den han (goi boi cron o 042, hoac bam tay)
create or replace function public.fn_task_sinh_ky(p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare s record; v_date date; v_dow int; v_hop boolean; v_key text; v_due timestamptz; v_n int := 0;
begin
  v_date := coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_dow := extract(isodow from v_date);   -- 1=T2 ... 7=CN
  for s in select * from public.task_recurrence_series
           where is_active and start_date <= v_date and (end_date is null or end_date >= v_date) loop
    v_hop := case s.rule_type
      when 'daily'       then true
      when 'weekly'      then v_dow = any(s.weekdays)
      when 'weekday_set' then v_dow = any(s.weekdays)
      when 'monthly'     then extract(day from v_date)::int = coalesce(s.day_of_month, 1)
      when 'month_end'   then v_date = (date_trunc('month', v_date) + interval '1 month - 1 day')::date
      else false end;
    if not v_hop then continue; end if;

    v_key := 'S' || s.id || '-' || to_char(v_date, 'YYYYMMDD');
    if exists (select 1 from public.tasks where recurrence_instance_key = v_key) then continue; end if;

    v_due := (v_date + s.due_time) at time zone 'Asia/Ho_Chi_Minh';
    perform public.fn_task_tao(jsonb_build_object(
      'title', s.title, 'description', s.description, 'assignee_id', s.assignee_id,
      'reviewer_id', s.reviewer_id, 'location_code', s.location_code, 'priority', s.priority,
      'category_id', s.category_id, 'template_id', s.template_id,
      'due_at', v_due, 'recurrence_series_id', s.id, 'recurrence_instance_key', v_key));
    update public.task_recurrence_series set last_run_date = v_date where id = s.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ===================== 5) VIEW DASHBOARD =====================
create or replace view public.v_task_list as
select t.*,
  (t.due_at < now() and t.status not in ('completed','cancelled')) as is_overdue,
  extract(epoch from (now() - t.due_at)) / 3600 as gio_qua_han,
  (select count(*) from public.task_checklist_items c where c.task_id = t.id) as cl_tong,
  (select count(*) from public.task_checklist_items c where c.task_id = t.id and c.is_completed) as cl_xong,
  (t.submitted_at is not null and t.submitted_at <= t.due_at) as gui_dung_han,
  c.name as category_name
from public.tasks t
left join public.task_categories c on c.id = t.category_id
where t.deleted_at is null;

create or replace view public.v_task_thong_ke as
select
  assignee_id, assignee_name, region, location_code,
  count(*) filter (where status not in ('completed','cancelled')) as dang_mo,
  count(*) filter (where status = 'not_started') as chua_lam,
  count(*) filter (where status = 'in_progress') as dang_lam,
  count(*) filter (where status = 'pending_review') as cho_duyet,
  count(*) filter (where status = 'needs_revision') as can_bo_sung,
  count(*) filter (where status = 'completed') as hoan_thanh,
  count(*) filter (where is_overdue) as qua_han,
  count(*) filter (where status = 'completed' and gui_dung_han) as xong_dung_han,
  count(*) filter (where status <> 'cancelled') as tong_phai_lam
from public.v_task_list
group by assignee_id, assignee_name, region, location_code;
