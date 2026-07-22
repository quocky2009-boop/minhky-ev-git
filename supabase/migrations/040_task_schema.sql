-- ============================================================
-- Migration 040 — MODULE TEAM & TASKS (GĐ2: SCHEMA + RLS + SEED)
-- Chot thiet ke (da duyet):
--  C1(a) KHONG co phong ban — giao viec theo CUA HANG / KHU VUC
--  C2    nhan vien DUOC tu tao viec cho chinh minh (to-do ca nhan)
--  C3    KHONG lam mapping Discord user (chi hien ten nhan vien)
--  C4    bucket 'task-files' CONG KHAI (dong bo cac bucket hien co)
--  C5    KHONG lam bang notification — dung badge do tren menu
--  C6    Lich cong viec de sau MVP
--  C7    KENH DISCORD RIENG cho cong viec (key rieng trong Cai dat)
--
-- Chay SAU 039. Chay lai nhieu lan van an toan.
-- ROLLBACK: xem cuoi file.
-- ============================================================

-- ===================== 1) DANH MUC NHOM CONG VIEC =====================
create table if not exists public.task_categories (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ===================== 2) TASK CHINH =====================
create table if not exists public.tasks (
  id bigserial primary key,
  code text unique not null,                       -- TASK-YYMM-0001 (lien tuc)
  title text not null,
  description text default '',
  completion_criteria text default '',
  category_id bigint references public.task_categories(id),
  tags text[] not null default '{}',               -- nhan phu (thay bang tags rieng)
  location_code text references public.locations(code),
  region text,
  -- Nguoi lien quan
  created_by uuid not null references public.profiles(id),
  created_by_name text default '',
  assigned_by uuid references public.profiles(id),
  assigned_by_name text default '',
  assignee_id uuid not null references public.profiles(id),
  assignee_name text default '',
  reviewer_id uuid references public.profiles(id),
  reviewer_name text default '',
  -- Thoi gian
  priority text not null default 'Bình thường' check (priority in ('Thấp','Bình thường','Cao','Khẩn cấp')),
  start_at timestamptz,
  due_at timestamptz not null,
  actual_started_at timestamptz,
  submitted_at timestamptz,                        -- MOC danh gia dung han cua NHAN VIEN
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  completed_by_name text default '',
  completion_note text default '',
  -- Huy
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text default '',
  -- Cau hinh bang chung
  requires_review boolean not null default true,
  require_text_result boolean not null default false,
  require_link boolean not null default false,
  require_image boolean not null default false,
  require_file boolean not null default false,
  require_all_checklist boolean not null default false,
  minimum_image_count int not null default 0,
  -- Lien ket
  template_id bigint,
  recurrence_series_id bigint,
  recurrence_instance_key text,                    -- chong tao trung ky lap
  batch_id text,                                   -- giao viec hang loat
  batch_title text default '',
  is_personal boolean not null default false,      -- C2: viec tu tao cho chinh minh
  revision_count int not null default 0,
  -- Trang thai (6 trang thai, KHONG co overdue — qua han tinh tu due_at)
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','pending_review','needs_revision','completed','cancelled')),
  attachments jsonb not null default '[]'::jsonb,  -- file huong dan tu nguoi giao
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status, due_at);
create index if not exists tasks_reviewer_idx on public.tasks (reviewer_id, status);
create index if not exists tasks_loc_idx      on public.tasks (location_code, status, due_at);
create index if not exists tasks_region_idx   on public.tasks (region, status);
create index if not exists tasks_due_idx      on public.tasks (due_at) where status not in ('completed','cancelled');
create index if not exists tasks_batch_idx    on public.tasks (batch_id);
create index if not exists tasks_series_idx   on public.tasks (recurrence_series_id);
create index if not exists tasks_tags_idx     on public.tasks using gin (tags);
-- Chong cron tao trung ky lap
create unique index if not exists tasks_recur_uniq on public.tasks (recurrence_instance_key)
  where recurrence_instance_key is not null;

