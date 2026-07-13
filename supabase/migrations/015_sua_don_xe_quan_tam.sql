-- ============================================================
-- Migration 015:
-- 1) Khach hang: "Xe du kien mua" (chon tu danh muc xe) + loc
-- 2) Cham soc: hinh thuc cham soc dang dropdown (chinh Cai dat)
-- 3) DIEU CHINH DON BAN 2 cap: Sales tao don / Quan ly gui yeu
--    cau sua gia -> CEO/Admin duyet -> tu sinh phieu thu/chi bu,
--    KHONG sua de phieu thu cu, luu day du lich su (audit).
-- Chay SAU 014, 1 lan duy nhat.
-- ============================================================

-- ---- 1) XE DU KIEN MUA ----
alter table public.customers add column if not exists interested_vehicle_id text references public.vehicles(id);
create index if not exists customers_interested_idx on public.customers (interested_vehicle_id) where interested_vehicle_id is not null;

-- ---- 2) HINH THUC CHAM SOC ----
alter table public.customer_care_logs add column if not exists care_type text default '';
insert into public.app_settings(key, value) values ('cham_soc_types', 'Gọi điện
Nhắn tin / Zalo
Gặp trực tiếp
Mời lái thử
Gửi báo giá
Khác') on conflict do nothing;

-- LUU KHACH HANG v3 (them interested_vehicle_id; giu khoa "Da mua", phan quyen, lich hen)
create or replace function public.fn_luu_khach_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; old_row record; v_new_status text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(trim(p->>'name'),'') = '' or coalesce(trim(p->>'phone'),'') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  if coalesce(p->>'interested_vehicle_id','') <> ''
     and not exists (select 1 from public.vehicles where id = p->>'interested_vehicle_id') then
    raise exception 'KHONG_TIM_THAY: mã xe quan tâm không có trong danh mục';
  end if;

  if coalesce(p->>'id','') <> '' then
    select * into old_row from public.customers where id = (p->>'id')::bigint for update;
    if old_row is null then raise exception 'KHONG_TIM_THAY: khách hàng không tồn tại'; end if;
    if me.role <> 'CEO' and old_row.assigned_to <> me.uid and old_row.created_by <> me.uid then
      raise exception 'KHONG_CO_QUYEN: bạn chỉ được sửa khách hàng do mình phụ trách';
    end if;
    v_new_status := coalesce(nullif(p->>'status',''), old_row.status);
    if old_row.status = 'Đã mua' and v_new_status <> 'Đã mua' then
      raise exception 'TRANG_THAI_KHOA: khách đã mua xe, trạng thái "Đã mua" không thể đổi';
    end if;
    update public.customers set
      name = trim(p->>'name'), phone = trim(p->>'phone'),
      cccd = coalesce(p->>'cccd',''), address = coalesce(p->>'address',''),
      customer_type = coalesce(nullif(p->>'customer_type',''),'Khách lẻ'),
      source = coalesce(nullif(p->>'source',''),'Khách vãng lai'),
      status = v_new_status,
      temperature = nullif(p->>'temperature',''),
      interested_vehicle_id = case when p ? 'interested_vehicle_id' then nullif(p->>'interested_vehicle_id','') else interested_vehicle_id end,
      next_care_date = case when p ? 'next_care_date' then nullif(p->>'next_care_date','')::date else next_care_date end,
      next_care_note = case when p ? 'next_care_note' then coalesce(p->>'next_care_note','') else next_care_note end,
      note = coalesce(p->>'note',''), updated_at = now()
    where id = (p->>'id')::bigint
    returning code into v_code;
    return v_code;
  end if;

  v_code := public.fn_gen_code('KH');
  insert into public.customers (code, name, phone, cccd, address, customer_type, source, status, temperature,
    interested_vehicle_id, next_care_date, next_care_note, assigned_to, assigned_name, note, created_by, created_by_name)
  values (v_code, trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
          coalesce(nullif(p->>'customer_type',''),'Khách lẻ'), coalesce(nullif(p->>'source',''),'Khách vãng lai'),
          coalesce(nullif(p->>'status',''),'Lead mới'), nullif(p->>'temperature',''),
          nullif(p->>'interested_vehicle_id',''),
          nullif(p->>'next_care_date','')::date, coalesce(p->>'next_care_note',''),
          me.uid, me.name, coalesce(p->>'note',''), me.uid, me.name);
  return v_code;
end $$;

-- GHI CHAM SOC v3 (hinh thuc + noi dung; giu lich hen lan sau)
create or replace function public.fn_luu_cham_soc(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; cust record;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select * into cust from public.customers where id = (p->>'customer_id')::bigint;
  if cust is null then raise exception 'KHONG_TIM_THAY: khách hàng không tồn tại'; end if;
  if me.role <> 'CEO' and cust.assigned_to <> me.uid and cust.created_by <> me.uid then
    raise exception 'KHONG_CO_QUYEN: bạn chỉ được ghi chăm sóc cho khách mình phụ trách';
  end if;
  if coalesce(trim(p->>'content'),'') = '' and coalesce(trim(p->>'care_type'),'') = '' then
    raise exception 'THIEU_THONG_TIN: cần chọn hình thức hoặc nhập nội dung chăm sóc';
  end if;
  insert into public.customer_care_logs (customer_id, care_date, care_type, content, result, created_by, created_by_name)
  values ((p->>'customer_id')::bigint, coalesce(nullif(p->>'care_date','')::date, current_date),
          coalesce(trim(p->>'care_type'),''), coalesce(trim(p->>'content'),''), coalesce(p->>'result',''), me.uid, me.name);
  update public.customers set
    updated_at = now(),
    next_care_date = case when p ? 'next_care_date' then nullif(p->>'next_care_date','')::date else next_care_date end,
    next_care_note = case when p ? 'next_care_note' then coalesce(p->>'next_care_note','') else next_care_note end
  where id = (p->>'customer_id')::bigint;
end $$;

-- ---- 3) DIEU CHINH DON BAN (sua gia) 2 CAP ----
create table public.sale_adjust_requests (
  id bigserial primary key,
  code text unique not null,
  sale_code text not null references public.sales_orders(code),
  old_price bigint not null,
  new_price bigint not null,
  quantity int not null,
  diff_total bigint not null,          -- (new - old) * quantity: am = hoan khach, duong = thu them
  reason text not null,
  status text not null default 'Chờ duyệt' check (status in ('Chờ duyệt','Đã duyệt','Từ chối')),
  requested_by uuid references public.profiles(id),
  requested_by_name text default '',
  approved_by uuid references public.profiles(id),
  approved_by_name text default '',
  approved_at timestamptz,
  account_id bigint references public.cash_accounts(id),
  cash_txn_code text default '',
  approve_note text default '',
  created_at timestamptz not null default now()
);
create index on public.sale_adjust_requests (sale_code);
create index on public.sale_adjust_requests (status);

alter table public.sale_adjust_requests enable row level security;
create policy "read_sale_adjust" on public.sale_adjust_requests for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN','MANAGER'))
  or requested_by = auth.uid()
  or exists (select 1 from public.sales_orders s where s.code = sale_code and s.seller_id = auth.uid())
);

