"""Generate the bounded, synthetic PDFs used by the native project document acceptance."""
from pathlib import Path
import subprocess

PDF_NAME = "qa-project-pages.pdf"
PAGES = [
    ["QA_PDF_PAGE_ONE_18"],
    ["QA_PDF_UNSELECTED_TOP_87", "QA_PDF_SELECTED_CEDAR_42", "QA_PDF_UNSELECTED_BOTTOM_76"],
    ["QA_PDF_PAGE_THREE_19"],
]


def text_pdf(pages=None):
    pages = PAGES if pages is None else pages
    page_ids = [4 + 2 * index for index in range(len(pages))]
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for page_id, lines in zip(page_ids, pages):
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources "
            f"<< /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode()
        )
        commands = "BT /F1 12 Tf 16 TL 44 740 Td " + " T* ".join(f"({line}) Tj" for line in lines) + " ET"
        data = commands.encode("ascii")
        objects.append(b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream")

    output = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(b"%d 0 obj\n" % number + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        output.extend(b"%010d 00000 n \n" % offset)
    output.extend(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref))
    return bytes(output)


def fixtures(directory: Path):
    source = directory / PDF_NAME
    source.write_bytes(text_pdf())
    (directory / "qa-project-long.pdf").write_bytes(text_pdf([["PAGE_LIMIT"]] * 101))
    (directory / "qa-project-damaged.pdf").write_bytes(b"%PDF-1.7\nnot a PDF document\n")
    # 让系统生成实际加密 PDF，随后重新打开确认它需要密码。口令只用于合成样本。
    subprocess.run(
        ["/usr/bin/swift", "-module-cache-path", str(directory / "swift-cache"), "-",
         str(source), str(directory / "qa-project-protected.pdf")],
        input="""
import Foundation
import PDFKit
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let target = URL(fileURLWithPath: CommandLine.arguments[2])
guard let document = PDFDocument(url: source),
      document.write(to: target, withOptions: [.userPasswordOption: "fixture-reader",
                                                .ownerPasswordOption: "fixture-owner"]),
      let protected = PDFDocument(url: target), protected.isEncrypted, protected.isLocked
else { exit(1) }
""", text=True, check=True, timeout=120,
    )
