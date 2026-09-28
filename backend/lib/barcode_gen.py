"""Generate gambar barcode (Code128 PNG) di server — dipakai label cetak per artikel."""

import io

import barcode
from barcode.writer import ImageWriter


def barcode_png(data: str) -> bytes:
    code = barcode.get("code128", data, writer=ImageWriter())
    buf = io.BytesIO()
    code.write(
        buf,
        options={
            "module_height": 12.0,
            "module_width": 0.33,
            "font_size": 9,
            "text_distance": 3.0,
            "quiet_zone": 2.0,
            "dpi": 200,
        },
    )
    return buf.getvalue()
