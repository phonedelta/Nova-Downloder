import {
  getCurrentPageVideoId,
  isSupportedYouTubePage,
  buildWatchUrl,
} from "../utils/videoId";
import { getPageVideoTitle } from "../utils/youtubeSelectors";

export function getCurrentVideoInfo() {
  const videoId = getCurrentPageVideoId();
  const supported = isSupportedYouTubePage();
  return {
    videoId,
    url: videoId ? buildWatchUrl(videoId) : null,
    title: getPageVideoTitle(),
    isYouTube: location.hostname.includes("youtube.com"),
    supported,
  };
}
