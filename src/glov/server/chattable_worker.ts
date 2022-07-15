import { assert } from 'console';
import { FIFO, fifoCreate } from 'glov/common/fifo';
import { ChatHistoryData, ClientHandlerSource, ErrorCallback, Packet } from 'glov/common/types';
import { sanitize } from 'glov/common/util';
import { ChannelWorker } from './channel_worker';

const CHAT_MAX_LEN = 1024; // Client must be set to this or fewer
const CHAT_USER_FLAGS = 0x1;
const CHAT_MAX_MESSAGES = 50;

const CHAT_COOLDOWN_DATA_KEY = 'public.chat_cooldown';
const CHAT_DATA_KEY = 'private.chat';

export interface ChattableWorker extends ChannelWorker {
  chat_msg_timestamps?: FIFO< { timestamp: number, id: string }>;
  chat_records_map?: Partial<Record<string, { timestamp: number, id: string }>>;
  chatFilter?: (source: ClientHandlerSource, msg: string) => string | null;
  chatCooldownFilter?: (source: ClientHandlerSource) => boolean;
}

export function chatGetCooldown(worker: ChannelWorker): number {
  return worker.getChannelData(CHAT_COOLDOWN_DATA_KEY, 0);
}

export function chatSetCooldown(worker: ChannelWorker, seconds: number): void {
  assert(seconds >= 0);
  worker.setChannelData(CHAT_COOLDOWN_DATA_KEY, seconds);
}

export function chatGet(worker: ChannelWorker): ChatHistoryData | null {
  return worker.getChannelData(CHAT_DATA_KEY, null);
}

export function chatClear(worker: ChannelWorker): void {
  return worker.setChannelData(CHAT_DATA_KEY, null);
}

export function sendChat(
  worker: ChannelWorker,
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
  let data_saved = { id, msg, flags, ts, display_name };
  // Not broadcasting timestamp, so client will use local timestamp for smooth fading
  // Need client_id on broadcast so client can avoid playing a sound for own messages
  let data_broad = { id, msg, flags, display_name, client_id };
  chat.msgs[chat.idx] = data_saved;
  chat.idx = (chat.idx + 1) % CHAT_MAX_MESSAGES;
  // Setting whole 'chat' blob, since we re-serialize the whole metadata anyway
  if (!worker.channel_server.restarting) {
    worker.setChannelData(CHAT_DATA_KEY, chat);
  }
  worker.channelEmit('chat', data_broad);
  return null;
}

function chatReceive(
  worker: ChattableWorker,
  source: ClientHandlerSource,
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
      worker.logSrc(source,
        `denied chat from ${id} ("${display_name}") (${channel_id}) (${err}): ${JSON.stringify(msg)}`);
      return err;
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
    let ts = Date.now();
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
      return `This world has chat slow mode enabled. Wait ${time_left} seconds before writting again.`;
    }
    last = worker.chat_records_map[id] = {
      timestamp: ts,
      id: id,
    };
    worker.chat_msg_timestamps.add(last);
  }
  let err = sendChat(worker, id, client_id, display_name, flags, msg);
  if (err) {
    worker.logSrc(source,
      `suppressed chat from ${id} ("${display_name}") (${channel_id}) (${err}): ${JSON.stringify(msg)}`);
    return err;
  }
  // Log entire, non-truncated chat string
  worker.logSrc(source, `chat from ${id} ("${display_name}") (${channel_id}): ${JSON.stringify(msg)}`);
  return null;
}

export function handleChat(this: ChattableWorker,
  source: ClientHandlerSource,
  pak: Packet,
  resp_func: ErrorCallback<string>
): void {
  let err = chatReceive(this, source, pak);
  resp_func(err);
}

export function handleChatGet(this: ChattableWorker,
  source: ClientHandlerSource,
  data: void,
  resp_func: ErrorCallback<ChatHistoryData | null>
): void {
  resp_func(null, chatGet(this));
}
