-- ============================================================
-- Migration 077 — LIÊN KẾT PHIẾU DỊCH VỤ VỚI HÀNG HÓA (products)
--  Phieu dich vu gio co the ban kem hang hoa (phu kien/qua tang)
--  ngoai phu tung sua chua (parts) da co san.
--  Them line_type 'HANG_HOA' + product_id vao dv_ticket_lines
--  Them fn_dv_xuat_hang_hoa: tru ton products khi xuat dong HANG_HOA
-- Chạy SAU 076. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) MỞ RỘNG dv_ticket_lines =====================
alter table public.dv_ticket_lines drop constraint if exists dv_ticket_lines_line_type_check;
alter table public.dv_ticket_lines add constraint dv_ticket_lines_line_type_check
  check (line_type in ('CONG','PHU_TUNG','HANG_HOA','THUE_NGOAI','HANG_KHACH'));

alter table public.dv_ticket_lines add column if not exists product_id bigint references public.products(id);
create index if not exists dv_lines_product_idx on public.dv_ticket_lines (product_id) where product_id is not null;

-- ===================== 2) HÀM XUẤT HÀNG HÓA CHO DÒNG HANG_HOA =====================
create or replace function public.fn_dv_xuat_hang_hoa(p_line_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; l record; t record; prod record; v_before int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('pt_xuat') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền xuất hàng hóa'; end if;
  select * into l from public.dv_ticket_lines where id = p_line_id for update;
  if l is null then raise exception 'KHONG_TIM_THAY: dòng hàng hóa không tồn tại'; end if;
  if l.line_type <> 'HANG_HOA' then raise exception 'THAM_SO_SAI: dòng này không phải hàng hóa'; end if;
  if l.exported then raise exception 'TRANG_THAI_SAI: dòng này đã xuất rồi'; end if;
  if not l.approved then raise exception 'CHUA_DUYET: khách chưa duyệt hạng mục này — không được xuất'; end if;
  select * into t from public.dv_tickets where id = l.ticket_id;
  if t.status not in ('DANG_LAM','NGHIEM_THU') then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái thi công'; end if;
  select * into prod from public.products where id = l.product_id for update;
  if prod is null then raise exception 'KHONG_TIM_THAY: sản phẩm không còn trong danh mục'; end if;

  if prod.stock_qty < l.qty then
    raise exception 'THIEU_TON: % chỉ còn % %, cần % %', prod.name, prod.stock_qty, prod.unit, l.qty, prod.unit;
  end if;

  v_before := prod.stock_qty;
  update public.products set stock_qty = stock_qty - l.qty, updated_at = now() where id = prod.id;
  insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
    unit_price, ref_code, note, created_by, created_by_name)
  values (prod.id, 'Xuất', l.qty, v_before, v_before - l.qty,
    l.unit_price, t.code, 'Bán kèm phiếu dịch vụ ' || t.code, me.uid, me.name);

  update public.dv_ticket_lines set exported = true where id = l.id;
  perform public._dv_log('ticket', t.code, 'xuat_hang_hoa', null, jsonb_build_object('line', l.name, 'qty', l.qty), '');
end $$;

-- ===================== 3) HOÀN TỒN KHI XÓA DÒNG / HỦY PHIẾU =====================
create or replace function public._trg_dv_line_hoan_ton()
returns trigger language plpgsql security definer set search_path = public as $$
declare prod record; v_before int;
begin
  if OLD.line_type = 'HANG_HOA' and OLD.product_id is not null and OLD.exported then
    select * into prod from public.products where id = OLD.product_id for update;
    if prod is not null then
      v_before := prod.stock_qty;
      update public.products set stock_qty = stock_qty + OLD.qty, updated_at = now() where id = OLD.product_id;
      insert into public.product_txns (product_id, txn_type, qty, stock_before, stock_after,
        unit_price, ref_code, note, created_by, created_by_name)
      values (OLD.product_id, 'Nhập', OLD.qty, v_before, v_before + OLD.qty,
        OLD.unit_price, (select code from public.dv_tickets where id = OLD.ticket_id),
        'Hoàn tồn do xóa hạng mục / hủy phiếu dịch vụ',
        (select id from public.profiles where id = auth.uid() limit 1),
        (select name from public.profiles where id = auth.uid() limit 1));
    end if;
  end if;
  return OLD;
end $$;

drop trigger if exists trg_dv_line_hoan_ton on public.dv_ticket_lines;
create trigger trg_dv_line_hoan_ton
  before delete on public.dv_ticket_lines
  for each row execute function public._trg_dv_line_hoan_ton();

-- ===================== 4) CẬP NHẬT fn_dv_luu_bao_gia: thêm product_id =====================
create or replace function public.fn_dv_luu_bao_gia(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; r jsonb; v_ps boolean;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_bao_gia') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền lập báo giá'; end if;
  select * into t from public.dv_tickets where id = (p->>'id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;
  v_ps := t.customer_approved_at is not null;

  delete from public.dv_ticket_lines where ticket_id = t.id and exported = false;
  for r in select jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    if coalesce(trim(r->>'name'),'') = '' then continue; end if;
    insert into public.dv_ticket_lines (ticket_id, line_type, service_id, part_id, product_id, part_serial,
      name, qty, unit_price, amount, is_phat_sinh, approved, note)
    values (t.id, coalesce(r->>'line_type','CONG'),
      nullif(r->>'service_id','')::bigint, nullif(r->>'part_id','')::bigint,
      nullif(r->>'product_id','')::bigint, coalesce(r->>'part_serial',''),
      trim(r->>'name'), greatest(coalesce((r->>'qty')::int,1),1), coalesce((r->>'unit_price')::bigint,0),
      greatest(coalesce((r->>'qty')::int,1),1) * coalesce((r->>'unit_price')::bigint,0),
      v_ps, false, coalesce(r->>'note',''));
  end loop;

  update public.dv_tickets set
    discount = coalesce((p->>'discount')::bigint, discount),
    discount_by = case when p ? 'discount' then me.uid else discount_by end,
    discount_by_name = case when p ? 'discount' then me.name else discount_by_name end,
    discount_note = coalesce(p->>'discount_note', discount_note),
    status = 'CHO_DUYET_GIA'
  where id = t.id;
  perform public._dv_log('ticket', t.code, 'bao_gia', null, p, '');
end $$;

do $do$
begin
  raise notice 'XONG 077: dv_ticket_lines them line_type HANG_HOA + product_id; fn_dv_xuat_hang_hoa; hoan ton khi xoa dong; fn_dv_luu_bao_gia them product_id';
end $do$;
