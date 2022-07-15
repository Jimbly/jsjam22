import assert from 'assert';
import { setAbilityReload } from './client_config';
import { cmd_parse } from './cmds';
import { netForceDisconnect } from './net';
import * as urlhash from './urlhash';

export interface EnvironmentConfig {
  name: string;
  link_base?: string;
  api_path?: string;
}

let all_environments: Partial<Record<string, EnvironmentConfig>> = {};
let current_environment: EnvironmentConfig | null = null;
let default_environment: EnvironmentConfig | null = null;

let link_base: string;    // Link base like http://foo.bar/ (with trailing slash)
let api_path: string;     // API base like http://foo.bar/api/ (with trailing slash)
let texture_base: string; // Texture base like http://foo.bar/ (with trailing slash)

function applyEnvironment() {
  link_base = (current_environment && current_environment.link_base) || urlhash.getURLBase();
  api_path = (current_environment && current_environment.api_path) || `${link_base}api/`;
  texture_base = link_base.replace('//localhost:', '//127.0.0.1:');
}

// Default initialization
applyEnvironment();

export function getCurrentEnvironment<T extends EnvironmentConfig>(): T | null {
  return current_environment as (T | null);
}
export function setCurrentEnvironment(environment_name: string | undefined | null): void {
  let prev_environment = current_environment;
  current_environment = (environment_name && all_environments[environment_name]) || default_environment;
  if (current_environment !== prev_environment) {
    applyEnvironment();
    setAbilityReload(false);
    netForceDisconnect();
  }
}

export function getLinkBase(): string {
  return link_base;
}
export function getAPIPath(): string {
  return api_path;
}
export function getExternalTextureURL(url: string): string {
  return url.match(/^.{2,7}:/) ? url : `${texture_base}${url}`;
}

export function environmentsInit<T extends EnvironmentConfig>(
  environments: Array<T>,
  default_environment_name?: string | undefined | null,
): void {
  all_environments = {};
  let all_names = [];
  for (let i = 0, len = environments.length; i < len; i++) {
    let env = environments[i];
    let env_name = env.name;
    assert(env_name.length > 0);
    all_environments[env_name] = env;
    all_names.push(env_name);
  }

  current_environment = default_environment =
    (default_environment_name && all_environments[default_environment_name]) || null;
  applyEnvironment();

  if (!all_names.some((name) => name.toLowerCase() === 'default')) {
    all_names.push('default');
  }
  cmd_parse.registerValue('environment', {
    type: cmd_parse.TYPE_STRING,
    help: 'Display or set the current client environment',
    usage: 'Display the current client environment\n  Usage: /environment\n' +
      `Set the current client environment (${all_names.join(', ')})\n  Usage: /environment <environment_name>`,
    label: 'Environment',
    get: () => JSON.stringify(getCurrentEnvironment() || 'default', null, 2),
    set: setCurrentEnvironment,
    access_show: ['sysadmin'],
  });
}
