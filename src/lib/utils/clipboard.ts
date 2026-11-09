/**
 * Copies a text to the clipboard; true when it worked.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS, or localhost): on a server reached in plain HTTP
 * on the local network, it is missing and every copy button failed. The hidden text field with
 * `execCommand("copy")` still works there, in every browser, as long as it runs from a click. Inside a dialog,
 * the field goes into the dialog: its focus trap would take the selection back from a field outside it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permissions, document without focus): the fallback below may still work
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    const host = document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    host.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
