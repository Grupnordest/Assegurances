/**
 * Redueix una foto al navegador abans de pujar-la (JPEG, costat llarg ≤ 1600 px), perquè el correu
 * d'alta amb 4 fotos i els documents no passi del límit de Microsoft (~4 MB). Només per al client.
 * Si el fitxer no és una imatge (p. ex. un PDF), es retorna tal qual.
 */
export async function redueixImatge(fitxer: File, costatMax = 1600, qualitat = 0.8): Promise<File> {
  if (!fitxer.type.startsWith("image/")) return fitxer;
  const bitmap = await createImageBitmap(fitxer, { imageOrientation: "from-image" });
  const escala = Math.min(1, costatMax / Math.max(bitmap.width, bitmap.height));
  const amplada = Math.round(bitmap.width * escala);
  const alcada = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = amplada;
  canvas.height = alcada;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fitxer;
  ctx.drawImage(bitmap, 0, 0, amplada, alcada);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", qualitat));
  if (!blob) return fitxer;
  const nom = fitxer.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], nom, { type: "image/jpeg" });
}