-- ===================== 3) CHECKLIST =====================
create table if not exists public.task_checklist_items (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  is_required boolean not null default false,
  is_completed boolean not null default false,
  completed_by uuid references public.profiles(id),
  completed_by_name text default '',
  completed_at timestamptz,
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_cl_idx on public.task_checklist_items (task_id, sort_order);

-- ===================== 4) NGUOI PHOI HOP =====================
create table if not exists public.task_collaborators (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text default '',
  can_check boolean not null default true,          -- duoc tich checklist khong
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists task_collab_user_idx on public.task_collaborators (user_id);

-- ===================== 5) KET QUA (co phien ban) =====================
create table if not exists public.task_results (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  version_number int not null default 1,
  is_current boolean not null default true,
  result_text text default '',
  result_link text default '',
  files jsonb not null default '[]'::jsonb,         -- C4: [{url, path, name, size, type}]
  submitted_by uuid not null references public.profiles(id),
  submitted_by_name text default '',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists task_result_idx on public.task_results (task_id, version_number desc);

-- ===================== 6) BINH LUAN =====================
create table if not exists public.task_comments (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  user_name text default '',
  content text not null,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_cmt_idx on public.task_comments (task_id, created_at);

-- ===================== 7) MAU CONG VIEC =====================
create table if not exists public.task_templates (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  description text default '',
  completion_criteria text default '',
  category_id bigint references public.task_categories(id),
  default_priority text not null default 'Bình thường',
  default_duration_hours numeric not null default 24,
  requires_review boolean not null default true,
  require_text_result boolean not null default false,
  require_link boolean not null default false,
  require_image boolean not null default false,
  require_file boolean not null default false,
  require_all_checklist boolean not null default false,
  minimum_image_count int not null default 0,
  scope_region text,                                -- null = dung chung toan he thong
  created_by uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_template_items (
  id bigserial primary key,
  template_id bigint not null references public.task_templates(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  is_required boolean not null default false
);
create index if not exists task_tpl_item_idx on public.task_template_items (template_id, sort_order);

-- ===================== 8) CHUOI LAP LAI =====================
create table if not exists public.task_recurrence_series (
  id bigserial primary key,
  title text not null,
  template_id bigint references public.task_templates(id),
  -- Quy tac: daily | weekly | monthly | weekday_set | month_end
  rule_type text not null check (rule_type in ('daily','weekly','monthly','weekday_set','month_end')),
  weekdays int[] not null default '{}',             -- 1=T2 ... 7=CN (cho weekly/weekday_set)
  day_of_month int,                                 -- cho monthly
  due_time time not null default '17:00',           -- gio het han trong ngay
  lead_hours numeric not null default 0,            -- tao truoc han bao nhieu gio
  assignee_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  location_code text references public.locations(code),
  priority text not null default 'Bình thường',
  category_id bigint references public.task_categories(id),
  description text default '',
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default true,
  last_run_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_series_active_idx on public.task_recurrence_series (is_active, start_date);

alter table public.tasks drop constraint if exists tasks_series_fk;
alter table public.tasks add constraint tasks_series_fk
  foreign key (recurrence_series_id) references public.task_recurrence_series(id) on delete set null;
alter table public.tasks drop constraint if exists tasks_template_fk;
alter table public.tasks add constraint tasks_template_fk
  foreign key (template_id) references public.task_templates(id) on delete set null;

-- ===================== 9) OUTBOX DISCORD (bat dong bo + retry) =====================
create table if not exists public.task_outbox (
  id bigserial primary key,
  task_id bigint references public.tasks(id) on delete cascade,
  event_type text not null,                         -- created|started|submitted|revision|completed|overdue|updated
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  discord_message_id text,
  error_message text default '',
  idempotency_key text unique not null,             -- chong gui trung
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists task_outbox_pending_idx on public.task_outbox (status, next_retry_at);

-- ===================== 10) AUDIT LOG =====================
create table if not exists public.task_audit_logs (
  id bigserial primary key,
  task_id bigint references public.tasks(id) on delete cascade,
  entity_type text not null default 'task',
  action text not null,
  old_data jsonb,
  new_data jsonb,
  note text default '',
  acted_by uuid references public.profiles(id),
  acted_by_name text default '',
  acted_at timestamptz not null default now()
);
create index if not exists task_audit_idx on public.task_audit_logs (task_id, acted_at desc);

-- ===================== 11) TRIGGER updated_at =====================
do $do$
declare t text;
begin
  foreach t in array array['tasks','task_checklist_items','task_templates',
                           'task_recurrence_series','task_comments','task_outbox'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public._touch_updated_at()', t);
  end loop;
end $do$;

-- ===================== 12) QUYEN MOI =====================
insert into public.role_perms (role, perm, allowed) values
  ('SALES','task_xem',true),        ('TECHNICIAN','task_xem',true),        ('MANAGER','task_xem',true),        ('ADMIN','task_xem',true),        ('CEO','task_xem',true),
  ('SALES','task_tu_tao',true),     ('TECHNICIAN','task_tu_tao',true),     ('MANAGER','task_tu_tao',true),     ('ADMIN','task_tu_tao',true),     ('CEO','task_tu_tao',true),
  ('SALES','task_giao_viec',false), ('TECHNICIAN','task_giao_viec',false), ('MANAGER','task_giao_viec',true),  ('ADMIN','task_giao_viec',true),  ('CEO','task_giao_viec',true),
  ('SALES','task_duyet',false),     ('TECHNICIAN','task_duyet',false),     ('MANAGER','task_duyet',true),      ('ADMIN','task_duyet',true),      ('CEO','task_duyet',true),
  ('SALES','task_huy',false),       ('TECHNICIAN','task_huy',false),       ('MANAGER','task_huy',true),        ('ADMIN','task_huy',true),        ('CEO','task_huy',true),
  ('SALES','task_mau',false),       ('TECHNICIAN','task_mau',false),       ('MANAGER','task_mau',true),        ('ADMIN','task_mau',true),        ('CEO','task_mau',true),
  ('SALES','task_lap_lai',false),   ('TECHNICIAN','task_lap_lai',false),   ('MANAGER','task_lap_lai',true),    ('ADMIN','task_lap_lai',true),    ('CEO','task_lap_lai',true),
  ('SALES','task_bao_cao_cty',false),('TECHNICIAN','task_bao_cao_cty',false),('MANAGER','task_bao_cao_cty',false),('ADMIN','task_bao_cao_cty',true),('CEO','task_bao_cao_cty',true)
