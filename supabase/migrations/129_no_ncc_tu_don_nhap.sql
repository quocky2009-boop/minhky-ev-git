-- 129_no_ncc_tu_don_nhap.sql
-- Muc dich: tu dong sinh cong no NCC (supplier_debts) tu fn_nhap_hang_v2 khi don nhap
-- co danh dau "tra cham/bao lanh", thay vi phai nhap tay qua fn_tao_no_ncc nhu hien tai.
--
-- Nghiep vu da chot voi anh Ky:
-- 1. Tra cham la TUY DON. Ke toan tick luc nhap hang, gui them p->'cong_no':
--      { "co_tra_cham": true, "so_ngay": [10,20,30], "ty_le": [30,30,40] }
--    (so_ngay va ty_le cung do dai, tuy chinh duoc, khong co dinh 3 dot).
-- 2. Neu nhieu dot -> tao NHIEU dong supplier_debts cung import_doc (= ma phieu nhap),
--    khac due_date va tong_tien theo ty le. Dong cuoi lay phan con lai de tranh lech
--    do lam tron (vi du 3 dot 33/33/34%).
-- 3. Nguoi tick la Ke toan (role ADMIN) luc nhap hang -> dung quyen fn_tao_no_ncc
--    (CEO/MANAGER/ADMIN) da co san, khong doi.
--
-- KHONG doi chu ky ham (van la fn_nhap_hang_v2(p jsonb)) -> khong can DROP FUNCTION,
-- CREATE OR REPLACE la du. Toan bo logic nhap kho/so khung/PO giu nguyen 100%,
-- chi them 1 khoi o cuoi truoc phan bao Discord.

