-- ============================================================
-- Migration 086: Bổ sung fn_ai_ton_xe_chi_tiet — trả chi tiết
-- SỐ KHUNG và MÀU tách theo TỪNG ĐỊA ĐIỂM (yêu cầu bổ sung của anh Kỳ).
--
-- ⚠️ THAY ĐỔI CHÍNH SÁCH BẢO MẬT so với fn_ai_ton_xe (migration 084):
-- hàm này TRẢ SỐ KHUNG (frame_number) — dữ liệu định danh từng xe.
-- Ban đầu thiết kế cố tình ẩn số khung khỏi Bot AI; đây là ngoại lệ
-- được CEO yêu cầu trực tiếp cho mục đích quản trị nội bộ. Nếu kênh
-- Discord/Companion có người khác ngoài CEO, số khung sẽ lộ ra cho họ.
--
-- Giữ nguyên fn_ai_ton_xe (tổng nhanh, không lộ số khung) cho các nhu
-- cầu chỉ cần con số — không phá công cụ đang chạy.
-- Chạy sau 085. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ai_ton_xe_chi_tiet(
  p_location_code text default null,
  p_region text default null,
  p_vehicle_name text default null,
  p_color text default null
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
      coalesce(array_agg(u.frame_number order by u.frame_number)
        filter (where u.status in ('TON_KHO','DANG_CHUYEN')), '{}') as so_khung_kha_dung,
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
    group by l.code, l.name, l.region, v.id, v.brand, v.name, v.color
  )
  select dia_diem_n, khu_vuc_n,
    jsonb_agg(jsonb_build_object(
      'model_xe', model_xe,
      'mau', mau,
      'ton_kha_dung', ton_kha_dung,
      'ton_giu_cho', ton_giu_cho,
      'so_khung_kha_dung', to_jsonb(so_khung_kha_dung),
      'so_khung_giu_cho', to_jsonb(so_khung_giu_cho)
    ) order by mau)
  from base
  group by loc_code, dia_diem_n, khu_vuc_n
  order by dia_diem_n
  limit 100;
$$;

revoke all on function public.fn_ai_ton_xe_chi_tiet(text, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_xe_chi_tiet(text, text, text, text) to service_role;
