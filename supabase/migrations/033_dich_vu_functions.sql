-- ============================================================
-- Migration 033 — DỊCH VỤ: HAM NGHIEP VU (chot cung cua QT-DV-01)
--  * Khong du 4 anh -> khong tao duoc phieu (Buoc 1)
--  * Xuat vat tu bat buoc gan phieu + dong da duyet; pin tru theo serial
--  * KTV khong nghiem thu phieu minh lam
--  * GIAO XE bi khoa: thu du HOAC cong no duoc duyet
--  * Thu tien: chi nguoi trong danh sach chi dinh cua diem
--  * EOD tu tinh, lech phai co bien ban moi chot; 2 nguoi xac nhan
--  * Khong xoa phieu — chi Huy co ly do (hoan ton vat tu da xuat)
-- Giam gia: nguoi co quyen bao gia duyet + luu vet (KHONG leo thang BGD).
-- Chay SAU 032. Chay lai duoc nhieu lan.
-- ============================================================

create or replace function public._dv_log(p_entity text, p_id text, p_action text, p_old jsonb, p_new jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  insert into public.dv_audit_logs (entity_type, entity_id, action, old_data, new_data, note, acted_by, acted_by_name)
  values (p_entity, p_id, p_action, p_old, p_new, coalesce(p_note,''), me.uid, me.name);
end $$;

-- Tong tien phieu = tong dong da duyet - giam gia; da thu = tong phieu thu
create or replace view public.v_dv_ticket_tong as
select t.id as ticket_id, t.code,
  greatest(coalesce((select sum(l.amount) from public.dv_ticket_lines l where l.ticket_id = t.id and l.approved), 0) - t.discount, 0) as tong,
  coalesce((select sum(p.amount) from public.dv_payments p where p.ticket_id = t.id), 0) as da_thu,
  t.debt_approved
from public.dv_tickets t;

-- ===================== 1) TIEP NHAN =====================
create or replace function public.fn_dv_tao_phieu(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_region text; v_cust bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dv_tiep_nhan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tiếp nhận xe'; end if;
  if coalesce(p->>'location_code','') = '' then raise exception 'THIEU_THONG_TIN: chọn điểm dịch vụ'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách';
  end if;
  if jsonb_array_length(coalesce(p->'photos','[]'::jsonb)) < 4 then
    raise exception 'THIEU_ANH: bắt buộc chụp tối thiểu 4 ảnh xe (trước, sau, hai bên) khi tiếp nhận';
  end if;
  select region into v_region from public.locations where code = p->>'location_code';
  v_cust := nullif(p->>'customer_id','')::bigint;
  if v_cust is null then
    v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', '', coalesce(p->>'customer_address',''), 'Khách lẻ', 'Dịch vụ', me.uid, me.name);
  end if;
  v_code := public.fn_next_code('DV');
  insert into public.dv_tickets (code, location_code, region, customer_id, customer_name, customer_phone,
    frame_number, vehicle_desc, odo_km, battery_pct, assets_note, request_note, photos,
    status, received_by, received_by_name)
  values (v_code, p->>'location_code', v_region, v_cust, p->>'customer_name', p->>'customer_phone',
    coalesce(p->>'frame_number',''), coalesce(p->>'vehicle_desc',''),
    nullif(p->>'odo_km','')::int, nullif(p->>'battery_pct','')::int,
    coalesce(p->>'assets_note',''), coalesce(p->>'request_note',''), coalesce(p->'photos','[]'::jsonb),
    'TIEP_NHAN', me.uid, me.name);
  perform public._dv_log('ticket', v_code, 'tiep_nhan', null, p, '');
  perform public._notify_discord(jsonb_build_object('content',
    '🔧 **Phiếu dịch vụ mới '||v_code||'** · '||(p->>'customer_name')||' ('||(p->>'customer_phone')||') · '||
    coalesce(nullif(p->>'vehicle_desc',''), 'SK '||coalesce(p->>'frame_number','?'))||' · điểm '||(p->>'location_code')||' · '||me.name));
  return v_code;
end $$;

-- Cap nhat chan doan / gan KTV / bo sung anh
create or replace function public.fn_dv_chan_doan(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_chan_doan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền chẩn đoán'; end if;
  select * into t from public.dv_tickets where id = (p->>'id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status not in ('TIEP_NHAN','CHAN_DOAN','CHO_DUYET_GIA','DANG_LAM') then
    raise exception 'TRANG_THAI_SAI: phiếu ở trạng thái % không cập nhật chẩn đoán được', t.status;
  end if;
  update public.dv_tickets set
    ktv_id = coalesce(nullif(p->>'ktv_id','')::uuid, me.uid),
    ktv_name = coalesce(nullif(p->>'ktv_name',''), me.name),
    diagnose_note = coalesce(p->>'diagnose_note', diagnose_note),
    photos = case when p ? 'photos' then coalesce(p->'photos', photos) else photos end,
    status = case when status = 'TIEP_NHAN' then 'CHAN_DOAN' else status end
  where id = t.id;
  perform public._dv_log('ticket', t.code, 'chan_doan', null, p, '');
end $$;

-- ===================== 2) BAO GIA + KHACH DUYET =====================
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
    insert into public.dv_ticket_lines (ticket_id, line_type, service_id, part_id, part_serial,
      name, qty, unit_price, amount, is_phat_sinh, approved, note)
    values (t.id, coalesce(r->>'line_type','CONG'),
      nullif(r->>'service_id','')::bigint, nullif(r->>'part_id','')::bigint, coalesce(r->>'part_serial',''),
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

create or replace function public.fn_dv_khach_duyet(p_id bigint, p_evidence jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_bao_gia') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status <> 'CHO_DUYET_GIA' then raise exception 'TRANG_THAI_SAI: phiếu chưa ở bước chờ duyệt báo giá'; end if;
  if not exists (select 1 from public.dv_ticket_lines where ticket_id = p_id) then
    raise exception 'THIEU_THONG_TIN: báo giá chưa có hạng mục nào';
  end if;
  update public.dv_ticket_lines set approved = true where ticket_id = p_id;
  update public.dv_tickets set
    customer_approved_at = now(),
    customer_approve_evidence = coalesce(p_evidence, customer_approve_evidence),
    status = 'DANG_LAM'
  where id = p_id;
  perform public._dv_log('ticket', t.code, 'khach_duyet', null, null, '');
end $$;

-- ===================== 3) KHO PHU TUNG =====================
create or replace function public.fn_pt_luu_part(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('pt_danh_muc') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa danh mục phụ tùng'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.parts (code, name, group_name, unit, cost_price, sell_price, min_stock, track_serial, note)
    values (upper(p->>'code'), p->>'name', coalesce(p->>'group_name','Phụ tùng'), coalesce(p->>'unit','cái'),
      coalesce((p->>'cost_price')::bigint,0), coalesce((p->>'sell_price')::bigint,0),
      coalesce((p->>'min_stock')::int,0), coalesce((p->>'track_serial')::boolean,false), coalesce(p->>'note',''))
    returning id into v_id;
  else
    update public.parts set name = p->>'name', group_name = coalesce(p->>'group_name', group_name),
      unit = coalesce(p->>'unit', unit), cost_price = coalesce((p->>'cost_price')::bigint, cost_price),
      sell_price = coalesce((p->>'sell_price')::bigint, sell_price),
      min_stock = coalesce((p->>'min_stock')::int, min_stock),
      track_serial = coalesce((p->>'track_serial')::boolean, track_serial),
      status = coalesce(p->>'status', status), note = coalesce(p->>'note', note)
    where id = v_id;
  end if;
  perform public._dv_log('part', v_id::text, 'luu_danh_muc', null, p, '');
  return v_id;
end $$;

create or replace function public.fn_pt_nhap(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; pt record; v_code text; v_qty int; v_before int; s text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('pt_nhap') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập kho phụ tùng'; end if;
  select * into pt from public.parts where id = (p->>'part_id')::bigint;
  if pt is null then raise exception 'KHONG_TIM_THAY: phụ tùng không tồn tại'; end if;
  v_qty := coalesce((p->>'qty')::int, 0);
  if v_qty <= 0 then raise exception 'THAM_SO_SAI: số lượng phải > 0'; end if;
  if pt.track_serial and jsonb_array_length(coalesce(p->'serials','[]'::jsonb)) <> v_qty then
    raise exception 'THIEU_SERIAL: % theo dõi serial — cần đúng % serial', pt.name, v_qty;
  end if;

  insert into public.parts_stock (part_id, location_code, qty) values (pt.id, p->>'location_code', 0)
  on conflict (part_id, location_code) do nothing;
  select qty into v_before from public.parts_stock where part_id = pt.id and location_code = p->>'location_code' for update;

  if pt.track_serial then
    for s in select jsonb_array_elements_text(p->'serials') loop
      if exists (select 1 from public.part_units where serial = s) then
        raise exception 'TRUNG_SERIAL: serial % đã có trên hệ thống', s;
      end if;
      insert into public.part_units (serial, part_id, location_code, status) values (s, pt.id, p->>'location_code', 'TON_KHO');
    end loop;
  end if;

  update public.parts_stock set qty = qty + v_qty, updated_at = now()
  where part_id = pt.id and location_code = p->>'location_code';

  v_code := public.fn_next_code('PNPT');
  insert into public.pt_txns (txn_type, part_id, location_code, qty_change, qty_before, qty_after,
    doc_code, serials, unit_cost, supplier_id, note, by_id, by_name)
  values ('NHAP', pt.id, p->>'location_code', v_qty, v_before, v_before + v_qty,
    v_code, coalesce(p->'serials','[]'::jsonb), coalesce((p->>'unit_cost')::bigint, pt.cost_price),
    nullif(p->>'supplier_id','')::bigint, coalesce(p->>'note',''), me.uid, me.name);
  perform public._dv_log('pt', v_code, 'nhap_kho', null, p, '');
  return v_code;
end $$;

-- XUAT VAT TU CHO PHIEU DV — nguyen tac 03: khong phieu khong xuat
create or replace function public.fn_dv_xuat_vat_tu(p_line_id bigint, p_serials jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; l record; t record; pt record; v_before int; s text; v_n int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('pt_xuat') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền xuất vật tư'; end if;
  select * into l from public.dv_ticket_lines where id = p_line_id for update;
  if l is null then raise exception 'KHONG_TIM_THAY: dòng vật tư không tồn tại'; end if;
  if l.line_type <> 'PHU_TUNG' then raise exception 'THAM_SO_SAI: dòng này không phải phụ tùng kho'; end if;
  if l.exported then raise exception 'TRANG_THAI_SAI: dòng này đã xuất rồi'; end if;
  if not l.approved then raise exception 'CHUA_DUYET: khách chưa duyệt hạng mục này — không được xuất'; end if;
  select * into t from public.dv_tickets where id = l.ticket_id;
  if t.status not in ('DANG_LAM','NGHIEM_THU') then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái thi công'; end if;
  select * into pt from public.parts where id = l.part_id;
  if pt is null then raise exception 'KHONG_TIM_THAY: phụ tùng không còn trong danh mục'; end if;

  select qty into v_before from public.parts_stock where part_id = pt.id and location_code = t.location_code for update;
  if coalesce(v_before, 0) < l.qty then
    raise exception 'THIEU_TON: % tại % chỉ còn % (cần %)', pt.name, t.location_code, coalesce(v_before,0), l.qty;
  end if;

  if pt.track_serial then
    v_n := jsonb_array_length(coalesce(p_serials,'[]'::jsonb));
    if v_n <> l.qty then raise exception 'THIEU_SERIAL: cần chọn đúng % serial cho %', l.qty, pt.name; end if;
    for s in select jsonb_array_elements_text(p_serials) loop
      update public.part_units set status = 'DA_XUAT', ticket_code = t.code, updated_at = now()
      where serial = s and part_id = pt.id and location_code = t.location_code and status = 'TON_KHO';
      if not found then raise exception 'SERIAL_SAI: serial % không tồn kho tại điểm này', s; end if;
    end loop;
    update public.dv_ticket_lines set part_serial = (select string_agg(x, ', ') from jsonb_array_elements_text(p_serials) x) where id = l.id;
  end if;

  update public.parts_stock set qty = qty - l.qty, updated_at = now()
  where part_id = pt.id and location_code = t.location_code;
  insert into public.pt_txns (txn_type, part_id, location_code, qty_change, qty_before, qty_after, doc_code, serials, note, by_id, by_name)
  values ('XUAT_DV', pt.id, t.location_code, -l.qty, v_before, v_before - l.qty, t.code,
    coalesce(p_serials,'[]'::jsonb), l.name, me.uid, me.name);
  update public.dv_ticket_lines set exported = true where id = l.id;
  perform public._dv_log('ticket', t.code, 'xuat_vat_tu', null, jsonb_build_object('line', l.name, 'qty', l.qty), '');
end $$;

-- ===================== 4) NGHIEM THU =====================
create or replace function public.fn_dv_nghiem_thu(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v_chua_xuat int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_nghiem_thu') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nghiệm thu'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status <> 'DANG_LAM' then raise exception 'TRANG_THAI_SAI: phiếu chưa ở bước thi công'; end if;
  if t.ktv_id = me.uid and me.role not in ('ADMIN','CEO') then
    raise exception 'KHONG_CO_QUYEN: kỹ thuật viên thực hiện không được tự nghiệm thu phiếu của mình';
  end if;
  select count(*) into v_chua_xuat from public.dv_ticket_lines
  where ticket_id = p_id and line_type = 'PHU_TUNG' and approved and not exported;
  if v_chua_xuat > 0 then
    raise exception 'CHUA_XUAT_KHO: còn % dòng phụ tùng đã duyệt nhưng chưa xuất kho — xuất trước khi nghiệm thu', v_chua_xuat;
  end if;
  update public.dv_tickets set status = 'CHO_THANH_TOAN', qc_by = me.uid, qc_by_name = me.name,
    qc_at = now(), qc_note = coalesce(p_note,'') where id = p_id;
  perform public._dv_log('ticket', t.code, 'nghiem_thu', null, null, p_note);
end $$;

-- ===================== 5) THU TIEN + CONG NO =====================
create or replace function public.fn_dv_thu_tien(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; t record; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_thu_tien') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền thu tiền'; end if;
  select * into t from public.dv_tickets where id = (p->>'ticket_id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;
  if me.role not in ('ADMIN','CEO') and not exists (
    select 1 from public.dv_collectors c where c.user_id = me.uid and c.location_code = t.location_code and c.active
  ) then
    raise exception 'KHONG_TRONG_DANH_SACH: bạn chưa được chỉ định thu tiền tại điểm % — nhờ CHT gán trong Cài đặt', t.location_code;
  end if;
  if coalesce((p->>'amount')::bigint, 0) <= 0 then raise exception 'THAM_SO_SAI: số tiền phải > 0'; end if;
  if (p->>'method') = 'Tiền mặt' and jsonb_array_length(coalesce(p->'evidence','[]'::jsonb)) = 0 then
    raise exception 'THIEU_ANH: thu tiền mặt bắt buộc chụp ảnh phiếu thu/giao dịch';
  end if;
  v_code := public.fn_next_code('PTDV');
  insert into public.dv_payments (code, ticket_id, method, amount, evidence, collected_by, collected_by_name, note)
  values (v_code, t.id, p->>'method', (p->>'amount')::bigint, coalesce(p->'evidence','[]'::jsonb), me.uid, me.name, coalesce(p->>'note',''));
  perform public._dv_log('ticket', t.code, 'thu_tien', null, jsonb_build_object('code', v_code, 'method', p->>'method', 'amount', p->>'amount'), '');
  perform public._notify_discord(jsonb_build_object('content',
    '💵 **Thu tiền DV** '||v_code||' · phiếu '||t.code||' · '||(p->>'method')||' '||(p->>'amount')||'đ · '||me.name||' · điểm '||t.location_code));
  return v_code;
end $$;

create or replace function public.fn_dv_duyet_cong_no(p_id bigint, p_amount bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_eod') then raise exception 'KHONG_CO_QUYEN: chỉ Cửa hàng trưởng/BGĐ được duyệt công nợ'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'THAM_SO_SAI'; end if;
  if coalesce(btrim(p_note),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc ghi lý do/điều kiện công nợ'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  update public.dv_tickets set debt_approved = p_amount, debt_by = me.uid, debt_by_name = me.name, debt_note = p_note where id = p_id;
  perform public._dv_log('ticket', t.code, 'duyet_cong_no', null, jsonb_build_object('amount', p_amount), p_note);
end $$;

-- ===================== 6) GIAO XE + HUY =====================
create or replace function public.fn_dv_giao_xe(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_giao_xe') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền giao xe'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status <> 'CHO_THANH_TOAN' then raise exception 'TRANG_THAI_SAI: phiếu chưa nghiệm thu xong'; end if;
  select * into v from public.v_dv_ticket_tong where ticket_id = p_id;
  if v.da_thu + v.debt_approved < v.tong then
    raise exception 'CHUA_DU_TIEN: phải thu %đ, đã thu %đ, công nợ duyệt %đ — thu đủ hoặc duyệt công nợ trước khi giao xe',
      v.tong, v.da_thu, v.debt_approved;
  end if;
  update public.dv_tickets set status = 'DA_GIAO', delivered_at = now(), delivered_by = me.uid, delivered_by_name = me.name where id = p_id;
  perform public._dv_log('ticket', t.code, 'giao_xe', null, null, '');
  perform public._notify_discord(jsonb_build_object('content',
    '✅ **Đã giao xe** phiếu '||t.code||' · '||t.customer_name||' ('||t.customer_phone||') · tổng '||v.tong||'đ (thu '||v.da_thu||'đ, công nợ '||v.debt_approved||'đ) · '||me.name));
end $$;

create or replace function public.fn_dv_huy_phieu(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; l record; v_before int; s text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_huy_phieu') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được hủy phiếu'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: bắt buộc nhập lý do hủy'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status = 'DA_GIAO' then raise exception 'TRANG_THAI_SAI: phiếu đã giao xe — không hủy được'; end if;
  if exists (select 1 from public.dv_payments where ticket_id = p_id) then
    raise exception 'DA_CO_TIEN: phiếu đã có phiếu thu — xử lý hoàn tiền/đối soát trước khi hủy';
  end if;
  for l in select * from public.dv_ticket_lines where ticket_id = p_id and exported loop
    select qty into v_before from public.parts_stock where part_id = l.part_id and location_code = t.location_code for update;
    update public.parts_stock set qty = qty + l.qty, updated_at = now() where part_id = l.part_id and location_code = t.location_code;
    if coalesce(l.part_serial,'') <> '' then
      foreach s in array string_to_array(l.part_serial, ', ') loop
        update public.part_units set status = 'TON_KHO', ticket_code = '', updated_at = now() where serial = s;
      end loop;
    end if;
    insert into public.pt_txns (txn_type, part_id, location_code, qty_change, qty_before, qty_after, doc_code, note, by_id, by_name)
    values ('HOAN_TRA', l.part_id, t.location_code, l.qty, coalesce(v_before,0), coalesce(v_before,0) + l.qty, t.code,
      'Hủy phiếu: '||p_ly_do, me.uid, me.name);
  end loop;
  update public.dv_tickets set status = 'HUY', cancel_reason = p_ly_do where id = p_id;
  perform public._dv_log('ticket', t.code, 'huy_phieu', jsonb_build_object('status', t.status), null, p_ly_do);
end $$;

-- ===================== 7) NGUOI THU + EOD + DANH MUC =====================
create or replace function public.fn_dv_gan_nguoi_thu(p_user uuid, p_loc text, p_primary boolean, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_role text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_eod') then raise exception 'KHONG_CO_QUYEN: chỉ CHT/BGĐ được gán người thu tiền'; end if;
  select role into v_role from public.profiles where id = p_user;
  if v_role = 'TECHNICIAN' then raise exception 'KHONG_HOP_LE: kỹ thuật viên không được nằm trong danh sách thu tiền (QT mục 7.2)'; end if;
  insert into public.dv_collectors (user_id, location_code, is_primary, active)
  values (p_user, p_loc, coalesce(p_primary, true), coalesce(p_active, true))
  on conflict (user_id, location_code) do update set is_primary = excluded.is_primary, active = excluded.active;
  perform public._dv_log('collector', p_user::text || '/' || p_loc, 'gan_nguoi_thu', null,
    jsonb_build_object('primary', p_primary, 'active', p_active), '');
end $$;

create or replace function public.fn_dv_eod_tinh(p_loc text, p_date date)
returns public.dv_eod language plpgsql security definer set search_path = public as $$
declare me record; e public.dv_eod;
  v_phieu int; v_phai_thu bigint; v_ck bigint; v_tm bigint; v_no bigint; v_luu int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_eod') then raise exception 'KHONG_CO_QUYEN'; end if;
  select count(*), coalesce(sum(v.tong),0), coalesce(sum(v.debt_approved),0)
    into v_phieu, v_phai_thu, v_no
  from public.dv_tickets t join public.v_dv_ticket_tong v on v.ticket_id = t.id
  where t.location_code = p_loc and t.status = 'DA_GIAO'
    and (t.delivered_at at time zone 'Asia/Ho_Chi_Minh')::date = p_date;
  select coalesce(sum(amount) filter (where method = 'Chuyển khoản'), 0),
         coalesce(sum(amount) filter (where method = 'Tiền mặt'), 0)
    into v_ck, v_tm
  from public.dv_payments p join public.dv_tickets t on t.id = p.ticket_id
  where t.location_code = p_loc and (p.created_at at time zone 'Asia/Ho_Chi_Minh')::date = p_date;
  select count(*) into v_luu from public.dv_tickets
  where location_code = p_loc and status not in ('DA_GIAO','HUY');

  insert into public.dv_eod (location_code, eod_date, so_phieu_dong, phai_thu, thu_ck, thu_tm, cong_no, lech, xe_luu)
  values (p_loc, p_date, v_phieu, v_phai_thu, v_ck, v_tm, v_no, v_phai_thu - v_ck - v_tm - v_no, v_luu)
  on conflict (location_code, eod_date) do update set
    so_phieu_dong = excluded.so_phieu_dong, phai_thu = excluded.phai_thu,
    thu_ck = excluded.thu_ck, thu_tm = excluded.thu_tm, cong_no = excluded.cong_no,
    lech = excluded.lech, xe_luu = excluded.xe_luu, updated_at = now()
  returning * into e;
  return e;
end $$;

create or replace function public.fn_dv_eod_chot(p_loc text, p_date date, p_vai text, p_bien_ban text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; e record;
begin
  select * into me from public.fn_me_mkt();
  perform public.fn_dv_eod_tinh(p_loc, p_date);
  select * into e from public.dv_eod where location_code = p_loc and eod_date = p_date for update;
  if e.status = 'DA_CHOT' then raise exception 'TRANG_THAI_SAI: ngày này đã chốt'; end if;
  if e.lech <> 0 and coalesce(btrim(p_bien_ban),'') = '' and coalesce(btrim(e.bien_ban_note),'') = '' then
    raise exception 'CO_LECH: lệch %đ — bắt buộc lập biên bản chênh lệch (BM-DV-07) trước khi chốt', e.lech;
  end if;
  if p_vai = 'thu' then
    if not public.fn_co_quyen('dv_thu_tien') then raise exception 'KHONG_CO_QUYEN'; end if;
    update public.dv_eod set confirmed_thu_by = me.uid, confirmed_thu_name = me.name, confirmed_thu_at = now(),
      bien_ban_note = coalesce(nullif(p_bien_ban,''), bien_ban_note) where id = e.id;
  elsif p_vai = 'cht' then
    if not public.fn_co_quyen('dv_eod') then raise exception 'KHONG_CO_QUYEN'; end if;
    update public.dv_eod set confirmed_cht_by = me.uid, confirmed_cht_name = me.name, confirmed_cht_at = now(),
      bien_ban_note = coalesce(nullif(p_bien_ban,''), bien_ban_note) where id = e.id;
  else
    raise exception 'THAM_SO_SAI: vai phải là thu hoặc cht';
  end if;
  select * into e from public.dv_eod where id = e.id;
  if e.confirmed_thu_at is not null and e.confirmed_cht_at is not null then
    update public.dv_eod set status = 'DA_CHOT' where id = e.id;
    perform public._notify_discord(jsonb_build_object('content',
      '📋 **EOD Dịch vụ '||p_loc||' ngày '||p_date||'**: '||e.so_phieu_dong||' phiếu · phải thu '||e.phai_thu||
      'đ · CK '||e.thu_ck||'đ · TM '||e.thu_tm||'đ · công nợ '||e.cong_no||'đ · lệch '||e.lech||'đ'||
      case when e.lech <> 0 then ' ⚠️ CÓ LỆCH — xem biên bản' else ' ✓' end));
  end if;
  perform public._dv_log('eod', p_loc || '/' || p_date, 'chot_' || p_vai, null, null, p_bien_ban);
end $$;

create or replace function public.fn_dv_luu_service(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.fn_co_quyen('pt_danh_muc') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa bảng giá dịch vụ'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.dv_services (code, name, group_name, price, note)
    values (upper(p->>'code'), p->>'name', coalesce(p->>'group_name','Chung'), coalesce((p->>'price')::bigint,0), coalesce(p->>'note',''))
    returning id into v_id;
  else
    update public.dv_services set name = p->>'name', group_name = coalesce(p->>'group_name', group_name),
      price = coalesce((p->>'price')::bigint, price), status = coalesce(p->>'status', status), note = coalesce(p->>'note', note)
    where id = v_id;
  end if;
  return v_id;
end $$;
