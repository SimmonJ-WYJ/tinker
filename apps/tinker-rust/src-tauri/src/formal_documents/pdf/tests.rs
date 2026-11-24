use super::extract_pages;
use crate::formal_documents::{MAX_PDF_BYTES, MAX_PDF_PAGES};
use std::fmt::Write;

fn serialize(objects: &[String], trailer: &str) -> Vec<u8> {
    let mut file = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(file.len());
        writeln!(file, "{} 0 obj\n{}\nendobj", index + 1, object).unwrap();
    }
    let xref = file.len();
    writeln!(file, "xref\n0 {}\n0000000000 65535 f ", offsets.len()).unwrap();
    for offset in &offsets[1..] {
        writeln!(file, "{offset:010} 00000 n ").unwrap();
    }
    writeln!(
        file,
        "trailer\n<< /Size {} /Root 1 0 R {trailer} >>\nstartxref\n{xref}\n%%EOF",
        offsets.len()
    )
    .unwrap();
    file.into_bytes()
}

fn objects(pages: &[&[&str]]) -> Vec<String> {
    let kids: Vec<_> = (0..pages.len())
        .map(|i| format!("{} 0 R", 4 + i * 2))
        .collect();
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        format!(
            "<< /Type /Pages /Count {} /Kids [{}] >>",
            pages.len(),
            kids.join(" ")
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
    ];
    for lines in pages {
        let contents = objects.len() + 2;
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {contents} 0 R >>"));
        let mut stream = String::from("BT /F1 12 Tf 16 TL 70 720 Td\n");
        for text in *lines {
            let text = text
                .replace('\\', "\\\\")
                .replace('(', "\\(")
                .replace(')', "\\)");
            writeln!(stream, "({text}) Tj T*").unwrap();
        }
        stream.push_str("ET\n");
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.len(),
            stream
        ));
    }
    objects
}

pub(crate) fn fixture(pages: &[&[&str]]) -> Vec<u8> {
    serialize(&objects(pages), "")
}

#[test]
fn native_extraction_preserves_physical_pages_and_line_breaks() {
    let pages = extract_pages(&fixture(&[
        &["First marker", "Second marker"],
        &[],
        &["Third page"],
    ]))
    .unwrap();
    assert_eq!(
        pages.iter().map(|v| v.trim()).collect::<Vec<_>>(),
        ["First marker\nSecond marker", "", "Third page"]
    );
}

#[test]
fn image_only_pdf_has_no_selectable_text() {
    let mut objects = objects(&[&[]]);
    let drawing = "q 24 0 0 24 0 0 cm /Im0 Do Q\n";
    objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 24 24] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>".into();
    objects[4] = format!(
        "<< /Length {} >>\nstream\n{drawing}endstream",
        drawing.len()
    );
    objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 4 >>\nstream\n00>\nendstream".into());
    assert_eq!(
        extract_pages(&serialize(&objects, "")).unwrap_err().0,
        "pdfNoText"
    );
}

#[test]
fn locked_document_is_explicitly_rejected() {
    let mut objects = objects(&[&["never unlock"]]);
    let token = "00".repeat(32);
    let reference = objects.len() + 1;
    objects.push(format!(
        "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <{token}> /U <{token}> /P -4 >>"
    ));
    let trailer = format!("/Encrypt {reference} 0 R /ID [<1122334455667788><1122334455667788>]");
    assert_eq!(
        extract_pages(&serialize(&objects, &trailer)).unwrap_err().0,
        "pdfEncrypted"
    );
}

#[test]
fn malformed_input_and_limits_fail_without_partial_pages() {
    let valid = fixture(&[&["readable"]]);
    assert_eq!(
        extract_pages(&valid[..valid.len() - 5]).unwrap_err().0,
        "invalidPdf"
    );
    assert_eq!(
        extract_pages(b"%PDF-1.7\nstartxref\n500\n%%EOF")
            .unwrap_err()
            .0,
        "invalidPdf"
    );
    assert_eq!(
        extract_pages(&vec![0; MAX_PDF_BYTES + 1]).unwrap_err().0,
        "documentTooLarge"
    );
    let pages = vec![&["bounded"][..]; MAX_PDF_PAGES + 1];
    assert_eq!(
        extract_pages(&fixture(&pages)).unwrap_err().0,
        "documentTooLarge"
    );
}

#[test]
fn aggregate_extracted_text_limit_rejects_document_with_short_individual_pages() {
    let line = "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 abcdefghijklmnopqrstuvwxyz";
    let lines = vec![line; 46];
    let pages = vec![lines.as_slice(); 100];
    let input = fixture(&pages);
    assert!(input.len() < MAX_PDF_BYTES);
    assert_eq!(extract_pages(&input).unwrap_err().0, "documentTooLarge");
}

#[test]
fn valid_xref_stream_and_misdirected_index_have_distinct_outcomes() {
    let entries = objects(&[&["indexed"]]);
    let mut file = b"%PDF-1.5\n".to_vec();
    let mut offsets = vec![0];
    for (i, entry) in entries.iter().enumerate() {
        offsets.push(file.len());
        file.extend(format!("{} 0 obj\n{entry}\nendobj\n", i + 1).bytes());
    }
    let index = file.len();
    offsets.push(index);
    let size = offsets.len();
    file.extend(
        format!(
            "{} 0 obj\n<< /Type/XRef /Size {size} /Root 1 0 R /W [1 4 2] /Length {} >>\nstream\n",
            size - 1,
            size * 7
        )
        .bytes(),
    );
    let catalog_offset = offsets[1];
    for (i, offset) in offsets.into_iter().enumerate() {
        file.push(u8::from(i != 0));
        file.extend((offset as u32).to_be_bytes());
        file.extend(if i == 0 { u16::MAX } else { 0 }.to_be_bytes());
    }
    file.extend(b"\nendstream\nendobj\n");
    let end = file.len();
    file.extend(format!("startxref\n{index}\n%%EOF\n").bytes());
    assert_eq!(extract_pages(&file).unwrap()[0].trim(), "indexed");
    for wrong in [5, catalog_offset] {
        file.truncate(end);
        file.extend(format!("startxref\n{wrong}\n%%EOF\n").bytes());
        assert_eq!(extract_pages(&file).unwrap_err().0, "invalidPdf");
    }
}
