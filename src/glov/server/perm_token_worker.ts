import assert from 'assert';
import { Express, NextFunction, Request, Response } from 'express';
import * as base32 from 'glov/common/base32';
import { Packet } from 'glov/common/packet';
import { ErrorCallback, HandlerSource } from 'glov/common/types';
import './channel_server'; // importing to enforce import ordering (note the import below gets stripped by TypeScript)
// eslint-disable-next-line no-duplicate-imports
import { ChannelServer } from './channel_server';
import { ChannelWorker } from './channel_worker';
import { requestIsLocalHost } from './request_utils';

// General purpose worker(s) for handling global state

class PermTokenWorker extends ChannelWorker {
  // constructor(channel_server, channel_id, channel_data) {
  //   super(channel_server, channel_id, channel_data);
  // }

  handleTokenAlloc(src: HandlerSource, pak: Packet, resp_func: ErrorCallback<string>): void {
    let ops = pak.readJSON();

    let token_key = 'PZ';
    let token_body;
    let retries = 10;
    do {
      token_body = base32.gen(8);
      let exists = this.getChannelData(`private.tokens.${token_body}`);
      if (!exists) {
        break;
      }
      --retries;
    } while (--retries);
    assert(retries); // Something has gone horribly wrong if we have that many unused tokens!

    this.logSrc(src, `Allocated access token ${token_body}=${JSON.stringify(ops)}`);
    this.setChannelData(`private.tokens.${token_body}`, {
      claimed: 0,
      time: Date.now(),
      ops,
    });
    resp_func(null, `${token_key}-${token_body}`);
  }
}
PermTokenWorker.prototype.require_login = false;
PermTokenWorker.prototype.auto_destroy = true;

export function permTokenWorkerInit(channel_server: ChannelServer, app: Express): void {
  channel_server.registerChannelWorker('perm_token', PermTokenWorker, {
    autocreate: true,
    subid_regex: /^(perm_token)$/,
    handlers: {
      token_alloc: PermTokenWorker.prototype.handleTokenAlloc,
    },
  });

  // Example usage, get 3 world quota and allow single player:
  // http://localhost:4000/api/permtoken?op=add&key=max_worlds&value=3&op=set&key=single_player&value=1
  app.get('/api/permtoken', function (req: Request, res: Response, next: NextFunction) {
    if (!requestIsLocalHost(req)) {
      return next();
    }

    function getArray(key: string): (string)[] {
      let v = req.query[key];
      if (typeof v === 'string') {
        return [v];
      } else if (Array.isArray(v)) {
        return v as string[];
      } else {
        return [];
      }
    }

    let op = getArray('op');
    let key = getArray('key');
    let value: (number|string)[] = getArray('value');
    if (op.length !== key.length || key.length !== value.length) {
      return next('Array size mismatch');
    }
    let ops = [];
    for (let ii = 0; ii < op.length; ++ii) {
      if (op[ii] !== 'set' && op[ii] !== 'add') {
        return next('Unknown op');
      }
      if (!key[ii]) {
        return next('Missing key');
      }
      if (Number(value[ii]) || value[ii] === '0') {
        value[ii] = Number(value[ii]);
      } else {
        return next('Value must be a number');
      }
      ops.push({ op: op[ii], key: key[ii], value: value[ii] });
    }

    let pak = channel_server.pakAsChannelServer('perm_token.perm_token', 'token_alloc');
    pak.writeJSON(ops);
    return pak.send(function (err: string, token: string) {
      if (err) {
        return void next(err);
      }
      res.end(token);
    });
  });
}
