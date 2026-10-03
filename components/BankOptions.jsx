// <option> cho o chon "Tai khoan nhan tien": tai khoan cua phap nhan cua hang xe len truoc,
// cac tai khoan phap nhan khac (vd: Cty VinFast Viet Nam) o nhom rieng, co ghi ten phap nhan.
export default function BankOptions({ accounts = [], companies = [], companyId, withInfo = true }) {
  const coName = (id) => companies.find((c) => c.id === id)?.name || "";
  const label = (a, kem) => `${a.name}${withInfo && a.bank_info ? ` (${a.bank_info})` : ""}${kem && coName(a.company_id) ? ` — ${coName(a.company_id)}` : ""}`;
  const gan = accounts.filter((a) => companyId && a.company_id === companyId);
  const khac = accounts.filter((a) => !(companyId && a.company_id === companyId));
  return (
    <>
      {gan.length > 0 && <optgroup label="Pháp nhân của hãng xe">{gan.map((a) => <option key={a.id} value={a.id}>{label(a, false)}</option>)}</optgroup>}
      {khac.length > 0 && <optgroup label={gan.length > 0 ? "Pháp nhân khác" : "Tài khoản ngân hàng"}>{khac.map((a) => <option key={a.id} value={a.id}>{label(a, true)}</option>)}</optgroup>}
    </>
  );
}
