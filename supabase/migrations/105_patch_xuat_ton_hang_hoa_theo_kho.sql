-- ============================================================
-- Migration 105: Sửa lại 3 nơi đang xuất tồn hàng hóa qua cột phẳng
-- products.stock_qty (bỏ qua kho) để trừ ĐÚNG THEO KHO trong
-- products_stock — khớp với mô hình tách kho mới (migration 104).
--
-- 3 nơi cần sửa:
--  1) _trg_sale_item_hang_hoa — bán kèm hàng hóa trong đơn bán xe,
--     trừ theo sales_orders.location_code (điểm bán).
--  2) fn_dv_xuat_hang_hoa — xuất hàng hóa khi nghiệm thu phiếu dịch
--     vụ, trừ theo dv_tickets.location_code.
--  3) _trg_dv_line_hoan_ton — hoàn tồn khi xóa dòng/hủy phiếu dịch vụ.
--
-- products.stock_qty vẫn được cập nhật song song (không xóa, giữ để
-- không phá vỡ chỗ nào còn đọc cột cũ) nhưng KHÔNG còn là nguồn sự
-- thật — products_stock theo từng kho mới là nguồn đúng.
-- Chạy sau 104. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- 1) Bán kèm hàng hóa trong đơn bán xe ----------
create or replace function public._trg_sale_item_hang_hoa()
returns trigger language plpgsql security definer set search_path = public as $$
declare prod record; v_before int; v_loc text; v_stock int;
begin
  if TG_OP = 'INSERT' then
    if NEW.product_id is not null then
      select * into prod from public.products where id = NEW.product_id for update;
      if prod is not null then
        select o.location_code into v_loc from public.sales_orders o where o.code = NEW.sale_code;
        select coalesce(qty,0) into v_stock from public.products_stock where product_id = NEW.product_id and location_code = v_loc;
        v_stock := coalesce(v_stock, 0);
        if v_stock < NEW.qty then
          raise exception 'KHONG_DU_TON: % chỉ còn % % tại kho bán, cần % %',
            prod.name, v_stock, prod.unit, NEW.qty, prod.unit;
        end if;
        v_before := v_stock;
        update public.products_stock set qty = v_stock - NEW.qty, updated_at = now()
        where product_id = NEW.product_id and location_code = v_loc;
        update public.products set stock_qty = greatest(stock_qty - NEW.qty, 0), updated_at = now()
        where id = NEW.product_id;
        insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
          unit_price, ref_code, location_code, note, created_by, created_by_name)
        values (NEW.product_id, 'Xuất', NEW.qty, v_before, v_before - NEW.qty,
          NEW.unit_price, NEW.sale_code, v_loc, 'Bán kèm đơn ' || NEW.sale_code,
          (select id from public.profiles where id = auth.uid() limit 1),
          (select name from public.profiles where id = auth.uid() limit 1));
      end if;
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    if OLD.product_id is not null then
      select * into prod from public.products where id = OLD.product_id for update;
      if prod is not null then
        select o.location_code into v_loc from public.sales_orders o where o.code = OLD.sale_code;
        select coalesce(qty,0) into v_stock from public.products_stock where product_id = OLD.product_id and location_code = v_loc;
        v_stock := coalesce(v_stock, 0);
        v_before := v_stock;
        insert into public.products_stock (product_id, location_code, qty)
        values (OLD.product_id, v_loc, v_stock + OLD.qty)
        on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();
        update public.products set stock_qty = stock_qty + OLD.qty, updated_at = now()
        where id = OLD.product_id;
        insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
          unit_price, ref_code, location_code, note, created_by, created_by_name)
        values (OLD.product_id, 'Nhập', OLD.qty, v_before, v_before + OLD.qty,
          OLD.unit_price, OLD.sale_code, v_loc, 'Hoàn tồn khi sửa/hủy đơn ' || OLD.sale_code,
          (select id from public.profiles where id = auth.uid() limit 1),
          (select name from public.profiles where id = auth.uid() limit 1));
      end if;
    end if;
    return OLD;
  end if;
  return null;
