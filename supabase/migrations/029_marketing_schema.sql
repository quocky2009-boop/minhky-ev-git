-- ============================================================
-- Migration 029 — MODULE MARKETING & KPI (Giai doan 2/1: SCHEMA)
-- Chot thiet ke (da duyet):
--  C1(b) don vi = KHU VUC (profiles.region / locations.region) —
--       khong them cot location_code, dung dung bo may hien tai.
--  C2   tao chien dich: CEO + ADMIN + MANAGER (qua quyen dong).
--  C3   bigserial + ma text (CD-YYMM-xxxxx) theo chuan app.
--  C4   anh chung minh = cot photos jsonb (giong sales_orders).
--  C5   bucket 'marketing' CONG KHAI (de Discord hien anh).
--  C6   tuan = Thu 2 -> Chu nhat (dung date_trunc('week') cua PG).
--  C7   thong bao: Discord + badge, khong lam bang notification.
--
-- Chay SAU 028. Chay lai duoc nhieu lan (idempotent).
-- ROLLBACK: xem cuoi file.
-- ============================================================

-- ===================== 0) DANH MUC NEN TANG (app_settings) =====================
insert into public.app_settings(key, value) values
  ('mkt_platforms', E'Facebook cá nhân\nFacebook Page\nFacebook Group\nFacebook Reels\nZalo cá nhân\nZalo OA\nTikTok\nYouTube Shorts\nInstagram\nWebsite\nOffline\nKhác')
on conflict (key) do nothing;

