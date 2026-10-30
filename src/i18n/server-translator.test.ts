import { describe, expect, test } from "bun:test";
import { getServerTranslator, translateKey } from "./server-translator";
import { loadMessages, pickClientMessages } from "./messages";
import { SERVER_ONLY_NAMESPACES } from "./config";

describe("getServerTranslator (outside a request)", () => {
  test("translates into the requested language", async () => {
    const fr = await getServerTranslator("fr");
    const en = await getServerTranslator("en");
    expect(fr("common.actions.save")).toBe("Enregistrer");
    expect(en("common.actions.save")).toBe("Save");
    expect(en("errors.unauthenticated")).toBe("Not authenticated");
  });
  test("ICU plurals (=0, one, other)", async () => {
    const fr = await getServerTranslator("fr");
    const en = await getServerTranslator("en");
    expect(fr("common.table.selectedRows", { count: 0 })).toBe("Aucune ligne sélectionnée");
    expect(fr("common.table.selectedRows", { count: 1 })).toBe("1 ligne sélectionnée");
    expect(fr("common.table.selectedRows", { count: 3 })).toBe("3 lignes sélectionnées");
    expect(en("common.table.selectedRows", { count: 1 })).toBe("1 row selected");
    expect(fr("audit.changes.recipients", { count: 0 })).toBe("0 destinataire");
  });
});

describe("translateKey", () => {
  test("known code → text; legacy message or unknown key → null", async () => {
    const en = await getServerTranslator("en");
    expect(translateKey(en, "errors.forbidden")).toBe("Access denied");
    expect(translateKey(en, "errors.fileTooLargeMax", { max: "10 MB" })).toBe("File too large. Maximum: 10 MB");
    expect(translateKey(en, "Tâche non trouvée")).toBeNull();
    expect(translateKey(en, "errors.doesNotExist")).toBeNull();
    expect(translateKey(en, "errors")).toBeNull();
  });
});

test("pickClientMessages removes the server namespaces", async () => {
  const messages = await loadMessages("fr");
  const client = pickClientMessages(messages) as Record<string, unknown>;
  for (const ns of SERVER_ONLY_NAMESPACES) expect(client[ns]).toBeUndefined();
  expect(client.common).toBeDefined();
});
