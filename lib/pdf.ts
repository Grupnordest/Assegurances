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
