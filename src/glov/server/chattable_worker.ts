import { assert } from 'console';
import { FIFO, fifoCreate } from 'glov/common/fifo';
import { Packet } from 'glov/common/packet';
import {
  ChatHistoryData,
  ChatIDs,
  ChatMessageDataBroadcast,
  ChatMessageDataSaved,
  ClientHandlerSource,
  ErrorCallback,
  NetResponseCallback,
} from 'glov/common/types';
import { sanitize, secondsToFriendlyString } from 'glov/common/util';
import { ChannelWorker } from './channel_worker';

const CHAT_MAX_LEN = 1024; // Client must be set to this or fewer
const CHAT_USER_FLAGS = 0x1;
const CHAT_MAX_MESSAGES = 50;

const CHAT_COOLDOWN_DATA_KEY = 'public.chat_cooldown';
const CHAT_MINIMUM_ACCOUNT_AGE_KEY = 'public.chat_minimum_account_age';
const CHAT_DATA_KEY = 'private.chat';

export interface ChattableWorker extends ChannelWorker {
  chat_msg_timestamps?: FIFO< { timestamp: number; id: string }>;
  chat_records_map?: Partial<Record<string, { timestamp: number; id: string }>>;
  chatFilter?(source: ClientHandlerSource, msg: string): string | null;
  chatDecorateData?(data_saved: ChatMessageDataSaved, data_broadcast: ChatMessageDataBroadcast): void;
  chatCooldownFilter?(source: ClientHandlerSource): boolean;
  chatMinimumAccountAgeFilter?(source: ClientHandlerSource): number;
}

export function chatGetCooldown(worker: ChannelWorker): number {
  return worker.getChannelData(CHAT_COOLDOWN_DATA_KEY, 0);
}

export function chatSetCooldown(worker: ChannelWorker, seconds: number): void {
  assert(seconds >= 0);
  worker.setChannelData(CHAT_COOLDOWN_DATA_KEY, seconds);
}

export function chatGetMinimumAccountAge(worker: ChannelWorker): number {
  return worker.getChannelData(CHAT_MINIMUM_ACCOUNT_AGE_KEY, 0);
}

export function chatSetMinimumAccountAge(worker: ChannelWorker, minutes: number): void {
  assert(minutes >= 0);
  worker.setChannelData(CHAT_MINIMUM_ACCOUNT_AGE_KEY, minutes);
}

export function chatGet(worker: ChannelWorker): ChatHistoryData | null {
  return worker.getChannelData(CHAT_DATA_KEY, null);
}

export function chatClear(worker: ChannelWorker): void {
  return worker.setChannelData(CHAT_DATA_KEY, null);
}

export function sendChat(
  worker: ChattableWorker,
  id: string | undefined,
  client_id: string | undefined,
  display_name: string | undefined,
  flags: number,
  msg: string,
): string | null {
  id = id || undefined;
  client_id = client_id || undefined;
  display_name = display_name || undefined;
  let chat = chatGet(worker);
  if (!chat) {
    chat = {
      idx: 0,
      msgs: [],
    };
  }
  let last_idx = (chat.idx + CHAT_MAX_MESSAGES - 1) % CHAT_MAX_MESSAGES;
  let last_msg = chat.msgs[last_idx];
  if (id && last_msg && last_msg.id === id && last_msg.msg === msg) {
    return 'ERR_ECHO';
  }
  let ts = Date.now();
  let data_saved: ChatMessageDataSaved = { id, msg, flags, ts, display_name };
  // Not broadcasting timestamp, so client will use local timestamp for smooth fading
  // Need client_id on broadcast so client can avoid playing a sound for own messages
  let data_broad: ChatMessageDataBroadcast = { id, msg, flags, display_name, client_id };
  if (worker.chatDecorateData) {
    worker.chatDecorateData(data_saved, data_broad);
  }
  chat.msgs[chat.idx] = data_saved;
  chat.idx = (chat.idx + 1) % CHAT_MAX_MESSAGES;
  // Setting whole 'chat' blob, since we re-serialize the whole metadata anyway
  if (!worker.channel_server.restarting) {
    worker.setChannelData(CHAT_DATA_KEY, chat);
  }
  worker.channelEmit('chat', data_broad);
  return null;
}

