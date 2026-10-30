import { AppError } from "@/lib/errors";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

/**
 * Chat attachments. Office formats are converted to text here: this works
 * with ALL models. A PDF comes back in both forms, its extracted text and the
 * document itself: the choice is made at send time, when the model is known
 * (a model that reads files receives the PDF intact).
 */

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
/** Cap on the text sent to the model, per attachment. */
const MAX_TEXT_LENGTH = 200_000;

export interface Attachment {
  name: string;
  kind: "text" | "image" | "pdf";
  text?: string;
  mediaType?: string;
  dataUrl?: string;
  /** Length of the text actually read from the document. */
  characters?: number;
}

const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** Text of a PDF; an empty string for a scan without a text layer. */
async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).slice(0, 400_000);
}

async function docxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

/** One sheet per block, one line per row, cells separated by tabs. */
async function workbookText(buffer: Buffer, name: string): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new AppError("aiChat.attachments.errors.unreadableWorkbook", {
      params: { name, detail: error instanceof Error ? error.message : String(error) },
    });
  }
  // Sheet header read by the model and visible in the document preview: user language
  const t = await getServerTranslator(await resolveRequestLocale());
  const cellText = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if ("result" in obj) return cellText(obj.result);
      if ("text" in obj) return String(obj.text);
      if (Array.isArray(obj.richText)) return (obj.richText as { text: string }[]).map((r) => r.text).join("");
      if ("hyperlink" in obj) return String(obj.text ?? obj.hyperlink);
    }
    return String(value);
  };
  const blocks: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = values.map(cellText).join("\t").trimEnd();
      if (line.trim()) lines.push(line);
    });
    if (lines.length) blocks.push(`${t("aiChat.attachments.sheetHeading", { name: sheet.name })}\n${lines.join("\n")}`);
  });
  return blocks.join("\n\n");
}

/** Reads an attachment, according to its type. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_SIZE) throw new AppError("aiChat.attachments.errors.tooLarge");
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name || "piece-jointe";
  const type = file.type || "";
  const ext = extension(name);

  if (type.startsWith("image/")) {
    return { name, kind: "image", mediaType: type, dataUrl: `data:${type};base64,${buffer.toString("base64")}` };
  }

  if (ext === "pdf") {
    // A scan has no text layer: it can still be sent as is to a model that reads files
    const text = await pdfText(buffer).catch(() => "");
    return {
      name,
      kind: "pdf",
      mediaType: "application/pdf",
      dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}`,
      text: text.slice(0, MAX_TEXT_LENGTH),
      characters: text.length,
    };
  }

  let text: string;
  if (ext === "docx") text = await docxText(buffer);
  else if (ext === "xlsx" || ext === "xlsm") text = await workbookText(buffer, name);
  else if (ext === "csv" || ext === "txt" || type.startsWith("text/")) text = new TextDecoder("utf-8").decode(buffer);
  else throw new AppError("aiChat.attachments.errors.unsupportedFormat");

  if (!text.trim()) throw new AppError("aiChat.attachments.errors.noText");
  return { name, kind: "text", text: text.slice(0, MAX_TEXT_LENGTH), characters: text.length };
}
