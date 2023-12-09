/* eslint global-require:off */
/* eslint-disable import/order */
const argv = require('minimist')(process.argv.slice(2));
const assert = require('assert');
const fs = require('fs');
const json5 = require('json5');
const path = require('path');
const { defaultsDeep } = require('glov/common/util.js');

let server_config;

export let default_config_options = {
  // How many servers must be connected to the master before it is considered ready
  master_ready_servers: 1,
  // How long after a new server connects before we consider it being stable/ready
  master_ready_server_time: 1000,
  // How long before triggering being ready, even if not enough servers are connected
  master_ready_timeout: 60000,
  // Flags that are propagated from a user's public.permissions onto their per-message identity
  permission_flags: ['sysadmin'],
  // What permission flags grant ability to use reserved words when renaming user and logging in
  display_name_bypass_flags: ['sysadmin'],
  // Modules to import before creating exchanges
  // Using string template so that glov-build-preresolve doesn't munge it
  exchange_providers: [`glov${'/server/exchange_gmx_client'}`],
};

let default_env_options = {
  dev: {
    log: {
      format: 'dev',
      pad_levels: true,
    },
    // Always immediately "ready" in dev
    master_ready_timeout: 0,
  },
  prod: {
    log: {
      timestamp_format: 'long',
      pad_levels: true,
    },
  },
};

let process_uid;
export function processUID() {
  if (!process_uid) {
    if (process.env.PODNAME) {
      process_uid = `${process.env.PODNAME}${process.pid === 1 ? '' : `-${process.pid}`}`;
      // Add timestamp because failed pods restart with the same PODNAME
      // Timestamp mod 10m (approx 4 months), should be acceptably low chance for a collision
      process_uid += `-${Math.floor(Date.now()/1000) % 10000000}`;
    } else {
      process_uid = `local-${process.pid}`;
    }
  }
  return process_uid;
}

function determinEnv() {
  let env;
  if (argv.env || server_config.env) {
    // explicitly specified, use it
    env = argv.env || server_config.env;
  } else if (process.env.CONFIG_ENV) {
    env = process.env.CONFIG_ENV;
  } else if (process.env.GKE_PROJECTNAME) {
    env = process.env.GKE_PROJECTNAME;
  } else if (process.env.PODNAME) {
    if (process.env.LOCAL_GCP_CRED) {
      fs.writeFileSync('local-k8s.json', process.env.LOCAL_GCP_CRED);
    } else {
      console.log('Running in env:local-k8s, but no gcp.cred secret found.  You may need to add one with:');
      console.log('  kubectl create secret generic gcp.cred --from-file=json=my-gcp-cred.json');
    }
    env = 'local-k8s';
  } else if (argv.dev) {
    env = 'dev';
  } else {
    env = 'prod';
  }

  server_config.env = env;
  return env;
}

export function serverConfigStartup(code_defaults) {
  assert(!server_config);
  let config_file = 'config/server.json';
  if (argv.config) {
    config_file = argv.config;
  }
  // Highest priority: configuration file specified on command line
  let config_path = path.join(process.cwd(), config_file);
  if (fs.existsSync(config_path)) {
    console.log(`Using local server config from ${config_path}`);
    server_config = json5.parse(fs.readFileSync(config_path, 'utf8'));
  } else {
    server_config = {};
  }

  // Next priority: environment-based config
  let env = determinEnv(); // After getting explicit server_config

  let env_path = path.join(__dirname, '../../server/config/env.json');
  if (fs.existsSync(env_path)) {
    console.log(`Using config environment "${env}"`);
    let env_data = json5.parse(fs.readFileSync(env_path, 'utf8'));
    if (!env_data[env]) {
      console.error(`Invalid config environment specified: "${env}"`);
    } else {
      server_config = defaultsDeep(server_config, env_data[env]);
    }
    server_config = defaultsDeep(server_config, env_data.defaults);
  }

  // Lowest priority: hard-coded defaults
  if (default_env_options[env]) {
    server_config = defaultsDeep(server_config, default_env_options[env]);
  }
  server_config = defaultsDeep(server_config, code_defaults);
}

export function serverConfig() {
  if (!server_config) {
    serverConfigStartup(default_config_options);
  }
  return server_config;
}
