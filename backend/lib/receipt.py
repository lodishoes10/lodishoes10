"""Receipt text builder — one source of truth for the WhatsApp receipt body.

All arithmetic is integer Rupiah (no floats) so totals can never drift.
"""

from datetime import datetime, timezone

from lib.dates import app_zone

W = 32  # thermal 80mm ≈ 32 monospace columns

PAY_LABEL = {"TUNAI": "TUNAI", "QRIS": "QRIS", "TRANSFER": "TRANSFER", "DEBIT": "DEBIT"}


def rupiah(v: int) -> str:
    sign = "-" if v < 0 else ""
    return f"{sign}Rp{abs(int(v)):,.0f}".replace(",", ".")


def _two(left: str, right: str) -> str:
    left = left[: max(0, W - len(right))]
    return left.ljust(W - len(right)) + right


def _wrap(text: str) -> list[str]:
    text = text.upper()
    if len(text) <= W:
        return [text]
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > W:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def build_receipt_text(tx: dict, branch: dict) -> str:
    created = tx.get("created_at")
    if isinstance(created, datetime) and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    local = created.astimezone(app_zone()) if created else datetime.now(app_zone())

    # Kepala struk: hanya nama toko + nama cabang (BALARAJA / CILEDUG).
    # Alamat & nomor telepon toko sengaja TIDAK dicetak (permintaan pemilik).
    name = (branch.get("name") or "LODISHOES").upper()
    lines: list[str] = ["LODISHOES".center(W).strip(), name.center(W).strip()]
    lines.append("=" * W)
    lines.append(f"NO : {tx['receipt_no']}")
    lines.append(f"TGL: {local:%d/%m/%Y %H:%M} WIB")
    lines.append(f"KASIR: {tx.get('cashier_name', '-')}"[:W])
    lines.append("-" * W)
    is_tukar = tx.get("type") == "TUKAR"
    for it in tx.get("items", []):
        if not is_tukar and int(it.get("qty", 0)) < 1:
            continue  # baris yang sudah habis ditukar tidak dicetak ulang di struk penjualan
        lines.extend(_wrap(f"{it['article_name']} ({it['size']})"))
        lines.append(_two(f"{it['qty']} x {rupiah(it['price'])}", rupiah(it["line_revenue"])))
        if it.get("new_size"):
            if it.get("new_article_name"):
                # Tukar artikel/ukuran: target boleh artikel yang berbeda.
                lines.extend(_wrap(f"> JADI: {it['new_article_name']} ({it['new_size']})"))
                per_pair = int(it.get("new_price", 0)) - int(it["price"])
                lines.append(f"  @{rupiah(it.get('new_price', 0))} (SELISIH {rupiah(per_pair)}/PSG)")
            else:
                lines.append(f"> TUKAR UKURAN: {it['size']} -> {it['new_size']}")
    lines.append("-" * W)
    if is_tukar:
        method = PAY_LABEL.get(tx.get("payment_method", ""), "TUNAI")
        lines.append(_two(f"SELISIH TUKAR ({method})", rupiah(tx.get("total", 0))))
        if tx.get("total", 0) < 0:
            lines.append(_two("KEMBALI KE PELANGGAN", rupiah(tx.get("change", 0))))
        else:
            if tx.get("payment_method") == "TUNAI" and tx.get("paid"):
                lines.append(_two("BAYAR TUNAI", rupiah(tx.get("paid", 0))))
            if tx.get("change"):
                lines.append(_two("KEMBALIAN", rupiah(tx.get("change"))))
    else:
        lines.append(_two("TOTAL", rupiah(tx.get("subtotal", 0))))
        if tx.get("discount"):
            lines.append(_two("DISKON", rupiah(-tx["discount"])))
        lines.append(_two(PAY_LABEL.get(tx.get("payment_method", ""), "-"), rupiah(tx.get("total", 0))))
        if tx.get("payment_method") == "TUNAI":
            lines.append(_two("BAYAR TUNAI", rupiah(tx.get("paid", 0))))
            lines.append(_two("KEMBALIAN", rupiah(tx.get("change", 0))))
    lines.append("=" * W)
    # Ketentuan tukar 7 hari TIDAK dicetak lagi (permintaan pemilik).
    lines.append("TERIMA KASIH ATAS KUNJUNGAN ANDA")
    return "\n".join(lines)[:1600]
