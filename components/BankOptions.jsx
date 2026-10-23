// <option> cho o chon "Tai khoan nhan tien": tai khoan cua phap nhan cua hang xe len truoc,
// cac tai khoan phap nhan khac (vd: Cty VinFast Viet Nam) o nhom rieng, co ghi ten phap nhan.
export default function BankOptions({ accounts: all = [], companies = [], companyId, withInfo = true, buon = false, giu = "" }) {
  // Đơn bán buôn: tài khoản dùng cho bán buôn / cả hai; đơn bán lẻ: tài khoản bán lẻ / cả hai (loại tài khoản cá nhân). Luôn giữ tài khoản đang chọn.
  const accounts = all.filter((a) => String(a.id) === String(giu) || (buon ? a.dung_cho !== "BAN_LE" : a.dung_cho !== "BAN_BUON" && !a.ca_nhan));
  const canhan = accounts.filter((a) => a.ca_nhan);
  const coName = (id) => companies.find((c) => c.id === id)?.name || "";
  const label = (a, kem) => `${a.name}${withInfo && a.bank_info ? ` (${a.bank_info})` : ""}${kem && coName(a.company_id) ? ` — ${coName(a.company_id)}` : ""}`;
  const gan = accounts.filter((a) => !a.ca_nhan && companyId && a.company_id === companyId);
  const khac = accounts.filter((a) => !a.ca_nhan && !(companyId && a.company_id === companyId));
  return (
    <>
      {canhan.length > 0 && <optgroup label="Tài khoản nhận tiền bán buôn">{canhan.map((a) => <option key={a.id} value={a.id}>{a.name}{withInfo && a.bank_info ? ` (${a.bank_info})` : ""}</option>)}</optgroup>}
      {gan.length > 0 && <optgroup label="Pháp nhân của hãng xe">{gan.map((a) => <option key={a.id} value={a.id}>{label(a, false)}</option>)}</optgroup>}
      {khac.length > 0 && <optgroup label={gan.length > 0 ? "Pháp nhân khác" : "Tài khoản ngân hàng"}>{khac.map((a) => <option key={a.id} value={a.id}>{label(a, true)}</option>)}</optgroup>}
    </>
  );
}
