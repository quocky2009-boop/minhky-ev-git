-- ============================================================
-- Migration 039 — GỠ MODULE MARKETING & KPI, GIỮ LẠI LÁI THỬ
-- Da chot: (b) xoa KPI + chien dich + bao cao bai viet/video,
--          GIU nguyen bang test_drives va du lieu lai thu.
--
-- QUAN TRONG: test_drives co 2 FK tro sang mkt_campaigns va
-- mkt_kpi_templates -> PHAI go 2 cot do TRUOC khi drop, neu khong
-- lenh "drop ... cascade" se keo theo ca bang lai thu.
--
-- KHONG the hoan tac. Chay 1 lan.
-- ============================================================

-- ---------- 0) AN TOAN: bao so luong truoc khi xoa ----------
do $do$
declare v_sub int; v_td int; v_camp int;
begin
  select count(*) into v_sub  from public.mkt_submissions;
  select count(*) into v_td   from public.test_drives;
  select count(*) into v_camp from public.mkt_campaigns;
  raise notice 'TRUOC KHI XOA: bao cao=% | chien dich=% | lai thu (GIU LAI)=%', v_sub, v_camp, v_td;
end $do$;

-- ---------- 1) XÓA VIEW TRƯỚC ----------
-- (view v_mkt_kpi_progress dung cot kpi_template_id cua test_drives,
--  phai xoa view TRUOC khi cat cot — neu khong se bao loi 2BP01)
drop view if exists public.v_mkt_kpi_progress cascade;
drop view if exists public.v_mkt_campaign_progress cascade;

-- ---------- 2) CẮT LIÊN KẾT của test_drives sang bảng sắp xóa ----------
alter table public.test_drives drop column if exists campaign_id;
alter table public.test_drives drop column if exists kpi_template_id;

-- ---------- 3) XÓA HÀM marketing (giữ hàm lái thử) ----------
drop function if exists public.fn_mkt_luu_bao_cao(jsonb) cascade;
drop function if exists public.fn_mkt_duyet_bao_cao(bigint, text, text) cascade;
drop function if exists public.fn_mkt_cho_phep_trung(bigint, text) cascade;
drop function if exists public.fn_mkt_luu_chien_dich(jsonb) cascade;
drop function if exists public.fn_mkt_trang_thai_chien_dich(bigint, text, text) cascade;
drop function if exists public.fn_mkt_mien_kpi(bigint, uuid, text) cascade;
drop function if exists public.fn_mkt_xac_nhan_hoan_thanh(bigint, uuid, text) cascade;
drop function if exists public.fn_mkt_xac_nhan_cua_hang(bigint, text, text) cascade;
drop function if exists public.fn_mkt_luu_kpi(jsonb) cascade;
drop function if exists public.fn_mkt_giao_kpi(bigint, text, text, uuid, text) cascade;
drop function if exists public.fn_mkt_xoa_giao_kpi(bigint) cascade;
drop function if exists public._mkt_normalize_url(text) cascade;
drop function if exists public._mkt_hash(text) cascade;
drop function if exists public._mkt_period(text, date) cascade;
-- GIU LAI: fn_mkt_luu_lai_thu, fn_mkt_duyet_lai_thu, fn_mkt_loai_khoi_kpi, _mkt_log

-- ---------- 4) XÓA BẢNG (thứ tự: con trước, cha sau) ----------
drop table if exists public.mkt_submissions          cascade;
drop table if exists public.mkt_branch_progress      cascade;
drop table if exists public.mkt_campaign_targets     cascade;
drop table if exists public.mkt_campaign_requirements cascade;
drop table if exists public.mkt_campaigns            cascade;
drop table if exists public.mkt_kpi_assignments      cascade;
drop table if exists public.mkt_kpi_templates        cascade;
-- GIU LAI: test_drives, mkt_audit_logs (luu vet lai thu)

