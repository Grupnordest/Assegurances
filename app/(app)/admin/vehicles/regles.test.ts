import { describe, expect, it } from "vitest";
import { classificacioSchema, esDataReal, missatgeErrorVehicles } from "./regles";

describe("esDataReal", () => {
  it("rebutja dates impossibles", () => {
    expect(esDataReal("2026-02-28")).toBe(true);
    expect(esDataReal("2026-02-31")).toBe(false);
    expect(esDataReal("2026-13-01")).toBe(false);
  });
});

describe("classificacioSchema", () => {
  const base = { id: "3f1c9a2e-5b7d-4c8e-9f0a-1b2c3d4e5f60", versio: "2026-11-20T10:00:00Z" };
  it("camps buits → null", () => {
    const r = classificacioSchema.safeParse({ ...base, motiu: "", responsable: "", centre: "", dataPrevista: "" });
    expect(r.success && r.data).toMatchObject({ motiu: null, responsable: null, centre: null, dataPrevista: null });
  });
  it("rebutja motius, centres i dates no vàlids", () => {
    expect(classificacioSchema.safeParse({ ...base, motiu: "lloguer" }).success).toBe(false);
    expect(classificacioSchema.safeParse({ ...base, centre: "99999" }).success).toBe(false);
    expect(classificacioSchema.safeParse({ ...base, dataPrevista: "2026-02-31" }).success).toBe(false);
  });
});

describe("missatgeErrorVehicles", () => {
  it("tradueix els errors de les funcions", () => {
    expect(missatgeErrorVehicles({ code: "P0001", message: "ja_carregat" })).toBe("La càrrega inicial ja s'ha fet.");
    expect(missatgeErrorVehicles({ code: "P0001", message: "canviat" })).toContain("Algú altre");
    expect(missatgeErrorVehicles({ code: "42501" })).toBe("No tens permís per fer aquesta acció.");
  });
});
