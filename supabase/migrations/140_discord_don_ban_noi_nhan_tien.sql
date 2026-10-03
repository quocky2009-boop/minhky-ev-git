-- =====================================================================
-- 140_discord_don_ban_noi_nhan_tien.sql
-- Tin Discord don ban (tao / sua / ban buon): muc "Thanh toan" them dong
-- NOI NHAN TIEN cho tung khoan:
--   · Ngan hang : ten TK · so TK / thong tin NH (khong kem Phap nhan)
--   · Tien mat  : ten quy · Diem
--   · Tra gop   : don vi tra gop
-- Ap dung bang cach them ham _pay_noi_nhan va vá _don_discord_body +
-- _don_discord_tao_embeds (lay lai dinh nghia that bang pg_get_functiondef,
-- thay doan vong lap sale_payments). DB that la nguon su that.
-- =====================================================================
create or replace function public._pay_noi_nhan(p_account_id bigint, p_method text, p_finance text, p_extra_cty text default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare a record; v_loc text; v_fin text := nullif(p_finance,'');
begin
  if p_method = 'Trả góp' or v_fin is not null then
    return E'     ↳ Đơn vị trả góp: ' || coalesce(v_fin, nullif(p_extra_cty,''), '—') || E'\n';
  end if;
  if p_account_id is null then return ''; end if;
  select * into a from public.cash_accounts where id = p_account_id;
  if a is null then return ''; end if;
  if a.type = 'Ngân hàng' then
    return E'     ↳ TK: ' || a.name || coalesce(' · ' || nullif(a.bank_info,''), '') || E'\n';
  end if;
  select name into v_loc from public.locations where code = a.location_code;
  return E'     ↳ Quỹ: ' || a.name || coalesce(' · Điểm: ' || v_loc, '') || E'\n';
exception when others then
  return '';
end $$;

-- Va 2 ham: trong vong lap sale_payments
--   select method, amount, status  ->  select method, amount, status, account_id, finance_company
--   ... || E'\n';                  ->  ... || E'\n' || public._pay_noi_nhan(account_id, method, finance_company, <cty tra gop>);
