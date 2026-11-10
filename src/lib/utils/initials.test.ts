import { describe, expect, it } from "bun:test";
import { personInitials } from "./initials";

describe("personInitials", () => {
  it("takes the first letter of the first and of the last word", () => {
    expect(personInitials("Anthony ROYER")).toBe("AR");
    expect(personInitials("Jean Paul Dupont")).toBe("JD");
    expect(personInitials("  élodie   martin ")).toBe("ÉM");
  });

  it("leaves out what is between brackets, whatever the contract", () => {
    expect(personInitials("Alexandre LAMARRE-MARTIN (Alternant)")).toBe("AL");
    expect(personInitials("Timothé FARINA (Alternant)")).toBe("TF");
    expect(personInitials("Mathis Laurent (Intérimaire)")).toBe("ML");
    expect(personInitials("Maxime Dupont [Stagiaire]")).toBe("MD");
    expect(personInitials("Paul Lambert [Indépendant]")).toBe("PL");
    expect(personInitials("Léa Simon (Apprentie) [CDD]")).toBe("LS");
  });

  it("skips signs at the start of a word", () => {
    expect(personInitials("Anne -Sophie")).toBe("AS");
    expect(personInitials("Marc 'Bob' Martin")).toBe("MM");
    expect(personInitials("Luc - Martin")).toBe("LM");
  });

  it("gives two letters for a single word, and ? without letters", () => {
    expect(personInitials("Administrateur")).toBe("AD");
    expect(personInitials("O'Neil")).toBe("ON");
    expect(personInitials("(Alternant)")).toBe("AL");
    expect(personInitials("")).toBe("?");
    expect(personInitials(null)).toBe("?");
    expect(personInitials("123 -")).toBe("?");
  });
});
