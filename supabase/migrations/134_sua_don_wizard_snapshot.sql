-- =====================================================================
-- 134_sua_don_wizard_snapshot.sql
-- "Sua don" cho don tao tu Wizard: cap nhat dung snapshot Bang gia.
-- fn_sua_don_ban_v2 chi BOC ngoai (khong sua) fn_sua_don_ban cu:
--   1) goi fn_sua_don_ban(p)          -> sua don nhu cu (xe, khach, thanh toan...)
--   2) ghi promo_amount / invoice_total / price_snapshot moi vao don
--   3) fn_gan_khuyen_mai_don          -> dong bo tag KM (them/xoa + log)
--   4) cap nhat snapshot so tien tung KM trong sale_order_promotions
-- Form "Ban hang" cu van goi fn_sua_don_ban nhu truoc (khong anh huong).
-- =====================================================================
create or replace function public.fn_sua_don_ban_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb; v_code text; v_snap jsonb; v_ids bigint[];
begin
  v_snap := p->'frames'->0->'price_snapshot';
  if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
    raise exception 'THIEU_THONG_TIN: thiếu Bảng giá (price_snapshot) — hãy bấm Làm mới Bảng giá';
  end if;

  r := public.fn_sua_don_ban(p);
  v_code := r->>'code';

  update public.sales_orders set
    promo_amount = coalesce((p->'frames'->0->>'promo_amount')::bigint, 0),
    invoice_total = nullif(p->'frames'->0->>'invoice_total','')::bigint,
    price_snapshot = v_snap
  where code = v_code;

  select coalesce(array_agg((x->>'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(v_snap->'khuyen_mai','[]'::jsonb)) x;
  perform public.fn_gan_khuyen_mai_don(v_code, v_ids);

  update public.sale_order_promotions sop set
    kind = x->>'kind', value_type = x->>'value_type',
    value = nullif(x->>'value','')::numeric, amount_applied = coalesce((x->>'amount')::bigint, 0)
  from jsonb_array_elements(coalesce(v_snap->'khuyen_mai','[]'::jsonb)) x
  where sop.sale_code = v_code and sop.promotion_id = (x->>'id')::bigint;

  return r;
end $function$;
