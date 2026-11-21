/** Comprova la capçalera "%PDF-" (no ens fiem de l'extensió ni del tipus que envia el navegador). */
export function esPdf(contingut: Uint8Array): boolean {
  return (
    contingut.length > 5 &&
    contingut[0] === 0x25 &&
    contingut[1] === 0x50 &&
    contingut[2] === 0x44 &&
    contingut[3] === 0x46 &&
    contingut[4] === 0x2d
  );
}

export type TipusDocument = "pdf" | "xlsx" | "xls";

export const MIME: Record<TipusDocument, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

/** Tipus pel contingut: PDF, Excel nou (zip "PK\x03\x04") o Excel antic (OLE "D0 CF 11 E0"). */
export function tipusDocument(c: Uint8Array): TipusDocument | null {
  if (esPdf(c)) return "pdf";
  if (c.length > 4 && c[0] === 0x50 && c[1] === 0x4b && c[2] === 0x03 && c[3] === 0x04) return "xlsx";
  if (c.length > 4 && c[0] === 0xd0 && c[1] === 0xcf && c[2] === 0x11 && c[3] === 0xe0) return "xls";
  return null;
}
