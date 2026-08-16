-- ============================================================
-- Migration 094: Đổi fn_huy_don_nhap từ XÓA HẲN dữ liệu (DELETE)
-- sang SOFT-CANCEL — giữ lại đơn trong danh sách với trạng thái
-- "Đơn hủy", giống hệt cách "Hủy đơn bán" đang làm (status='Đã hủy'
-- nhưng vẫn hiện trong lưới, có Badge đỏ).
--
-- Cách làm: tái dùng enum DA_XOA đã có sẵn trên vehicle_units.status
-- (dùng cho điều chỉnh xóa từ trước — migration 004/005), KHÔNG xóa
-- dòng inventory_txns nên đơn vẫn hiện trong danh sách "Đơn nhập"
-- (danh sách đó lấy hoàn toàn từ inventory_txns, không xóa = vẫn hiện).
-- Chạy sau 093. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_huy_don_nhap(p_doc text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_da_dung int; v_n int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền hủy đơn nhập'; end if;

  if not exists (select 1 from public.vehicle_units where import_doc = p_doc) then
    raise exception 'KHONG_TIM_THAY: không tìm thấy đơn nhập %', p_doc;
  end if;

  if exists (select 1 from public.vehicle_units where import_doc = p_doc and status = 'DA_XOA') then
    raise exception 'DA_HUY: đơn nhập % đã hủy rồi', p_doc;
  end if;

  select count(*) into v_da_dung from public.vehicle_units
  where import_doc = p_doc and status <> 'TON_KHO';
  if v_da_dung > 0 then
    raise exception 'KHONG_THE_HUY: có % xe trong đơn đã bán/chuyển/điều chỉnh, không thể hủy đơn', v_da_dung;
  end if;

  -- SOFT-CANCEL: chuyen trang thai DA_XOA, KHONG xoa dong du lieu
  update public.vehicle_units set
    status = 'DA_XOA', removed_reason = concat('Hủy đơn nhập bởi ', me.name), updated_at = now()
  where import_doc = p_doc;
  get diagnostics v_n = row_count;

  -- Giu lai inventory_txns (khong xoa) de don van hien trong danh sach,
  -- chi ghi chu them vao note de biet da huy.
  update public.inventory_txns set
    note = concat(note, ' · [ĐÃ HỦY bởi ', me.name, ' lúc ', to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ']')
  where doc_code = p_doc and txn_type = 'Nhập hàng';

  perform public._notify_discord(jsonb_build_object('content',
    concat('🗑️ **Đã hủy đơn nhập ', p_doc, '** (', v_n, ' xe) — bởi ', me.name)));
end $$;

-- ---------- Hàm phụ: lấy trạng thái đơn nhập theo doc (dùng cho list UI) ----------
create or replace function public.fn_trang_thai_don_nhap(p_docs text[])
returns table (doc text, trang_thai text)
language sql security definer stable set search_path = public as $$
  select import_doc,
    case when bool_and(status = 'DA_XOA') then 'Đơn hủy' else 'Đã nhập' end
  from public.vehicle_units
  where import_doc = any(p_docs)
  group by import_doc;
$$;
revoke all on function public.fn_trang_thai_don_nhap(text[]) from public;
grant execute on function public.fn_trang_thai_don_nhap(text[]) to authenticated;
