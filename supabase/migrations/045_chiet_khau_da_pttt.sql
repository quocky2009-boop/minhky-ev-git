-- ============================================================
-- Migration 045 — CHIẾT KHẤU + NHIỀU PHƯƠNG THỨC THANH TOÁN
-- Theo chot:
--  C3: chiet khau tung dong + ca don, kieu % hoac so tien
--  C5: 1 don co NHIEU dong thanh toan (tien mat + CK + tra gop...)
--  C1a: giu mo hinh moi xe = 1 don, gom nhom bang batch (ma lo)
-- Chay SAU 044. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== 1) CHIẾT KHẤU =====================
-- Tren don: chiet khau tong don
alter table public.sales_orders add column if not exists discount_type text not null default 'amount'
  check (discount_type in ('amount','percent'));
alter table public.sales_orders add column if not exists discount_value numeric not null default 0;
alter table public.sales_orders add column if not exists discount_amount bigint not null default 0; -- so tien thuc giam
-- Tren tung dong ban kem
alter table public.sale_items add column if not exists discount_type text not null default 'amount'
  check (discount_type in ('amount','percent'));
alter table public.sale_items add column if not exists discount_value numeric not null default 0;
-- Chiet khau rieng cho dong XE (luu tren don vi moi don 1 xe)
alter table public.sales_orders add column if not exists vehicle_discount_type text not null default 'amount'
  check (vehicle_discount_type in ('amount','percent'));
alter table public.sales_orders add column if not exists vehicle_discount_value numeric not null default 0;

