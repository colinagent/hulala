import { parseDesktopReleaseManifest, type DesktopReleaseManifest } from "@hulala/desktop-contracts/release-manifest";

const DEFAULT_MANIFEST_URL = "https://downloads.hulala.ai/hulala/desktop/latest/manifest.json";

export async function loadRelease(): Promise<DesktopReleaseManifest | null> {
  const url = process.env.HULALA_DESKTOP_MANIFEST_URL || DEFAULT_MANIFEST_URL;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    return parseDesktopReleaseManifest(await response.json());
  } catch {
    return null;
  }
}
