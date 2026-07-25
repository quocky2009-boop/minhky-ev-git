-- ============================================================
-- Migration 051 — TEAM & TASKS: DUYỆT "KHÔNG ĐẠT" + NHẮC HẠN + DASHBOARD
--  * Thêm trạng thái 'failed' (Không đạt) — đóng hẳn, KHÔNG tính hoàn thành,
--    KHÔNG cho mở lại (khác needs_revision).
--  * fn_task_duyet: thêm action 'reject' (Không đạt), bắt buộc ghi lý do.
--  * Nhắc hạn tự động: trước 24h, trước 2h (ngoài "quá hạn" đã có ở 042).
--  * Báo quá hạn: gắn nhãn rõ CHT + BGĐ cùng lúc (kênh Discord công việc
--    hiện tại là kênh chung, không mention theo user — xem C3/C7 ở 040).
--  * View phục vụ Dashboard quản lý (mục 6 trong yêu cầu).
-- Chạy SAU 050. Chạy lại nhiều lần vẫn an toàn.
-- ROLLBACK: xem cuối file.
-- ============================================================

-- ===================== 1) TRẠNG THÁI MỚI: 'failed' =====================
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('not_started','in_progress','pending_review','needs_revision','completed','cancelled','failed'));

-- ===================== 2) fn_task_duyet: THÊM ACTION 'reject' =====================
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
  elsif p_action = 'reject' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc ghi rõ lý do không đạt'; end if;
    update public.tasks set status = 'failed', completed_at = now(),
      completed_by = me.uid, completed_by_name = me.name, completion_note = p_note
    where id = p_id;
    perform public._task_log(p_id, 'reject', jsonb_build_object('status', t.status), jsonb_build_object('status','failed'), p_note);
    perform public._task_outbox(p_id, 'failed', jsonb_build_object('ly_do', p_note, 'nguoi_danh_gia', me.name));
  else
    raise exception 'THAM_SO_SAI: action phải là approve, revise hoặc reject';
  end if;
end $$;

-- ===================== 3) TIN NHẮN DISCORD: 'failed' + 'nhac_han' + tăng cường 'overdue' =====================
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
    when 'failed' then
      '❌ **KHÔNG ĐẠT** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || E'\n' ||
      '📋 Lý do: ' || public._task_safe(d->>'ly_do') || E'\n' ||
      '🙋 Người đánh giá: ' || public._task_safe(d->>'nguoi_danh_gia') ||
      E'\n📊 Trạng thái: **Không đạt** (đóng việc, không tính hoàn thành)'
    when 'overdue' then
      '⚠️ **TASK QUÁ HẠN** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || E'\n' ||
      '⏰ Hạn: ' || (d->>'due_at') || '  ·  ⌛ Quá **' || coalesce(d->>'qua_han','?') || '**' || E'\n' ||
      '📊 Hiện tại: ' || (d->>'status_vi') || '  ·  📤 Người giao: ' || public._task_safe(d->>'assigned_by') || E'\n' ||
      '🔔 Đã báo: Cửa hàng trưởng khu vực & Ban giám đốc'
    when 'nhac_han' then
      '⏳ **SẮP ĐẾN HẠN — CÒN ' || upper(coalesce(d->>'con_lai','')) || '** · `' || (d->>'code') || '`' || E'\n' ||
      public._task_safe(d->>'title') || E'\n' ||
      '👤 ' || public._task_safe(d->>'assignee') || '  ·  ⏰ Hạn: ' || (d->>'due_at') || E'\n' ||
      '📊 Hiện tại: ' || (d->>'status_vi')
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

-- ===================== 4) NHẮC TRƯỚC HẠN 24H / 2H (không spam, 1 lần / mốc) =====================
create or replace function public.fn_task_nhac_sap_den_han()
returns int language plpgsql security definer set search_path = public as $$
declare t record; v_n int := 0; v_gio numeric; v_key text; v_moc text; v_nhan text;
begin
  for t in
    select * from public.v_task_list
    where status in ('not_started','in_progress','needs_revision')
      and due_at > now()
      and due_at <= now() + interval '24 hours'
  loop
    v_gio := extract(epoch from (t.due_at - now())) / 3600;
    -- Chi 2 moc: <=24h (va >2h) va <=2h. Moi moc gui dung 1 lan / ky han hien tai.
    if v_gio <= 2 then v_moc := '2h'; v_nhan := '2 giờ';
    elsif v_gio <= 24 then v_moc := '24h'; v_nhan := '24 giờ';
    else continue; end if;

    v_key := t.id::text || ':nhac_han:' || v_moc || ':' || t.revision_count || ':' || to_char(t.due_at, 'YYYYMMDDHH24MI');
    if exists (select 1 from public.task_outbox where idempotency_key = v_key) then continue; end if;

    insert into public.task_outbox (task_id, event_type, payload, idempotency_key, status, next_retry_at)
    values (t.id, 'nhac_han', jsonb_build_object(
      'code', t.code, 'title', t.title, 'assignee', t.assignee_name,
      'due_at', to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY'),
      'con_lai', v_nhan,
      'status_vi', case t.status when 'not_started' then 'Chưa thực hiện'
                     when 'in_progress' then 'Đang thực hiện'
                     when 'needs_revision' then 'Cần bổ sung' else t.status end
    ), v_key, 'pending', now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ===================== 5) CRON: quét nhắc hạn mỗi 15 phút =====================
