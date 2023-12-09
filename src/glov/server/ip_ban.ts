import assert from 'assert';
import { BlockList } from 'net';
import { CmdRespFunc } from 'glov/common/types';
import { merge } from 'glov/common/util';
import { ChannelServerWorker } from './channel_server_worker';
import { GlobalWorker } from './global_worker';
import {
  serverGlobalsReady,
  serverGlobalsRegister,
} from './server_globals';

const { floor } = Math;

type IPBanEntry = {
  expires: number;
  created_at: number;
  created_by: string;
};
type IPBanList = Partial<Record<string, IPBanEntry>>;

function escapeDots(ip: string): string {
  return ip.replace(/\./g, '\\.');
}

function secondsToString(seconds: number): string {
  return new Date(seconds*1000).toISOString().replace(/:\d\d\.000/, '');
}

function banSummary(entry: IPBanEntry): string {
  return `until ${secondsToString(entry.expires)} set by ${entry.created_by}` +
    ` on ${secondsToString(entry.created_at)}`;
}

//////////////////////////////////////////////////////////////////////////
// Command(s) ran on GlobalWorker

const IPBAN_KEY = 'public.ipban.banlist';

function cmdIPBan(this: GlobalWorker, str: string, resp_func: CmdRespFunc): void {
  let banlist = this.getChannelData<IPBanList>(IPBAN_KEY, {});
  let msgs = [];
  for (let ip in banlist) {
    let entry = banlist[ip]!;
    if (entry.expires < Date.now()/1000) {
      msgs.push(`Auto-removed expired ban for ${ip} ${banSummary(entry)}`);
      this.setChannelData(`${IPBAN_KEY}.${escapeDots(ip)}`, undefined);
    }
  }
  if (!str) {
    for (let ip in banlist) {
      msgs.push(`Ban ${ip} ${banSummary(banlist[ip]!)}`);
    }
    if (!msgs.length) {
      msgs.push('No active IP bans');
    }
  } else {
    let params = str.split(' ');
    let ip = params[0];
    let days = 90;
    if (params.length === 2) {
      days = Number(params[1]);
    }
    if (!days || !isFinite(days)) {
      msgs.push('Error parsing arguments');
    } else {
      let entry = banlist[ip];
      if (days < 0) {
        if (!entry) {
          msgs.push(`No existing ban found for ${ip}`);
        } else {
          this.setChannelData(`${IPBAN_KEY}.${escapeDots(ip)}`, undefined);
          msgs.push(`Removed ban for ${ip} ${banSummary(entry)}`);
        }
      } else {
        let expy = Date.now() + (days || 90)*24*60*60*1000;
        entry = {
          expires: floor(expy/1000),
          created_at: floor(Date.now()/1000),
          created_by: this.cmd_parse_source.user_id!,
        };
        this.setChannelData(`${IPBAN_KEY}.${escapeDots(ip)}`, entry);
        msgs.push(`Added ban for ${ip} ${banSummary(entry)}`);
      }
      this.logSrc(this.cmd_parse_source, msgs.join('\n'));
    }
  }
  resp_func(null, msgs.join('\n'));
}

//////////////////////////////////////////////////////////////////////////
// Functions exported and ran in the context of a ChannelServerWorker

let banlist: IPBanList;
let banranges: BlockList;

export function ipBanned(ip: string): boolean {
  assert(ip);
  assert(banlist);
  let entry = banlist[ip];
  if (entry && entry.expires*1000 > Date.now()) {
    return true;
  }
  return banranges.check(ip);
}

export function ipBanReady(): boolean {
  return serverGlobalsReady();
}

function ipBanOnData(csworker: ChannelServerWorker, data: IPBanList | undefined): void {
  // Make as object with null prototype so it is safe to query
  banlist = Object.create(null);
  merge(banlist, data);
  banranges = new BlockList();
  let now = Date.now();
  for (let key in banlist) {
    let entry = banlist[key]!;
    if (entry.expires*1000 > now) {
      let m = key.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
      if (m) {
        banranges.addSubnet(m[1], Number(m[2]));
      }
      m = key.match(/^(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)$/);
      if (m) {
        banranges.addRange(m[1], m[2]);
      }
    }
  }

  csworker.channel_server.ws_server.checkAllIPBans();
}

//////////////////////////////////////////////////////////////////////////
// Initialization

export function ipBanInit(): void {
  serverGlobalsRegister<IPBanList>(IPBAN_KEY, {
    on_data: ipBanOnData,
    cmds: [{
      cmd: 'ipban',
      help: '(CSR) List or add to IP bans',
      usage: 'List bans: /ipban\n' +
        'Add an IP ban: /ipban IP|RANGE [DAYS]\n' +
        '    DAYS defaults to 90, can be fractional (e.g. 0.25 = 6 hours)\n' +
        '    RANGE can be 1.2.3.0/24 or 1.2.3.0-1.2.3.255\n' +
        'Delete an IP ban: /ipban IP -1\n',
      prefix_usage_with_help: true,
      access_run: ['csr'],
      func: cmdIPBan,
    }],
  });
}
