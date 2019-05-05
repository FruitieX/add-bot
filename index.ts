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

const getPlayersStr = (
  channelId: number,
  queueId: string,
  avoidHighlight?: boolean
) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});

  return Object.values(channelLens.compose(queueLens).get(state))
    .map((playerName: string) =>
      playerName.replace("@", avoidHighlight ? "" : "@")
    )
    .join(", ");
};

const logStatus = (channelId: number, queueId: string) => {
  const numPlayers = getNumPlayers(channelId, queueId);

  if (numPlayers) {
    bot.sendMessage(
      channelId,
      `${numPlayers} / ${getMaxPlayers(
        queueId
      )} added up to ${queueId} (${getPlayersStr(channelId, queueId, true)})`
    );
  } else {
    bot.sendMessage(channelId, `${queueId} is empty.`);
  }
};

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
    bot.sendMessage(
      channelId,
      `Game ready! ${getPlayersStr(channelId, queueId)}`
    );

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

// https://gist.github.com/sk22/cc02d95cd2d24c882835c1dddb33e1da
const telegramBotRe = /^\/([^@\s]+)@?(?:(\S+)|)\s?([\s\S]*)$/;

bot.onText(telegramBotRe, ({ from, chat }, match) => {
  if (!from || !match) return;
  const cmd = match[1];
  const queueId = match[3] ? match[3] : DEFAULT_QUEUE;

  switch (cmd) {
    case "add":
      add(chat.id, queueId, from.id, getUsername(from));
      break;

    case "remove":
      remove(chat.id, queueId, from.id);
      break;

    case "status":
      logStatus(chat.id, queueId);
      break;
  }
});