do $do$
begin
  perform cron.unschedule('task-nhac-han-15p');
exception when others then null; end $do$;
select cron.schedule('task-nhac-han-15p', '*/15 * * * *', $$ select public.fn_task_nhac_sap_den_han(); $$);

-- ===================== 6) VIEW: is_overdue / thống kê loại trừ 'failed' =====================
create or replace view public.v_task_list as
select t.*,
  (t.due_at < now() and t.status not in ('completed','cancelled','failed')) as is_overdue,
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
  count(*) filter (where status not in ('completed','cancelled','failed')) as dang_mo,
  count(*) filter (where status = 'not_started') as chua_lam,
  count(*) filter (where status = 'in_progress') as dang_lam,
  count(*) filter (where status = 'pending_review') as cho_duyet,
  count(*) filter (where status = 'needs_revision') as can_bo_sung,
  count(*) filter (where status = 'completed') as hoan_thanh,
  count(*) filter (where status = 'failed') as khong_dat,
  count(*) filter (where is_overdue) as qua_han,
  count(*) filter (where status = 'completed' and gui_dung_han) as xong_dung_han,
  count(*) filter (where status <> 'cancelled') as tong_phai_lam
from public.v_task_list
group by assignee_id, assignee_name, region, location_code;

-- ===================== 7) VIEW: DASHBOARD QUẢN LÝ (mục 6) =====================
-- Theo điểm / cửa hàng — phục vụ "cửa hàng có tỷ lệ hoàn thành thấp nhất"
create or replace view public.v_task_theo_diem as
select
  coalesce(location_code, '—') as location_code, region,
  count(*) filter (where status <> 'cancelled') as tong,
  count(*) filter (where status = 'completed') as hoan_thanh,
  count(*) filter (where status = 'failed') as khong_dat,
  count(*) filter (where is_overdue) as qua_han,
  case when count(*) filter (where status <> 'cancelled') = 0 then null
       else round(100.0 * count(*) filter (where status = 'completed')
            / count(*) filter (where status <> 'cancelled'), 1) end as ty_le_hoan_thanh
from public.v_task_list
group by coalesce(location_code, '—'), region;

-- Tong quan toan he thong — dung 1 dong cho Dashboard doc nhanh
create or replace view public.v_task_dashboard as
select
  count(*) filter (where status not in ('completed','cancelled','failed')) as dang_mo,
  count(*) filter (where status not in ('completed','cancelled','failed') and not is_overdue
                    and due_at <= now() + interval '24 hours') as sap_den_han,
  count(*) filter (where is_overdue) as qua_han,
  count(*) filter (where status = 'pending_review') as cho_duyet,
  count(*) filter (where status = 'completed') as hoan_thanh_tong,
  count(*) filter (where status = 'completed' and gui_dung_han) as hoan_thanh_dung_han,
  count(*) filter (where status = 'failed') as khong_dat_tong,
  count(*) filter (where revision_count > 0) as tra_lai_bo_sung_tong,
  count(*) filter (where status <> 'cancelled') as tong_phai_lam
from public.v_task_list;

-- ===================== 8) KIỂM TRA =====================
do $do$
declare v_job int;
begin
  select count(*) into v_job from cron.job where jobname like 'task-%';
  raise notice 'XONG 051: da lap % lich cron (mong doi 4: outbox-1p, qua-han-1h, sinh-ky-6h, nhac-han-15p)', v_job;
end $do$;

-- ============================================================
-- ROLLBACK:
--   select cron.unschedule('task-nhac-han-15p');
--   drop function if exists public.fn_task_nhac_sap_den_han();
--   drop view if exists public.v_task_dashboard, public.v_task_theo_diem;
--   -- fn_task_duyet / _task_build_msg / v_task_list / v_task_thong_ke:
--   -- chay lai ban 041/042 de tra ve phien ban truoc (khong co 'reject'/'failed').
--   alter table public.tasks drop constraint tasks_status_check;
--   alter table public.tasks add constraint tasks_status_check
--     check (status in ('not_started','in_progress','pending_review','needs_revision','completed','cancelled'));
-- ============================================================
