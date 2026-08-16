-- ============================================================
-- Migration 106: Cập nhật fn_ai_ton_hang_hoa (tool AI get_product_stock)
-- để trả tồn THEO TỪNG KHO — trước đây (migration 085) ghi chú rõ
-- "products KHÔNG tách tồn theo kho thật" nên không nhận tham số
-- location_code. Từ migration 104, products_stock đã tách đúng theo
-- kho, nên bổ sung lại khả năng lọc/tách theo kho cho tool AI.
-- Chạy sau 105. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

drop function if exists public.fn_ai_ton_hang_hoa(text, boolean);

create or replace function public.fn_ai_ton_hang_hoa(
  p_name text default null,
  p_location_code text default null,
  p_duoi_dinh_muc boolean default false
)
returns table (
  ten text,
  dia_diem text,
  don_vi text,
  ton int,
  muc_toi_thieu int,
  canh_bao boolean
)
language sql security definer stable set search_path = public as $$
  select p.name,
    case when p_location_code is not null then l.name else 'Tổng mọi kho' end,
    p.unit,
    case when p_location_code is not null then coalesce(ps.qty, 0)
         else coalesce((select sum(qty) from public.products_stock where product_id = p.id), 0) end,
    p.min_qty,
    (case when p_location_code is not null then coalesce(ps.qty, 0)
          else coalesce((select sum(qty) from public.products_stock where product_id = p.id), 0)
     end < p.min_qty)
  from public.products p
  left join public.products_stock ps on ps.product_id = p.id and ps.location_code = p_location_code
  left join public.locations l on l.code = p_location_code
  where p.status = 'Hoạt động'
    and (p_name is null or p.name ilike '%' || p_name || '%')
    and (not p_duoi_dinh_muc or
      (case when p_location_code is not null then coalesce(ps.qty, 0)
            else coalesce((select sum(qty) from public.products_stock where product_id = p.id), 0)
       end < p.min_qty))
  order by ton asc
  limit 200;
$$;

revoke all on function public.fn_ai_ton_hang_hoa(text, text, boolean) from public, anon, authenticated;
grant execute on function public.fn_ai_ton_hang_hoa(text, text, boolean) to service_role;