-- ===================== 1) KPI DINH KY =====================
create table if not exists public.mkt_kpi_templates (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  description text default '',
  kpi_type text not null check (kpi_type in ('social_post','short_video','test_drive','custom')),
  target_quantity int not null check (target_quantity > 0),
  period_type text not null default 'weekly' check (period_type in ('daily','weekly','monthly','custom_period')),
  counting_method text default 'submissions' check (counting_method in ('submissions','test_drive_sessions','unique_customers')),
  effective_from date not null default current_date,
  effective_to date,
  require_approval boolean not null default true,
  weight numeric,
  status text not null default 'Hoạt động' check (status in ('Hoạt động','Tạm dừng')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Giao KPI: region null = toan he thong; role null = moi vai tro; user_id null = ca nhom
create table if not exists public.mkt_kpi_assignments (
  id bigserial primary key,
  kpi_template_id bigint not null references public.mkt_kpi_templates(id) on delete cascade,
  region text check (region in ('Thành phố','Hàm Yên')),
  role_code text check (role_code in ('CEO','MANAGER','SALES','ADMIN')),
  user_id uuid references public.profiles(id) on delete cascade,
  participation_type text not null default 'required' check (participation_type in ('required','encouraged','exempted')),
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists mkt_kpi_assign_idx on public.mkt_kpi_assignments (kpi_template_id, region, user_id);

-- ===================== 2) CHIEN DICH =====================
create table if not exists public.mkt_campaigns (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  description text default '',
  instructions text default '',
  sample_content_url text default '',
  document_url text default '',
  media_folder_url text default '',
  start_at date not null,
  end_at date not null,
  priority text not null default 'Bình thường' check (priority in ('Thấp','Bình thường','Cao','Khẩn')),
  status text not null default 'draft' check (status in ('draft','scheduled','active','ended','completed','cancelled')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  published_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);
create index if not exists mkt_camp_status_idx on public.mkt_campaigns (status, start_at, end_at);

create table if not exists public.mkt_campaign_requirements (
  id bigserial primary key,
  campaign_id bigint not null references public.mkt_campaigns(id) on delete cascade,
  title text not null,
  description text default '',
  content_type text not null check (content_type in ('social_post','short_video','share','test_drive','custom')),
  target_quantity int not null default 1 check (target_quantity > 0),
  platforms jsonb not null default '[]'::jsonb,
  link_required boolean not null default true,
  evidence_allowed boolean not null default true,
  evidence_required boolean not null default false,
  approval_required boolean not null default true,
  acceptance_criteria text default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_camp_req_idx on public.mkt_campaign_requirements (campaign_id, sort_order);

create table if not exists public.mkt_campaign_targets (
  id bigserial primary key,
  campaign_id bigint not null references public.mkt_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  region text,
  participation_type text not null default 'required' check (participation_type in ('required','encouraged','exempted')),
  -- Xac nhan hoan thanh cua CHT (khong tinh toan, chi luu vet quyet dinh)
  manager_confirmed_by uuid references public.profiles(id),
  manager_confirmed_at timestamptz,
  manager_note text default '',
  -- Mien KPI
  exempted_by uuid references public.profiles(id),
  exempted_at timestamptz,
  exemption_reason text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create index if not exists mkt_camp_target_idx on public.mkt_campaign_targets (campaign_id, user_id, region);

-- Xac nhan hoan thanh cap CUA HANG (khu vuc)
create table if not exists public.mkt_branch_progress (
  id bigserial primary key,
  campaign_id bigint not null references public.mkt_campaigns(id) on delete cascade,
  region text not null,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  note text default '',
  updated_at timestamptz not null default now(),
  unique (campaign_id, region)
);

-- ===================== 3) BAO CAO (SUBMISSIONS) =====================
create table if not exists public.mkt_submissions (
  id bigserial primary key,
  code text unique not null,
  source_type text not null check (source_type in ('kpi','campaign')),
  kpi_template_id bigint references public.mkt_kpi_templates(id) on delete set null,
  campaign_id bigint references public.mkt_campaigns(id) on delete cascade,
  campaign_requirement_id bigint references public.mkt_campaign_requirements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text default '',
  region text,
  platform text not null default 'Khác',
  content_type text not null check (content_type in ('social_post','short_video','share','test_drive','custom')),
  content_url text default '',
  normalized_url text default '',
  normalized_url_hash text,
  duplicate_override boolean not null default false,
  duplicate_override_by uuid references public.profiles(id),
  duplicate_override_at timestamptz,
  duplicate_override_reason text default '',
  photos jsonb not null default '[]'::jsonb,
  published_at date,
  note text default '',
  is_extra boolean not null default false,       -- bao cao nop du (vuot muc tieu)
  status text not null default 'draft' check (status in ('draft','submitted','needs_revision','approved','rejected','cancelled')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_by_name text default '',
  reviewed_at timestamptz,
  review_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bao cao phai gan dung 1 nguon
  check ((source_type = 'kpi' and kpi_template_id is not null and campaign_id is null)
      or (source_type = 'campaign' and campaign_id is not null and campaign_requirement_id is not null))
);
create index if not exists mkt_sub_user_idx on public.mkt_submissions (user_id, status, published_at);
create index if not exists mkt_sub_region_idx on public.mkt_submissions (region, status);
create index if not exists mkt_sub_camp_idx on public.mkt_submissions (campaign_id, campaign_requirement_id, status);
create index if not exists mkt_sub_kpi_idx on public.mkt_submissions (kpi_template_id, status, published_at);
create index if not exists mkt_sub_platform_idx on public.mkt_submissions (platform);

-- CHONG TRUNG LINK: 1 link chi tinh KPI 1 lan toan he thong.
-- Partial unique: chi ap dung voi phieu con hieu luc va khong duoc BGD cho ngoai le.
create unique index if not exists mkt_sub_url_uniq
  on public.mkt_submissions (normalized_url_hash)
  where normalized_url_hash is not null
    and status not in ('rejected','cancelled')
    and duplicate_override = false;

-- ===================== 4) LAI THU =====================
create table if not exists public.test_drives (
  id bigserial primary key,
  code text unique not null,
  customer_id bigint not null references public.customers(id) on delete restrict,
  customer_name_snapshot text default '',
  customer_phone_snapshot text default '',
  normalized_phone text not null,
  region text,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  employee_name text default '',
  campaign_id bigint references public.mkt_campaigns(id) on delete set null,
  kpi_template_id bigint references public.mkt_kpi_templates(id) on delete set null,
  interested_vehicle_id text references public.vehicles(id),
  test_drive_vehicle_id text references public.vehicles(id),
  actual_frame_number text,
  test_drive_at timestamptz not null default now(),
  test_drive_date date generated always as ((test_drive_at at time zone 'Asia/Ho_Chi_Minh')::date) stored,
  duration_minutes int,
  customer_need_level text not null default 'warm' check (customer_need_level in ('cold','warm','hot')),
  result_status text not null default 'undecided' check (result_status in ('undecided','interested','follow_up','quotation_sent','deposit','purchased','no_longer_interested')),
  customer_feedback text default '',
  employee_note text default '',
  photos jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','approved','needs_revision','rejected','cancelled')),
  is_suspicious boolean not null default false,
  suspicious_note text default '',
  excluded_from_kpi boolean not null default false,
  exclusion_reason text default '',
  excluded_by uuid references public.profiles(id),
  excluded_at timestamptz,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_by_name text default '',
  reviewed_at timestamptz,
  review_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists td_customer_idx on public.test_drives (customer_id);
create index if not exists td_phone_idx on public.test_drives (normalized_phone, test_drive_date);
create index if not exists td_emp_idx on public.test_drives (employee_id, status, test_drive_date);
create index if not exists td_region_idx on public.test_drives (region, status);
create index if not exists td_flags_idx on public.test_drives (is_suspicious, excluded_from_kpi);
create index if not exists td_camp_idx on public.test_drives (campaign_id);

-- CHONG KHAI KHONG: cung SDT + cung ngay + cung NV + cung dong xe -> chi 1 luot approved
create unique index if not exists td_dup_uniq
  on public.test_drives (normalized_phone, test_drive_date, employee_id, test_drive_vehicle_id)
  where status = 'approved';

-- ===================== 5) AUDIT LOG =====================
create table if not exists public.mkt_audit_logs (
  id bigserial primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  note text default '',
  acted_by uuid references public.profiles(id),
  acted_by_name text default '',
  acted_at timestamptz not null default now()
);
create index if not exists mkt_audit_idx on public.mkt_audit_logs (entity_type, entity_id, acted_at desc);

-- ===================== 6) TRIGGER updated_at =====================
create or replace function public._touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $do$
declare t text;
begin
  foreach t in array array['mkt_kpi_templates','mkt_campaigns','mkt_campaign_requirements',
                           'mkt_campaign_targets','mkt_submissions','test_drives','mkt_branch_progress'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public._touch_updated_at()', t);
  end loop;
end $do$;

-- ===================== 7) QUYEN MOI (role_perms) =====================
insert into public.role_perms (role, perm, allowed) values
  ('SALES','mkt_bao_cao',true),      ('MANAGER','mkt_bao_cao',true),    ('ADMIN','mkt_bao_cao',true),    ('CEO','mkt_bao_cao',true),
  ('SALES','mkt_lai_thu',true),      ('MANAGER','mkt_lai_thu',true),    ('ADMIN','mkt_lai_thu',true),    ('CEO','mkt_lai_thu',true),
  ('SALES','mkt_duyet',false),       ('MANAGER','mkt_duyet',true),      ('ADMIN','mkt_duyet',true),      ('CEO','mkt_duyet',true),
  ('SALES','mkt_chien_dich',false),  ('MANAGER','mkt_chien_dich',true), ('ADMIN','mkt_chien_dich',true), ('CEO','mkt_chien_dich',true),
  ('SALES','mkt_kpi_dinh_ky',false), ('MANAGER','mkt_kpi_dinh_ky',false),('ADMIN','mkt_kpi_dinh_ky',true),('CEO','mkt_kpi_dinh_ky',true),
  ('SALES','mkt_xem_toan_cty',false),('MANAGER','mkt_xem_toan_cty',false),('ADMIN','mkt_xem_toan_cty',true),('CEO','mkt_xem_toan_cty',true),
  ('SALES','mkt_ngoai_le',false),    ('MANAGER','mkt_ngoai_le',false),  ('ADMIN','mkt_ngoai_le',false),  ('CEO','mkt_ngoai_le',true)
on conflict (role, perm) do nothing;

-- ===================== 8) STORAGE (bucket cong khai) =====================
insert into storage.buckets (id, name, public)
values ('marketing', 'marketing', true)
on conflict (id) do update set public = true;

drop policy if exists "upload_marketing" on storage.objects;
create policy "upload_marketing" on storage.objects
  for insert to authenticated with check (bucket_id = 'marketing');

drop policy if exists "read_marketing" on storage.objects;
create policy "read_marketing" on storage.objects
  for select to public using (bucket_id = 'marketing');

drop policy if exists "delete_marketing" on storage.objects;
create policy "delete_marketing" on storage.objects
  for delete to authenticated using (bucket_id = 'marketing');

-- ===================== 9) RLS =====================
-- Nguyen tac: DOC theo pham vi; MOI THAO TAC GHI trang thai deu qua RPC
-- security definer (migration 030). Khong mo update truc tiep cot status.
alter table public.mkt_kpi_templates       enable row level security;
alter table public.mkt_kpi_assignments     enable row level security;
alter table public.mkt_campaigns           enable row level security;
alter table public.mkt_campaign_requirements enable row level security;
alter table public.mkt_campaign_targets    enable row level security;
alter table public.mkt_branch_progress     enable row level security;
alter table public.mkt_submissions         enable row level security;
alter table public.test_drives             enable row level security;
alter table public.mkt_audit_logs          enable row level security;

-- Helper: vai tro + khu vuc cua nguoi dang dang nhap (tranh tu khoa reserved)
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.my_region()
returns text language sql stable security definer set search_path = public as $$
  select region from public.profiles where id = auth.uid()
$$;

-- Danh muc: ai dang nhap cung doc duoc (loc hien thi o UI)
drop policy if exists "read_kpi_tpl" on public.mkt_kpi_templates;
create policy "read_kpi_tpl" on public.mkt_kpi_templates for select to authenticated using (true);
drop policy if exists "read_kpi_assign" on public.mkt_kpi_assignments;
create policy "read_kpi_assign" on public.mkt_kpi_assignments for select to authenticated using (true);
drop policy if exists "read_camp" on public.mkt_campaigns;
create policy "read_camp" on public.mkt_campaigns for select to authenticated using (true);
drop policy if exists "read_camp_req" on public.mkt_campaign_requirements;
create policy "read_camp_req" on public.mkt_campaign_requirements for select to authenticated using (true);
drop policy if exists "read_branch_prog" on public.mkt_branch_progress;
create policy "read_branch_prog" on public.mkt_branch_progress for select to authenticated using (true);

-- Doi tuong chien dich: nhan vien thay dong cua minh; MANAGER thay khu vuc; ADMIN/CEO thay tat ca
drop policy if exists "read_camp_target" on public.mkt_campaign_targets;
create policy "read_camp_target" on public.mkt_campaign_targets for select to authenticated using (
  user_id = auth.uid()
  or public.my_role() in ('ADMIN','CEO')
  or (public.my_role() = 'MANAGER' and (public.my_region() is null or region = public.my_region()))
);

-- Bao cao
drop policy if exists "read_sub" on public.mkt_submissions;
create policy "read_sub" on public.mkt_submissions for select to authenticated using (
  user_id = auth.uid()
  or public.my_role() in ('ADMIN','CEO')
  or (public.my_role() = 'MANAGER' and (public.my_region() is null or region = public.my_region()))
);
-- Chi tao phieu NHAP cho chinh minh, va chi o trang thai draft
drop policy if exists "insert_sub" on public.mkt_submissions;
create policy "insert_sub" on public.mkt_submissions for insert to authenticated
  with check (user_id = auth.uid() and status = 'draft');
-- Chi sua phieu cua minh khi con draft/needs_revision; khong duoc tu doi chu so huu
drop policy if exists "update_sub" on public.mkt_submissions;
create policy "update_sub" on public.mkt_submissions for update to authenticated
  using (user_id = auth.uid() and status in ('draft','needs_revision'))
  with check (user_id = auth.uid() and status in ('draft','needs_revision'));
-- Chi xoa duoc ban nhap cua minh
drop policy if exists "delete_sub" on public.mkt_submissions;
create policy "delete_sub" on public.mkt_submissions for delete to authenticated
  using (user_id = auth.uid() and status = 'draft');

-- Lai thu (tuong tu)
drop policy if exists "read_td" on public.test_drives;
create policy "read_td" on public.test_drives for select to authenticated using (
  employee_id = auth.uid()
  or public.my_role() in ('ADMIN','CEO')
  or (public.my_role() = 'MANAGER' and (public.my_region() is null or region = public.my_region()))
);
drop policy if exists "insert_td" on public.test_drives;
create policy "insert_td" on public.test_drives for insert to authenticated
  with check (employee_id = auth.uid() and status = 'draft');
drop policy if exists "update_td" on public.test_drives;
create policy "update_td" on public.test_drives for update to authenticated
  using (employee_id = auth.uid() and status in ('draft','needs_revision'))
  with check (employee_id = auth.uid() and status in ('draft','needs_revision'));
drop policy if exists "delete_td" on public.test_drives;
create policy "delete_td" on public.test_drives for delete to authenticated
  using (employee_id = auth.uid() and status = 'draft');

-- Audit log: chi ADMIN/CEO doc
drop policy if exists "read_audit" on public.mkt_audit_logs;
create policy "read_audit" on public.mkt_audit_logs for select to authenticated
  using (public.my_role() in ('ADMIN','CEO'));

-- ===================== 10) SEED KPI MAU =====================
insert into public.mkt_kpi_templates (code, name, description, kpi_type, target_quantity, period_type, counting_method, require_approval)
values
  ('KPI-BAIVIET', '6 bài viết mỗi tuần', 'Đăng Facebook / Zalo — ảnh, chữ hoặc video.', 'social_post', 6, 'weekly', 'submissions', true),
  ('KPI-VIDEO',   '3 video mỗi tuần',   'Video ngắn TikTok / Facebook Reels / YouTube Shorts.', 'short_video', 3, 'weekly', 'submissions', true),
  ('KPI-LAITHU',  '10 khách lái thử mỗi tháng', 'Đếm số khách hàng duy nhất có lượt lái thử được duyệt.', 'test_drive', 10, 'monthly', 'unique_customers', true)
