-- ============================================================
-- Migration 084: RPC CHỈ ĐỌC cho Bot AI "Minh Trí" — get_vehicle_stock
--
-- Mục đích: cung cấp 1 hàm SQL cố định, tham số whitelist, KHÔNG nhận
-- SQL tự do, để Edge Function gọi thay AI trả lời câu hỏi tồn xe.
--
-- Công thức đã đối chiếu với app ở Giai đoạn 1:
--   ton_kha_dung = count(status in ('TON_KHO','DANG_CHUYEN'))
--     (đúng công thức _count_at() — migration 004_units_v2.sql dòng 117-120,
--      dùng để check tồn trước khi bán và để sync bảng inventory)
--   ton_giu_cho  = count(status = 'GIU_CHO')
--     (đúng số hiển thị thêm ở trang /ton-tong-hop — app/(app)/ton-tong-hop/page.js dòng 23-24)
--
-- Bảo mật:
--   - Hàm SECURITY DEFINER, STABLE (chỉ SELECT, không ghi).
--   - LIMIT cứng 200 dòng / lần gọi — không cho kéo toàn bộ dữ liệu.
--   - REVOKE EXECUTE khỏi PUBLIC/anon/authenticated — CHỈ service_role
--     (dùng riêng trong Edge Function, không lộ ra Discord/OpenClaw/frontend)
--     mới gọi được. Người dùng app bình thường (kể cả CEO đăng nhập trên
--     web) KHÔNG gọi trực tiếp hàm này qua PostgREST.
--   - Không trả frame_number, cost_price (dữ liệu nhạy cảm/định danh).
-- Chạy sau 083. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ai_ton_xe(
  p_location_code text default null,   -- ma dia diem cu the, VD: 'HN01'
  p_region text default null,          -- khu vuc: 'Thành phố' / 'Hàm Yên' (theo locations.region)
  p_vehicle_name text default null,    -- ten dong xe, tim gan dung (ILIKE)
  p_color text default null,           -- mau xe, tim gan dung (ILIKE)
  p_group_by text default 'location'   -- 'location' | 'vehicle' | 'color' (whitelist, khong nhan gia tri khac)
)
returns table (
  dia_diem text,
  khu_vuc text,
  model_xe text,
  mau text,
  ton_kha_dung int,
  ton_giu_cho int,
  cap_nhat_luc timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
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
    now()
  from public.vehicle_units u
  join public.vehicles v on v.id = u.vehicle_id
  join public.locations l on l.code = u.location_code
  where u.status in ('TON_KHO','DANG_CHUYEN','GIU_CHO')
    and (p_location_code is null or l.code = p_location_code)
    and (p_region is null or l.region = p_region)
    and (p_vehicle_name is null or (v.brand || ' ' || v.name) ilike '%' || p_vehicle_name || '%')
    and (p_color is null or v.color ilike '%' || p_color || '%')
  group by
    case when p_group_by = 'location' then l.name else null end,
    case when p_group_by = 'location' then l.region else null end,
    case when p_group_by in ('vehicle','color') then (v.brand || ' ' || v.name) else null end,
    case when p_group_by = 'color' then v.color else null end
  order by 5 desc
  limit 200;
end $$;

-- ---------- CẤU HÌNH QUYỀN TỐI THIỂU ----------
revoke all on function public.fn_ai_ton_xe(text, text, text, text, text) from public;
revoke all on function public.fn_ai_ton_xe(text, text, text, text, text) from anon;
revoke all on function public.fn_ai_ton_xe(text, text, text, text, text) from authenticated;
grant execute on function public.fn_ai_ton_xe(text, text, text, text, text) to service_role;
