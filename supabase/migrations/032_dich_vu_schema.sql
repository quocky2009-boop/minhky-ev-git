-- ============================================================
-- Migration 032 — MODULE DỊCH VỤ (GĐ1: SCHEMA + RLS + SEED)
-- Bam theo QT-DV-01. Cac chot da duyet:
--  (1) Phu tung theo SO LUONG (SKU); rieng PIN/AC QUY theo SERIAL
--  (2) Them vai tro TECHNICIAN (Ky thuat vien)
--  (3) Han muc CHT tu duyet giam gia: 100.000d (chinh trong Cai dat)
--  (4) Bang gia tien cong: seed mau, sua trong Cai dat
--  (5) Phieu thu gan phieu DV o app nay; SO QUY tong van o app So Thu Chi
--  (6) Ap dung 2 khu vuc Thanh pho + Ham Yen (theo locations san co)
-- LUU Y: 032 chi tao SCHEMA + RLS. Cac ham nghiep vu (khoa giao xe,
-- xuat theo phieu, EOD...) nam o 033 — chay 2 file lien tiep.
-- Chay SAU 031. Chay lai duoc nhieu lan.
-- ============================================================

-- ===================== 0) VAI TRO MOI: TECHNICIAN =====================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('CEO','MANAGER','SALES','ADMIN','TECHNICIAN'));

alter table public.role_perms drop constraint if exists role_perms_role_check;
alter table public.role_perms add constraint role_perms_role_check
  check (role in ('SALES','MANAGER','ADMIN','CEO','TECHNICIAN'));

