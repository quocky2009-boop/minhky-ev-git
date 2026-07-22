-- ============================================================
-- Migration 036 — ĐỢT 1: GIÁ VỐN · LÃI GỘP · CÔNG NỢ · ĐẶT CỌC
--  A) Gia von theo TUNG CHIEC XE (vehicle_units.cost_price)
--  B) View lai gop theo don / mau xe / diem
--  C) Cong no khach: view gom moi don con thieu tien theo khach
--  D) Dat coc giu xe: trang thai GIU_CHO + bang dat coc
-- Chay SAU 035. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== A) GIÁ VỐN =====================
alter table public.vehicle_units add column if not exists cost_price bigint not null default 0;
alter table public.vehicle_units add column if not exists cost_note text default '';
create index if not exists vu_cost_idx on public.vehicle_units (vehicle_id, cost_price);

-- Gia von mac dinh theo mau xe (dung khi nhap hang khong khai gia tung chiec)
alter table public.vehicles add column if not exists default_cost bigint not null default 0;

-- Cap nhat gia von cho 1 hoac nhieu so khung
create or replace function public.fn_set_gia_von(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me record; f text; v_n int := 0; v_cost bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('nhap_hang') and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật giá vốn';
  end if;
  v_cost := coalesce((p->>'cost_price')::bigint, 0);
  if v_cost < 0 then raise exception 'THAM_SO_SAI: giá vốn không âm'; end if;
  for f in select jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) loop
    update public.vehicle_units set cost_price = v_cost, cost_note = coalesce(p->>'note',''), updated_at = now()
    where frame_number = f;
    if found then v_n := v_n + 1; end if;
  end loop;
  -- Neu co truyen vehicle_id: luu lam gia von mac dinh cho mau xe
  if coalesce(p->>'vehicle_id','') <> '' then
    update public.vehicles set default_cost = v_cost where id = p->>'vehicle_id';
  end if;
  return v_n;
end $$;

-- ===================== B) LÃI GỘP =====================
-- Lai gop tung don = (gia ban + ban kem) - (gia von cac xe trong don)
create or replace view public.v_lai_gop_don as
select
  o.id, o.code, o.sale_date, o.location_code, o.vehicle_id, o.frame_number,
  o.customer_name, o.seller_name, o.quantity,
  o.sale_price * o.quantity as tien_xe,
  coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0) as tien_kem,
  o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0) as doanh_thu,
  coalesce((
    select sum(u.cost_price) from public.vehicle_units u
    where u.sale_code = o.code
  ), coalesce((select v.default_cost from public.vehicles v where v.id = o.vehicle_id), 0) * o.quantity) as gia_von,
  o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce((
        select sum(u.cost_price) from public.vehicle_units u where u.sale_code = o.code
      ), coalesce((select v.default_cost from public.vehicles v where v.id = o.vehicle_id), 0) * o.quantity) as lai_gop,
  o.invoice_status, o.paid_amount
from public.sales_orders o;

-- ===================== C) CÔNG NỢ KHÁCH =====================
-- Gom moi don con thieu tien theo khach hang
create or replace view public.v_cong_no_don as
select
  o.id, o.code, o.sale_date, o.location_code, o.customer_id,
  o.customer_name, o.customer_phone, o.customer_type, o.seller_name,
  o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0) as tong_don,
  coalesce(o.paid_amount, 0) as da_tra,
  o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.paid_amount, 0) as con_no,
  (current_date - o.sale_date) as tuoi_no
from public.sales_orders o
where o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - coalesce(o.paid_amount, 0) > 0;

create or replace view public.v_cong_no_khach as
select
  coalesce(customer_id::text, customer_phone) as khach_key,
  max(customer_name) as customer_name,
  max(customer_phone) as customer_phone,
  max(customer_type) as customer_type,
  count(*) as so_don,
  sum(con_no) as tong_no,
  max(tuoi_no) as tuoi_no_max,
  min(sale_date) as don_cu_nhat
from public.v_cong_no_don
group by coalesce(customer_id::text, customer_phone);

