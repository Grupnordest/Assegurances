import { describe, expect, it } from "vitest";
import { diesLaborablesDes } from "./dies-laborables";
import { esCaigudaForta } from "@/app/(app)/admin/estoc/regles";

// 2026-11-16 és dilluns.
const d = (s: string) => new Date(s);

describe("diesLaborablesDes", () => {
  it("compta de dilluns a divendres, sense el dia d'inici", () => {
    expect(diesLaborablesDes(d("2026-11-16T10:00:00+01:00"), d("2026-11-16T18:00:00+01:00"))).toBe(0);
    expect(diesLaborablesDes(d("2026-11-16T10:00:00+01:00"), d("2026-11-19T09:00:00+01:00"))).toBe(3);
    expect(diesLaborablesDes(d("2026-11-16T10:00:00+01:00"), d("2026-11-20T09:00:00+01:00"))).toBe(4);
  });

  it("no compta el cap de setmana", () => {
    // divendres → dilluns = 1
    expect(diesLaborablesDes(d("2026-11-20T10:00:00+01:00"), d("2026-11-23T10:00:00+01:00"))).toBe(1);
  });

  it("fa servir l'hora de Madrid (23:30 UTC de diumenge ja és dilluns a Madrid)", () => {
    expect(diesLaborablesDes(d("2026-11-13T12:00:00Z"), d("2026-11-15T23:30:00Z"))).toBe(1);
  });
});

describe("esCaigudaForta", () => {
  it("demana confirmació si hi ha menys de la meitat", () => {
    expect(esCaigudaForta(274, 120)).toBe(true);
    expect(esCaigudaForta(274, 137)).toBe(false);
    expect(esCaigudaForta(0, 5)).toBe(false);
  });
});