on conflict (role, perm) do nothing;

-- ===================== 13) CAI DAT: KENH DISCORD RIENG (C7) =====================
insert into public.app_settings (key, value) values
  ('discord_webhook_task', ''),                     -- kenh rieng cho cong viec
  ('task_nhac_qua_han_gio', '24'),                  -- nhac lai sau N gio
  ('task_bao_start_muc', 'Cao,Khẩn cấp')            -- chi bao "da bat dau" voi muc nay
on conflict (key) do nothing;

-- ===================== 14) STORAGE (C4: cong khai) =====================
insert into storage.buckets (id, name, public) values ('task-files','task-files', true)
on conflict (id) do update set public = true;
drop policy if exists "upload_task_files" on storage.objects;
create policy "upload_task_files" on storage.objects for insert to authenticated with check (bucket_id = 'task-files');
drop policy if exists "read_task_files" on storage.objects;
create policy "read_task_files" on storage.objects for select to public using (bucket_id = 'task-files');
drop policy if exists "delete_task_files" on storage.objects;
create policy "delete_task_files" on storage.objects for delete to authenticated using (bucket_id = 'task-files');

-- ===================== 15) RLS =====================
do $do$
declare t text;
begin
  foreach t in array array['tasks','task_checklist_items','task_collaborators','task_results',
    'task_comments','task_templates','task_template_items','task_recurrence_series',
    'task_categories','task_outbox','task_audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $do$;

-- Helper: user co duoc xem task nay khong (assignee | collaborator | nguoi giao | quan ly khu vuc | BGD)
create or replace function public.task_co_quyen_xem(p_task_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and (
      t.assignee_id = auth.uid()
      or t.created_by = auth.uid()
      or t.reviewer_id = auth.uid()
      or exists (select 1 from public.task_collaborators c where c.task_id = t.id and c.user_id = auth.uid())
      or public.my_role() in ('ADMIN','CEO')
      or (public.my_role() = 'MANAGER' and (public.my_region() is null or t.region = public.my_region()))
    )
  )
$$;

-- Danh muc + mau: ai dang nhap cung doc duoc
drop policy if exists "read_task_categories" on public.task_categories;
create policy "read_task_categories" on public.task_categories for select to authenticated using (true);
drop policy if exists "read_task_templates" on public.task_templates;
create policy "read_task_templates" on public.task_templates for select to authenticated using (true);
drop policy if exists "read_task_tpl_items" on public.task_template_items;
create policy "read_task_tpl_items" on public.task_template_items for select to authenticated using (true);
drop policy if exists "read_task_series" on public.task_recurrence_series;
create policy "read_task_series" on public.task_recurrence_series for select to authenticated using (
  assignee_id = auth.uid() or public.my_role() in ('ADMIN','CEO')
  or (public.my_role() = 'MANAGER' and (public.my_region() is null
      or exists (select 1 from public.locations l where l.code = location_code and l.region = public.my_region())))
);

-- TASK: doc theo pham vi
drop policy if exists "read_tasks" on public.tasks;
create policy "read_tasks" on public.tasks for select to authenticated using (
  deleted_at is null and (
    assignee_id = auth.uid()
    or created_by = auth.uid()
    or reviewer_id = auth.uid()
    or exists (select 1 from public.task_collaborators c where c.task_id = tasks.id and c.user_id = auth.uid())
    or public.my_role() in ('ADMIN','CEO')
    or (public.my_role() = 'MANAGER' and (public.my_region() is null or region = public.my_region()))
  )
);
-- C2: nhan vien tu tao viec cho CHINH MINH (is_personal, khong duoc gan cho nguoi khac)
drop policy if exists "insert_task_personal" on public.tasks;
create policy "insert_task_personal" on public.tasks for insert to authenticated
  with check (assignee_id = auth.uid() and created_by = auth.uid() and is_personal = true and status = 'not_started');
-- KHONG mo update truc tiep: moi chuyen trang thai di qua RPC security definer (041)

-- Bang con: theo quyen xem task
drop policy if exists "read_task_cl" on public.task_checklist_items;
create policy "read_task_cl" on public.task_checklist_items for select to authenticated using (public.task_co_quyen_xem(task_id));
drop policy if exists "read_task_collab" on public.task_collaborators;
create policy "read_task_collab" on public.task_collaborators for select to authenticated using (public.task_co_quyen_xem(task_id));
drop policy if exists "read_task_results" on public.task_results;
create policy "read_task_results" on public.task_results for select to authenticated using (public.task_co_quyen_xem(task_id));
drop policy if exists "read_task_comments" on public.task_comments;
create policy "read_task_comments" on public.task_comments for select to authenticated using (deleted_at is null and public.task_co_quyen_xem(task_id));
drop policy if exists "read_task_audit" on public.task_audit_logs;
create policy "read_task_audit" on public.task_audit_logs for select to authenticated using (
  public.my_role() in ('ADMIN','CEO') or public.task_co_quyen_xem(task_id)
);
-- Outbox: chi ADMIN/CEO xem (chua webhook payload)
drop policy if exists "read_task_outbox" on public.task_outbox;
create policy "read_task_outbox" on public.task_outbox for select to authenticated using (public.my_role() in ('ADMIN','CEO'));

-- ===================== 16) SEED: NHOM CONG VIEC =====================
insert into public.task_categories (code, name, sort_order) values
  ('BAN_HANG','Bán hàng',1), ('MARKETING','Marketing',2), ('CSKH','Chăm sóc khách hàng',3),
  ('KHO','Kho và kiểm kê',4), ('DICH_VU','Dịch vụ kỹ thuật',5), ('TAI_CHINH','Tài chính – kế toán',6),
  ('NHAN_SU','Nhân sự',7), ('HANH_CHINH','Hành chính',8), ('CO_SO','Cơ sở vật chất',9),
  ('BGD','Ban giám đốc',10), ('KHAC','Khác',99)
