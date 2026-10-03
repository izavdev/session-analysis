export function isAnalyzerActivity(text:string):boolean {
  const value=text.trim();
  if(/\b(?:implement|fix|refactor|develop|extend)\b/i.test(value)) return false;
  return /^[$/]session-analysis(?:\s|$)/i.test(value)||/^(?:please\s+)?(?:use|run|invoke)\s+(?:the\s+)?(?:[$/]?session-analysis)(?:\s+skill)?(?:[.!?]?$|\s+(?:to\s+)?(?:analy[sz]e|review|summari[sz]e|inspect)\b)/i.test(value)||/^(?:analy[sz]e|review)\b[^\n]*\b(?:using|with)\s+(?:the\s+)?[$/]?session-analysis(?:\s+skill)?[.!?]?$/i.test(value);
}
export function isSessionControl(text:string):boolean {
  // Match before task-text normalization removes slash/markup distinctions.
  // Keep controls in the timeline, but do not treat session housekeeping as reusable work.
  const value=text.trim();
  return /^\/(?:clear|compact)(?:\s+[^\n]*)?$/i.test(value) ||
    /^<command-name>\/(?:clear|compact)<\/command-name>\s*(?:<command-message>[^<]*<\/command-message>\s*)?(?:<command-args>[\s\S]*?<\/command-args>\s*)?$/i.test(value);
}