-- Cap nhat so tien da tra cua don (dung khi khach tra dan)
create or replace function public.fn_cap_nhat_da_tra(p_id bigint, p_paid bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('sua_thanh_toan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật thanh toán'; end if;
  if coalesce(p_paid,0) < 0 then raise exception 'THAM_SO_SAI'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  update public.sales_orders set paid_amount = p_paid,
    note = case when coalesce(p_note,'') = '' then note
           else trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Thu thêm: ' || p_note || ' (' || me.name || ')') end
  where id = p_id;
end $$;

-- ===================== D) ĐẶT CỌC / GIỮ XE =====================
alter table public.vehicle_units drop constraint if exists vehicle_units_status_check;
alter table public.vehicle_units add constraint vehicle_units_status_check
  check (status in ('TON_KHO','DANG_CHUYEN','DA_BAN','DA_XOA','GIU_CHO'));

create table if not exists public.deposits (
  id bigserial primary key,
  code text unique not null,
  frame_number text not null references public.vehicle_units(frame_number),
  vehicle_id text references public.vehicles(id),
  location_code text references public.locations(code),
  customer_id bigint references public.customers(id),
  customer_name text not null default '',
  customer_phone text not null default '',
  amount bigint not null default 0 check (amount >= 0),
  hold_until date not null,
  status text not null default 'DANG_GIU' check (status in ('DANG_GIU','DA_BAN','HET_HAN','HUY')),
  note text default '',
  cancel_reason text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deposits_frame_idx on public.deposits (frame_number, status);
create index if not exists deposits_status_idx on public.deposits (status, hold_until);

drop trigger if exists trg_touch_deposits on public.deposits;
create trigger trg_touch_deposits before update on public.deposits
  for each row execute function public._touch_updated_at();

alter table public.deposits enable row level security;
drop policy if exists "read_deposits" on public.deposits;
create policy "read_deposits" on public.deposits for select to authenticated using (true);

-- Tao coc: chuyen xe sang GIU_CHO
create or replace function public.fn_dat_coc(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; u record; v_code text; v_cust bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền đặt cọc giữ xe'; end if;
  select * into u from public.vehicle_units where frame_number = p->>'frame_number' for update;
  if u is null then raise exception 'KHONG_TIM_THAY: số khung % không có trên hệ thống', p->>'frame_number'; end if;
  if u.status = 'GIU_CHO' then
    raise exception 'XE_DANG_GIU: xe này đã được giữ cho khách khác — kiểm tra danh sách đặt cọc';
  end if;
  if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe đang ở trạng thái %', u.status; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách đặt cọc';
  end if;
  if coalesce(nullif(p->>'hold_until','')::date, null) is null then
    raise exception 'THIEU_THONG_TIN: cần chọn ngày giữ xe đến';
  end if;

  v_cust := nullif(p->>'customer_id','')::bigint;
  if v_cust is null then
    v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', '',
      coalesce(p->>'customer_address',''), 'Khách lẻ', 'Đặt cọc', me.uid, me.name);
  end if;

  v_code := public.fn_next_code('COC');
  insert into public.deposits (code, frame_number, vehicle_id, location_code, customer_id,
    customer_name, customer_phone, amount, hold_until, note, created_by, created_by_name)
  values (v_code, u.frame_number, u.vehicle_id, u.location_code, v_cust,
    p->>'customer_name', p->>'customer_phone', coalesce((p->>'amount')::bigint, 0),
    (p->>'hold_until')::date, coalesce(p->>'note',''), me.uid, me.name);

  update public.vehicle_units set status = 'GIU_CHO', updated_at = now() where frame_number = u.frame_number;

  perform public._notify_discord(jsonb_build_object('content',
    '🔒 **Giữ xe theo cọc '||v_code||'** · SK '||u.frame_number||' · KH '||(p->>'customer_name')||' ('||(p->>'customer_phone')||
    ') · cọc '||coalesce((p->>'amount')::bigint,0)||'đ · giữ đến '||(p->>'hold_until')||' · '||me.name));
  return v_code;
end $$;

-- Huy coc / het han: tra xe ve TON_KHO
create or replace function public.fn_huy_coc(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do hủy giữ xe'; end if;
  select * into d from public.deposits where id = p_id for update;
  if d is null then raise exception 'KHONG_TIM_THAY'; end if;
  if d.status <> 'DANG_GIU' then raise exception 'TRANG_THAI_SAI: phiếu cọc này không còn hiệu lực'; end if;
  update public.deposits set status = 'HUY', cancel_reason = p_ly_do where id = p_id;
  update public.vehicle_units set status = 'TON_KHO', updated_at = now()
  where frame_number = d.frame_number and status = 'GIU_CHO';
  perform public._notify_discord(jsonb_build_object('content',
    '🔓 **Hủy giữ xe** '||d.code||' · SK '||d.frame_number||' · lý do: '||p_ly_do||' · '||me.name));
end $$;

-- Nha xe qua han (goi tay hoac cron sau nay)
create or replace function public.fn_nha_coc_qua_han()
returns int language plpgsql security definer set search_path = public as $$
declare d record; v_n int := 0;
begin
  for d in select * from public.deposits where status = 'DANG_GIU' and hold_until < current_date loop
    update public.deposits set status = 'HET_HAN' where id = d.id;
    update public.vehicle_units set status = 'TON_KHO', updated_at = now()
    where frame_number = d.frame_number and status = 'GIU_CHO';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Ban hang cho xe dang giu: cho phep neu dung khach dat coc
create or replace function public.fn_coc_cho_phep_ban(p_frame text, p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deposits
    where frame_number = p_frame and status = 'DANG_GIU'
      and regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')
  )
$$;
