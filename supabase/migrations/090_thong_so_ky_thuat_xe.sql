-- ============================================================
-- Migration 090: Thêm THÔNG SỐ KỸ THUẬT cho vehicles + tool AI mới
-- get_vehicle_price_specs (tra cứu giá + thông số kỹ thuật).
--
-- Thêm 4 cột cố định (theo anh Kỳ chọn) + 1 cột JSONB linh hoạt để
-- thêm thông số mới sau này KHÔNG cần sửa migration:
--   cong_suat_dong_co_w  int    — công suất động cơ (W)
--   dung_luong_pin       text   — dung lượng pin (VD: "60V-20Ah", "1.5kWh") — để text vì đơn vị hay viết khác nhau
--   tam_hoat_dong_km     int    — tầm hoạt động (km)
--   toc_do_toi_da_kmh    int    — tốc độ tối đa (km/h)
--   thong_so_khac        jsonb  — thông số tùy ý khác (VD: {"thoi_gian_sac": "6 giờ", "trong_luong_kg": 95})
--
-- Dùng ALTER TABLE (không phải CREATE TABLE IF NOT EXISTS) vì vehicles
-- đã có sẵn dữ liệu — đúng theo kinh nghiệm dự án đã ghi nhận.
-- Chạy sau 089. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.vehicles
  add column if not exists cong_suat_dong_co_w int,
  add column if not exists dung_luong_pin text default '',
  add column if not exists tam_hoat_dong_km int,
  add column if not exists toc_do_toi_da_kmh int,
  add column if not exists thong_so_khac jsonb not null default '{}'::jsonb;

-- ---------- Patch fn_them_xe: nhận thêm thông số kỹ thuật ----------
create or replace function public.fn_them_xe(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id text; v_mfr text; v_capnhat boolean;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;

  v_capnhat := coalesce((p->>'_cap_nhat')::boolean, false);
  v_mfr := nullif(trim(coalesce(p->>'mfr_code','')), '');

  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;

  v_id := upper(replace(trim(p->>'brand')||'_'||trim(p->>'name')||'_'||trim(p->>'color'), ' ', '_'));

  if not v_capnhat then
    if exists (select 1 from public.vehicles where id = v_id) then
      raise exception 'TRUNG_MA_XE: đã có xe % (% % %) trong danh mục',
        v_id, trim(p->>'brand'), trim(p->>'name'), trim(p->>'color');
    end if;
    if v_mfr is not null and exists (select 1 from public.vehicles where nullif(trim(mfr_code),'') = v_mfr) then
      raise exception 'TRUNG_MA_HANG: Mã hãng "%" đã được dùng cho mã xe %',
        v_mfr, (select id from public.vehicles where nullif(trim(mfr_code),'') = v_mfr limit 1);
    end if;
  end if;

  insert into public.vehicles (id, mfr_code, brand, name, color, list_price, min_stock,
    cong_suat_dong_co_w, dung_luong_pin, tam_hoat_dong_km, toc_do_toi_da_kmh, thong_so_khac)
  values (v_id, coalesce(v_mfr,''), trim(p->>'brand'), trim(p->>'name'), trim(p->>'color'),
          coalesce((p->>'list_price')::bigint,0), coalesce((p->>'min_stock')::int,2),
          nullif(p->>'cong_suat_dong_co_w','')::int, coalesce(p->>'dung_luong_pin',''),
          nullif(p->>'tam_hoat_dong_km','')::int, nullif(p->>'toc_do_toi_da_kmh','')::int,
          coalesce(p->'thong_so_khac', '{}'::jsonb))
  on conflict (id) do update set mfr_code = excluded.mfr_code, list_price = excluded.list_price,
          min_stock = excluded.min_stock,
          cong_suat_dong_co_w = excluded.cong_suat_dong_co_w,
          dung_luong_pin = excluded.dung_luong_pin,
          tam_hoat_dong_km = excluded.tam_hoat_dong_km,
          toc_do_toi_da_kmh = excluded.toc_do_toi_da_kmh,
          thong_so_khac = excluded.thong_so_khac,
          updated_at = now();
  return v_id;
end $$;

-- ---------- Patch fn_sua_xe: nhận thêm thông số kỹ thuật ----------
create or replace function public.fn_sua_xe(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_mfr text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;

  v_mfr := nullif(trim(coalesce(p->>'mfr_code','')), '');
  if v_mfr is not null and exists (
    select 1 from public.vehicles where nullif(trim(mfr_code),'') = v_mfr and id <> p->>'id'
  ) then
    raise exception 'TRUNG_MA_HANG: Mã hãng "%" đã được dùng cho mã xe %',
      v_mfr, (select id from public.vehicles where nullif(trim(mfr_code),'') = v_mfr and id <> p->>'id' limit 1);
  end if;

  update public.vehicles set
    brand = coalesce(nullif(trim(p->>'brand'),''), brand),
    name = coalesce(nullif(trim(p->>'name'),''), name),
    color = coalesce(nullif(trim(p->>'color'),''), color),
    mfr_code = coalesce(p->>'mfr_code', mfr_code),
    list_price = coalesce((p->>'list_price')::bigint, list_price),
    min_stock = coalesce((p->>'min_stock')::int, min_stock),
    status = coalesce(nullif(p->>'status',''), status),
    cong_suat_dong_co_w = coalesce(nullif(p->>'cong_suat_dong_co_w','')::int, cong_suat_dong_co_w),
    dung_luong_pin = coalesce(p->>'dung_luong_pin', dung_luong_pin),
    tam_hoat_dong_km = coalesce(nullif(p->>'tam_hoat_dong_km','')::int, tam_hoat_dong_km),
    toc_do_toi_da_kmh = coalesce(nullif(p->>'toc_do_toi_da_kmh','')::int, toc_do_toi_da_kmh),
    thong_so_khac = coalesce(p->'thong_so_khac', thong_so_khac),
    updated_at = now()
  where id = p->>'id';
  if not found then raise exception 'KHONG_TIM_THAY: mã xe không tồn tại'; end if;
end $$;

-- ============================================================
-- TOOL AI MỚI: get_vehicle_price_specs — tra cứu giá + thông số kỹ thuật
-- Đây là dữ liệu công khai/nội bộ ít nhạy cảm hơn (không phải công nợ/
-- lương), phù hợp cho MỌI nhân viên tra cứu, không chỉ CEO.
-- ============================================================
create or replace function public.fn_ai_gia_thong_so_xe(
  p_vehicle_name text default null,
  p_color text default null
)
returns table (
  model_xe text,
  mau text,
  gia_niem_yet bigint,
  gia_de_xuat bigint,
  cong_suat_dong_co_w int,
  dung_luong_pin text,
  tam_hoat_dong_km int,
  toc_do_toi_da_kmh int,
  thong_so_khac jsonb
)
language sql security definer stable set search_path = public as $$
  select (v.brand || ' ' || v.name), v.color, v.list_price, v.suggested_price,
    v.cong_suat_dong_co_w, v.dung_luong_pin, v.tam_hoat_dong_km, v.toc_do_toi_da_kmh, v.thong_so_khac
  from public.vehicles v
  where v.status <> 'Ngừng bán'
    and (p_vehicle_name is null or (v.brand || ' ' || v.name) ilike '%' || p_vehicle_name || '%')
    and (p_color is null or v.color ilike '%' || p_color || '%')
  order by v.brand, v.name, v.color
  limit 100;
$$;

revoke all on function public.fn_ai_gia_thong_so_xe(text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_gia_thong_so_xe(text, text) to service_role;
