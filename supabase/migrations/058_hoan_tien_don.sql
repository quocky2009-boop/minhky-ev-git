-- ============================================================
-- Migration 058 — HOÀN TIỀN MỘT PHẦN CHO ĐƠN BÁN + siết cập nhật đã trả
--  Van de: fn_cap_nhat_da_tra cho GIAM paid_amount ma khong ghi phieu chi
--  hoan -> quy sai. Va UI cho sua so da tra tuy tien.
--  Sua:
--   1) fn_cap_nhat_da_tra: CHI cho THU THEM (p_paid > paid cu). Muon giam
--      phai dung fn_hoan_tien_don.
--   2) fn_hoan_tien_don(p_id, p_amount, p_ly_do): hoan 1 phan/toan bo tien
--      da thu — tru lui phieu thu neu chua chot quy, lap phieu chi neu da chot;
--      giam paid_amount tuong ung.
-- Chạy SAU 057. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- 1) fn_cap_nhat_da_tra: chan giam
create or replace function public.fn_cap_nhat_da_tra(p_id bigint, p_paid bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_them bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('sua_thanh_toan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật thanh toán'; end if;
  if coalesce(p_paid,0) < 0 then raise exception 'THAM_SO_SAI'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.status in ('Đã hủy','Đã trả hàng') then raise exception 'DA_DONG: đơn đã hủy/trả, không thu thêm được'; end if;

  v_them := p_paid - coalesce(o.paid_amount, 0);
  if v_them < 0 then
    raise exception 'KHONG_GIAM_DUOC: chức năng này chỉ dùng để THU THÊM. Muốn giảm/hoàn tiền, dùng "Hoàn tiền cho khách".';
  end if;
  if v_them = 0 then return; end if;  -- khong doi gi

  update public.sales_orders set paid_amount = p_paid,
    note = case when coalesce(p_note,'') = '' then note
           else trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Thu thêm: ' || p_note || ' (' || me.name || ')') end
  where id = p_id;

  perform public._auto_thu(o.location_code, coalesce(o.payment_method,'Chuyển khoản'), v_them,
    'Thu công nợ bán xe', o.customer_name, 'Đơn '||o.code||' — thu thêm', o.code||'-TT'||p_paid, me.uid, me.name);
end $$;

-- 2) fn_hoan_tien_don: hoan 1 phan tien da thu
--    p = { id, amount, ly_do }
create or replace function public.fn_hoan_tien_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_amt bigint; v_ly text; r record; v_daclose boolean; v_code text; v_conlai bigint;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' and not public.fn_co_quyen('sua_thanh_toan') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền hoàn tiền';
  end if;
  v_amt := coalesce((p->>'amount')::bigint, 0);
  v_ly := trim(coalesce(p->>'ly_do',''));
  if v_amt <= 0 then raise exception 'THAM_SO_SAI: số tiền hoàn phải > 0'; end if;
  if v_ly = '' then raise exception 'THIEU_THONG_TIN: nhập lý do hoàn tiền'; end if;
  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if v_amt > coalesce(o.paid_amount,0) then
    raise exception 'VUOT_DA_THU: chỉ hoàn tối đa số đã thu (% đ)', coalesce(o.paid_amount,0);
  end if;

  -- Uu tien tru lui cac phieu thu chua chot cua don (tong = v_amt), phan con lai lap phieu chi
  v_conlai := v_amt;
  for r in select * from public.cash_txns where ref_doc = o.code and direction = 'Thu' order by txn_date desc, id desc loop
    exit when v_conlai <= 0;
    v_daclose := exists (select 1 from public.cash_closings c where c.account_id = r.account_id and c.close_date >= r.txn_date);
    if not v_daclose then
      if r.amount <= v_conlai then
        delete from public.cash_txns where id = r.id;   -- tru lui ca phieu
        v_conlai := v_conlai - r.amount;
      end if;
      -- neu phieu lon hon phan con lai thi de lai, se lap phieu chi cho phan con lai o duoi
    end if;
  end loop;

  -- Phan con lai (da chot hoac le) -> lap phieu chi hoan
  if v_conlai > 0 then
    -- chon quy tien mat cua diem ban de chi
    declare v_acc bigint;
    begin
      v_acc := public._quy_mac_dinh(o.location_code, 'Tiền mặt');
      if v_acc is null then raise exception 'CHUA_CO_QUY: chưa có quỹ tiền mặt tại điểm bán để lập phiếu chi hoàn'; end if;
      if public.fn_so_du(v_acc) < v_conlai then
        raise exception 'QUY_KHONG_DU: quỹ không đủ để lập phiếu chi hoàn % đ', v_conlai;
      end if;
      v_code := public.fn_gen_code('PC');
      insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
      values (v_code, (now() at time zone 'Asia/Ho_Chi_Minh')::date, v_acc, 'Chi', v_conlai,
        'Chi trả lại tiền cho khách hủy/trả đơn', o.customer_name,
        'Hoàn tiền đơn '||o.code||' — '||v_ly, o.code, me.uid, me.name);
    end;
  end if;

  update public.sales_orders set
    paid_amount = coalesce(paid_amount,0) - v_amt,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Hoàn khách '||v_amt||'đ: '||v_ly||' ('||me.name||')')
  where id = (p->>'id')::bigint;
end $$;

do $do$
begin
  raise notice 'XONG 058: fn_cap_nhat_da_tra chi thu them; them fn_hoan_tien_don';
end $do$;
