// https://github.com/yagop/node-telegram-bot-api/issues/319
(process.env as any).NTBA_FIX_319 = true;
import * as TelegramBot from "node-telegram-bot-api";

import * as dotenv from "dotenv";
dotenv.config();

import { Lens } from "monocle-ts";

const DEFAULT_QUEUE = process.env.DEFAULT_QUEUE || "5v5";

if (!process.env.TOKEN)
  throw new Error(
    "TOKEN environment variable must be provided either through .env file or via envvars, quitting."
  );

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

interface Queue {
  [userId: number]: string | undefined;
}

interface Channel {
  [queueId: string]: Queue | undefined;
}

interface Channels {
  [channelId: number]: Channel | undefined;
}

let state: Channels = {};

const getMaxPlayers = (queueId: string) => {
  const maxPlayers = parseInt(queueId[0]);
  return isNaN(maxPlayers) ? 5 : maxPlayers;
};

const getUsername = (from: TelegramBot.User) =>
  from.username ? `@${from.username}` : `${from.first_name} ${from.last_name}`;

const getNumPlayers = (channelId: number, queueId: string) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});

  return Object.keys(channelLens.compose(queueLens).get(state)).length;
};

const getQueueId = (match: RegExpMatchArray | null) =>
  match && match[1] ? match[1].trim() : DEFAULT_QUEUE;

const logStatus = (channelId: number, queueId: string) =>
  bot.sendMessage(
    channelId,
    `${getNumPlayers(channelId, queueId)} / ${getMaxPlayers(
      queueId
    )} added up to ${queueId}`
  );

const add = (
  channelId: number,
  queueId: string,
  userId: number,
  userName: string
) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});
  const userLens = Lens.fromNullableProp<Queue>()(userId, undefined);

  state = channelLens
    .compose(queueLens)
    .compose(userLens)
    .set(userName)(state);

  const numPlayers = getNumPlayers(channelId, queueId);
  const maxPlayers = getMaxPlayers(queueId);

  if (numPlayers >= maxPlayers) {
    const players: string[] = Object.values(
      channelLens.compose(queueLens).get(state)
    );

    bot.sendMessage(channelId, `Game ready! ${players.join(", ")}`);

    state = channelLens.compose(queueLens).set({})(state);
  } else {
    logStatus(channelId, queueId);
  }
};

const remove = (channelId: number, queueId: string, userId: number) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});

  state = channelLens.compose(queueLens).modify(queue => {
    const copy = { ...queue };
    delete copy[userId];
    return copy;
  })(state);

  logStatus(channelId, queueId);
};

bot.onText(/\/add\s*(.+)?/, ({ from, chat }, match) => {
  if (!from) return;
  add(chat.id, getQueueId(match), from.id, getUsername(from));
});

bot.onText(/\/remove\s*(.+)?/, ({ from, chat }, match) => {
  if (!from) return;
  remove(chat.id, getQueueId(match), from.id);
});

bot.onText(/\/status\s*(.+)?/, ({ chat }, match) => {
  logStatus(chat.id, getQueueId(match));
});