function denyChat(
  worker: ChattableWorker,
  source: ChatIDs,
  err: string,
  msg: string,
  time_left?: string | number
): string {
  let { user_id, channel_id, display_name } = source; // user_id is falsey if not logged in
  let id = user_id || channel_id;
  worker.logSrc(source,
    `suppressed chat from ${id} ("${display_name}") (${channel_id}) (${err}): ${JSON.stringify(msg)}`);
  if (err === 'ERR_ACCOUNT_AGE') {
    return `Your account is too recent to chat in this world. Wait ${time_left} before writing again.`;
  }
  if (err === 'ERR_COOLDOWN') {
    return `This world has chat slow mode enabled. Wait ${time_left} seconds before writing again.`;
  }
  return err;
}

function chatReceive(
  worker: ChattableWorker,
  source: ChatIDs,
  pak: Packet,
): string | null {
  let { user_id, channel_id, display_name } = source; // user_id is falsey if not logged in
  let client_id = source.id;
  let id = user_id || channel_id;
  let flags = pak.readInt();
  let msg = sanitize(pak.readString()).trim();
  if (!msg) {
    return 'ERR_EMPTY_MESSAGE';
  }
  if (msg.length > CHAT_MAX_LEN) {
    return 'ERR_MESSAGE_TOO_LONG';
  }
  if (flags & ~CHAT_USER_FLAGS) {
    return 'ERR_INVALID_FLAGS';
  }
  if (worker.chatFilter) {
    let err = worker.chatFilter(source, msg);
    if (err) {
      return denyChat(worker, source, err, msg);
    }
  }

  let ts = Date.now();
  let minimum_account_age_minutes = chatGetMinimumAccountAge(worker);
  let acc_creation_ts;
  if (minimum_account_age_minutes && (worker.chatMinimumAccountAgeFilter &&
    (acc_creation_ts = worker.chatMinimumAccountAgeFilter(source)))) { // Chat minimum account age
    let time_elapsed_seconds = Math.floor((ts - acc_creation_ts) * 0.001);
    if (time_elapsed_seconds < minimum_account_age_minutes * 60) {
      let seconds_left = minimum_account_age_minutes * 60 - time_elapsed_seconds;
      let time_left = seconds_left < 60 ? `${seconds_left} seconds` : secondsToFriendlyString(seconds_left);
      return denyChat(worker, source, 'ERR_ACCOUNT_AGE', msg, time_left);
    }
  }

  if (!worker.chat_msg_timestamps) {
    worker.chat_msg_timestamps = fifoCreate();
  }
  if (!worker.chat_records_map) {
    worker.chat_records_map = {};
  }
  let cooldown = chatGetCooldown(worker);
  if (cooldown && (!worker.chatCooldownFilter || worker.chatCooldownFilter(source))) { // Chat slow mode
    let cooldown_time = cooldown * 1000;
    let record;
    while ((record = worker.chat_msg_timestamps.peek())) {
      if (ts - record.timestamp > cooldown_time) {
        worker.chat_msg_timestamps.pop();
        delete worker.chat_records_map[record.id];
      } else {
        break;
      }
    }
    let last = worker.chat_records_map[id];
    if (last) {
      let time_elapsed = ts - last.timestamp;
      let time_left = Math.ceil(cooldown - time_elapsed * 0.001);
      return denyChat(worker, source, 'ERR_COOLDOWN', msg, time_left);
    }
    last = worker.chat_records_map[id] = {
      timestamp: ts,
      id: id,
    };
    worker.chat_msg_timestamps.add(last);
  }
  let err = sendChat(worker, id, client_id, display_name, flags, msg);
  if (err) {
    return denyChat(worker, source, err, msg);
  }
  // Log entire, non-truncated chat string
  worker.logSrc(source, `chat from ${id} ("${display_name}") (${channel_id}): ${JSON.stringify(msg)}`);
  return null;
}

export function handleChat(this: ChattableWorker,
  source: ClientHandlerSource,
  pak: Packet,
  resp_func: ErrorCallback<never, string>
): void {
  let err = chatReceive(this, source, pak);
  resp_func(err);
}

export function handleChatGet(this: ChattableWorker,
  source: ClientHandlerSource,
  data: void,
  resp_func: NetResponseCallback<ChatHistoryData | null>
): void {
  resp_func(null, chatGet(this));
}

export function chattableWorkerInit(ctor: typeof ChannelWorker): void {
  ctor.registerClientHandler('chat', handleChat);
  ctor.registerClientHandler('chat_get', handleChatGet);
}
