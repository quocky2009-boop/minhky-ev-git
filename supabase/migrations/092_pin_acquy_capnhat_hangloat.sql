-- ============================================================
-- Migration 092: Bổ sung 2 trường thông số (Số lượng pin/AQ,
-- Model pin) + hàm CẬP NHẬT THÔNG SỐ KỸ THUẬT HÀNG LOẠT theo đúng
-- Tên xe (EXACT MATCH — không mở rộng, VD "Flazz" không áp dụng
-- nhầm cho "Flazz Max", giống fn_cap_nhat_gia_hang_loat 064).
-- Chạy sau 091. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.vehicles
  add column if not exists so_luong_pin_ac_quy int,
  add column if not exists model_pin text check (model_pin in ('Xe kèm pin','Xe đổi pin','Xe kèm AQ'));

-- ---------- Patch fn_them_xe: nhận thêm 2 trường mới ----------
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
    cong_suat_dong_co_w, dung_luong_pin, tam_hoat_dong_km, toc_do_toi_da_kmh, thong_so_khac,
    so_luong_pin_ac_quy, model_pin)
  values (v_id, coalesce(v_mfr,''), trim(p->>'brand'), trim(p->>'name'), trim(p->>'color'),
          coalesce((p->>'list_price')::bigint,0), coalesce((p->>'min_stock')::int,2),
          nullif(p->>'cong_suat_dong_co_w','')::int, coalesce(p->>'dung_luong_pin',''),
          nullif(p->>'tam_hoat_dong_km','')::int, nullif(p->>'toc_do_toi_da_kmh','')::int,
          coalesce(p->'thong_so_khac', '{}'::jsonb),
          nullif(p->>'so_luong_pin_ac_quy','')::int, nullif(p->>'model_pin',''))
  on conflict (id) do update set mfr_code = excluded.mfr_code, list_price = excluded.list_price,
          min_stock = excluded.min_stock,
          cong_suat_dong_co_w = excluded.cong_suat_dong_co_w,
          dung_luong_pin = excluded.dung_luong_pin,
          tam_hoat_dong_km = excluded.tam_hoat_dong_km,
          toc_do_toi_da_kmh = excluded.toc_do_toi_da_kmh,
          thong_so_khac = excluded.thong_so_khac,
          so_luong_pin_ac_quy = excluded.so_luong_pin_ac_quy,
          model_pin = excluded.model_pin,
          updated_at = now();
  return v_id;
end $$;

-- ---------- Patch fn_sua_xe: nhận thêm 2 trường mới ----------
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
    so_luong_pin_ac_quy = coalesce(nullif(p->>'so_luong_pin_ac_quy','')::int, so_luong_pin_ac_quy),
    model_pin = coalesce(nullif(p->>'model_pin',''), model_pin),
    updated_at = now()
  where id = p->>'id';
  if not found then raise exception 'KHONG_TIM_THAY: mã xe không tồn tại'; end if;
end $$;

-- ---------- MỚI: fn_cap_nhat_thong_so_hang_loat ----------
-- Cập nhật thông số kỹ thuật cho TẤT CẢ biến thể màu của 1 Tên xe,
-- theo EXACT MATCH brand + name (không dùng ILIKE, tránh khớp nhầm
-- "Flazz" vào "Flazz Max"). Chỉ cập nhật các trường được truyền vào
-- (bỏ trống = giữ nguyên giá trị cũ của từng xe).
create or replace function public.fn_cap_nhat_thong_so_hang_loat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_brand text; v_name text; v_n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được cập nhật thông số hàng loạt'; end if;

  v_brand := nullif(trim(coalesce(p->>'brand','')), '');
  v_name  := nullif(trim(coalesce(p->>'name','')), '');
  if v_brand is null or v_name is null then
    raise exception 'THIEU_DIEU_KIEN: phải chọn cả Hãng và Tên xe (Model) để tránh cập nhật nhầm toàn bộ danh mục';
  end if;

  -- EXACT match: brand = v_brand AND name = v_name (khong dung ILIKE)
  update public.vehicles set
    cong_suat_dong_co_w = coalesce(nullif(p->>'cong_suat_dong_co_w','')::int, cong_suat_dong_co_w),
    dung_luong_pin = coalesce(nullif(p->>'dung_luong_pin',''), dung_luong_pin),
    tam_hoat_dong_km = coalesce(nullif(p->>'tam_hoat_dong_km','')::int, tam_hoat_dong_km),
    toc_do_toi_da_kmh = coalesce(nullif(p->>'toc_do_toi_da_kmh','')::int, toc_do_toi_da_kmh),
    so_luong_pin_ac_quy = coalesce(nullif(p->>'so_luong_pin_ac_quy','')::int, so_luong_pin_ac_quy),
    model_pin = coalesce(nullif(p->>'model_pin',''), model_pin),
    updated_at = now()
  where brand = v_brand and name = v_name;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'KHONG_KHOP: không có mã xe nào khớp đúng Hãng "%" + Tên xe "%"', v_brand, v_name; end if;
  return jsonb_build_object('so_ma_cap_nhat', v_n);
end $$;

-- ---------- Cập nhật tool AI get_vehicle_price_specs: thêm 2 trường mới ----------
drop function if exists public.fn_ai_gia_thong_so_xe(text, text);

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
  so_luong_pin_ac_quy int,
  model_pin text,
  tam_hoat_dong_km int,
  toc_do_toi_da_kmh int,
  thong_so_khac jsonb
)
language sql security definer stable set search_path = public as $$
  select (v.brand || ' ' || v.name), v.color, v.list_price, v.suggested_price,
    v.cong_suat_dong_co_w, v.dung_luong_pin, v.so_luong_pin_ac_quy, v.model_pin,
    v.tam_hoat_dong_km, v.toc_do_toi_da_kmh, v.thong_so_khac
  from public.vehicles v
  where v.status <> 'Ngừng bán'
    and (p_vehicle_name is null or (v.brand || ' ' || v.name) ilike '%' || p_vehicle_name || '%')
    and (p_color is null or v.color ilike '%' || p_color || '%')
  order by v.brand, v.name, v.color
  limit 100;
$$;

revoke all on function public.fn_ai_gia_thong_so_xe(text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_gia_thong_so_xe(text, text) to service_role;
