-- ============================================================
-- Migration 125: Bổ sung TUỔI TỒN (số ngày từ lúc nhập kho —
-- vehicle_units.imported_at, đã có sẵn từ đầu, chỉ chưa được API
-- trả về) vào 2 hàm AI tra cứu tồn xe.
--
--  A) fn_ai_ton_xe: thêm cột "tuoi_ton_binh_quan_ngay" (trung bình
--     tuổi tồn của cả nhóm) + "so_xe_ton_qua_30_ngay" (đếm nhanh) —
--     phù hợp câu hỏi tổng quan, không cần liệt kê từng xe.
--  B) fn_ai_ton_xe_chi_tiet: đổi mảng số khung đơn thuần thành mảng
--     OBJECT có kèm ngày nhập + số ngày tồn TỪNG XE — phù hợp câu hỏi
--     "xe nào cụ thể đang tồn quá lâu".
--  C) Thêm tham số "p_ton_qua_ngay" cho CẢ 2 hàm — lọc CHỈ xe tồn
--     trên N ngày (dùng cho việc rà tồn lâu/đề xuất khuyến mại).
--
-- Chạy 1 lần, độc lập.
-- ============================================================

-- ---------- A) fn_ai_ton_xe: them tuoi ton binh quan + dem xe qua 30 ngay ----------
drop function if exists public.fn_ai_ton_xe(text, text, text, text, text);
create or replace function public.fn_ai_ton_xe(
  p_location_code text default null,
  p_region text default null,
  p_vehicle_name text default null,
  p_color text default null,
  p_group_by text default 'location',
  p_ton_qua_ngay int default null      -- moi: chi lay xe da ton TREN N ngay
)
returns table (
  dia_diem text,
  khu_vuc text,
  model_xe text,
  mau text,
  ton_kha_dung int,
  ton_giu_cho int,
  tuoi_ton_binh_quan_ngay numeric,
  so_xe_ton_qua_30_ngay int,
  cap_nhat_luc timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if p_group_by not in ('location','vehicle','color') then
    raise exception 'THAM_SO_SAI: group_by chỉ nhận location/vehicle/color';
  end if;

  return query
  select
    case when p_group_by = 'location' then l.name else null end,
    case when p_group_by = 'location' then l.region else null end,
    case when p_group_by in ('vehicle','color') then (v.brand || ' ' || v.name) else null end,
    case when p_group_by = 'color' then v.color else null end,
    count(*) filter (where u.status in ('TON_KHO','DANG_CHUYEN'))::int,
    count(*) filter (where u.status = 'GIU_CHO')::int,
    round(avg(extract(day from now() - u.imported_at)) filter (where u.status in ('TON_KHO','DANG_CHUYEN')), 1),
    count(*) filter (where u.status in ('TON_KHO','DANG_CHUYEN') and now() - u.imported_at > interval '30 days')::int,
    now()
  from public.vehicle_units u
  join public.vehicles v on v.id = u.vehicle_id
  join public.locations l on l.code = u.location_code
  where u.status in ('TON_KHO','DANG_CHUYEN','GIU_CHO')
    and (p_location_code is null or l.code = p_location_code)
    and (p_region is null or l.region = p_region)
    and (p_vehicle_name is null or (v.brand || ' ' || v.name) ilike '%' || p_vehicle_name || '%')
    and (p_color is null or v.color ilike '%' || p_color || '%')
    and (p_ton_qua_ngay is null or now() - u.imported_at > (p_ton_qua_ngay || ' days')::interval)
  group by
    case when p_group_by = 'location' then l.name else null end,
    case when p_group_by = 'location' then l.region else null end,
    case when p_group_by in ('vehicle','color') then (v.brand || ' ' || v.name) else null end,
    case when p_group_by = 'color' then v.color else null end
  order by 5 desc
  limit 200;
end $$;

revoke all on function public.fn_ai_ton_xe(text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_xe(text, text, text, text, text, int) to service_role;

-- ---------- B) fn_ai_ton_xe_chi_tiet: tra ve tung xe kem ngay nhap + so ngay ton ----------
drop function if exists public.fn_ai_ton_xe_chi_tiet(text, text, text, text);
create or replace function public.fn_ai_ton_xe_chi_tiet(
  p_location_code text default null,
  p_region text default null,
  p_vehicle_name text default null,
  p_color text default null,
  p_ton_qua_ngay int default null      -- moi: chi lay xe da ton TREN N ngay
)
returns table (
  dia_diem text,
  khu_vuc text,
  chi_tiet jsonb
)
language sql security definer stable set search_path = public as $$
  with base as (
    select
      l.code as loc_code, l.name as dia_diem_n, l.region as khu_vuc_n,
      (v.brand || ' ' || v.name) as model_xe, v.color as mau,
      count(*) filter (where u.status in ('TON_KHO','DANG_CHUYEN')) as ton_kha_dung,
      count(*) filter (where u.status = 'GIU_CHO') as ton_giu_cho,
      -- SUA MOI: mang OBJECT (so_khung + ngay_nhap + so_ngay_ton), khong con la mang string don thuan
      coalesce(jsonb_agg(jsonb_build_object(
          'so_khung', u.frame_number,
          'ngay_nhap', u.imported_at::date,
          'so_ngay_ton', extract(day from now() - u.imported_at)::int
        ) order by u.imported_at)
        filter (where u.status in ('TON_KHO','DANG_CHUYEN')), '[]'::jsonb) as xe_kha_dung,
      coalesce(array_agg(u.frame_number order by u.frame_number)
        filter (where u.status = 'GIU_CHO'), '{}') as so_khung_giu_cho
    from public.vehicle_units u
    join public.vehicles v on v.id = u.vehicle_id
    join public.locations l on l.code = u.location_code
    where u.status in ('TON_KHO','DANG_CHUYEN','GIU_CHO')
      and (p_location_code is null or l.code = p_location_code)
      and (p_region is null or l.region = p_region)
      and (p_vehicle_name is null or (v.brand || ' ' || v.name) ilike '%' || p_vehicle_name || '%')
      and (p_color is null or v.color ilike '%' || p_color || '%')
      and (p_ton_qua_ngay is null or now() - u.imported_at > (p_ton_qua_ngay || ' days')::interval)
    group by l.code, l.name, l.region, v.id, v.brand, v.name, v.color
  )
  select dia_diem_n, khu_vuc_n,
    jsonb_agg(jsonb_build_object(
      'model_xe', model_xe,
      'mau', mau,
      'ton_kha_dung', ton_kha_dung,
      'ton_giu_cho', ton_giu_cho,
      'xe_kha_dung', xe_kha_dung,        -- moi: [{so_khung, ngay_nhap, so_ngay_ton}, ...]
      'so_khung_giu_cho', to_jsonb(so_khung_giu_cho)
    ) order by mau)
  from base
  group by loc_code, dia_diem_n, khu_vuc_n
  order by dia_diem_n
  limit 100;
$$;

revoke all on function public.fn_ai_ton_xe_chi_tiet(text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_xe_chi_tiet(text, text, text, text, int) to service_role;
