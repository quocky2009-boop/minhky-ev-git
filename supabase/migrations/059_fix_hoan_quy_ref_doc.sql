-- ============================================================
-- Migration 059 — FIX HOÀN QUỸ KHI HỦY/TRẢ ĐƠN (bắt đủ mọi phiếu thu)
--  Bug: _hoan_quy_don (057) tim phieu thu bang ref_doc = ma_don (khop tuyet doi),
--  nhung phieu thu cua don thuc te co ref_doc nhieu dang:
--    - Ban xe:   BH-...-<method>-<amount>
--    - Sua don:  BH-...-SUA-<method>-<amount>
--    - Thu them: BH-...-TT<paid>
--    - Tien coc: COC-...  (KHONG chua ma don)
--  => khop tuyet doi khong bat duoc cai nao -> phieu thu van ton tai sau khi huy.
--  Sua: bat phieu thu theo ref_doc LIKE 'ma_don%' VA phieu thu cua cac ma coc
--  (COC-...) gan voi so khung cua don.
-- Chạy SAU 058. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public._hoan_quy_don(p_code text, p_ly_do text, p_uid uuid, p_uname text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r record; v_daclose boolean; v_code text; v_tong bigint := 0; v_refs text[];
begin
  -- Tap hop ref_doc can hoan:
  --  1) moi phieu thu bat dau bang ma don (ban xe / sua don / thu them)
  --  2) cac ma coc COC-... gan voi so khung cua don nay
  select array_agg(distinct ref) into v_refs from (
    select ref_doc as ref from public.cash_txns
      where direction = 'Thu' and ref_doc like p_code || '%'
    union
    select d.code as ref from public.deposits d
      join public.sales_orders o on o.code = p_code
      where d.frame_number = any(string_to_array(o.frame_number, ', '))
  ) x;

  if v_refs is null then return 0; end if;

  for r in
    select * from public.cash_txns
    where direction = 'Thu' and ref_doc = any(v_refs)
  loop
    v_daclose := exists (
      select 1 from public.cash_closings c
      where c.account_id = r.account_id and c.close_date >= r.txn_date
    );
    if v_daclose then
      -- Da chot -> lap phieu chi hoan (khong xoa phieu thu goc)
      if public.fn_so_du(r.account_id) >= r.amount then
        v_code := public.fn_gen_code('PC');
        insert into public.cash_txns (code, txn_date, account_id, direction, amount, category,
          counterparty, description, ref_doc, created_by, created_by_name)
        values (v_code, (now() at time zone 'Asia/Ho_Chi_Minh')::date, r.account_id, 'Chi', r.amount,
          'Chi trả lại tiền cho khách hủy/trả đơn', r.counterparty,
          'Hoàn tiền đơn '||p_code||' — '||coalesce(p_ly_do,'')||' (phiếu thu gốc '||r.code||')', p_code, p_uid, p_uname);
        v_tong := v_tong + r.amount;
      else
        raise exception 'QUY_KHONG_DU: quỹ không đủ số dư để lập phiếu chi hoàn % đ (đơn %). Hãy nạp quỹ hoặc chi tay rồi ghi phiếu chi thủ công.', r.amount, p_code;
      end if;
    else
      -- Chua chot -> tru lui: xoa phieu thu goc
      delete from public.cash_txns where id = r.id;
      v_tong := v_tong + r.amount;
    end if;
  end loop;
  return v_tong;
end $$;

do $do$
begin
  raise notice 'XONG 059: _hoan_quy_don bat du phieu thu (LIKE ma don + phieu coc)';
end $do$;

-- ===================== HÀM KHẮC PHỤC ĐƠN ĐÃ HỦY NHƯNG CHƯA HOÀN QUỸ =====================
-- Dung cho cac don da bi huy/tra TRUOC khi co ban va nay (phieu thu con ton).
-- CEO goi: select public.fn_hoan_quy_don_da_huy('BH-2607-22099');
create or replace function public.fn_hoan_quy_don_da_huy(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; o record; v_hoan bigint;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ Ban giám đốc'; end if;
  select * into o from public.sales_orders where code = p_code;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.status not in ('Đã hủy','Đã trả hàng') then
    raise exception 'CHUA_HUY: đơn này chưa ở trạng thái hủy/trả — không cần hoàn quỹ bổ sung';
  end if;
  v_hoan := public._hoan_quy_don(o.code, coalesce(o.cancel_reason,'hoàn quỹ bổ sung'), me.uid, me.name);
  if v_hoan > 0 then
    update public.sales_orders set
      cancel_reason = trim(both ' · ' from coalesce(cancel_reason,'') || ' · đã hoàn quỹ bổ sung '||v_hoan||'đ'),
      updated_at = now()
    where code = p_code;
  end if;
  return v_hoan;
end $$;
