-- ============================================================
-- Migration 018: PHIEU NHAP NHAP (tu trang Quet gom so khung)
-- - Quet xong luu thanh phieu nhap, sua duoc, roi moi day vao kho
-- - Sales tao/sua phieu cua minh; Quan ly/Admin/BGD sua duoc het
-- - Chi Admin/BGD duoc "Nhap vao kho" (goi fn_import_units co san)
-- Chay SAU 017 (chay sau 015 neu 016/017 chua co cung khong sao).
-- ============================================================

create table public.import_drafts (
  id bigserial primary key,
  code text unique not null,
  location_code text not null references public.locations(code),
  status text not null default 'Nháp' check (status in ('Nháp','Đã nhập')),
  rows jsonb not null default '[]'::jsonb,   -- [{frame_number, vehicle_id}]
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  imported_doc text default '',
  imported_at timestamptz,
  imported_by_name text default ''
);
create index on public.import_drafts (status, updated_at desc);

alter table public.import_drafts enable row level security;
create policy "read_import_drafts" on public.import_drafts for select to authenticated using (true);

-- Tao / cap nhat phieu nhap (chi khi con Nhap)
create or replace function public.fn_luu_phieu_nhap(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; d record; v_code text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not exists (select 1 from public.locations where code = p->>'location_code') then
    raise exception 'KHONG_TIM_THAY: mã kho không tồn tại';
  end if;
  if jsonb_array_length(coalesce(p->'rows','[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: phiếu chưa có số khung nào';
  end if;

  if coalesce(p->>'id','') <> '' then
    select * into d from public.import_drafts where id = (p->>'id')::bigint for update;
    if d is null then raise exception 'KHONG_TIM_THAY: phiếu không tồn tại'; end if;
    if d.status <> 'Nháp' then raise exception 'TRANG_THAI_SAI: phiếu đã nhập vào kho, không sửa được'; end if;
    if me.role not in ('MANAGER','ADMIN','CEO') and d.created_by <> me.uid then
      raise exception 'KHONG_CO_QUYEN: bạn chỉ được sửa phiếu do mình tạo';
    end if;
    update public.import_drafts set
      location_code = p->>'location_code', rows = p->'rows',
      note = coalesce(p->>'note',''), updated_at = now()
    where id = d.id returning code into v_code;
    return v_code;
  end if;

  v_code := public.fn_gen_code('PNH');
  insert into public.import_drafts (code, location_code, rows, note, created_by, created_by_name)
  values (v_code, p->>'location_code', p->'rows', coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- Xoa phieu nhap (chi Nhap; nguoi tao hoac Admin/BGD)
create or replace function public.fn_xoa_phieu_nhap(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.fn_me();
  select * into d from public.import_drafts where id = p_id;
  if d is null then raise exception 'KHONG_TIM_THAY'; end if;
  if d.status <> 'Nháp' then raise exception 'TRANG_THAI_SAI: phiếu đã nhập, không xóa được'; end if;
  if me.role not in ('ADMIN','CEO') and d.created_by <> me.uid then raise exception 'KHONG_CO_QUYEN'; end if;
  delete from public.import_drafts where id = p_id;
end $$;

-- Day phieu nhap vao kho (Admin/BGD) - dung lai fn_import_units, atomic
create or replace function public.fn_nhap_tu_phieu(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; d record; res jsonb;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được nhập vào kho'; end if;
  select * into d from public.import_drafts where id = p_id for update;
  if d is null then raise exception 'KHONG_TIM_THAY: phiếu không tồn tại'; end if;
  if d.status <> 'Nháp' then raise exception 'TRANG_THAI_SAI: phiếu này đã được nhập trước đó'; end if;
  res := public.fn_import_units(d.location_code, d.rows);
  update public.import_drafts set
    status = 'Đã nhập', imported_doc = coalesce(res->>'doc',''),
    imported_at = now(), imported_by_name = me.name, updated_at = now()
  where id = p_id;
  return res;
end $$;
