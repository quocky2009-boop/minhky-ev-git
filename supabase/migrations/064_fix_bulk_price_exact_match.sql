-- ============================================================
-- Migration 064 — FIX fn_cap_nhat_gia_hang_loat: EXACT match thay ILIKE
--  Bug: v_name ilike '%name%' -> "Flazz" khop ca "Flazz Max".
--  Sua: dung = (so sanh chinh xac ten xe).
-- Chạy SAU 063. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_cap_nhat_gia_hang_loat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_brand text; v_name text; v_gia bigint; v_n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được cập nhật giá'; end if;

  v_brand := nullif(trim(coalesce(p->>'brand','')), '');
  v_name  := nullif(trim(coalesce(p->>'name','')), '');
  v_gia   := coalesce((p->>'list_price')::bigint, 0);
  if v_gia <= 0 then raise exception 'THIEU_THONG_TIN: giá niêm yết mới phải lớn hơn 0'; end if;
  if v_brand is null and v_name is null then
    raise exception 'THIEU_DIEU_KIEN: phải chọn ít nhất hãng hoặc model để tránh đổi giá toàn bộ danh mục';
  end if;

  -- EXACT match: brand = v_brand AND name = v_name (khong dung ILIKE de tranh khop nham)
  update public.vehicles set list_price = v_gia, updated_at = now()
  where (v_brand is null or brand = v_brand)
    and (v_name is null or name = v_name);

  get diagnostics v_n = row_count;
  return jsonb_build_object('so_ma_cap_nhat', v_n);
end $$;

do $do$
begin
  raise notice 'XONG 064: fn_cap_nhat_gia_hang_loat dung exact match (= thay ilike)';
end $do$;
