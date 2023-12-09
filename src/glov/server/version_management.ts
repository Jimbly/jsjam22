import assert from 'assert';
import { PlatformID as Platform } from 'glov/common/platform';

export class SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;

  constructor(major = 0, minor = 0, patch = 0) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
  }

  compareTo(other: SemanticVersion, ignore_patch = false, ignore_minor = false): number {
    return this.major > other.major ? 1 :
      this.major < other.major ? -1 :
      ignore_minor ? 0 :
      this.minor > other.minor ? 1 :
      this.minor < other.minor ? -1 :
      ignore_patch ? 0 :
      this.patch > other.patch ? 1 :
      this.patch < other.patch ? -1 :
      0;
  }

  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  static parse(str: string): SemanticVersion | null {
    if (str.length === 0) {
      return null;
    }
    let splits = str.split('.');
    let major = Number(splits[0]);
    let minor = splits[1] !== undefined ? Number(splits[1]) : 0;
    let patch = splits[2] !== undefined ? Number(splits[2]) : 0;
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
      return null;
    }
    return new SemanticVersion(major, minor, patch);
  }
}

export const enum VersionSupport {
  Supported = 1, // The version is not up-to-date but still supported
  Obsolete = 2,  // The version is no longer supported
  Upcoming = 3,  // The version is not yet supported
}

let current_ver = new SemanticVersion();
let min_ver = new SemanticVersion();
let plat_min_vers: Partial<Record<Platform, SemanticVersion>> = {};
let plat_latest_vers: Partial<Record<Platform, SemanticVersion>> = {};
let plat_fallback_envs: Partial<Record<Platform, string>> = {};

/**
 * Check if the value corresponds to a valid version.
 * @param {string} value The value to check.
 * @returns {boolean} `true` if the provided value is a valid version; `false`otherwise.
 */
export function isValidVersion(value: string | undefined | null): boolean {
  return value !== undefined && value !== null && Boolean(SemanticVersion.parse(value));
}

/**
 * Setup the version support.
 * @param {string} current_version Current version.
 * @param {string} min_supported_version Minimum supported version.
 * @param {Partial<Record<Platform, string>>} platform_min_supported_versions Optional minimum supported versions
 * for each platform that differs from `min_supported_version`. Allows forcing the update of specific platforms.
 * Each of these versions must be equal to or newer than `min_supported_version`.
 * @returns {void}
 */
export function setupVersionSupport(
  current_version: string,
  min_supported_version?: string | undefined | null,
  platform_min_supported_versions?: Partial<Record<Platform, string>> | undefined | null
): void {
  let v = SemanticVersion.parse(current_version);
  assert(v);
  current_ver = v;

  v = min_supported_version !== undefined && min_supported_version !== null ?
    SemanticVersion.parse(min_supported_version) :
    current_ver;
  assert(v && v.compareTo(current_ver) <= 0);
  min_ver = v;

  plat_min_vers = {};
  if (platform_min_supported_versions) {
    for (let p in platform_min_supported_versions) {
      let platform = p as Platform;
      let v_str = platform_min_supported_versions[platform];
      v = v_str ? SemanticVersion.parse(v_str) : null;
      assert(v && v.compareTo(current_ver) <= 0);
      plat_min_vers[platform] = v;
    }
  }
}

/**
 * Set latest released versions for different platforms.
 * Allows detection of older versions that need to be updated.
 * @param {Partial<Record<Platform, string>>} latest_versions Latest released versions per platform.
 * @returns {void}
 */
export function setLatestVersions(
  latest_versions: Partial<Record<Platform, string>> | undefined | null
): void {
  plat_latest_vers = {};
  if (latest_versions) {
    for (let p in latest_versions) {
      let platform = p as Platform;
      let v_str = latest_versions[platform];
      let v = v_str ? SemanticVersion.parse(v_str) : null;
      assert(v);
      plat_latest_vers[platform] = v;
    }
  }
}

/**
 * Set fallback environments for different platforms. Allows using a different environment when the current server
 * does not yet support an upcoming version.
 * @param {Partial<Record<Platform, string>>} fallback_environments Fallback environment names per platform.
 * @returns {void}
 */
export function setFallbackEnvironments(
  fallback_environments: Partial<Record<Platform, string>> | undefined | null
): void {
  plat_fallback_envs = {};
  if (fallback_environments) {
    for (let p in fallback_environments) {
      let platform = p as Platform;
      let environment = fallback_environments[platform];
      assert(environment);
      plat_fallback_envs[platform] = environment;
    }
  }
}

/**
 * Check if a client's version is supported.
 * @param {Platform} platform The client's platform.
 * @param {string} version The client's version.
 * @return {VersionSupport} One of three values signaling if `version` is supported, obsolete, or upcoming.
 */
export function getVersionSupport(platform: Platform, version: string): VersionSupport {
  let v = SemanticVersion.parse(version);
  assert(v);
  let oldest_supported = plat_min_vers[platform] ?? min_ver;
  if (v.compareTo(oldest_supported) < 0) { // No longer supported
    return VersionSupport.Obsolete;
  } else if (v.compareTo(current_ver, true) > 0) { // Not yet supported
    return VersionSupport.Upcoming;
  } else { // Supported
    return VersionSupport.Supported;
  }
}

/**
 * Check if a client's version is up-to-date.
 * @param {Platform} platform The client's platform.
 * @param {string} version The client's version.
 * @returns {boolean} true, if `version` is equal to or older than the latest version
 * or the latest version is not known; or false, otherwise.
 */
export function isVersionUpToDate(platform: Platform, version: string): boolean {
  let v = SemanticVersion.parse(version);
  assert(v);
  // If the latest version is not known, consider any version as up-to-date;
  // If the version was not released yet, also consider it as up-to-date.
  let latest = plat_latest_vers[platform];
  return !latest || v.compareTo(latest) >= 0;
}

/**
 * Get a fallback environment for a version that is not supported.
 * @param {Platform} platform The client's platform.
 * @param {string} version The client's version.
 * @returns {string | null} a fallback environment name if one exists; or null, otherwise.
 */
export function getFallbackEnvironment(platform: Platform, version: string): string | null {
  let fallback_env = plat_fallback_envs[platform];
  if (fallback_env && getVersionSupport(platform, version) === VersionSupport.Upcoming) {
    // Only return a fallback environment if the client version is Upcoming
    return fallback_env;
  }
  return null;
}

export function getAllFallbackEnvironments(): Partial<Record<Platform, string>> {
  return plat_fallback_envs;
}