-- ===================== 1) SO PHIEU LIEN TUC (QT muc 7.2) =====================
-- fn_gen_code cu sinh so NGAU NHIEN -> khong dat yeu cau "so phieu lien tuc".
-- Bo dem theo prefix + thang, cap so tang dan 0001, 0002...
create table if not exists public.doc_counters (
  prefix text not null,
  ym text not null,
  n int not null default 0,
  primary key (prefix, ym)
);
create or replace function public.fn_next_code(p_prefix text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_ym text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM'); v_n int;
begin
  insert into public.doc_counters (prefix, ym, n) values (p_prefix, v_ym, 1)
  on conflict (prefix, ym) do update set n = doc_counters.n + 1
  returning n into v_n;
  return p_prefix || '-' || v_ym || '-' || lpad(v_n::text, 4, '0');
end $$;

-- ===================== 2) BANG GIA TIEN CONG (dv_services) =====================
create table if not exists public.dv_services (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  group_name text default 'Chung',
  price bigint not null default 0,
  note text default '',
  status text not null default 'Hoạt động' check (status in ('Hoạt động','Ngừng')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===================== 3) KHO PHU TUNG =====================
create table if not exists public.parts (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  group_name text default 'Phụ tùng',
  unit text not null default 'cái',
  cost_price bigint not null default 0,
  sell_price bigint not null default 0,
  min_stock int not null default 0,
  track_serial boolean not null default false,   -- true: pin/ac quy theo serial
  status text not null default 'Hoạt động' check (status in ('Hoạt động','Ngừng')),
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parts_stock (
  part_id bigint not null references public.parts(id) on delete cascade,
  location_code text not null references public.locations(code),
  qty int not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (part_id, location_code)
);

-- Pin/ac quy theo tung serial
create table if not exists public.part_units (
  serial text primary key,
  part_id bigint not null references public.parts(id) on delete restrict,
  location_code text not null references public.locations(code),
  status text not null default 'TON_KHO' check (status in ('TON_KHO','DA_XUAT','BAO_HANH','HONG')),
  imported_at timestamptz not null default now(),
  ticket_code text default '',            -- phieu DV da xuat cho (neu co)
  note text default '',
  updated_at timestamptz not null default now()
);
create index if not exists part_units_part_idx on public.part_units (part_id, location_code, status);

-- Lich su nhap xuat phu tung (moi bien dong ton deu qua day)
create table if not exists public.pt_txns (
  id bigserial primary key,
  txn_type text not null check (txn_type in ('NHAP','XUAT_DV','XUAT_NOI_BO','DIEU_CHUYEN_DI','DIEU_CHUYEN_DEN','KIEM_KE','HOAN_TRA')),
  part_id bigint not null references public.parts(id),
  location_code text not null references public.locations(code),
  qty_change int not null,
  qty_before int not null default 0,
  qty_after int not null default 0,
  doc_code text not null default '',      -- PNPT-/DV-/XNB-/DCPT-
  serials jsonb not null default '[]'::jsonb,
  unit_cost bigint not null default 0,
  supplier_id bigint,
  note text default '',
  by_id uuid references public.profiles(id),
  by_name text default '',
  created_at timestamptz not null default now()
);
create index if not exists pt_txns_part_idx on public.pt_txns (part_id, location_code, created_at desc);
create index if not exists pt_txns_doc_idx on public.pt_txns (doc_code);

-- ===================== 4) PHIEU DICH VU =====================
create table if not exists public.dv_tickets (
  id bigserial primary key,
  code text unique not null,                            -- DV-YYMM-0001 lien tuc
  location_code text not null references public.locations(code),
  region text,
  -- Khach + xe
  customer_id bigint references public.customers(id),
  customer_name text not null default '',
  customer_phone text not null default '',
  frame_number text default '',                         -- xe Minh Ky ban (neu co)
  vehicle_desc text default '',                         -- mo ta xe (xe ngoai)
  odo_km int,
  battery_pct int,
  assets_note text default '',                          -- tai san/phu kien kem theo
  request_note text default '',                         -- yeu cau cua khach
  photos jsonb not null default '[]'::jsonb,            -- >=4 anh tiep nhan (fn 033 ep)
  -- Chan doan
  ktv_id uuid references public.profiles(id),
  ktv_name text default '',
  diagnose_note text default '',
  -- Khach duyet bao gia
  customer_approved_at timestamptz,
  customer_approve_evidence jsonb not null default '[]'::jsonb,  -- anh chu ky/tin nhan
  -- Giam gia (3): <=100k CHT duyet, vuot -> BGD
  discount bigint not null default 0 check (discount >= 0),
  discount_by uuid references public.profiles(id),
  discount_by_name text default '',
  discount_note text default '',
  -- Nghiem thu (nguoi khac KTV)
  qc_by uuid references public.profiles(id),
  qc_by_name text default '',
  qc_at timestamptz,
  qc_note text default '',
  -- Cong no (chi giao xe khi thu du HOAC cong no duoc duyet)
  debt_approved bigint not null default 0,
  debt_by uuid references public.profiles(id),
  debt_by_name text default '',
  debt_note text default '',
  -- Giao xe / dong
  delivered_at timestamptz,
  delivered_by uuid references public.profiles(id),
  delivered_by_name text default '',
  -- Trang thai theo 8 buoc QT-DV-01
  status text not null default 'TIEP_NHAN' check (status in
    ('TIEP_NHAN','CHAN_DOAN','CHO_DUYET_GIA','DANG_LAM','NGHIEM_THU','CHO_THANH_TOAN','DA_GIAO','HUY')),
  cancel_reason text default '',
  received_by uuid references public.profiles(id),
  received_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dv_tickets_loc_idx on public.dv_tickets (location_code, status, created_at desc);
create index if not exists dv_tickets_cust_idx on public.dv_tickets (customer_id);
create index if not exists dv_tickets_frame_idx on public.dv_tickets (frame_number);

-- Dong bao gia / hang muc tren phieu
create table if not exists public.dv_ticket_lines (
  id bigserial primary key,
  ticket_id bigint not null references public.dv_tickets(id) on delete cascade,
  line_type text not null check (line_type in ('CONG','PHU_TUNG','THUE_NGOAI','HANG_KHACH')),
  service_id bigint references public.dv_services(id),
  part_id bigint references public.parts(id),
  part_serial text default '',                          -- pin/ac quy theo serial
  name text not null,
  qty int not null default 1 check (qty > 0),
  unit_price bigint not null default 0,
  amount bigint not null default 0,
  is_phat_sinh boolean not null default false,          -- phat sinh sau khi khach da duyet
  approved boolean not null default false,              -- khach da duyet dong nay
  exported boolean not null default false,              -- vat tu DA xuat kho (033 xu ly)
  note text default '',
  created_at timestamptz not null default now()
);
create index if not exists dv_lines_ticket_idx on public.dv_ticket_lines (ticket_id);

-- Phieu thu gan phieu DV (so quy tong o app So Thu Chi — day la chung tu doi soat)
create table if not exists public.dv_payments (
  id bigserial primary key,
  code text unique not null,                            -- PTDV-YYMM-0001 lien tuc
  ticket_id bigint not null references public.dv_tickets(id) on delete restrict,
  method text not null check (method in ('Chuyển khoản','Tiền mặt')),
  amount bigint not null check (amount > 0),
  evidence jsonb not null default '[]'::jsonb,          -- anh giao dich / phieu thu
  collected_by uuid not null references public.profiles(id),
  collected_by_name text default '',
  note text default '',
  created_at timestamptz not null default now()
);
create index if not exists dv_pay_ticket_idx on public.dv_payments (ticket_id);

-- Danh sach NGUOI DUOC CHI DINH THU TIEN theo diem (QT 7.2 — KTV khong bao gio co)
create table if not exists public.dv_collectors (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_code text not null references public.locations(code),
  is_primary boolean not null default true,             -- thu chinh / du phong
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, location_code)
);

-- Doi soat cuoi ngay (EOD) theo diem — so lieu tu dong, 2 nguoi xac nhan
create table if not exists public.dv_eod (
  id bigserial primary key,
  location_code text not null references public.locations(code),
  eod_date date not null,
  so_phieu_dong int not null default 0,
  phai_thu bigint not null default 0,
  thu_ck bigint not null default 0,
  thu_tm bigint not null default 0,
  cong_no bigint not null default 0,
  lech bigint not null default 0,
  xe_luu int not null default 0,
  bien_ban_note text default '',                        -- BM-DV-07 khi co lech
  confirmed_thu_by uuid references public.profiles(id),
  confirmed_thu_name text default '',
  confirmed_thu_at timestamptz,
  confirmed_cht_by uuid references public.profiles(id),
  confirmed_cht_name text default '',
  confirmed_cht_at timestamptz,
  status text not null default 'MO' check (status in ('MO','DA_CHOT')),
  updated_at timestamptz not null default now(),
  unique (location_code, eod_date)
);

-- Audit log dich vu (khong xoa phieu — chi huy co ly do, moi hanh dong luu vet)
create table if not exists public.dv_audit_logs (
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
create index if not exists dv_audit_idx on public.dv_audit_logs (entity_type, entity_id, acted_at desc);

-- Trigger updated_at
do $do$
declare t text;
begin
  foreach t in array array['dv_services','parts','part_units','dv_tickets','dv_eod'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public._touch_updated_at()', t);
  end loop;
end $do$;

-- ===================== 5) QUYEN MOI (role_perms) =====================
insert into public.role_perms (role, perm, allowed) values
  -- Dich vu
  ('SALES','dv_tiep_nhan',true), ('MANAGER','dv_tiep_nhan',true), ('ADMIN','dv_tiep_nhan',true), ('CEO','dv_tiep_nhan',true), ('TECHNICIAN','dv_tiep_nhan',false),
  ('SALES','dv_chan_doan',false),('MANAGER','dv_chan_doan',true), ('ADMIN','dv_chan_doan',true), ('CEO','dv_chan_doan',true), ('TECHNICIAN','dv_chan_doan',true),
  ('SALES','dv_bao_gia',true),   ('MANAGER','dv_bao_gia',true),   ('ADMIN','dv_bao_gia',true),   ('CEO','dv_bao_gia',true),   ('TECHNICIAN','dv_bao_gia',false),
  ('SALES','dv_thu_tien',true),  ('MANAGER','dv_thu_tien',true),  ('ADMIN','dv_thu_tien',true),  ('CEO','dv_thu_tien',true),  ('TECHNICIAN','dv_thu_tien',false),
  ('SALES','dv_nghiem_thu',false),('MANAGER','dv_nghiem_thu',true),('ADMIN','dv_nghiem_thu',true),('CEO','dv_nghiem_thu',true),('TECHNICIAN','dv_nghiem_thu',false),
  ('SALES','dv_giao_xe',true),   ('MANAGER','dv_giao_xe',true),   ('ADMIN','dv_giao_xe',true),   ('CEO','dv_giao_xe',true),   ('TECHNICIAN','dv_giao_xe',false),
  ('SALES','dv_eod',false),      ('MANAGER','dv_eod',true),       ('ADMIN','dv_eod',true),       ('CEO','dv_eod',true),       ('TECHNICIAN','dv_eod',false),
  ('SALES','dv_huy_phieu',false),('MANAGER','dv_huy_phieu',false),('ADMIN','dv_huy_phieu',true), ('CEO','dv_huy_phieu',true), ('TECHNICIAN','dv_huy_phieu',false),
  -- Kho phu tung
  ('SALES','pt_danh_muc',false), ('MANAGER','pt_danh_muc',false), ('ADMIN','pt_danh_muc',true),  ('CEO','pt_danh_muc',true),  ('TECHNICIAN','pt_danh_muc',false),
  ('SALES','pt_nhap',false),     ('MANAGER','pt_nhap',true),      ('ADMIN','pt_nhap',true),      ('CEO','pt_nhap',true),      ('TECHNICIAN','pt_nhap',false),
  ('SALES','pt_xuat',true),      ('MANAGER','pt_xuat',true),      ('ADMIN','pt_xuat',true),      ('CEO','pt_xuat',true),      ('TECHNICIAN','pt_xuat',true),
  ('SALES','pt_kiem_ke',false),  ('MANAGER','pt_kiem_ke',true),   ('ADMIN','pt_kiem_ke',true),   ('CEO','pt_kiem_ke',true),   ('TECHNICIAN','pt_kiem_ke',false)
on conflict (role, perm) do nothing;

-- Vai tro TECHNICIAN cho cac quyen module cu: mac dinh tat het (chi xem tra cuu)
insert into public.role_perms (role, perm, allowed)
select 'TECHNICIAN', perm, false from (select distinct perm from public.role_perms where role = 'SALES') x
on conflict (role, perm) do nothing;

-- ===================== 6) CAI DAT =====================
insert into public.app_settings (key, value) values
  ('dv_han_muc_giam_cht', '100000'),
  ('dv_nhom_phu_tung', E'Pin & Ắc quy\nSăm lốp\nPhanh\nĐiện & Sạc\nNhựa & Dàn áo\nKhác')
on conflict (key) do nothing;

-- ===================== 7) STORAGE =====================
insert into storage.buckets (id, name, public) values ('dich-vu', 'dich-vu', true)
on conflict (id) do update set public = true;
drop policy if exists "upload_dich_vu" on storage.objects;
create policy "upload_dich_vu" on storage.objects for insert to authenticated with check (bucket_id = 'dich-vu');
drop policy if exists "read_dich_vu" on storage.objects;
create policy "read_dich_vu" on storage.objects for select to public using (bucket_id = 'dich-vu');
drop policy if exists "delete_dich_vu" on storage.objects;
create policy "delete_dich_vu" on storage.objects for delete to authenticated using (bucket_id = 'dich-vu');

