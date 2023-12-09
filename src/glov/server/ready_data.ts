import assert from 'assert';
import { Express, NextFunction, Request, Response } from 'express';
import {
  PlatformID,
  platformGetValidIDs,
  platformIsValid,
} from 'glov/common/platform';
import { CmdRespFunc } from 'glov/common/types';
import { ChannelServer } from './channel_server';
import { ChannelServerWorker } from './channel_server_worker';
import { GlobalWorker } from './global_worker';
import {
  serverGlobalsReady,
  serverGlobalsRegister,
} from './server_globals';
import {
  VersionSupport,
  getAllFallbackEnvironments,
  getFallbackEnvironment,
  getVersionSupport,
  isValidVersion,
  isVersionUpToDate,
  setFallbackEnvironments,
  setLatestVersions,
} from './version_management';

interface ReadyData {
  latest_platform_versions?: Partial<Record<PlatformID, string>>;
  fallback_environments?: Partial<Record<PlatformID, string>>;
}

//////////////////////////////////////////////////////////////////////////
// Command(s) ran on GlobalWorker

const READY_DATA_KEY = 'public.ready_data';

function cmdGetLatestPlatformVersions(this: GlobalWorker, str: string, resp_func: CmdRespFunc): void {
  resp_func(null, this.getChannelData(`${READY_DATA_KEY}.latest_platform_versions`, {}));
}

function cmdSetLatestPlatformVersion(this: GlobalWorker, str: string, resp_func: CmdRespFunc): void {
  let params = str.split(' ');
  if (params.length !== 1 && params.length !== 2) {
    return void resp_func('Invalid parameters');
  }
  let plat = params[0];
  if (!platformIsValid(plat)) {
    return void resp_func(`Invalid platform, must be one of the following:\n${platformGetValidIDs().join(', ')}`);
  }
  let ver: string | undefined = params[1];
  if (!ver) {
    ver = undefined;
  }
  if (ver !== undefined && !isValidVersion(ver)) {
    return void resp_func('Invalid version format');
  }
  this.logSrc(this.cmd_parse_source, `/set_latest_platform_version ${plat} ${ver}`);
  this.setChannelData(`${READY_DATA_KEY}.latest_platform_versions.${plat}`, ver);
  resp_func(null, `Latest version '${ver}' set for the '${plat}' platform`);
}

function cmdGetFallbackEnvironments(this: GlobalWorker, str: string, resp_func: CmdRespFunc): void {
  resp_func(null, this.getChannelData(`${READY_DATA_KEY}.fallback_environments`, {}));
}

function cmdSetFallbackEnvironment(this: GlobalWorker, str: string, resp_func: CmdRespFunc): void {
  let params = str.split(' ');
  if (params.length !== 1 && params.length !== 2) {
    return void resp_func('Invalid parameters');
  }
  let plat = params[0];
  if (!platformIsValid(plat)) {
    return void resp_func(`Invalid platform, must be one of the following:\n${platformGetValidIDs().join(', ')}`);
  }
  let env: string | undefined = params[1];
  if (!env) {
    env = undefined;
  }
  this.logSrc(this.cmd_parse_source, `/set_fallback_environment ${plat} ${env}`);
  this.setChannelData(`${READY_DATA_KEY}.fallback_environments.${plat}`, env);
  resp_func(null, `Fallback environment '${env}' set for the '${plat}' platform`);
}

//////////////////////////////////////////////////////////////////////////
// Functions exported and ran in the context of a ChannelServerWorker

type ReadyDataExtaData = {
  update_available?: true;
  redirect_environment?: string;
};
type ReadyDataCheckReturn = {
  err: string | null;
  extra_data?: ReadyDataExtaData;
};
export function readyDataCheck(plat: PlatformID, ver: string): ReadyDataCheckReturn {
  if (!serverGlobalsReady()) {
    return { err: 'ERR_STARTUP' };
  }

  if (!platformIsValid(plat) || !isValidVersion(ver)) {
    return { err: 'ERR_CLIENT_INVALID' };
  }

  let extra_data: ReadyDataExtaData = {};
  if (!isVersionUpToDate(plat, ver)) {
    extra_data.update_available = true;
  }
  let version_support = getVersionSupport(plat, ver);
  switch (version_support) {
    case VersionSupport.Supported:
      return { err: null, extra_data };
    case VersionSupport.Obsolete:
      return { err: 'ERR_CLIENT_VERSION_OLD', extra_data };
    case VersionSupport.Upcoming: {
      let redirect_environment = getFallbackEnvironment(plat, ver);
      if (redirect_environment) {
        extra_data.redirect_environment = redirect_environment;
      }
      return { err: 'ERR_CLIENT_VERSION_NEW', extra_data };
    }
    default:
      assert(false);
      return { err: 'just for eslint' };
  }
}

function readyDataOnData(csworker: ChannelServerWorker, ready_data: ReadyData | undefined): void {
  setLatestVersions(ready_data?.latest_platform_versions);
  setFallbackEnvironments(ready_data?.fallback_environments);
}

//////////////////////////////////////////////////////////////////////////
// Initialization

export function readyDataInit(channel_server: ChannelServer, app: Express): void {
  serverGlobalsRegister<ReadyData>(READY_DATA_KEY, {
    on_data: readyDataOnData,
    cmds: [{
      cmd: 'get_latest_platform_versions',
      help: 'Gets the latest known versions for all the platforms',
      access_run: ['sysadmin'],
      func: cmdGetLatestPlatformVersions,
    }, {
      cmd: 'set_latest_platform_version',
      help: 'Sets the latest client version for a platform',
      usage: 'Usage: /set_latest_platform_version <platform> [version]',
      prefix_usage_with_help: true,
      access_run: ['sysadmin'],
      func: cmdSetLatestPlatformVersion,
    }, {
      cmd: 'get_fallback_environments',
      help: 'Gets the fallback environment names for all the platforms',
      access_run: ['sysadmin'],
      func: cmdGetFallbackEnvironments,
    }, {
      cmd: 'set_fallback_environment',
      help: 'Sets the fallback environment name for a platform',
      usage: 'Usage: /set_fallback_environment <platform> [environment]',
      prefix_usage_with_help: true,
      access_run: ['sysadmin'],
      func: cmdSetFallbackEnvironment,
    }],
  });

  app.get('/api/fallback_environments', function (req: Request, res: Response, next: NextFunction) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(getAllFallbackEnvironments()));
  });

}