on conflict (code) do nothing;

-- ===================== 17) SEED: 10 MAU CONG VIEC =====================
insert into public.task_templates (code, name, description, completion_criteria, category_id,
  default_priority, default_duration_hours, require_image, require_text_result, require_link, minimum_image_count)
select v.code, v.name, v.mo_ta, v.tieu_chuan, c.id, v.uu_tien, v.gio, v.anh, v.chu, v.link, v.so_anh
from (values
  ('TPL-DANGBAI','Đăng bài truyền thông','Đăng bài lên Facebook/Zalo theo nội dung được duyệt.','Bài đã đăng, gửi link hoặc ảnh chụp màn hình.','MARKETING','Bình thường',8,false,false,true,0),
  ('TPL-GOIKHACH','Gọi lại khách hàng cũ','Gọi danh sách khách được giao, ghi nhận phản hồi.','Ghi chú kết quả từng khách + file danh sách.','CSKH','Bình thường',24,false,true,false,0),
  ('TPL-KIEMKHO','Kiểm kê tồn kho','Đếm thực tế và đối chiếu với app tồn kho.','Biên bản kiểm kê + ảnh thực tế.','KHO','Cao',12,true,true,false,2),
  ('TPL-KIEMQUY','Kiểm tra quỹ tiền mặt','Đếm quỹ, đối chiếu sổ thu chi.','Ảnh biên bản chốt quỹ.','TAI_CHINH','Cao',4,true,true,false,1),
  ('TPL-BCKHACH','Báo cáo khách hàng tiềm năng','Tổng hợp khách quan tâm trong tuần.','File hoặc ghi chú danh sách khách.','BAN_HANG','Bình thường',24,false,true,false,0),
  ('TPL-TRUNGBAY','Kiểm tra trưng bày cửa hàng','Rà soát vị trí xe, bảng giá, biển hiệu.','Ảnh khu trưng bày.','CO_SO','Bình thường',6,true,false,false,3),
  ('TPL-VESINH','Kiểm tra vệ sinh cửa hàng','Vệ sinh khu bán hàng và khu dịch vụ.','Ảnh trước/sau.','CO_SO','Thấp',4,true,false,false,2),
  ('TPL-CONGNO','Thu hồi công nợ','Liên hệ khách còn nợ, ghi nhận cam kết trả.','Ghi chú từng khách + số tiền thu được.','TAI_CHINH','Cao',48,false,true,false,0),
  ('TPL-BANGIAOCA','Bàn giao ca','Bàn giao tiền, chìa khóa, tình trạng cửa hàng.','Ảnh biên bản bàn giao.','HANH_CHINH','Bình thường',2,true,false,false,1),
  ('TPL-BCCUOINGAY','Báo cáo hoạt động cuối ngày','Tổng hợp bán hàng, khách, tồn kho trong ngày.','Ghi chú số liệu cuối ngày.','BGD','Bình thường',2,false,true,false,0)
) as v(code,name,mo_ta,tieu_chuan,cat,uu_tien,gio,anh,chu,link,so_anh)
join public.task_categories c on c.code = v.cat
on conflict (code) do nothing;