on conflict (code) do nothing;

-- Giao cho toan bo SALES (region null = tat ca khu vuc), bat buoc
insert into public.mkt_kpi_assignments (kpi_template_id, region, role_code, user_id, participation_type)
select t.id, null, 'SALES', null, 'required' from public.mkt_kpi_templates t
where t.code in ('KPI-BAIVIET','KPI-VIDEO','KPI-LAITHU')
  and not exists (select 1 from public.mkt_kpi_assignments a where a.kpi_template_id = t.id and a.role_code = 'SALES' and a.user_id is null);

-- ============================================================
-- ROLLBACK (chi chay khi can go bo hoan toan module):
--   drop table if exists public.mkt_audit_logs, public.test_drives,
--     public.mkt_submissions, public.mkt_branch_progress,
--     public.mkt_campaign_targets, public.mkt_campaign_requirements,
--     public.mkt_campaigns, public.mkt_kpi_assignments,
--     public.mkt_kpi_templates cascade;
--   delete from public.role_perms where perm like 'mkt_%';
--   delete from public.app_settings where key = 'mkt_platforms';
--   -- Xoa bucket: Storage > marketing > Delete bucket (xoa ca anh!)
-- Luu y: KHONG dung lai bang cu (customers/profiles/vehicles) nen
-- rollback module nay khong anh huong module kho.
-- ============================================================
