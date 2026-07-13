-- ============================================================
-- Migration 017: TRUONG THANH TOAN TRA CUU tren don ban
-- (da thanh toan / con lai / trang thai) — chi de tra cuu,
-- KHONG phai so quy. Kem file 017_rollback.sql de dao nguoc.
-- Chay SAU 016, 1 lan duy nhat.
-- ============================================================

alter table public.sales_orders add column if not exists paid_amount bigint not null default 0;

-- BAN HANG: nhan them "da thanh toan" (mac dinh 0)
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
        v_frames text[]; v_cust bigint; it jsonb;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  n := coalesce(array_length(v_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe theo số khung'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
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
  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', p->>'customer_cccd',
    p->>'customer_address', p->>'customer_type', p->>'customer_source', me.uid, me.name);
  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, paid_amount, payment_method, seller_id, seller_name, document_status, note, extra, customer_id)
  values (v_code, p->>'location_code', p->>'vehicle_id', n, array_to_string(v_frames,', '),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), coalesce((p->>'sale_price')::bigint, v_list, 0),
    greatest(coalesce((p->>'paid_amount')::bigint, 0), 0),
    coalesce(p->>'payment_method','Chuyển khoản'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''),
    coalesce(p->'extra','{}'::jsonb), v_cust);
  for it in select jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if coalesce(trim(it->>'name'),'') <> '' and coalesce((it->>'unit_price')::bigint,0) >= 0 then
      insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount)
      values (v_code, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
              greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
              greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0));
    end if;
  end loop;
  return v_code;
end $$;

-- Cap nhat "da thanh toan" sau ban (khach tra not) — CEO/Admin/Quan ly, luu vet vao ghi chu
create or replace function public.fn_cap_nhat_thanh_toan(p_id bigint, p_paid bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','ADMIN','MANAGER') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ được cập nhật thanh toán'; end if;
  if p_paid is null or p_paid < 0 then raise exception 'SO_LUONG_SAI: số tiền không hợp lệ'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.paid_amount = p_paid then return; end if;
  update public.sales_orders set
    paid_amount = p_paid,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Đã TT '||o.paid_amount||' → '||p_paid||' ('||me.name||' '||to_char(now() at time zone 'Asia/Ho_Chi_Minh','DD/MM HH24:MI')||')')
  where id = p_id;
end $$;
