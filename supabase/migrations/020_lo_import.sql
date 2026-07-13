-- ============================================================
-- Migration 020: LO IMPORT DANH SACH HANG (pool_batches)
-- - Moi lan import CSV = 1 lo: ma lo, ten file, ngay, nguoi
--   nhap, so xe. Admin import nhieu file; sales chon lo de loc.
-- Chay SAU 019, 1 lan duy nhat.
-- ============================================================

create table public.pool_batches (
  id bigserial primary key,
  code text unique not null,
  file_name text not null default '',
  row_count int not null default 0,
  imported_by uuid references public.profiles(id),
  imported_by_name text default '',
  created_at timestamptz not null default now()
);
alter table public.pool_batches enable row level security;
create policy "read_pool_batches" on public.pool_batches for select to authenticated using (true);

alter table public.frame_pool add column if not exists batch_id bigint references public.pool_batches(id);
create index if not exists frame_pool_batch_idx on public.frame_pool (batch_id);

-- Tao lo import moi (Admin/BGD)
create or replace function public.fn_tao_lo_import(p_file_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được import danh sách hãng'; end if;
  v_code := public.fn_gen_code('LOH');
  insert into public.pool_batches (code, file_name, imported_by, imported_by_name)
  values (v_code, coalesce(p_file_name,''), me.uid, me.name)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- Import (nang cap): gan dong vao lo + dem lai so xe cua lo
create or replace function public.fn_import_pool(p_rows jsonb, p_batch bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; r jsonb; v_ins int := 0; v_upd int := 0; v_skip jsonb := '[]'::jsonb;
        v_frame text; v_vid text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được import danh sách hãng'; end if;
  for r in select jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_frame := upper(trim(r->>'frame_number'));
    v_vid := trim(r->>'vehicle_id');
    if coalesce(v_frame,'') = '' or coalesce(v_vid,'') = '' then
      v_skip := v_skip || jsonb_build_object('frame', coalesce(v_frame,'(trống)'), 'ly_do', 'thiếu mã xe hoặc số khung');
    elsif not exists (select 1 from public.vehicles where id = v_vid) then
      v_skip := v_skip || jsonb_build_object('frame', v_frame, 'ly_do', 'mã xe '||v_vid||' không có trong Danh mục xe');
    elsif exists (select 1 from public.frame_pool where frame_number = v_frame) then
      update public.frame_pool set vehicle_id = v_vid, batch_id = coalesce(p_batch, batch_id) where frame_number = v_frame;
      v_upd := v_upd + 1;
    else
      insert into public.frame_pool (frame_number, vehicle_id, imported_by_name, batch_id) values (v_frame, v_vid, me.name, p_batch);
      v_ins := v_ins + 1;
    end if;
  end loop;
  if p_batch is not null then
    update public.pool_batches set row_count = (select count(*) from public.frame_pool where batch_id = p_batch) where id = p_batch;
  end if;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end $$;

-- Xoa 1 lo (Admin/BGD): xoa cac dong cho cua lo + xoa lo.
-- Khong anh huong xe da nhap vao kho (vehicle_units) hay phieu nhap.
create or replace function public.fn_xoa_lo(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  delete from public.frame_pool where batch_id = p_id;
  delete from public.pool_batches where id = p_id;
end $$;
