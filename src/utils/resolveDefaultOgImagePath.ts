import type { ResolvedAstroPaperConfig } from "@/types/config";
import { getAssetPath } from "./withBase";

const staticFiles = import.meta.glob("/static/*", { eager: false });

function existsInStatic(filename: string): boolean {
  return `/static/${filename}` in staticFiles;
}

/**
 * Resolves the absolute OG image path used for pages/posts.
 *
 * Security note: `site.ogImage` must be a single filename under `static/` to avoid
 * path traversal or referencing arbitrary files.
 *
 * Behavior:
 * - When `features.dynamicOgImage` is enabled, prefers `static/{site.ogImage}` when present,
 *   otherwise falls back to the generated `/og.png`.
 * - When disabled, requires `static/{site.ogImage}` to exist.
 */
export function resolveDefaultOgImagePath(
  config: ResolvedAstroPaperConfig,
): string {
  const filename = config.site.ogImage;
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new Error(
      `site.ogImage must be a single filename in static/ (e.g. "default-og.jpg"), got "${filename}"`,
    );
  }

  if (config.features.dynamicOgImage) {
    return existsInStatic(filename)
      ? getAssetPath(filename)
      : getAssetPath("og.png");
  }

  if (!existsInStatic(filename)) {
    throw new Error(
      `AstroPaper: missing static/${filename}. Add that file, or set site.ogImage to an existing file under static/, or enable features.dynamicOgImage to fall back to /og.png.`,
    );
  }

  return getAssetPath(filename);
}
