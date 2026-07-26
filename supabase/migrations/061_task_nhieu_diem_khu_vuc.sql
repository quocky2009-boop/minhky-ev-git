-- ============================================================
-- Migration 061 — GIAO VIỆC: nhiều điểm/cửa hàng + chọn khu vực
--  1) Them cot tasks.location_codes text[] — danh sach nhieu diem ap dung
--     cho CUNG 1 cong viec (khong nhan task len).
--     location_code (cu) van giu = diem dau tien, de tuong thich bao cao/RLS.
--  2) fn_task_tao: nhan them 'location_codes' (mang) va 'region' (chon tay,
--     khong bat buoc — neu bo trong thi tu suy tu nguoi thuc hien nhu cu).
-- Chạy SAU 060. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.tasks add column if not exists location_codes text[] default '{}';

create or replace function public.fn_task_tao(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_id bigint; v_assignee uuid; v_region text; v_tu_tao boolean;
  a record; r jsonb; v_tpl record; v_pri text; v_locs text[]; v_loc1 text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;

  v_assignee := coalesce(nullif(p->>'assignee_id','')::uuid, me.uid);
  v_tu_tao := (v_assignee = me.uid) and coalesce((p->>'is_personal')::boolean, false);

  if v_tu_tao then
    if not public.fn_co_quyen('task_tu_tao') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo việc'; end if;
  else
    if not public.fn_co_quyen('task_giao_viec') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền giao việc cho người khác'; end if;
  end if;

  if coalesce(trim(p->>'title'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên công việc'; end if;
  if (p->>'due_at') is null then raise exception 'THIEU_THONG_TIN: chọn hạn hoàn thành'; end if;

  select * into a from public.profiles where id = v_assignee;
  if a is null then raise exception 'KHONG_TIM_THAY: người thực hiện không tồn tại'; end if;

  if me.role = 'MANAGER' and me.region is not null and not v_tu_tao
     and coalesce(a.region,'') <> me.region then
    raise exception 'NGOAI_PHAM_VI: % không thuộc khu vực bạn quản lý', a.name;
  end if;

  -- Khu vuc: uu tien gia tri chon tay tren form, sau do suy tu nguoi thuc hien
  v_region := coalesce(nullif(p->>'region',''), a.region, me.region);
  -- MANAGER khong duoc giao ra ngoai khu vuc minh
  if me.role = 'MANAGER' and me.region is not null and coalesce(v_region,'') <> me.region then
    raise exception 'NGOAI_PHAM_VI: bạn chỉ giao việc trong khu vực %', me.region;
  end if;

  v_pri := coalesce(nullif(p->>'priority',''), 'Bình thường');

  -- Danh sach diem: nhan mang 'location_codes', neu khong co thi dung 'location_code' don le
  v_locs := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p->'location_codes','[]'::jsonb)) x),
    case when coalesce(p->>'location_code','') <> '' then array[p->>'location_code'] else '{}' end
  );
  v_loc1 := nullif(v_locs[1], '');

  select * into v_tpl from public.task_templates
  where id = nullif(p->>'template_id','')::bigint;

  v_code := public.fn_next_code('TASK');
  insert into public.tasks (code, title, description, completion_criteria, category_id, tags,
    location_code, location_codes, region, created_by, created_by_name, assigned_by, assigned_by_name,
    assignee_id, assignee_name, reviewer_id, reviewer_name, priority,
    start_at, due_at, requires_review, require_text_result, require_link, require_image,
    require_file, require_all_checklist, minimum_image_count, template_id,
    recurrence_series_id, recurrence_instance_key, batch_id, batch_title, is_personal,
    attachments, status)
  values (v_code, trim(p->>'title'), coalesce(nullif(p->>'description',''), v_tpl.description, ''),
    coalesce(nullif(p->>'completion_criteria',''), v_tpl.completion_criteria, ''),
    coalesce(nullif(p->>'category_id','')::bigint, v_tpl.category_id),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb)) x), '{}'),
    v_loc1, v_locs, v_region,
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

do $do$
begin
  raise notice 'XONG 061: tasks.location_codes (nhieu diem) + chon khu vuc tay trong fn_task_tao';
end $do$;
