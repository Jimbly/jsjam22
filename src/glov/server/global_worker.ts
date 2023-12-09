import assert from 'assert';
import { CmdDef, HandlerSource, isClientHandlerSource } from 'glov/common/types';
import { ChannelServer } from './channel_server';
import { ChannelWorker, HandleNewClientOpts } from './channel_worker';

// General purpose worker(s) for handling global state

export class GlobalWorker extends ChannelWorker {
  // constructor(channel_server, channel_id, channel_data) {
  //   super(channel_server, channel_id, channel_data);
  // }

  handleNewClient(src: HandlerSource, opts: HandleNewClientOpts): string | null {
    // Do not allow any subscriptions by anyone other than sysadmins to any global
    //   channels by default.
    // sysadmins probably subscribe only to get command completion
    // regular users should get global data in another way (it's already being broadcast
    //   to each ChannelServerWorker)
    if (!isClientHandlerSource(src)) {
      return null;
    }
    if (!src.sysadmin && !src.csr) {
      return 'ERR_ACCESS_DENIED';
    }
    return null;
  }
}
GlobalWorker.prototype.auto_destroy = true;

let global_worker_cmds: CmdDef[] = [];
let inited = false;

export function globalWorkerAddCmd(cmd_def: CmdDef): void {
  assert(!inited);
  assert(!global_worker_cmds.find((e) => e.cmd === cmd_def.cmd));
  assert(cmd_def.access_run && (cmd_def.access_run.includes('sysadmin') || cmd_def.access_run.includes('csr')));
  global_worker_cmds.push(cmd_def);
}

export function globalWorkerInit(channel_server: ChannelServer): void {
  assert(!inited);
  inited = true;
  channel_server.registerChannelWorker('global', GlobalWorker, {
    autocreate: true,
    subid_regex: /^(global)$/,
    cmds: global_worker_cmds,
  });
}