CREATE OR REPLACE FUNCTION public.fn_nhap_hang_v2(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me record; v_doc text; ln jsonb; f text; v_loc text;
  v_before int; v_n int := 0; v_xe int := 0; v_von bigint := 0;
  v_frames text[]; v_cost bigint; v_nv_id uuid; v_nv_name text;
  v_po_id bigint; v_line record; v_recv int; v_all_done boolean; v_any_recv boolean;
  -- them cho cong no NCC
  v_cn jsonb; v_so_ngay jsonb; v_ty_le jsonb; v_n_dot int; v_i int;
  v_tong_da_chia bigint; v_tien_dot bigint; v_due date; v_no_code text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập hàng'; end if;

  v_nv_id := nullif(p->>'nguoi_nhap_id','')::uuid;
  if v_nv_id is not null and exists (select 1 from public.profiles where id = v_nv_id) then
    select name into v_nv_name from public.profiles where id = v_nv_id;
  else
    v_nv_id := me.uid; v_nv_name := me.name;
  end if;

  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'THIEU_DONG: chưa có dòng hàng nào';
  end if;
  v_loc := p->>'location_code';
  if coalesce(v_loc,'') = '' then raise exception 'THIEU_THONG_TIN: chọn kho nhập'; end if;

  v_po_id := nullif(p->>'po_id','')::bigint;
  if v_po_id is not null and not exists (select 1 from public.purchase_orders where id = v_po_id) then
    v_po_id := null;
  end if;

  v_doc := coalesce(nullif(p->>'doc',''), public.fn_next_code('PN'));

  for ln in select jsonb_array_elements(p->'lines') loop
    if coalesce(ln->>'vehicle_id','') = '' then continue; end if;

    select array_agg(x) into v_frames
    from jsonb_array_elements_text(coalesce(ln->'frames','[]'::jsonb)) x;
    if coalesce(array_length(v_frames,1),0) = 0 then
      raise exception 'THIEU_SO_KHUNG: dòng % chưa có số khung nào', ln->>'vehicle_id';
    end if;

    v_cost := coalesce((ln->>'cost_price')::bigint, 0);
    v_before := public._count_at(ln->>'vehicle_id', v_loc);

    foreach f in array v_frames loop
      f := upper(btrim(f));
      if f = '' then continue; end if;
      if exists (select 1 from public.vehicle_units where frame_number = f) then
        raise exception 'TRUNG_SO_KHUNG: số khung % đã có trên hệ thống', f;
      end if;
      insert into public.vehicle_units (frame_number, vehicle_id, location_code, status,
        cost_price, imported_at, import_doc, note)
      values (f, ln->>'vehicle_id', v_loc, 'TON_KHO', v_cost, now(), v_doc,
        coalesce(ln->>'note',''));
      v_n := v_n + 1;
      v_von := v_von + v_cost;
    end loop;

    if v_cost > 0 then
      update public.vehicles set default_cost = v_cost where id = ln->>'vehicle_id';
    end if;

    -- Cap nhat SL da nhan cho dong don dat hang tuong ung (neu co lien ket)
    if v_po_id is not null then
      update public.purchase_order_lines
      set qty_received = qty_received + array_length(v_frames,1)
      where po_id = v_po_id and vehicle_id = ln->>'vehicle_id';
    end if;

    perform public._log_txn('Nhập hàng', ln->>'vehicle_id', null, v_loc,
      array_length(v_frames,1), v_before, v_before + array_length(v_frames,1), v_doc,
      trim(concat(
        case when coalesce(p->>'supplier','') <> '' then concat('NCC: ', p->>'supplier', ' · ') else '' end,
        'SK: ', array_to_string(v_frames, ', '),
        case when v_cost > 0 then concat(' · giá vốn ', v_cost, 'đ/xe') else '' end,
        case when coalesce(p->>'note','') <> '' then concat(' · ', p->>'note') else '' end)),
      v_nv_id, v_nv_name);
    v_xe := v_xe + 1;
  end loop;

  if v_n = 0 then raise exception 'THIEU_SO_KHUNG: không có số khung hợp lệ nào'; end if;

  -- Cap nhat trang thai don dat hang lien ket
  if v_po_id is not null then
    v_all_done := true; v_any_recv := false;
    for v_line in select * from public.purchase_order_lines where po_id = v_po_id loop
      if v_line.qty_received > 0 then v_any_recv := true; end if;
      if v_line.qty_received < v_line.qty_ordered then v_all_done := false; end if;
    end loop;
    update public.purchase_orders set
      status = case when v_all_done then 'Hoàn thành' when v_any_recv then 'Nhập một phần' else status end,
      updated_at = now()
    where id = v_po_id;
  end if;

  -- ===== MOI: tu sinh cong no NCC neu don nhap co danh dau tra cham/bao lanh =====
  v_cn := p->'cong_no';
  if v_cn is not null and coalesce((v_cn->>'co_tra_cham')::boolean, false) and v_von > 0 then
    v_so_ngay := coalesce(v_cn->'so_ngay', '[]'::jsonb);
    v_ty_le   := coalesce(v_cn->'ty_le', '[]'::jsonb);
    v_n_dot := jsonb_array_length(v_so_ngay);

    if v_n_dot = 0 or v_n_dot <> jsonb_array_length(v_ty_le) then
      raise exception 'THIEU_THONG_TIN: cong_no.so_ngay và cong_no.ty_le phải có cùng số đợt và > 0';
    end if;

    v_tong_da_chia := 0;
    for v_i in 0 .. v_n_dot - 1 loop
      v_due := (now() + make_interval(days => (v_so_ngay->v_i)::int))::date;
      if v_i < v_n_dot - 1 then
        v_tien_dot := round(v_von * (v_ty_le->v_i)::numeric / 100);
        v_tong_da_chia := v_tong_da_chia + v_tien_dot;
      else
        -- dot cuoi: lay phan con lai, tranh lech do lam tron
        v_tien_dot := v_von - v_tong_da_chia;
      end if;
      if v_tien_dot > 0 then
        v_no_code := public.fn_tao_no_ncc(jsonb_build_object(
          'import_doc', v_doc,
          'supplier', coalesce(p->>'supplier',''),
          'location_code', v_loc,
          'tong_tien', v_tien_dot,
          'due_date', v_due::text,
          'note', concat('Tự sinh từ đơn nhập ', v_doc, ' · đợt ', v_i+1, '/', v_n_dot,
            ' (', (v_ty_le->v_i)::text, '% · ', (v_so_ngay->v_i)::text, ' ngày)')
        ));
      end if;
    end loop;
  end if;
  -- ===== HET phan moi =====

  perform public._notify_discord(jsonb_build_object('content',
    concat('📦 **Nhập hàng ', v_doc, '** · ', v_n, ' xe (', v_xe, ' mã) · kho ', v_loc,
      case when coalesce(p->>'supplier','') <> '' then concat(' · NCC ', p->>'supplier') else '' end,
      case when v_po_id is not null then concat(' · từ đơn đặt #', v_po_id) else '' end,
      case when v_von > 0 then concat(E'\n💰 Tổng giá vốn: ', to_char(v_von, 'FM999,999,999,999'), 'đ') else '' end,
      case when v_cn is not null and coalesce((v_cn->>'co_tra_cham')::boolean, false)
        then E'\n⏳ Đã ghi công nợ trả chậm NCC' else '' end,
      E'\n👤 ', v_nv_name)));

  return jsonb_build_object('doc', v_doc, 'so_ma', v_n, 'so_xe', v_xe, 'von', v_von, 'po_id', v_po_id);
end $function$;

-- Xac minh sau khi chay:
-- select oid::regprocedure from pg_proc where proname = 'fn_nhap_hang_v2';
-- Test tra cham: goi fn_nhap_hang_v2 voi p co them:
--   "cong_no": {"co_tra_cham": true, "so_ngay": [10,20,30], "ty_le": [30,30,40]}
-- roi kiem: select * from supplier_debts where import_doc = '<ma_phieu_nhap>' order by due_date;
-- -> phai ra 3 dong, tong tong_tien = v_von, due_date = homnay+10/+20/+30.
