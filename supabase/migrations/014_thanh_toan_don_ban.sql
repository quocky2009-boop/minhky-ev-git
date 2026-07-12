-- ============================================================
-- Migration 014: THANH TOAN DA DONG + BAN KEM trong don ban
-- - sale_items: dong ban kem (phu kien / dang ky / bao hiem)
-- - sale_payments: dong thanh toan (TM / CK / Tra gop)
-- - TM/CK -> tu sinh phieu thu vao dung quy NGAY khi chot don
-- - Tra gop -> khoan CHO GIAI NGAN, xac nhan khi tien ve
-- - Tong thanh toan BAT BUOC = tong don (xe + ban kem)
-- - Don cu giu nguyen, khong bat bo sung nguoc
-- Chay SAU 013, 1 lan duy nhat.
-- ============================================================

-- Danh muc (chinh trong Cai dat)
insert into public.app_settings(key, value) values ('phu_kien', 'Mũ bảo hiểm|150000
Khóa đĩa|120000
Giáp gương|50000
Baga sau|250000
Áo mưa|80000') on conflict do nothing;
insert into public.app_settings(key, value) values ('bao_hiem', 'BH TNDS xe máy điện 1 năm|66000
BH TNDS xe máy điện 2 năm|121000') on conflict do nothing;
insert into public.app_settings(key, value) values ('cong_ty_tra_gop', 'Home Credit
Shinhanbank
HD Saison
FE Credit') on conflict do nothing;
insert into public.app_settings(key, value) values ('gia_dang_ky', '350000') on conflict do nothing;

-- ---- DONG BAN KEM ----
create table public.sale_items (
  id bigserial primary key,
  sale_code text not null references public.sales_orders(code),
  item_type text not null check (item_type in ('PHU_KIEN','DANG_KY','BAO_HIEM')),
  name text not null,
  qty int not null default 1 check (qty > 0),
  unit_price bigint not null default 0,
  amount bigint not null default 0,
  created_at timestamptz not null default now()
);
create index on public.sale_items (sale_code);

-- ---- DONG THANH TOAN ----
create table public.sale_payments (
  id bigserial primary key,
  sale_code text not null references public.sales_orders(code),
  method text not null check (method in ('Tiền mặt','Chuyển khoản','Trả góp')),
  account_id bigint references public.cash_accounts(id),
  finance_company text default '',
  amount bigint not null check (amount > 0),
  expected_date date,
  status text not null default 'Đã thu' check (status in ('Đã thu','Chờ giải ngân','Đã giải ngân')),
  cash_txn_code text default '',
  disbursed_txn_code text default '',
  disbursed_at timestamptz,
  disbursed_by_name text default '',
  created_at timestamptz not null default now()
);
create index on public.sale_payments (sale_code);
create index on public.sale_payments (status);

-- ---- RLS ----
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
create policy "read_sale_items" on public.sale_items for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER'))
  or exists (select 1 from public.sales_orders s where s.code = sale_code and s.seller_id = auth.uid())
);
create policy "read_sale_payments" on public.sale_payments for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER'))
  or exists (select 1 from public.sales_orders s where s.code = sale_code and s.seller_id = auth.uid())
);

-- Danh sach quy cho form don ban (sales can ten quy de chon noi thu tien,
-- khong lo so du) -> ham rieng thay vi mo RLS bang cash_accounts
create or replace function public.fn_ds_quy()
returns table(id bigint, name text, type text, location_code text)
language sql security definer set search_path = public stable as $$
  select id, name, type, location_code from public.cash_accounts where status = 'Hoạt động' order by type, name;
$$;

-- ---- BAN HANG: nguyen khoi ton + khach + ban kem + thanh toan ----
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
  v_frames text[]; v_cust bigint;
  it jsonb; pay jsonb; v_items_sum bigint := 0; v_pay_sum bigint := 0;
  v_total bigint; v_price bigint; v_qty int; v_amount bigint;
  acc record; v_pt text; v_methods text[] := '{}';
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  n := coalesce(array_length(v_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe theo số khung'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;

  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  v_price := coalesce((p->>'sale_price')::bigint, v_list, 0);

  -- Tong ban kem (tinh server-side, khong tin client)
  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_qty := greatest(coalesce((it->>'qty')::int,1),1);
    v_amount := v_qty * coalesce((it->>'unit_price')::bigint,0);
    if coalesce(trim(it->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: dòng bán kèm thiếu tên'; end if;
    v_items_sum := v_items_sum + v_amount;
  end loop;
  v_total := v_price * n + v_items_sum;

  -- Kiem tra thanh toan: bat buoc du va khop tong
  if jsonb_array_length(coalesce(p->'payments','[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: cần khai báo các dòng thanh toán';
  end if;
  for pay in select jsonb_array_elements(p->'payments') loop
    v_amount := coalesce((pay->>'amount')::bigint,0);
    if v_amount <= 0 then raise exception 'SO_LUONG_SAI: số tiền mỗi dòng thanh toán phải > 0'; end if;
    v_pay_sum := v_pay_sum + v_amount;
    if (pay->>'method') in ('Tiền mặt','Chuyển khoản') then
      select * into acc from public.cash_accounts where id = (pay->>'account_id')::bigint and status = 'Hoạt động';
      if acc is null then raise exception 'KHONG_TIM_THAY: quỹ nhận tiền không tồn tại hoặc đã khóa'; end if;
      if (pay->>'method') = 'Tiền mặt' and acc.type <> 'Tiền mặt' then raise exception 'SAI_KHO_HOAC_XE: dòng tiền mặt phải chọn quỹ tiền mặt'; end if;
      if (pay->>'method') = 'Chuyển khoản' and acc.type <> 'Ngân hàng' then raise exception 'SAI_KHO_HOAC_XE: dòng chuyển khoản phải chọn tài khoản ngân hàng'; end if;
    elsif (pay->>'method') = 'Trả góp' then
      if coalesce(trim(pay->>'finance_company'),'') = '' then raise exception 'THIEU_THONG_TIN: dòng trả góp cần chọn công ty tài chính'; end if;
    else
      raise exception 'SO_LUONG_SAI: phương thức thanh toán không hợp lệ';
    end if;
  end loop;
  if v_pay_sum <> v_total then
    raise exception 'SAI_TONG_THANH_TOAN: tổng thanh toán % đ khác tổng đơn % đ — phải khớp 100%%', v_pay_sum, v_total;
  end if;

  -- Tru ton theo so khung
  v_before := public._count_at(p->>'vehicle_id', p->>'location_code');
  v_code := public.fn_gen_code('BH');
  foreach f in array v_frames loop
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f, u.status; end if;
    if u.location_code <> p->>'location_code' or u.vehicle_id <> p->>'vehicle_id' then
      raise exception 'SAI_KHO_HOAC_XE: xe % không thuộc kho/mã xe đã chọn', f;
    end if;
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now() where frame_number = f;
  end loop;
  perform public._log_txn('Bán hàng', p->>'vehicle_id', p->>'location_code', null, -n, v_before, v_before - n,
    v_code, 'KH '||(p->>'customer_name')||' · SK: '||array_to_string(v_frames,', '), me.uid, me.name);

  -- Khach hang tu dong
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);

  -- Don ban
  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
  values (v_code, p->>'location_code', p->>'vehicle_id', n, array_to_string(v_frames,', '),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), v_price,
    coalesce(p->>'payment_method','Nhiều dòng'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''),
    coalesce(p->'extra','{}'::jsonb), v_cust);

  -- Dong ban kem
  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_qty := greatest(coalesce((it->>'qty')::int,1),1);
    insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount)
    values (v_code, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
            v_qty, coalesce((it->>'unit_price')::bigint,0), v_qty * coalesce((it->>'unit_price')::bigint,0));
  end loop;

  -- Dong thanh toan: TM/CK sinh phieu thu NGAY; Tra gop -> cho giai ngan
  for pay in select jsonb_array_elements(p->'payments') loop
    v_amount := (pay->>'amount')::bigint;
    v_methods := v_methods || (pay->>'method');
    if (pay->>'method') in ('Tiền mặt','Chuyển khoản') then
      v_pt := public.fn_gen_code('PT');
      insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
      values (v_pt, (now() at time zone 'Asia/Ho_Chi_Minh')::date, (pay->>'account_id')::bigint, 'Thu', v_amount,
              'Bán xe', p->>'customer_name', 'Thu theo đơn '||v_code||' ('||(pay->>'method')||')', v_code, me.uid, me.name);
      insert into public.sale_payments (sale_code, method, account_id, amount, status, cash_txn_code)
      values (v_code, pay->>'method', (pay->>'account_id')::bigint, v_amount, 'Đã thu', v_pt);
    else
      insert into public.sale_payments (sale_code, method, finance_company, amount, expected_date, status)
      values (v_code, 'Trả góp', trim(pay->>'finance_company'), v_amount, nullif(pay->>'expected_date','')::date, 'Chờ giải ngân');
    end if;
  end loop;
  update public.sales_orders set payment_method = array_to_string(array(select distinct unnest(v_methods)), ' + ') where code = v_code;

  return v_code;
end $$;

-- ---- XAC NHAN GIAI NGAN TRA GOP (khi tien ve tai khoan) ----
create or replace function public.fn_xac_nhan_giai_ngan(p_id bigint, p_account bigint, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; sp record; acc record; v_pt text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ được xác nhận giải ngân'; end if;
  select * into sp from public.sale_payments where id = p_id for update;
  if sp is null then raise exception 'KHONG_TIM_THAY'; end if;
  if sp.method <> 'Trả góp' or sp.status <> 'Chờ giải ngân' then raise exception 'TRANG_THAI_SAI: khoản này không ở trạng thái chờ giải ngân'; end if;
  select * into acc from public.cash_accounts where id = p_account and status = 'Hoạt động';
  if acc is null or acc.type <> 'Ngân hàng' then raise exception 'KHONG_TIM_THAY: chọn tài khoản ngân hàng nhận tiền hợp lệ'; end if;
  v_pt := public.fn_gen_code('PT');
  insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_pt, (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_account, 'Thu', sp.amount,
          'Giải ngân trả góp', sp.finance_company, 'Giải ngân '||sp.finance_company||' cho đơn '||sp.sale_code||coalesce('. '||nullif(p_note,''),''), sp.sale_code, me.uid, me.name);
  update public.sale_payments set status='Đã giải ngân', disbursed_txn_code=v_pt, disbursed_at=now(), disbursed_by_name=me.name where id = p_id;
end $$;
