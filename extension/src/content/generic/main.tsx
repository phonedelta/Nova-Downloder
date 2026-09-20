/**
 * Entry for non-YouTube pages.
 * YouTube uses content/main.tsx → bootstrapYouTubeExtension exclusively.
 */
import { isYouTubeHost } from "./webVideoDetector";
import { bootstrapGenericWebVideos } from "./bootstrap";

if (isYouTubeHost()) {
  // Safety: never activate generic detector on YouTube.
} else {
  bootstrapGenericWebVideos();
}
