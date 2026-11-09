import sharp from "sharp";
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

/** The image formats the models read through OpenRouter; any other is converted. */
const MODEL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/**
 * Models scale an image down to about 2000 px on its long side anyway: a photo
 * sent in full (up to 20 MB, a third more in base64) only slowed the request.
 */
export const IMAGE_MAX_PX = 2048;
const IMAGE_MAX_BYTES = 1024 * 1024;

/**
 * The image as the model gets it: as is when it is already small and in a
 * format the models read, otherwise turned upright, reduced to IMAGE_MAX_PX and
 * encoded in JPEG (on white: transparency means nothing to a model). An image
 * that cannot be read here goes as is, as before.
 */
export async function imageForModel(buffer: Buffer, type: string): Promise<{ buffer: Buffer; type: string }> {
  try {
    const meta = await sharp(buffer).metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (MODEL_IMAGE_TYPES.includes(type) && longest <= IMAGE_MAX_PX && buffer.length <= IMAGE_MAX_BYTES) {
      return { buffer, type };
    }
    const reduced = await sharp(buffer)
      .rotate()
      .resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: reduced, type: "image/jpeg" };
  } catch {
    return { buffer, type };
  }
}

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
    const image = await imageForModel(buffer, type);
    return { name, kind: "image", mediaType: image.type, dataUrl: `data:${image.type};base64,${image.buffer.toString("base64")}` };
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