end $$;

-- ---------- 2) Xuất hàng hóa khi nghiệm thu phiếu dịch vụ ----------
create or replace function public.fn_dv_xuat_hang_hoa(p_line_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; l record; t record; prod record; v_before int; v_loc text; v_stock int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;

  select * into l from public.dv_ticket_lines where id = p_line_id for update;
  if l is null then raise exception 'KHONG_TIM_THAY: dòng hàng hóa không tồn tại'; end if;
  if l.line_type <> 'HANG_HOA' then raise exception 'THAM_SO_SAI: dòng này không phải hàng hóa'; end if;
  if l.exported then raise exception 'TRANG_THAI_SAI: dòng này đã xuất rồi'; end if;
  if not l.approved then raise exception 'CHUA_DUYET: khách chưa duyệt hạng mục này — không được xuất'; end if;
  select * into t from public.dv_tickets where id = l.ticket_id;
  if t.status not in ('DANG_LAM','NGHIEM_THU') then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái thi công'; end if;
  select * into prod from public.products where id = l.product_id for update;
  if prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm không còn trong danh mục'; end if;

  v_loc := t.location_code;
  select coalesce(qty,0) into v_stock from public.products_stock where product_id = prod.id and location_code = v_loc;
  v_stock := coalesce(v_stock, 0);
  if v_stock < l.qty then
    raise exception 'THIEU_TON: % chỉ còn % % tại kho phiếu dịch vụ, cần % %', prod.name, v_stock, prod.unit, l.qty, prod.unit;
  end if;

  v_before := v_stock;
  update public.products_stock set qty = v_stock - l.qty, updated_at = now()
  where product_id = prod.id and location_code = v_loc;
  update public.products set stock_qty = greatest(stock_qty - l.qty, 0), updated_at = now() where id = prod.id;

  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    unit_price, ref_code, location_code, note, created_by, created_by_name)
  values (prod.id, 'Xuất', l.qty, v_before, v_before - l.qty,
    l.unit_price, t.code, v_loc, 'Bán kèm phiếu dịch vụ ' || t.code, me.uid, me.name);

  update public.dv_ticket_lines set exported = true where id = l.id;
  perform public._dv_log('ticket', t.code, 'xuat_hang_hoa', null, jsonb_build_object('line', l.name, 'qty', l.qty), '');
end $$;

-- ---------- 3) Hoàn tồn khi xóa dòng/hủy phiếu dịch vụ ----------
create or replace function public._trg_dv_line_hoan_ton()
returns trigger language plpgsql security definer set search_path = public as $$
declare prod record; v_before int; v_loc text; v_stock int;
begin
  if OLD.line_type = 'HANG_HOA' and OLD.product_id is not null and OLD.exported then
    select * into prod from public.products where id = OLD.product_id for update;
    if prod is not null then
      select location_code into v_loc from public.dv_tickets where id = OLD.ticket_id;
      select coalesce(qty,0) into v_stock from public.products_stock where product_id = OLD.product_id and location_code = v_loc;
      v_stock := coalesce(v_stock, 0);
      v_before := v_stock;
      insert into public.products_stock (product_id, location_code, qty)
      values (OLD.product_id, v_loc, v_stock + OLD.qty)
      on conflict (product_id, location_code) do update set qty = excluded.qty, updated_at = now();
      update public.products set stock_qty = stock_qty + OLD.qty, updated_at = now() where id = OLD.product_id;
      insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
        unit_price, ref_code, location_code, note, created_by, created_by_name)
      values (OLD.product_id, 'Nhập', OLD.qty, v_before, v_before + OLD.qty,
        OLD.unit_price, (select code from public.dv_tickets where id = OLD.ticket_id), v_loc,
        'Hoàn tồn do xóa hạng mục / hủy phiếu dịch vụ',
        (select id from public.profiles where id = auth.uid() limit 1),
        (select name from public.profiles where id = auth.uid() limit 1));
    end if;
  end if;
  return OLD;
end $$;