-- ===================== 8) RLS =====================
-- DOC theo pham vi; MOI THAO TAC GHI qua ham security definer (033).
do $do$
declare t text;
begin
  foreach t in array array['dv_services','parts','parts_stock','part_units','pt_txns',
    'dv_tickets','dv_ticket_lines','dv_payments','dv_collectors','dv_eod','dv_audit_logs','doc_counters'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $do$;

-- Danh muc + ton: ai dang nhap cung doc duoc
drop policy if exists "read_dv_services" on public.dv_services;
create policy "read_dv_services" on public.dv_services for select to authenticated using (true);
drop policy if exists "read_parts" on public.parts;
create policy "read_parts" on public.parts for select to authenticated using (true);
drop policy if exists "read_parts_stock" on public.parts_stock;
create policy "read_parts_stock" on public.parts_stock for select to authenticated using (true);
drop policy if exists "read_part_units" on public.part_units;
create policy "read_part_units" on public.part_units for select to authenticated using (true);
drop policy if exists "read_pt_txns" on public.pt_txns;
create policy "read_pt_txns" on public.pt_txns for select to authenticated using (true);
drop policy if exists "read_dv_collectors" on public.dv_collectors;
create policy "read_dv_collectors" on public.dv_collectors for select to authenticated using (true);

-- Phieu DV: nhan vien thay phieu khu vuc minh (region null = toan he thong); ADMIN/CEO thay het
drop policy if exists "read_dv_tickets" on public.dv_tickets;
create policy "read_dv_tickets" on public.dv_tickets for select to authenticated using (
  public.my_role() in ('ADMIN','CEO')
  or public.my_region() is null
  or region = public.my_region()
);
drop policy if exists "read_dv_lines" on public.dv_ticket_lines;
create policy "read_dv_lines" on public.dv_ticket_lines for select to authenticated using (
  exists (select 1 from public.dv_tickets t where t.id = ticket_id
    and (public.my_role() in ('ADMIN','CEO') or public.my_region() is null or t.region = public.my_region()))
);
drop policy if exists "read_dv_payments" on public.dv_payments;
create policy "read_dv_payments" on public.dv_payments for select to authenticated using (
  exists (select 1 from public.dv_tickets t where t.id = ticket_id
    and (public.my_role() in ('ADMIN','CEO') or public.my_region() is null or t.region = public.my_region()))
);
drop policy if exists "read_dv_eod" on public.dv_eod;
create policy "read_dv_eod" on public.dv_eod for select to authenticated using (
  public.my_role() in ('ADMIN','CEO') or public.my_region() is null
  or exists (select 1 from public.locations l where l.code = location_code and l.region = public.my_region())
);
drop policy if exists "read_dv_audit" on public.dv_audit_logs;
create policy "read_dv_audit" on public.dv_audit_logs for select to authenticated
  using (public.my_role() in ('ADMIN','CEO'));

-- ===================== 9) SEED BANG GIA CONG MAU (sua trong Cai dat) =====================
insert into public.dv_services (code, name, group_name, price, note) values
  ('DVC-001', 'Kiểm tra tổng quát xe điện', 'Kiểm tra', 0, 'Miễn phí kiểm tra'),
  ('DVC-002', 'Vá săm / thay săm (chưa gồm săm)', 'Săm lốp', 30000, ''),
  ('DVC-003', 'Thay lốp (chưa gồm lốp)', 'Săm lốp', 50000, ''),
  ('DVC-004', 'Thay má phanh (chưa gồm má)', 'Phanh', 40000, ''),
  ('DVC-005', 'Bảo dưỡng định kỳ tiêu chuẩn', 'Bảo dưỡng', 120000, ''),
  ('DVC-006', 'Kiểm tra / cân chỉnh pin, sạc', 'Pin & Điện', 50000, ''),
  ('DVC-007', 'Thay ắc quy / pin (chưa gồm pin)', 'Pin & Điện', 80000, ''),
  ('DVC-008', 'Cứu hộ trong nội thị', 'Cứu hộ', 100000, 'Ngoài nội thị tính theo km')
on conflict (code) do nothing;

-- ============================================================
-- ROLLBACK (chi khi go bo hoan toan):
--   drop table if exists public.dv_audit_logs, public.dv_eod, public.dv_collectors,
--     public.dv_payments, public.dv_ticket_lines, public.dv_tickets, public.pt_txns,
--     public.part_units, public.parts_stock, public.parts, public.dv_services,
--     public.doc_counters cascade;
--   drop function if exists public.fn_next_code(text);
--   delete from public.role_perms where perm like 'dv_%' or perm like 'pt_%' or role = 'TECHNICIAN';
--   delete from public.app_settings where key in ('dv_han_muc_giam_cht','dv_nhom_phu_tung');
--   alter table public.profiles drop constraint profiles_role_check;
--   alter table public.profiles add constraint profiles_role_check
--     check (role in ('CEO','MANAGER','SALES','ADMIN'));
-- Khong dung vao bang kho xe / don ban — rollback khong anh huong module cu.
-- ============================================================
