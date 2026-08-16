-- ============================================================
-- Migration 108: Lịch sử THÊM/XÓA tag khuyến mại trên đơn bán —
-- phục vụ tra soát cuối tháng: nhân viên nào quên add / add sai /
-- sửa lại sau khi đơn đã tạo.
--
-- Bảng log riêng (không xóa khi tag bị gỡ khỏi đơn — giữ lại vĩnh
-- viễn để tra soát, kể cả tag đã bị xóa hoặc chương trình đã hết hạn).
-- Chạy sau 107. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create table if not exists public.sale_order_promotions_log (
  id bigserial primary key,
  sale_code text not null,
  promotion_id bigint,
  promotion_name text not null default '',  -- luu ten tai thoi diem (de van doc duoc du chuong trinh bi xoa sau nay)
  action text not null check (action in ('THEM','XOA')),
  by_id uuid references public.profiles(id),
  by_name text default '',
  at timestamptz not null default now()
);
create index if not exists sopl_sale_idx on public.sale_order_promotions_log (sale_code, at);

alter table public.sale_order_promotions_log enable row level security;
drop policy if exists "read_sopl" on public.sale_order_promotions_log;
create policy "read_sopl" on public.sale_order_promotions_log for select to authenticated using (true);

-- ---------- Patch fn_gan_khuyen_mai_don: ghi log mỗi lần THÊM/XÓA thật sự ----------
create or replace function public.fn_gan_khuyen_mai_don(p_sale_code text, p_promotion_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_khuyen_mai_don') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa tag chương trình khuyến mại';
  end if;
  if not exists (select 1 from public.sales_orders where code = p_sale_code) then
    raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại';
  end if;

  -- Ghi log XOA cho nhung tag hien co nhung KHONG con trong danh sach moi
  for r in
    select sop.promotion_id, pr.name
    from public.sale_order_promotions sop
    join public.promotions pr on pr.id = sop.promotion_id
    where sop.sale_code = p_sale_code and not (sop.promotion_id = any(coalesce(p_promotion_ids, '{}')))
  loop
    insert into public.sale_order_promotions_log (sale_code, promotion_id, promotion_name, action, by_id, by_name)
    values (p_sale_code, r.promotion_id, r.name, 'XOA', me.uid, me.name);
  end loop;

  -- Ghi log THEM cho nhung tag MOI (chua ton tai truoc do)
  for r in
    select pid as promotion_id, (select name from public.promotions where id = pid) as name
    from unnest(coalesce(p_promotion_ids, '{}')) pid
    where not exists (select 1 from public.sale_order_promotions where sale_code = p_sale_code and promotion_id = pid)
  loop
    insert into public.sale_order_promotions_log (sale_code, promotion_id, promotion_name, action, by_id, by_name)
    values (p_sale_code, r.promotion_id, r.name, 'THEM', me.uid, me.name);
  end loop;

  delete from public.sale_order_promotions
  where sale_code = p_sale_code and not (promotion_id = any(coalesce(p_promotion_ids, '{}')));

  insert into public.sale_order_promotions (sale_code, promotion_id, created_by, created_by_name)
  select p_sale_code, pid, me.uid, me.name
  from unnest(coalesce(p_promotion_ids, '{}')) pid
  on conflict (sale_code, promotion_id) do nothing;
end $$;

-- ---------- View tổng hợp: tra soát nhanh đơn nào có sửa đổi KM sau khi tạo ----------
create or replace view public.v_don_ban_km_audit as
select
  o.code as sale_code,
  min(l.at) as km_lan_dau_luc,
  max(l.at) as km_lan_cuoi_luc,
  count(*) as tong_so_lan_thao_tac,
  count(*) filter (where l.action = 'XOA') as so_lan_xoa,
  -- "Co sua doi sau khi tao don": thao tac KM gan nhat cach luc tao don > 10 phut
  -- (cach nay tranh bao dong gia cho thao tac tick chon ngay khi dang tao don)
  (max(l.at) - o.created_at) > interval '10 minutes' as co_sua_doi_sau_khi_tao
from public.sales_orders o
left join public.sale_order_promotions_log l on l.sale_code = o.code
group by o.code, o.created_at;
