import { describe, expect, it } from "vitest";
import { diesNoConsumits, extornEsperat, fiPeriodeCartera, primaAnualDeRebut, quadra } from "./calcula";

describe("fiPeriodeCartera", () => {
  it("el pròxim 04/06 o 04/12 estrictament posterior", () => {
    expect(fiPeriodeCartera("2026-11-25")).toBe("2026-12-04");
    expect(fiPeriodeCartera("2026-12-04")).toBe("2027-06-04");
    expect(fiPeriodeCartera("2026-12-31")).toBe("2027-06-04");
    expect(fiPeriodeCartera("2027-01-10")).toBe("2027-06-04");
    expect(fiPeriodeCartera("2027-06-03")).toBe("2027-06-04");
    expect(fiPeriodeCartera("2027-06-04")).toBe("2027-12-04");
  });
});

describe("diesNoConsumits", () => {
  it("compta des del dia de baixa fins al final del període", () => {
    expect(diesNoConsumits("2026-11-25")).toBe(9);
    expect(diesNoConsumits("2026-12-03")).toBe(1);
    expect(diesNoConsumits("2026-12-04")).toBe(182);
  });
});

describe("extornEsperat", () => {
  it("prima anual × dies ÷ 365, arrodonit a cèntims (exemple de la spec)", () => {
    expect(extornEsperat(1031.45, "2026-11-25")).toBe(25.43);
  });

  it("sense prima → pendent de prima (null)", () => {
    expect(extornEsperat(null, "2026-11-25")).toBe(null);
    expect(extornEsperat(0, "2026-11-25")).toBe(null);
    expect(extornEsperat(Number.NaN, "2026-11-25")).toBe(null);
  });
});

describe("primaAnualDeRebut", () => {
  it("prima × 365 ÷ dies del rebut (exemple de la spec: 162,81 € del 31/03 al 04/06)", () => {
    expect(primaAnualDeRebut(162.81, "2026-03-31", "2026-06-04")).toBe(914.24);
    expect(extornEsperat(914.24, "2026-04-13")).toBe(130.25);
  });

  it("sense prima o sense dies → null", () => {
    expect(primaAnualDeRebut(0, "2026-03-31", "2026-06-04")).toBe(null);
    expect(primaAnualDeRebut(-5, "2026-03-31", "2026-06-04")).toBe(null);
    expect(primaAnualDeRebut(100, "2026-06-04", "2026-06-04")).toBe(null);
  });
});

describe("quadra", () => {
  it("tolerància de ±1 € inclosa sobre l'import negatiu de l'extorn", () => {
    expect(quadra(130.25, -130.24)).toBe(true);
    expect(quadra(130.25, -131.25)).toBe(true);
    expect(quadra(130.25, -129.25)).toBe(true);
    expect(quadra(130.25, -131.26)).toBe(false);
    expect(quadra(130.25, -129.24)).toBe(false);
  });

  it("un import positiu o zero no quadra mai", () => {
    expect(quadra(130.25, 130.25)).toBe(false);
    expect(quadra(0.5, 0)).toBe(false);
  });
});
