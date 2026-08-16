-- ============================================================
-- Migration 087: Sửa fn_ai_doanh_so khớp đúng công thức "Doanh thu"
-- hiển thị ở trang Báo cáo (app/(app)/bao-cao/page.js dòng 101:
-- chỉ sale_price*quantity, KHÔNG cộng bán kèm, KHÔNG trừ chiết khấu)
-- — bản cũ ở migration 085 lỡ dùng công thức của view công nợ
-- (v_cong_no_phai_thu, có trừ chiết khấu + cộng bán kèm), gây lệch
-- số khi đối chiếu với trang Báo cáo (đúng lỗi anh Kỳ phát hiện).
--
-- ⚠️ LƯU Ý QUAN TRỌNG: bản thân app hiện có 3 công thức "doanh thu"
-- khác nhau ở 3 nơi:
--   1) Báo cáo (KPI "Doanh thu"): sale_price*quantity
--   2) CSV xuất từ Báo cáo: sale_price*quantity + bán kèm
--   3) View công nợ v_cong_no_phai_thu: sale_price*quantity + bán kèm − chiết khấu
-- Đây là 1 bất nhất có sẵn trong app, không phải do bot gây ra.
-- Migration này chỉ chỉnh RPC bot khớp đúng công thức #1 (nơi anh
-- đang đối chiếu số). Nếu anh muốn thống nhất lại cả 3 công thức
-- trong app, đây là việc khác, ngoài phạm vi bot AI — báo em làm riêng.
-- Chạy sau 086. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ai_doanh_so(
  p_tu_ngay date,
  p_den_ngay date,
  p_location_code text default null,
  p_nhom_theo text default 'ngay'
)
returns table (
  nhom text,
  so_don int,
  tong_doanh_thu bigint,
  tong_da_thu bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if p_nhom_theo not in ('ngay','nguoi_ban','dia_diem') then
    raise exception 'THAM_SO_SAI: nhom_theo chỉ nhận ngay/nguoi_ban/dia_diem';
  end if;
  if p_tu_ngay is null or p_den_ngay is null or p_tu_ngay > p_den_ngay then
    raise exception 'THAM_SO_SAI: khoảng ngày không hợp lệ';
  end if;
  if p_den_ngay - p_tu_ngay > 92 then
    raise exception 'THAM_SO_SAI: khoảng ngày tối đa 92 ngày mỗi lần gọi';
  end if;

  return query
  select
    case p_nhom_theo
      when 'ngay' then o.sale_date::text
      when 'nguoi_ban' then o.seller_name
      else l.name
    end,
    count(distinct o.id)::int,
    -- Khop dung KPI "Doanh thu" o trang Bao cao: chi sale_price*quantity
    sum(o.sale_price * o.quantity)::bigint,
    sum(coalesce(o.paid_amount, 0))::bigint
  from public.sales_orders o
  join public.locations l on l.code = o.location_code
  where o.status <> 'Đã hủy'
    and o.sale_date between p_tu_ngay and p_den_ngay
    and (p_location_code is null or o.location_code = p_location_code)
  group by
    case p_nhom_theo
      when 'ngay' then o.sale_date::text
      when 'nguoi_ban' then o.seller_name
      else l.name
    end
  order by 3 desc
  limit 200;
end $$;

-- Đồng bộ hàm ceo-brief để dùng cùng công thức (tránh lệch giữa 2 tool)
create or replace function public.fn_ai_ceo_brief(p_ngay date default current_date)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_doanh_so record; v_cong_no record; v_task record; v_quy jsonb;
begin
  select count(distinct o.id) as so_don,
    sum(o.sale_price * o.quantity) as tong_doanh_thu
  into v_doanh_so
  from public.sales_orders o
  where o.status <> 'Đã hủy' and o.sale_date = p_ngay;

  select count(distinct coalesce(customer_id::text, customer_phone)) as so_khach,
    sum(con_no) as tong_no
  into v_cong_no
  from public.v_cong_no_phai_thu
  where so_ngay_qua_han > 0;

  select qua_han, sap_den_han into v_task from public.v_task_dashboard;

  select jsonb_agg(jsonb_build_object('ten_tai_khoan', name, 'so_du', so_du))
  into v_quy
  from public.v_quy_so_du where status = 'Hoạt động';

  return jsonb_build_object(
    'ngay', p_ngay,
    'doanh_so' , jsonb_build_object('so_don', coalesce(v_doanh_so.so_don,0), 'tong_doanh_thu', coalesce(v_doanh_so.tong_doanh_thu,0)),
    'cong_no_qua_han', jsonb_build_object('so_khach', coalesce(v_cong_no.so_khach,0), 'tong_no', coalesce(v_cong_no.tong_no,0)),
    'quy_hien_tai', coalesce(v_quy, '[]'::jsonb),
    'cong_viec_qua_han', coalesce(v_task.qua_han, 0),
    'cong_viec_sap_den_han', coalesce(v_task.sap_den_han, 0)
  );
end $$;
