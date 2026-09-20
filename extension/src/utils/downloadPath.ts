/**
 * Central download path helpers for the extension.
 * Implementation lives in @nova/shared so tests and UI stay aligned.
 */
export {
  getDownloadPath,
  sanitizeFilename,
  type NovaDownloadKind,
} from "@nova/shared";
