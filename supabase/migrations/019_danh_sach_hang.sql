-- ============================================================
-- Migration 019: DANH SACH SO KHUNG TU HANG (frame_pool)
-- - Admin/BGD import CSV cua hang (ma xe noi bo + so khung)
-- - Sales go duoi so khung -> chon -> vao phieu nhap nhap,
--   mau xe lay tu file hang nen khong chon nham model
-- - Chong trung toan chuoi + doi chieu xe "tren giay co,
--   thuc te chua thay"
-- Chay SAU 018, 1 lan duy nhat.
-- ============================================================

create table public.frame_pool (
  frame_number text primary key,
  vehicle_id text not null references public.vehicles(id),
  imported_at timestamptz not null default now(),
  imported_by_name text default ''
);
alter table public.frame_pool enable row level security;
create policy "read_frame_pool" on public.frame_pool for select to authenticated using (true);

-- Import danh sach tu file hang (Admin/BGD). Trung so khung -> cap nhat ma xe.
create or replace function public.fn_import_pool(p_rows jsonb)
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
      update public.frame_pool set vehicle_id = v_vid where frame_number = v_frame;
      v_upd := v_upd + 1;
    else
      insert into public.frame_pool (frame_number, vehicle_id, imported_by_name) values (v_frame, v_vid, me.name);
      v_ins := v_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end $$;

-- Tim so khung trong danh sach cho (go >= 3 ky tu, thuong la duoi so khung)
create or replace function public.fn_tim_pool(p_q text)
returns table (frame_number text, vehicle_id text, state text, ref text)
language sql security definer set search_path = public stable as $$
  select f.frame_number, f.vehicle_id,
    case
      when u.frame_number is not null and u.status = 'DA_BAN' then 'Đã bán'
      when u.frame_number is not null then 'Đã trong kho'
      when d.code is not null then 'Đang ở phiếu'
      else 'Chờ gán'
    end as state,
    coalesce(u.location_code, d.code, '') as ref
  from public.frame_pool f
  left join public.vehicle_units u on u.frame_number = f.frame_number
  left join lateral (
    select code from public.import_drafts d
    where d.status = 'Nháp'
      and d.rows @> jsonb_build_array(jsonb_build_object('frame_number', f.frame_number))
    limit 1
  ) d on true
  where length(trim(p_q)) >= 3 and f.frame_number ilike '%' || upper(trim(p_q)) || '%'
  order by f.frame_number
  limit 20;
$$;

-- Danh sach doi chieu: so khung hang co nhung CHUA vao kho / chua o phieu nao
create or replace function public.fn_pool_con_lai()
returns table (frame_number text, vehicle_id text)
language sql security definer set search_path = public stable as $$
  select f.frame_number, f.vehicle_id
  from public.frame_pool f
  where not exists (select 1 from public.vehicle_units u where u.frame_number = f.frame_number)
    and not exists (
      select 1 from public.import_drafts d
      where d.status = 'Nháp'
        and d.rows @> jsonb_build_array(jsonb_build_object('frame_number', f.frame_number))
    )
  order by f.vehicle_id, f.frame_number
  limit 10000;
$$;

-- Xoa toan bo danh sach cho (khi muon import lai file moi sach se)
create or replace function public.fn_xoa_pool()
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  delete from public.frame_pool;
end $$;
