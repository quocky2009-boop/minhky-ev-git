-- ============================================================
-- Migration 026:
-- A) XAC NHAN XUAT HOA DON cho don ban (Cho xuat HD -> Da xuat HD)
--    Sales/CHT/Admin/CEO deu xac nhan duoc; bat buoc so hoa don.
-- B) PHAN QUYEN DONG theo vai tro (bang role_perms) — CEO chinh
--    trong Cai dat; DB doc bang nay de chan that su, khong chi an nut.
-- Chay SAU 025, 1 lan duy nhat.
-- ============================================================

-- ---------- A) HOA DON ----------
alter table public.sales_orders add column if not exists invoice_status text not null default 'Chờ xuất HĐ';
alter table public.sales_orders add column if not exists invoice_no text default '';
alter table public.sales_orders add column if not exists invoice_date date;
alter table public.sales_orders add column if not exists invoice_by uuid references public.profiles(id);
alter table public.sales_orders add column if not exists invoice_by_name text default '';
alter table public.sales_orders add column if not exists invoice_at timestamptz;
create index if not exists sales_orders_invoice_idx on public.sales_orders (invoice_status);

create or replace function public.fn_xac_nhan_hoa_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if me.role not in ('SALES','MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if coalesce(trim(p->>'invoice_no'),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập số hóa đơn khi xác nhận';
  end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn này đã xác nhận xuất hóa đơn rồi'; end if;
  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now()
  where id = o.id;
end $$;

-- Huy xac nhan (ghi nham so HD) — chi ADMIN/CEO, luu vet vao ghi chu
create or replace function public.fn_huy_xac_nhan_hoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được hủy xác nhận hóa đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.invoice_status <> 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn chưa xác nhận HĐ'; end if;
  update public.sales_orders set
    invoice_status = 'Chờ xuất HĐ', invoice_no = '', invoice_date = null,
    invoice_by = null, invoice_by_name = '', invoice_at = null,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Hủy xác nhận HĐ '||coalesce(nullif(o.invoice_no,''),'(trống)')||' bởi '||me.name||
      coalesce(nullif(' — lý do: '||p_ly_do,' — lý do: '),''))
  where id = p_id;
end $$;

-- ---------- B) PHAN QUYEN DONG ----------
create table if not exists public.role_perms (
  role text not null check (role in ('SALES','MANAGER','ADMIN','CEO')),
  perm text not null,
  allowed boolean not null default false,
  primary key (role, perm)
);
alter table public.role_perms enable row level security;
create policy "read_role_perms" on public.role_perms for select to authenticated using (true);

-- Mac dinh (khop dung hanh vi hien tai cua he thong)
insert into public.role_perms (role, perm, allowed) values
  -- Kho
  ('SALES','nhap_hang',false),   ('MANAGER','nhap_hang',false), ('ADMIN','nhap_hang',true),  ('CEO','nhap_hang',true),
  ('SALES','xuat_ban',true),     ('MANAGER','xuat_ban',true),   ('ADMIN','xuat_ban',true),   ('CEO','xuat_ban',true),
  ('SALES','dieu_chuyen',true),  ('MANAGER','dieu_chuyen',true),('ADMIN','dieu_chuyen',true),('CEO','dieu_chuyen',true),
  ('SALES','dieu_chinh',false),  ('MANAGER','dieu_chinh',true), ('ADMIN','dieu_chinh',true), ('CEO','dieu_chinh',true),
  ('SALES','duyet_dieu_chinh',false),('MANAGER','duyet_dieu_chinh',false),('ADMIN','duyet_dieu_chinh',true),('CEO','duyet_dieu_chinh',true),
  ('SALES','kiem_ke',false),     ('MANAGER','kiem_ke',true),    ('ADMIN','kiem_ke',true),    ('CEO','kiem_ke',true),
  ('SALES','nhap_tu_phieu',false),('MANAGER','nhap_tu_phieu',false),('ADMIN','nhap_tu_phieu',true),('CEO','nhap_tu_phieu',true),
  -- Don ban
  ('SALES','xac_nhan_hd',true),  ('MANAGER','xac_nhan_hd',true),('ADMIN','xac_nhan_hd',true),('CEO','xac_nhan_hd',true),
  ('SALES','sua_thanh_toan',false),('MANAGER','sua_thanh_toan',true),('ADMIN','sua_thanh_toan',true),('CEO','sua_thanh_toan',true),
  ('SALES','duyet_sua_don',false),('MANAGER','duyet_sua_don',false),('ADMIN','duyet_sua_don',true),('CEO','duyet_sua_don',true),
  -- Du lieu
  ('SALES','sua_danh_muc',false),('MANAGER','sua_danh_muc',false),('ADMIN','sua_danh_muc',true),('CEO','sua_danh_muc',true),
  ('SALES','sua_unit',false),    ('MANAGER','sua_unit',true),   ('ADMIN','sua_unit',true),   ('CEO','sua_unit',true),
  ('SALES','sua_khach',true),    ('MANAGER','sua_khach',true),  ('ADMIN','sua_khach',true),  ('CEO','sua_khach',true),
  -- Quan tri
  ('SALES','xem_bao_cao',false), ('MANAGER','xem_bao_cao',true),('ADMIN','xem_bao_cao',true),('CEO','xem_bao_cao',true),
  ('SALES','cai_dat',false),     ('MANAGER','cai_dat',false),   ('ADMIN','cai_dat',true),    ('CEO','cai_dat',true)
on conflict (role, perm) do nothing;

-- Ham kiem tra quyen (CEO luon full de tranh tu khoa minh ra ngoai)
create or replace function public.fn_co_quyen(p_perm text)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare me record; v boolean;
begin
  select * into me from public.fn_me();
  if me.uid is null then return false; end if;
  if me.role = 'CEO' then return true; end if;
  select allowed into v from public.role_perms where role = me.role and perm = p_perm;
  return coalesce(v, false);
end $$;

-- CEO chinh quyen
create or replace function public.fn_set_quyen(p_role text, p_perm text, p_allowed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ BGĐ được chỉnh phân quyền'; end if;
  if p_role = 'CEO' then raise exception 'KHONG_DOI_DUOC: vai trò BGĐ luôn có toàn quyền'; end if;
  insert into public.role_perms (role, perm, allowed) values (p_role, p_perm, p_allowed)
  on conflict (role, perm) do update set allowed = excluded.allowed;
end $$;
