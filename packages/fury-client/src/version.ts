import semver from 'semver';

/** Kiểm phiên bản Fury trong khoảng hỗ trợ (SPEC-01 §6). Chuỗi lạ (`v0.2.23`, `0.2.23-win`) được `coerce`. */
export function isSupportedVersion(version: string | undefined, range: string): boolean {
  if (!version) return false;
  const v = semver.valid(version) ?? semver.coerce(version)?.version;
  if (!v) return false;
  if (!semver.validRange(range)) return false;
  return semver.satisfies(v, range, { includePrerelease: true });
}

/** Chuẩn hóa chuỗi phiên bản để so sánh/ghi nhận (`v0.2.23` → `0.2.23`). */
export function normalizeVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  return semver.valid(version) ?? semver.coerce(version)?.version ?? version;
}
