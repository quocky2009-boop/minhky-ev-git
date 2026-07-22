-- ============================================================
-- Migration 031 — HINH THUC THANH TOAN THEO TUNG DONG
-- Giá xe dung sales_orders.payment_method (da co).
-- Moi mon ban kem them cot payment_method rieng.
-- fn_ban_hang doc it->>'payment_method' cho tung mon.
-- Chay SAU 030. Chay lai duoc nhieu lan.
-- ============================================================

alter table public.sale_items add column if not exists payment_method text not null default 'Chuyển khoản';

-- Viet lai fn_ban_hang: giu nguyen logic, chi bo sung payment_method cho sale_items
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
        v_frames text[]; v_cust bigint; it jsonb;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tạo đơn bán'; end if;
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
      insert into public.sale_items (sale_code, item_type, name, qty, unit_price, amount, payment_method)
      values (v_code, coalesce(nullif(it->>'item_type',''),'PHU_KIEN'), trim(it->>'name'),
              greatest(coalesce((it->>'qty')::int,1),1), coalesce((it->>'unit_price')::bigint,0),
              greatest(coalesce((it->>'qty')::int,1),1) * coalesce((it->>'unit_price')::bigint,0),
              coalesce(nullif(it->>'payment_method',''), coalesce(p->>'payment_method','Chuyển khoản')));
    end if;
  end loop;
  return v_code;
end $$;

-- View tong hop tien theo hinh thuc thanh toan (phuc vu doi chieu dong tien)
-- Gop giá xe (theo payment_method cua don) + tung mon ban kem (theo payment_method rieng)
create or replace view public.v_thu_theo_httt as
select sale_code, payment_method, sum(amount) as tong from (
  select code as sale_code, coalesce(payment_method,'Chuyển khoản') as payment_method,
         sale_price * quantity as amount
  from public.sales_orders
  union all
  select sale_code, coalesce(payment_method,'Chuyển khoản'), amount
  from public.sale_items
) t
group by sale_code, payment_method;