-- ---------- 5) Sửa hàm lái thử cho khớp cấu trúc mới ----------
create or replace function public.fn_mkt_luu_lai_thu(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text; v_cus record; v_phone text; v_gui boolean;
  v_sus boolean := false; v_note text := ''; v_n int;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('mkt_lai_thu') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập lái thử'; end if;

  v_gui := coalesce((p->>'gui')::boolean, false);
  v_id := nullif(p->>'id','')::bigint;

  select * into v_cus from public.customers where id = (p->>'customer_id')::bigint;
  if v_cus is null then raise exception 'THIEU_THONG_TIN: phải chọn hoặc tạo khách hàng trước'; end if;
  v_phone := v_cus.phone_digits;
  if coalesce(v_phone,'') = '' then raise exception 'THIEU_THONG_TIN: khách hàng chưa có số điện thoại hợp lệ'; end if;

  if v_gui and ((p->>'interested_vehicle_id') is null or (p->>'test_drive_vehicle_id') is null) then
    raise exception 'THIEU_THONG_TIN: phải chọn dòng xe quan tâm và dòng xe đã lái thử';
  end if;

  -- Canh bao nghi ngo
  select count(*) into v_n from public.test_drives t
  where t.normalized_phone = v_phone and t.employee_id <> me.uid
    and t.status in ('submitted','approved') and (v_id is null or t.id <> v_id);
  if v_n > 0 then v_sus := true; v_note := v_note || 'SĐT này đã được nhân viên khác nhập ' || v_n || ' lượt. '; end if;

  select count(*) into v_n from public.test_drives t
  where t.normalized_phone = v_phone and t.status in ('submitted','approved')
    and t.test_drive_date = (coalesce(nullif(p->>'test_drive_at','')::timestamptz, now()) at time zone 'Asia/Ho_Chi_Minh')::date
    and (v_id is null or t.id <> v_id);
  if v_n > 0 then v_note := v_note || 'Khách đã có ' || v_n || ' lượt lái thử khác trong cùng ngày. '; end if;

  if v_id is null then
    v_code := public.fn_gen_code('TD');
    insert into public.test_drives (
      code, customer_id, customer_name_snapshot, customer_phone_snapshot, normalized_phone,
      region, employee_id, employee_name,
      interested_vehicle_id, test_drive_vehicle_id, actual_frame_number,
      test_drive_at, duration_minutes, customer_need_level, result_status,
      customer_feedback, employee_note, photos, status, is_suspicious, suspicious_note, submitted_at)
    values (
      v_code, v_cus.id, v_cus.name, v_cus.phone, v_phone,
      me.region, me.uid, me.name,
      nullif(p->>'interested_vehicle_id',''), nullif(p->>'test_drive_vehicle_id',''), nullif(p->>'actual_frame_number',''),
      coalesce(nullif(p->>'test_drive_at','')::timestamptz, now()), nullif(p->>'duration_minutes','')::int,
      coalesce(p->>'customer_need_level','warm'), coalesce(p->>'result_status','undecided'),
      coalesce(p->>'customer_feedback',''), coalesce(p->>'employee_note',''), coalesce(p->'photos','[]'::jsonb),
      case when v_gui then 'submitted' else 'draft' end, v_sus, v_note,
      case when v_gui then now() else null end);
    perform public._mkt_log('test_drive', v_code, case when v_gui then 'submit' else 'create_draft' end, null, p, v_note);
  else
    if not exists (select 1 from public.test_drives where id = v_id and employee_id = me.uid and status in ('draft','needs_revision')) then
      raise exception 'KHONG_CO_QUYEN: chỉ sửa được lượt lái thử của mình khi Nháp hoặc Cần bổ sung';
    end if;
    update public.test_drives set
      customer_id = v_cus.id, customer_name_snapshot = v_cus.name, customer_phone_snapshot = v_cus.phone,
      normalized_phone = v_phone,
      interested_vehicle_id = nullif(p->>'interested_vehicle_id',''),
      test_drive_vehicle_id = nullif(p->>'test_drive_vehicle_id',''),
      actual_frame_number = nullif(p->>'actual_frame_number',''),
      test_drive_at = coalesce(nullif(p->>'test_drive_at','')::timestamptz, test_drive_at),
      duration_minutes = nullif(p->>'duration_minutes','')::int,
      customer_need_level = coalesce(p->>'customer_need_level', customer_need_level),
      result_status = coalesce(p->>'result_status', result_status),
      customer_feedback = coalesce(p->>'customer_feedback', customer_feedback),
      employee_note = coalesce(p->>'employee_note', employee_note),
      photos = coalesce(p->'photos', photos),
      is_suspicious = v_sus, suspicious_note = v_note,
      status = case when v_gui then 'submitted' else 'draft' end,
      submitted_at = case when v_gui then now() else submitted_at end
    where id = v_id returning code into v_code;
    perform public._mkt_log('test_drive', v_code, case when v_gui then 'resubmit' else 'save_draft' end, null, p, v_note);
  end if;
  return v_code;
end $$;

-- ---------- 6) Gỡ quyền marketing (giữ quyền lái thử) ----------
delete from public.role_perms
where perm in ('mkt_bao_cao','mkt_duyet','mkt_chien_dich','mkt_kpi_dinh_ky','mkt_xem_toan_cty','mkt_ngoai_le');
-- GIU LAI quyen: mkt_lai_thu

-- ---------- 7) Xóa danh mục nền tảng marketing ----------
delete from public.app_settings where key = 'mkt_platforms';

-- ---------- 8) Gỡ quyền truy cập bucket marketing ----------
-- LUU Y: Supabase KHONG cho xoa file/bucket bang SQL
-- (loi 42501: Direct deletion from storage tables is not allowed).
-- Day chi go POLICY. Muon xoa han anh + bucket, lam TAY tren Dashboard:
--   Storage > chon bucket "marketing" > Delete bucket
-- (Buoc do khong bat buoc — bucket khong con duoc dung den nua.)
drop policy if exists "upload_marketing" on storage.objects;
drop policy if exists "read_marketing"   on storage.objects;
drop policy if exists "delete_marketing" on storage.objects;

-- ---------- 9) Kiểm tra kết quả ----------
do $do$
declare v_td int; v_con int;
begin
  select count(*) into v_td from public.test_drives;
  select count(*) into v_con from information_schema.tables
  where table_schema = 'public' and table_name like 'mkt_%' and table_name <> 'mkt_audit_logs';
  raise notice 'XONG: lai thu con lai=% ban ghi | bang mkt_* con sot=% (mong doi 0)', v_td, v_con;
end $do$;
