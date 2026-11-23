const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function renderMarkdown(text: string): string {
  if (!text) return "";

  // Aspas também são escapadas: a URL do link vai para dentro de href="…",
  // e uma aspa crua fecharia o atributo e permitiria injetar onmouseover etc.
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");
  // Só http(s) e mailto viram link. Qualquer outro esquema (javascript:,
  // data:, …) fica como texto puro, sem <a>.
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, label: string, url: string) =>
    SAFE_URL.test(url.trim())
      ? `<a href="${url.trim()}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">${label}</a>`
      : match,
  );

  const lines = html.split("\n");
  let inList = false;
  const processed = lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        const item = trimmed.substring(2);
        if (!inList) {
          inList = true;
          return `<ul class="ml-4 list-disc"><li>${item}</li>`;
        }
        return `<li>${item}</li>`;
      }
      if (inList && trimmed !== "") {
        inList = false;
        return `</ul>\n${trimmed}`;
      }
      if (inList && trimmed === "") {
        return "";
      }
      return trimmed ? line : "";
    })
    .join("\n");

  return inList ? processed + "</ul>" : processed;
}
