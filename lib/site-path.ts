const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function sitePath(path: string): string {
  return path.startsWith("#") || /^https?:\/\//i.test(path) ? path : `${basePath}${path}`;
}
