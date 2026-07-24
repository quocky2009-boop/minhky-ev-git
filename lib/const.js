export const CUSTOMER_TYPES = ["Khách lẻ", "Khách buôn", "Khách CBNV", "Khách cũ", "Đối tác", "O2O"];
export const CUSTOMER_SOURCES = ["Khách vãng lai", "Tự tìm kiếm", "Facebook/Tiktok", "Zalo", "Khách cũ giới thiệu", "ĐL bán buôn", "Công ty giao", "Telesale", "Khác"];
export const PAYMENT_METHODS = ["Chuyển khoản", "Tiền mặt", "Cả CK và TM", "Trả góp"];
export const DOC_STATUSES = ["Đủ hồ sơ", "Thiếu CCCD", "Thiếu địa chỉ", "Đang làm đăng ký", "Đã xong đăng ký", "Không làm đăng ký"];
export const ADJUST_REASONS = ["Kiểm kê lệch", "Nhập sai mã xe", "Nhập sai màu", "Sai vị trí kho", "Xe hỏng", "Xe trưng bày", "Xe giữ cho khách", "Lý do khác"];
export const ROLES = { CEO: "CEO / BGĐ", MANAGER: "Quản lý cửa hàng", SALES: "Sales", ADMIN: "Admin / Kế toán / Kho" };

export const NAV_GROUPS = [
  { items: [{ href: "/dashboard", label: "Tổng quan", roles: ["CEO", "MANAGER", "ADMIN"] }] },
  {
    label: "BÁN HÀNG",
    items: [
      { href: "/don-ban", label: "Đơn bán", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dat-coc", label: "Đặt cọc / Giữ xe", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
    ],
  },
  {
    label: "THU CHI & QUỸ",
    items: [
      { href: "/thu-chi", label: "Sổ quỹ", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/doi-soat", label: "Đối soát cuối ngày", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "KHO & HÀNG HÓA",
    items: [
      { href: "/nhap-hang", label: "Nhập hàng", roles: ["CEO", "ADMIN"] },
      { href: "/tra-cuu", label: "Tra cứu tồn", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dieu-chuyen", label: "Điều chuyển", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dieu-chinh", label: "Điều chỉnh tồn", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/kiem-ke", label: "Kiểm kê", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/quet-gom", label: "Quét gom số khung", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/ton-tong-hop", label: "Bảng tồn tổng hợp", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "DỮ LIỆU",
    items: [
      { href: "/lai-thu", label: "Khách lái thử", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/lich-su", label: "Lịch sử giao dịch", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/khach-hang", label: "Khách hàng", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/danh-muc-xe", label: "Danh mục xe", roles: ["CEO", "ADMIN"] },
      { href: "/nha-cung-cap", label: "Nhà cung cấp", roles: ["CEO", "ADMIN"] },
      { href: "/kho", label: "Kho / Cửa hàng", roles: ["CEO", "ADMIN"] },
    ],
  },
  {
    label: "CÔNG VIỆC",
    items: [
      { href: "/cong-viec", label: "Việc của tôi", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
      { href: "/cong-viec/doi-nhom", label: "Việc đội nhóm", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec/giao-viec", label: "Giao việc", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec/quan-tri", label: "Mẫu & Lặp lại", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "DỊCH VỤ",
    items: [
      { href: "/dich-vu", label: "Phiếu dịch vụ", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
    ],
  },
  {
    label: "QUẢN TRỊ",
    items: [
      { href: "/lai-gop", label: "Lãi gộp & Công nợ", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/bao-cao", label: "Báo cáo", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/nguoi-dung", label: "Người dùng", roles: ["CEO"] },
      { href: "/cai-dat", label: "Cài đặt", roles: ["CEO", "ADMIN"] },
    ],
  },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);
