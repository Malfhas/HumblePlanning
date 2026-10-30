import { describe, expect, it } from "bun:test";
import { idsToResolve, toolLabel, summarizeAction, type ActionsTranslator } from "./actions";
import { getServerTranslatorSync } from "@/i18n/server-translator";

/** The screen's `aiChat.actions` translator, rebuilt for one language. */
function translator(locale: "fr" | "en"): ActionsTranslator {
  const t = getServerTranslatorSync(locale) as unknown as ((k: string, v?: Record<string, unknown>) => string) & { has(k: string): boolean };
  return Object.assign((k: string, v?: Record<string, unknown>) => t(`aiChat.actions.${k}`, v), {
    has: (k: string) => t.has(`aiChat.actions.${k}`),
  }) as unknown as ActionsTranslator;
}
const fr = { t: translator("fr"), intlTag: "fr-FR" };
const en = { t: translator("en"), intlTag: "en-GB" };

describe("readable summary of a proposed write", () => {
  it("names each schedule write in plain words", () => {
    expect(toolLabel(fr.t, "delete-task")).toBe("Supprimer une tâche");
    expect(toolLabel(fr.t, "create-project")).toBe("Créer un projet");
    expect(toolLabel(fr.t, "outil-inconnu", "Description du serveur")).toBe("Description du serveur");
    expect(toolLabel(en.t, "delete-task")).toBe("Delete a task");
  });

  it("shows the resolved objects first, then the values, dates in the language format", () => {
    const labels: Record<string, string> = { "p1": "IA-001 - Chantier", "u1": "Alice Martin", "u2": "Marc Durand", "s1": "À faire" };
    const input = { projectId: "p1", userIds: ["u1", "u2"], statusId: "s1", startDate: "2026-11-02", title: "Pose câblage" };
    const { title, lines } = summarizeAction(fr, "create-task", input, undefined, (_key, id) => labels[id]);
    expect(title).toBe("Créer une tâche");
    expect(lines).toEqual([
      { label: "Projet", value: "IA-001 - Chantier" },
      { label: "Personnes assignées", value: "Alice Martin, Marc Durand" },
      { label: "Statut", value: "À faire" },
      { label: "Date de début", value: "02/11/2026" },
      { label: "Titre", value: "Pose câblage" },
    ]);
    const english = summarizeAction(en, "create-task", input, undefined, (_key, id) => labels[id]);
    expect(english.title).toBe("Create a task");
    expect(english.lines.map((l) => l.label)).toEqual(["Project", "Assignees", "Status", "Start date", "Title"]);
  });

  it("a deletion is never an empty card: the task is named", () => {
    const { lines } = summarizeAction(fr, "delete-task", { taskId: "t1" }, undefined, () => "Réunion de chantier (03/11/2026)");
    expect(lines).toEqual([{ label: "Tâche", value: "Réunion de chantier (03/11/2026)" }]);
    expect(idsToResolve({ taskId: "t1", title: "x" })).toEqual({ taskId: ["t1"] });
  });

  it("as long as the label is not read, the line waits (…)", () => {
    expect(summarizeAction(fr, "delete-task", { taskId: "t1" }).lines[0]?.value).toBe("…");
  });

  it("translates enum values and booleans", () => {
    const { lines } = summarizeAction(fr, "update-project", { status: "in_progress", archived: true });
    expect(lines).toEqual([
      { label: "Statut", value: "En cours" },
      { label: "Archived", value: "Oui" },
    ]);
    expect(summarizeAction(en, "update-project", { status: "done" }).lines[0]?.value).toBe("Done");
  });
});
