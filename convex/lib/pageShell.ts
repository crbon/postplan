/**
 * The pieces `/s/` and `/u/` share: design tokens lifted from the postplan document
 * shell (true black plane, serif titles, 17px body, filled byline chips), the
 * monoline icon set, and the small formatting helpers both templates need.
 *
 * Both pages are served under a strict CSP (see `convex/http.ts`), so everything
 * here is inline: no external stylesheet, no external image, no iframe.
 */

export const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Human file size. Kept identical on the server and in the upload page's script. */
export const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** "Sep 22" for the byline pill. */
export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "expires in 6 days" / "expires today". Never a bare timestamp. */
export const fmtExpiry = (expiresAt: number, now = Date.now()): string => {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `expires in ${Math.max(1, Math.floor(ms / 60000))} min`;
  if (hours < 24) return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
};

export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "sheet" | "file";

/** Content type first, then the extension, because phones send octet-stream a lot. */
export function kindOf(contentType: string, name: string): Kind {
  const type = (contentType || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name)) return "archive";
  if (
    /spreadsheet|excel/.test(type) ||
    /\.(xlsx?|xlsm|ods|numbers)$/i.test(name)
  )
    return "sheet";
  if (/\.csv$/i.test(name)) return "sheet";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    /\.(md|txt|log|json|ya?ml|toml|ini|py|jsx?|tsx?|mjs|cjs|sh|sql|html?|css|rs|go|java|rb|php|c|h|cpp)$/i.test(name)
  )
    return "text";
  return "file";
}

/** A short label under the name: "PNG image", "Markdown", "ZIP archive". */
export function kindLabel(kind: Kind, contentType: string, name: string): string {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toUpperCase();
  switch (kind) {
    case "image":
      return ext ? `${ext} image` : "Image";
    case "video":
      return ext ? `${ext} video` : "Video";
    case "audio":
      return ext ? `${ext} audio` : "Audio";
    case "pdf":
      return "PDF document";
    case "archive":
      return ext ? `${ext} archive` : "Archive";
    case "sheet":
      return ext ? `${ext} spreadsheet` : "Spreadsheet";
    case "text":
      return ext === "MD" ? "Markdown" : ext ? `${ext} file` : "Text";
    default:
      return ext ? `${ext} file` : contentType || "File";
  }
}

/**
 * One 20px monoline glyph per kind plus the action glyphs, defined once as SVG
 * symbols and used by reference. No emoji anywhere.
 */
export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.6" cy="9.6" r="1.7"/><path d="M4 17l4.7-4.7a2 2 0 0 1 2.8 0L20 20"/></symbol>
<symbol id="i-video" viewBox="0 0 24 24"><rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M16.5 10.2l5-2.7v9l-5-2.7z"/></symbol>
<symbol id="i-audio" viewBox="0 0 24 24"><path d="M9 16.5V5.2l10-1.8v11.4"/><circle cx="6.4" cy="17.4" r="2.6"/><circle cx="16.4" cy="15.6" r="2.6"/></symbol>
<symbol id="i-pdf" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/></symbol>
<symbol id="i-text" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10.5 12.2L8.6 14l1.9 1.8M13.5 12.2L15.4 14l-1.9 1.8"/></symbol>
<symbol id="i-archive" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1.6"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10.2 13h3.6"/></symbol>
<symbol id="i-sheet" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 9.5V20M15 9.5V20"/></symbol>
<symbol id="i-file" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></symbol>
<symbol id="i-dl" viewBox="0 0 24 24"><path d="M12 3.5v11.5M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5"/></symbol>
<symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.4 1.4"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.4-1.4"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></symbol>
<symbol id="i-cal" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/></symbol>
<symbol id="i-stack" viewBox="0 0 16 16"><path d="M8 1.6l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/></symbol>
<symbol id="i-weight" viewBox="0 0 16 16"><path d="M3.4 5.5h9.2l1.2 8.2H2.2z"/><path d="M6 5.5a2 2 0 1 1 4 0"/></symbol>
<symbol id="i-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
</defs></svg>`;

/**
 * Tokens, type scale, chips and buttons, shared by both pages. Mobile first at
 * 375px; every tappable target is at least 44px.
 */
export const BASE_CSS = `
:root{
  --bg:#000;--surface:#1a1a19;--surface-2:#232321;--line:#2c2c2a;--line-strong:#383835;
  --ink:#fff;--ink-2:#c3c2b7;--muted:#898781;--faint:#5e5d59;
  --s1:#3987e5;--good:#0ca30c;--critical:#d03b3b;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 var(--sans);min-height:100vh}
main{width:min(680px,calc(100% - 32px));margin:0 auto;padding:44px 0 72px}
h1{font-family:var(--serif);font-weight:400;font-size:34px;line-height:1.15;letter-spacing:-.01em;margin:0 0 14px}
.byline{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 26px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:4px 12px;border-radius:999px;
  background:#262624;color:#fff;white-space:nowrap;line-height:1.4;font-size:13.5px}
.chip svg{width:13px;height:13px;flex:none;stroke:#fff;fill:none;stroke-width:1.6}
.icon{width:20px;height:20px;flex:none;stroke:#fff;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
/* Every glyph on these two pages is white: sizes, types, pill contents, captions,
   queue metadata, the sent list. Hierarchy comes from size and weight, never from
   grey. Explanatory sentences a button label already covers are deleted, not dimmed.
   The only coloured text left is upload status: green on success, red on failure. */
.line{margin:22px 0 0;color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 16px;
  border-radius:999px;font:600 14px/1 var(--sans);text-decoration:none;cursor:pointer;white-space:nowrap;
  border:1px solid var(--line-strong);background:transparent;color:var(--ink)}
.btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.btn:hover{border-color:#54534e;color:var(--ink)}
.btn.primary{background:#fff;color:#000;border-color:#fff}
.btn.primary:hover{background:#ededea}
.btn.block{width:100%}
.btn:disabled{opacity:.35;cursor:default}
.ibtn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:999px;border:1px solid var(--line-strong);
  background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;flex:none}
.ibtn svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ibtn:hover{border-color:#54534e;color:var(--ink)}
.ibtn.primary{background:#fff;color:#000;border-color:#fff}
.copyfall{display:block;width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--line-strong);
  background:var(--surface);color:var(--ink);font:13px var(--mono)}
[hidden]{display:none !important}
@media (max-width:420px){h1{font-size:28px}body{font-size:16px}main{padding:32px 0 64px}}
`;

/** The serif title plus the byline pills both pages open with. */
export function header(title: string, chips: { icon?: string; text: string }[]): string {
  const pills = chips
    .map(
      (c) =>
        `<span class="chip">${c.icon ? `<svg viewBox="0 0 16 16"><use href="#i-${c.icon}"/></svg>` : ""}${esc(c.text)}</span>`,
    )
    .join("");
  return `<h1>${esc(title)}</h1><div class="byline">${pills}</div>`;
}
