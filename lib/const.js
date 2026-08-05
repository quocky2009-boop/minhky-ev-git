export const CUSTOMER_TYPES = ["Khách lẻ", "Khách buôn", "Khách CBNV", "Khách cũ", "Đối tác", "O2O"];
export const CUSTOMER_SOURCES = ["Khách vãng lai", "Tự tìm kiếm", "Facebook/Tiktok", "Zalo", "Khách cũ giới thiệu", "ĐL bán buôn", "Công ty giao", "Telesale", "Khác"];
export const PAYMENT_METHODS = ["Chuyển khoản", "Tiền mặt", "Cả CK và TM", "Trả góp"];
export const DOC_STATUSES = ["Đủ hồ sơ", "Thiếu CCCD", "Thiếu địa chỉ", "Đang làm đăng ký", "Đã xong đăng ký", "Không làm đăng ký"];
export const ADJUST_REASONS = ["Kiểm kê lệch", "Nhập sai mã xe", "Nhập sai màu", "Sai vị trí kho", "Xe hỏng", "Xe trưng bày", "Xe giữ cho khách", "Lý do khác"];
export const ROLES = { CEO: "CEO / BGĐ", MANAGER: "Quản lý cửa hàng", SALES: "Sales", ADMIN: "Admin / Kế toán / Kho" };

export const NAV_GROUPS = [
  { items: [{ href: "/dashboard", label: "Tổng quan", roles: ["CEO", "MANAGER", "ADMIN", "SALES", "TECHNICIAN"] }] },
  {
    label: "BÁN HÀNG",
    items: [
      { href: "/lai-thu", label: "Lái thử", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dat-coc", label: "Đặt cọc / Giữ xe", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/don-ban", label: "Đơn bán", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/khach-hang", label: "Khách hàng", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/khuyen-mai", label: "Chương trình khuyến mại", roles: ["CEO", "MANAGER", "ADMIN", "SALES"], perm: "xuat_ban" },
    ],
  },
  {
    label: "DỊCH VỤ",
    items: [
      { href: "/dich-vu/dashboard", label: "Dashboard", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/dich-vu", label: "Phiếu dịch vụ", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
      { href: "/dich-vu/bao-duong", label: "Nhắc bảo dưỡng", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
    ],
  },
  {
    label: "NHẬP XE",
    items: [
      { href: "/dat-hang-nhap", label: "Đặt hàng nhập", roles: ["CEO", "MANAGER", "ADMIN"], perm: "nhap_hang" },
      { href: "/nhap-hang", label: "Đơn nhập xe", roles: ["CEO", "ADMIN"], perm: "nhap_hang" },
      { href: "/giay-coc", label: "Giấy COC", roles: ["CEO", "MANAGER", "ADMIN", "SALES"] },
    ],
  },
  {
    label: "KHO",
    items: [
      { href: "/ton-tong-hop", label: "Bảng tồn tổng hợp", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/tra-cuu", label: "Tra cứu tồn", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/quet-gom", label: "Quét gom số khung", roles: ["CEO", "MANAGER", "SALES", "ADMIN"], perm: "nhap_tu_phieu" },
      { href: "/dieu-chuyen", label: "Điều chuyển", roles: ["CEO", "MANAGER", "SALES", "ADMIN"], perm: "dieu_chuyen" },
      { href: "/dieu-chinh", label: "Điều chỉnh tồn", roles: ["CEO", "MANAGER", "ADMIN"], perm: "dieu_chinh" },
      { href: "/kiem-ke", label: "Kiểm kê", roles: ["CEO", "MANAGER", "ADMIN"], perm: "kiem_ke" },
      { href: "/lich-su", label: "Lịch sử giao dịch", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "TÀI CHÍNH",
    items: [
      { href: "/phieu-thu", label: "Phiếu thu", roles: ["CEO", "MANAGER", "ADMIN"], perm: "thu_chi_chot" },
      { href: "/phieu-chi", label: "Phiếu chi", roles: ["CEO", "MANAGER", "ADMIN"], perm: "thu_chi_chot" },
      { href: "/thu-chi", label: "Sổ quỹ", roles: ["CEO", "MANAGER", "ADMIN"], perm: "thu_chi_chot" },
      { href: "/doi-soat", label: "Đối soát cuối ngày", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-no/phai-thu", label: "Công nợ phải thu", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-no/phai-tra", label: "Công nợ phải trả (NCC)", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/lai-gop", label: "Lãi gộp & Công nợ", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "CÔNG VIỆC",
    items: [
      { href: "/cong-viec/dashboard", label: "Dashboard", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec", label: "Việc của tôi", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
      { href: "/cong-viec/lich-hen", label: "Lịch hẹn", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
      { href: "/cong-viec/doi-nhom", label: "Việc đội nhóm", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec/quan-tri", label: "Mẫu & Lặp lại", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "DANH MỤC",
    items: [
      { href: "/hang-hoa", label: "Hàng hóa", roles: ["CEO", "MANAGER", "ADMIN"], perm: "sua_danh_muc" },
      { href: "/danh-muc-xe", label: "Danh mục xe", roles: ["CEO", "ADMIN"], perm: "sua_danh_muc" },
      { href: "/nha-cung-cap", label: "Nhà cung cấp", roles: ["CEO", "ADMIN"] },
      { href: "/kho", label: "Kho / Cửa hàng", roles: ["CEO", "ADMIN"] },
    ],
  },
  {
    label: "QUẢN TRỊ",
    items: [
      { href: "/chi-tieu", label: "Chỉ tiêu doanh số", roles: ["CEO", "ADMIN"] },
      { href: "/bao-cao", label: "Báo cáo", roles: ["CEO", "MANAGER", "ADMIN"], perm: "xem_bao_cao" },
      { href: "/nguoi-dung", label: "Người dùng", roles: ["CEO"] },
      { href: "/phan-quyen", label: "Phân quyền", roles: ["CEO"] },
      { href: "/cai-dat", label: "Cài đặt", roles: ["CEO", "ADMIN"], perm: "cai_dat" },
    ],
  },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);