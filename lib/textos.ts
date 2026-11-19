import type { MotiuDenegacio, Rol } from "./acces";

/** Tots els textos de la interfície (català). */
export const t = {
  app: {
    titol: "Control d'assegurances",
    descripcio: "Control de vehicles assegurats de Grup Nordest",
  },
  login: {
    titol: "Entra a l'eina",
    explicacio: "Fes servir el teu compte de Grup Nordest (@grupnordest.com).",
    boto: "Entra amb Microsoft",
    error: "No s'ha pogut iniciar la sessió. Torna-ho a provar.",
  },
  senseAcces: {
    titol: "No tens accés",
    motius: {
      domini: "Només hi poden entrar comptes de Grup Nordest (@grupnordest.com).",
      "no-alta": "El teu compte no està donat d'alta a l'eina. Demana accés a Administració.",
      desactivat: "El teu usuari està desactivat. Si creus que és un error, parla amb Administració.",
    } satisfies Record<MotiuDenegacio, string>,
    generic: "No s'ha pogut validar l'accés. Torna-ho a provar o parla amb Administració.",
    tornar: "Torna a l'inici de sessió",
  },
  menu: {
    inici: "Inici",
    usuaris: "Usuaris",
    sortir: "Surt",
  },
  inici: {
    hola: (nom: string) => `Hola, ${nom}`,
    centre: "Centre",
    senseCentre: "Sense centre",
    rols: "Rols",
    senseRols: "Cap rol assignat. Parla amb Administració.",
  },
  error: {
    titol: "Alguna cosa no ha anat bé",
    text: "No s'han pogut carregar les dades. Torna-ho a provar d'aquí a un moment.",
    reintenta: "Torna-ho a provar",
  },
  rols: {
    sollicitant: "Sol·licitant",
    validador: "Validador",
    cap_postvenda: "Cap de postvenda",
    administracio: "Administració",
  } satisfies Record<Rol, string>,
  usuaris: {
    titol: "Usuaris",
    nou: "Nou usuari",
    filtreCentre: "Centre",
    filtreRol: "Rol",
    tots: "Tots",
    filtra: "Filtra",
    buit: "No hi ha cap usuari amb aquests filtres.",
    inactiu: "Desactivat",
    edita: "Edita",
    desactiva: "Desactiva",
    reactiva: "Reactiva",
    cancela: "Cancel·la",
    desa: "Desa",
    camps: {
      nom: "Nom",
      email: "Correu",
      centre: "Centre",
      rols: "Rols",
    },
    avisSenseCapPostvenda:
      "No hi ha cap usuari actiu amb el rol Cap de postvenda. Les altes i baixes dels VS no tindran qui les validi.",
    errors: {
      permis: "No tens permís per fer aquesta acció.",
      duplicat: "Aquest usuari ja existeix.",
      ultimAdmin: "Ha de quedar com a mínim un administrador.",
      email: "El correu ha de ser @grupnordest.com.",
      nom: "Cal indicar el nom.",
      rols: "Tria com a mínim un rol.",
      centre: "Tria un centre.",
      generic: "No s'ha pogut desar. Torna-ho a provar.",
      noTrobat: "Aquest usuari no existeix.",
      propiCorreu: "No pots canviar el teu propi correu: perdries l'accés.",
    },
    desat: "Desat.",
  },
};
