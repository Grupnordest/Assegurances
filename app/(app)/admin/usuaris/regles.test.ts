import { describe, expect, it } from "vitest";
import {
  canviActiuSchema,
  esCorreuDuplicat,
  hiHaCapPostvendaActiu,
  missatgeErrorBd,
  quedaAlgunAdmin,
  usuariSchema,
  type UsuariRegles,
} from "./regles";

const roger: UsuariRegles = { id: "1", email: "roger.sabate@grupnordest.com", actiu: true, rols: ["administracio"] };
const anna: UsuariRegles = { id: "2", email: "anna@grupnordest.com", actiu: true, rols: ["validador"] };

describe("quedaAlgunAdmin", () => {
  it("bloqueja desactivar l'únic administrador", () => {
    expect(quedaAlgunAdmin([roger, anna], { id: "1", actiu: false })).toBe(false);
  });

  it("bloqueja treure el rol a l'únic administrador", () => {
    expect(quedaAlgunAdmin([roger, anna], { id: "1", rols: ["validador"] })).toBe(false);
  });

  it("permet-ho si queda un altre administrador actiu", () => {
    const anna2 = { ...anna, rols: ["administracio" as const] };
    expect(quedaAlgunAdmin([roger, anna2], { id: "1", actiu: false })).toBe(true);
  });

  it("un administrador desactivat no compta", () => {
    const anna2 = { ...anna, actiu: false, rols: ["administracio" as const] };
    expect(quedaAlgunAdmin([roger, anna2], { id: "1", actiu: false })).toBe(false);
  });
});

describe("esCorreuDuplicat", () => {
  it("detecta duplicats sense distingir majúscules", () => {
    expect(esCorreuDuplicat([roger, anna], "ANNA@grupnordest.com")).toBe(true);
  });

  it("no compta l'usuari que s'està editant", () => {
    expect(esCorreuDuplicat([roger, anna], "anna@grupnordest.com", "2")).toBe(false);
  });
});

describe("hiHaCapPostvendaActiu", () => {
  it("avisa si no n'hi ha cap d'actiu", () => {
    expect(hiHaCapPostvendaActiu([roger, anna])).toBe(false);
    expect(hiHaCapPostvendaActiu([roger, { ...anna, rols: ["cap_postvenda"], actiu: false }])).toBe(false);
    expect(hiHaCapPostvendaActiu([roger, { ...anna, rols: ["cap_postvenda"] }])).toBe(true);
  });
});

describe("usuariSchema", () => {
  const base = { nom: "Anna", email: " Anna@GrupNordest.com ", centreId: "5", rols: ["sollicitant"] };

  it("normalitza el correu i accepta dades vàlides", () => {
    const r = usuariSchema.safeParse(base);
    expect(r.success && r.data.email).toBe("anna@grupnordest.com");
  });

  it("rebutja altres dominis, sense rols o sense nom", () => {
    expect(usuariSchema.safeParse({ ...base, email: "anna@gmail.com" }).success).toBe(false);
    expect(usuariSchema.safeParse({ ...base, rols: [] }).success).toBe(false);
    expect(usuariSchema.safeParse({ ...base, nom: "  " }).success).toBe(false);
  });

  it("exigeix un centre, amb missatge en català", () => {
    for (const centreId of ["", "0", "abc", null]) {
      const r = usuariSchema.safeParse({ ...base, centreId });
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues[0].message).toBe("Tria un centre.");
    }
  });
});

describe("canviActiuSchema", () => {
  const id = "3f1c9a2e-5b7d-4c8e-9f0a-1b2c3d4e5f60";
  it("rebutja valors que no són booleans (p. ex. el text \"false\")", () => {
    expect(canviActiuSchema.safeParse({ id, actiu: "false" }).success).toBe(false);
    expect(canviActiuSchema.safeParse({ id, actiu: false }).success).toBe(true);
  });
  it("rebutja ids que no són uuid", () => {
    expect(canviActiuSchema.safeParse({ id: "1", actiu: true }).success).toBe(false);
  });
});

describe("missatgeErrorBd", () => {
  it("tradueix els errors coneguts de la base de dades", () => {
    expect(missatgeErrorBd({ code: "23505" })).toBe("Aquest usuari ja existeix.");
    expect(missatgeErrorBd({ code: "P0001", message: "ultim_admin" })).toBe("Ha de quedar com a mínim un administrador.");
    expect(missatgeErrorBd({ code: "42501" })).toBe("No tens permís per fer aquesta acció.");
    expect(missatgeErrorBd({ code: "XX000" })).toBe("No s'ha pogut desar. Torna-ho a provar.");
  });
});