-- ===================== 2) NHIỀU PHƯƠNG THỨC THANH TOÁN =====================
create table if not exists public.sale_payments (
  id bigserial primary key,
  sale_code text not null references public.sales_orders(code) on delete cascade,
  method text not null default 'Tiền mặt',
  amount bigint not null check (amount > 0),
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index if not exists sale_pay_idx on public.sale_payments (sale_code);

alter table public.sale_payments enable row level security;
drop policy if exists "read_sale_payments" on public.sale_payments;
create policy "read_sale_payments" on public.sale_payments for select to authenticated using (true);

-- ===================== 3) BÁN HÀNG BẢN MỚI =====================
-- Nhan: frames[] (nhieu xe) + items[] (ban kem) + payments[] (nhieu PTTT)
-- Moi XE tao 1 DON rieng (C1a), cung batch_code de gom nhom.
-- Ban kem + thanh toan gan vao DON DAU TIEN cua lo.
create or replace function public.fn_ban_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_batch text; v_code text; v_codes text[] := '{}';
  f jsonb; it jsonb; pm jsonb; u record; v_list bigint; v_cust bigint;
  v_before int; v_gia bigint; v_ck bigint; v_dm numeric; v_dt text;
  v_first text; v_coc bigint := 0; d record; n int := 0; v_def bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo đơn bán'; end if;
  if jsonb_array_length(coalesce(p->'frames','[]'::jsonb)) = 0 then
    raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe';
  end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;

  v_batch := public.fn_next_code('LO');
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);

  -- Tung xe = 1 don
  for f in select jsonb_array_elements(p->'frames') loop
    select * into u from public.vehicle_units where frame_number = f->>'frame_number' for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f->>'frame_number'; end if;

    -- Xe dang giu cho: chi ban cho dung khach dat coc
    if u.status = 'GIU_CHO' then
      if not public.fn_coc_cho_phep_ban(u.frame_number, p->>'customer_phone') then
        raise exception 'XE_DANG_GIU: xe % đang giữ cho khách khác', u.frame_number;
      end if;
      for d in select * from public.deposits where frame_number = u.frame_number and status = 'DANG_GIU' loop
        v_coc := v_coc + coalesce(d.amount, 0);
        update public.deposits set status = 'DA_BAN' where id = d.id;
      end loop;
    elsif u.status <> 'TON_KHO' then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', u.frame_number, u.status;
    end if;

    -- Tinh gia sau chiet khau dong
    v_gia := coalesce((f->>'unit_price')::bigint, 0);
    v_dt  := coalesce(nullif(f->>'discount_type',''), 'amount');
    v_dm  := coalesce((f->>'discount_value')::numeric, 0);
    v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                  else least(greatest(v_dm,0)::bigint, v_gia) end;

    v_code := public.fn_gen_code('BH');
    v_codes := array_append(v_codes, v_code);
    if v_first is null then v_first := v_code; end if;
    n := n + 1;

    select list_price, default_cost into v_list, v_def from public.vehicles where id = u.vehicle_id;
    if coalesce(u.cost_price,0) = 0 and coalesce(v_def,0) > 0 then
      update public.vehicle_units set cost_price = v_def where frame_number = u.frame_number;
    end if;

    v_before := public._count_at(u.vehicle_id, u.location_code);
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now()
    where frame_number = u.frame_number;

    perform public._log_txn('Bán hàng', u.vehicle_id, u.location_code, null, -1, v_before, v_before - 1,
      v_code, concat('KH ', p->>'customer_name', ' · SK ', u.frame_number,
        case when v_ck > 0 then concat(' · CK ', v_ck, 'đ') else '' end), me.uid, me.name);

    insert into public.sales_orders (code, sale_date, location_code, vehicle_id, quantity, frame_number,
      customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
      list_price, sale_price, vehicle_discount_type, vehicle_discount_value,
      paid_amount, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
    values (v_code, coalesce(nullif(p->>'sale_date','')::date, current_date),
      u.location_code, u.vehicle_id, 1, u.frame_number,
      p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
      coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
      coalesce(v_list,0), greatest(v_gia - v_ck, 0), v_dt, v_dm,
      0, 'Chuyển khoản', me.uid, me.name,
      coalesce(p->>'document_status','Đang làm đăng ký'),
      trim(both ' | ' from concat(coalesce(p->>'note',''),
        case when n > 1 or jsonb_array_length(p->'frames') > 1 then concat(' | Lô ', v_batch) else '' end)),
      coalesce(p->'extra','{}'::jsonb) || jsonb_build_object('batch_code', v_batch), v_cust);
  end loop;

  -- Ban kem + chiet khau tong + thanh toan -> gan vao DON DAU TIEN
  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'') = '' then continue; end if;
    v_gia := greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0);
    v_dt  := coalesce(nullif(it->>'discount_type',''), 'amount');
    v_dm  := coalesce((it->>'discount_value')::numeric, 0);
    v_ck  := case when v_dt = 'percent' then round(v_gia * least(greatest(v_dm,0),100) / 100.0)
                  else least(greatest(v_dm,0)::bigint, v_gia) end;
    insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount,
      payment_method, discount_type, discount_value)
    values (v_first, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
      greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
      greatest(v_gia - v_ck, 0), 'Chuyển khoản', v_dt, v_dm);
  end loop;

  -- Chiet khau tong don
  if coalesce((p->>'discount_value')::numeric, 0) > 0 then
    update public.sales_orders set
      discount_type = coalesce(nullif(p->>'discount_type',''), 'amount'),
      discount_value = (p->>'discount_value')::numeric,
      discount_amount = case when coalesce(nullif(p->>'discount_type',''),'amount') = 'percent'
        then round((sale_price + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = v_first),0))
                   * least(greatest((p->>'discount_value')::numeric,0),100) / 100.0)
        else least((p->>'discount_value')::numeric, sale_price)::bigint end
    where code = v_first;
  end if;

  -- Nhieu phuong thuc thanh toan
  for pm in select jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    if coalesce((pm->>'amount')::bigint, 0) <= 0 then continue; end if;
    insert into public.sale_payments (sale_code, method, amount, note, created_by, created_by_name)
    values (v_first, coalesce(nullif(pm->>'method',''),'Tiền mặt'), (pm->>'amount')::bigint,
      coalesce(pm->>'note',''), me.uid, me.name);
    perform public._auto_thu((select location_code from public.sales_orders where code = v_first),
      pm->>'method', (pm->>'amount')::bigint, 'Bán xe', p->>'customer_name',
      concat('Đơn ', v_first), concat(v_first, '-', pm->>'method', '-', pm->>'amount'), me.uid, me.name);
  end loop;

  -- Cong tien coc + tong thanh toan vao don dau
  update public.sales_orders set
    paid_amount = v_coc + coalesce((select sum(amount) from public.sale_payments where sale_code = v_first), 0),
    payment_method = coalesce((select method from public.sale_payments where sale_code = v_first order by amount desc limit 1), 'Chuyển khoản'),
    note = trim(both ' | ' from concat(note, case when v_coc > 0 then concat(' | Đã nhận cọc trước: ', v_coc, 'đ') else '' end))
  where code = v_first;

  return jsonb_build_object('batch', v_batch, 'codes', to_jsonb(v_codes), 'count', n, 'first', v_first);
end $$;

-- View tong tien don (gom ban kem + chiet khau + nhieu PTTT)
create or replace view public.v_don_ban_tong as
select o.id, o.code, o.sale_date, o.location_code, o.customer_name, o.customer_phone,
  o.sale_price, o.quantity,
  o.sale_price * o.quantity as tien_xe,
  coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0) as tien_kem,
  o.discount_amount,
  greatest(o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - o.discount_amount, 0) as tong_don,
  coalesce(o.paid_amount, 0) as da_tra,
  greatest(o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code), 0)
    - o.discount_amount - coalesce(o.paid_amount, 0), 0) as con_lai,
  o.extra->>'batch_code' as batch_code
from public.sales_orders o;
