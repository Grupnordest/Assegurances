import { describe, expect, it } from "vitest";
import { decideixAcces, parseAdminEmails, type Identitat } from "./acces";

const admins = parseAdminEmails(" Roger.Sabate@grupnordest.com , ");
const ms = (email: string | null, tenant?: string): Identitat => ({ email, proveidor: "azure", tenant });
const actiu = { actiu: true, rols: ["validador" as const] };

describe("parseAdminEmails", () => {
  it("normalitza i descarta buits", () => {
    expect(admins).toEqual(["roger.sabate@grupnordest.com"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });
});

describe("decideixAcces", () => {
  it("permet un usuari actiu donat d'alta", () => {
    expect(decideixAcces(ms("anna@grupnordest.com"), actiu, admins)).toEqual({ tipus: "permet" });
  });

  it("denega un compte del domini que no és a usuaris", () => {
    expect(decideixAcces(ms("anna@grupnordest.com"), null, admins)).toEqual({ tipus: "denega", motiu: "no-alta" });
  });

  it("denega un altre domini, encara que existís", () => {
    expect(decideixAcces(ms("anna@gmail.com"), actiu, admins)).toEqual({ tipus: "denega", motiu: "domini" });
    expect(decideixAcces(ms("x@grupnordest.com.fake.net"), null, admins)).toEqual({ tipus: "denega", motiu: "domini" });
  });

  it("denega sense correu", () => {
    expect(decideixAcces(ms(null), null, admins)).toEqual({ tipus: "denega", motiu: "domini" });
  });

  it("denega un correu del domini que no ve de Microsoft", () => {
    const altre = { email: "roger.sabate@grupnordest.com", proveidor: "email" };
    expect(decideixAcces(altre, null, admins)).toEqual({ tipus: "denega", motiu: "domini" });
  });

  it("denega un altre directori de Microsoft si hi ha tenant configurat", () => {
    expect(decideixAcces(ms("anna@grupnordest.com", "altre"), actiu, admins, "nordest")).toEqual({
      tipus: "denega",
      motiu: "domini",
    });
    expect(decideixAcces(ms("anna@grupnordest.com", "NORDEST"), actiu, admins, "nordest")).toEqual({ tipus: "permet" });
  });

  it("denega un usuari desactivat, encara que sigui a ADMIN_EMAILS", () => {
    expect(decideixAcces(ms("roger.sabate@grupnordest.com"), { actiu: false, rols: [] }, admins)).toEqual({
      tipus: "denega",
      motiu: "desactivat",
    });
  });

  it("crea el primer admin si és a ADMIN_EMAILS i no existeix (ignora majúscules)", () => {
    expect(decideixAcces(ms("ROGER.SABATE@grupnordest.com"), null, admins)).toEqual({ tipus: "crea-admin" });
  });

  it("repara el primer admin si va quedar creat sense rols", () => {
    expect(decideixAcces(ms("roger.sabate@grupnordest.com"), { actiu: true, rols: [] }, admins)).toEqual({
      tipus: "crea-admin",
    });
  });
});
