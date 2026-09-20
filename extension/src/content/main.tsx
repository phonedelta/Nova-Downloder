/**
 * YouTube-only content entry.
 * Generic web videos use content/generic/main.tsx → content-generic.js
 * and never share this bootstrap path.
 */
import { bootstrapYouTubeExtension } from "./youtube";

bootstrapYouTubeExtension();