-- Gui yeu cau: sales tao don do HOAC Quan ly/Admin/CEO
create or replace function public.fn_yeu_cau_sua_don(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; o record; v_new bigint; v_code text;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select * into o from public.sales_orders where code = p->>'sale_code';
  if o is null then raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại'; end if;
  if not (me.role in ('MANAGER','ADMIN','CEO') or o.seller_id = me.uid) then
    raise exception 'KHONG_CO_QUYEN: chỉ sales tạo đơn hoặc Quản lý/Admin/BGĐ được gửi yêu cầu';
  end if;
  if coalesce(trim(p->>'reason'),'') = '' then raise exception 'THIEU_LY_DO: điều chỉnh đơn bắt buộc có lý do'; end if;
  v_new := coalesce((p->>'new_price')::bigint, -1);
  if v_new < 0 then raise exception 'SO_LUONG_SAI: giá mới không hợp lệ'; end if;
  if v_new = o.sale_price then raise exception 'KHONG_CHENH_LECH: giá mới trùng giá hiện tại của đơn'; end if;
  if exists (select 1 from public.sale_adjust_requests where sale_code = o.code and status = 'Chờ duyệt') then
    raise exception 'TRANG_THAI_SAI: đơn này đang có 1 yêu cầu điều chỉnh chờ duyệt';
  end if;
  v_code := public.fn_gen_code('DCB');
  insert into public.sale_adjust_requests (code, sale_code, old_price, new_price, quantity, diff_total, reason, requested_by, requested_by_name)
  values (v_code, o.code, o.sale_price, v_new, o.quantity, (v_new - o.sale_price) * o.quantity,
          trim(p->>'reason'), me.uid, me.name);
  return v_code;
end $$;

-- Duyet: CEO/Admin. Duyet -> sinh phieu THU bo sung (thieu) hoac phieu CHI hoan (thua),
-- cap nhat gia don, giu nguyen phieu thu cu (khong sua de chung tu).
create or replace function public.fn_duyet_sua_don(p_id bigint, p_approve boolean, p_account bigint default null, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; rq record; acc record; v_pt text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được duyệt điều chỉnh đơn'; end if;
  select * into rq from public.sale_adjust_requests where id = p_id for update;
  if rq is null then raise exception 'KHONG_TIM_THAY'; end if;
  if rq.status <> 'Chờ duyệt' then raise exception 'TRANG_THAI_SAI'; end if;

  if not p_approve then
    update public.sale_adjust_requests set status='Từ chối', approved_by=me.uid, approved_by_name=me.name,
      approved_at=now(), approve_note=coalesce(p_note,'') where id = p_id;
    return;
  end if;

  if rq.diff_total <> 0 then
    select * into acc from public.cash_accounts where id = p_account and status = 'Hoạt động';
    if acc is null then raise exception 'THIEU_THONG_TIN: chọn quỹ để thu bổ sung / chi hoàn tiền'; end if;
    if rq.diff_total < 0 and public.fn_so_du(p_account) < -rq.diff_total then
      raise exception 'TON_KHONG_DU: số dư quỹ không đủ để chi hoàn %', -rq.diff_total;
    end if;
    v_pt := public.fn_gen_code(case when rq.diff_total > 0 then 'PT' else 'PC' end);
    insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
    values (v_pt, (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_account,
            case when rq.diff_total > 0 then 'Thu' else 'Chi' end, abs(rq.diff_total),
            'Điều chỉnh đơn bán',
            (select customer_name from public.sales_orders where code = rq.sale_code),
            case when rq.diff_total > 0 then 'Thu bổ sung' else 'Hoàn khách' end
              ||' theo yêu cầu '||rq.code||' của đơn '||rq.sale_code||': '||rq.reason,
            rq.sale_code, me.uid, me.name);
  end if;

  update public.sales_orders set
    sale_price = rq.new_price,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Đã điều chỉnh giá '||rq.old_price||' → '||rq.new_price||' ('||rq.code||')')
  where code = rq.sale_code;

  update public.sale_adjust_requests set status='Đã duyệt', approved_by=me.uid, approved_by_name=me.name,
    approved_at=now(), account_id=p_account, cash_txn_code=coalesce(v_pt,''), approve_note=coalesce(p_note,'')
  where id = p_id;
end $$;
