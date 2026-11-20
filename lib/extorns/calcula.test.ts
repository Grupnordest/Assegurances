import { describe, expect, it } from "vitest";
import { diesNoConsumits, extornEsperat, fiPeriodeCartera } from "./calcula";

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