-- Checklist mau cho 2 mau hay dung nhat
insert into public.task_template_items (template_id, title, sort_order, is_required)
select t.id, v.title, v.ord, v.req
from (values
  ('TPL-KIEMKHO','Kiểm tra từng vị trí trưng bày',1,true),
  ('TPL-KIEMKHO','Đối chiếu số khung với app',2,true),
  ('TPL-KIEMKHO','Ghi nhận chênh lệch (nếu có)',3,true),
  ('TPL-KIEMKHO','Chụp ảnh bằng chứng',4,true),
  ('TPL-KIEMKHO','Gửi kết quả chờ xác nhận',5,true),
  ('TPL-BANGIAOCA','Đếm và bàn giao tiền mặt',1,true),
  ('TPL-BANGIAOCA','Bàn giao chìa khóa, thiết bị',2,true),
  ('TPL-BANGIAOCA','Ghi nhận tình trạng cửa hàng',3,false)
) as v(tpl,title,ord,req)
join public.task_templates t on t.code = v.tpl
where not exists (select 1 from public.task_template_items i where i.template_id = t.id and i.title = v.title);

-- ===================== 18) KIEM TRA =====================
do $do$
declare v_cat int; v_tpl int; v_perm int;
begin
  select count(*) into v_cat from public.task_categories;
  select count(*) into v_tpl from public.task_templates;
  select count(*) into v_perm from public.role_perms where perm like 'task_%';
  raise notice 'XONG 040: nhom cong viec=% | mau=% | dong phan quyen=%', v_cat, v_tpl, v_perm;
end $do$;

-- ============================================================
-- ROLLBACK (chi khi go bo hoan toan module):
--   drop table if exists public.task_audit_logs, public.task_outbox,
--     public.task_comments, public.task_results, public.task_collaborators,
--     public.task_checklist_items, public.tasks, public.task_recurrence_series,
--     public.task_template_items, public.task_templates, public.task_categories cascade;
--   drop function if exists public.task_co_quyen_xem(bigint);
--   delete from public.role_perms where perm like 'task_%';
--   delete from public.app_settings where key in
--     ('discord_webhook_task','task_nhac_qua_han_gio','task_bao_start_muc');
--   -- Xoa bucket: Storage > task-files > Delete bucket
-- Khong dung vao bang kho/don ban/dich vu -> rollback khong anh huong module cu.
-- ============================================================
