import { describe, expect, it } from "vitest";
import { matriculaDelNom, matriculesConegudesA, matriculesDelText } from "./matricula";

const conegudes = ["1234ABC", "5678DEF", "GI1234AB"];

describe("matriculaDelNom", () => {
  it("troba la matrícula amb prefix, espais i guions", () => {
    expect(matriculaDelNom("POL. 1234ABC.pdf", conegudes)).toBe("1234ABC");
    expect(matriculaDelNom("5678-def.PDF", conegudes)).toBe("5678DEF");
    expect(matriculaDelNom("pol gi 1234 ab.pdf", conegudes)).toBe("GI1234AB");
  });
  it("null si no n'hi ha o n'hi ha més d'una", () => {
    expect(matriculaDelNom("factura.pdf", conegudes)).toBeNull();
    expect(matriculaDelNom("1234ABC i 5678DEF.pdf", conegudes)).toBeNull();
    expect(matriculaDelNom("9999ZZZ.pdf", conegudes)).toBeNull();
  });
});

describe("matriculesConegudesA", () => {
  it("retorna les diferents trobades al text", () => {
    expect(matriculesConegudesA("Matrícula: 1234 ABC ... 1234ABC", conegudes)).toEqual(["1234ABC"]);
    expect(matriculesConegudesA("res", conegudes)).toEqual([]);
  });
});

describe("matriculesDelText", () => {
  it("troba la matrícula com a paraula, amb espai o guió", () => {
    expect(matriculesDelText("Matrícula: 1234 ABC\nMarca", conegudes)).toEqual(["1234ABC"]);
    expect(matriculesDelText("vehicle gi-1234-ab", conegudes)).toEqual(["GI1234AB"]);
  });
  it("no la treu de dins d'un número més llarg", () => {
    expect(matriculesDelText("Pòlissa 991234ABC1", conegudes)).toEqual([]);
    expect(matriculesDelText("Ref 51234ABC", conegudes)).toEqual([]);
  });
});
