// https://github.com/yagop/node-telegram-bot-api/issues/319
(process.env as any).NTBA_FIX_319 = true;
import * as TelegramBot from "node-telegram-bot-api";

import * as dotenv from "dotenv";
dotenv.config();

import { Lens } from "monocle-ts";

const DEFAULT_QUEUE = process.env.DEFAULT_QUEUE || "5v5";
const TIMEOUT = process.env.TIMEOUT
  ? parseInt(process.env.TIMEOUT)
  : 1000 * 60 * 60;

if (!process.env.TOKEN)
  throw new Error(
    "TOKEN environment variable must be provided either through .env file or via envvars, quitting."
  );

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

interface Queue {
  timeout?: NodeJS.Timer;
  [userId: number]: string | undefined;
}

interface Channel {
  [queueId: string]: Queue | undefined;
}

interface Channels {
  [channelId: number]: Channel | undefined;
}

let state: Channels = {};

/**
 * Updates the bot's state
 *
 * @param newState Set this value as the new state
 */
const updateState = (newState: Channels) => {
  state = newState;
};

/**
 * Get number of players until given queue is full
 *
 * @param queueId Queue ID
 */
const getMaxPlayers = (queueId: string) => {
  const maxPlayers = parseInt(queueId[0]);
  return isNaN(maxPlayers) ? 5 : maxPlayers;
};

/**
 * Get username of user (falls back to first name/last name)
 *
 * @param from Telegram user object
 */
const getUsername = (from: TelegramBot.User) =>
  from.username ? `@${from.username}` : `${from.first_name} ${from.last_name}`;

/**
 * Returns number of players in given queue
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 */
const getNumPlayers = (channelId: number, queueId: string) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});

  return Object.keys(channelLens.compose(queueLens).get(state)).length;
};

/**
 * Returns printable list of players in given queue.
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 * @param avoidHighlight Whether to avoid highlighting players (removes @-prefix)
 */
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

/**
 * Logs status of given queue.
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 */
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

/**
 * Called when a queue times out. Resets the given queue by clearing out all
 * players.
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 */
const timeoutQueue = (channelId: number, queueId: string) => () => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});
  const numPlayers = getNumPlayers(channelId, queueId);

  if (numPlayers > 0) {
    bot.sendMessage(channelId, `${queueId} timed out after inactivity.`);
  }

  updateState(channelLens.compose(queueLens).set({})(state));
};

/**
 * Clears and optionally sets queue timeout
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 * @param restart Whether to restart the timer after clearing it
 */
const updateTimeout = (
  channelId: number,
  queueId: string,
  restart?: boolean
) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});
  const timeoutLens = Lens.fromNullableProp<Queue>()("timeout", undefined);

  const lens = channelLens.compose(queueLens).compose(timeoutLens);

  clearTimeout(lens.get(state));

  if (restart) {
    updateState(
      lens.set(setTimeout(timeoutQueue(channelId, queueId), TIMEOUT))(state)
    );
  }
};

/**
 * Adds player to given queue.
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 * @param userId User ID
 * @param userName Telegram username or first name/last name
 */
const addToQueue = (
  channelId: number,
  queueId: string,
  userId: number,
  userName: string
) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});
  const userLens = Lens.fromNullableProp<Queue>()(userId, undefined);

  updateState(
    channelLens
      .compose(queueLens)
      .compose(userLens)
      .set(userName)(state)
  );

  const numPlayers = getNumPlayers(channelId, queueId);
  const maxPlayers = getMaxPlayers(queueId);

  if (numPlayers >= maxPlayers) {
    bot.sendMessage(
      channelId,
      `Game ready! ${getPlayersStr(channelId, queueId)}`
    );

    updateTimeout(channelId, queueId, false);
    updateState(channelLens.compose(queueLens).set({})(state));
  } else {
    updateTimeout(channelId, queueId, true);
    logStatus(channelId, queueId);
  }
};

/**
 * Remove player from given queue.
 *
 * @param channelId Telegram group
 * @param queueId Queue ID
 * @param userId User ID
 */
const removeFromQueue = (
  channelId: number,
  queueId: string,
  userId: number
) => {
  const channelLens = Lens.fromNullableProp<Channels>()(channelId, {});
  const queueLens = Lens.fromNullableProp<Channel>()(queueId, {});

  updateState(
    channelLens.compose(queueLens).modify(queue => {
      const copy = { ...queue };
      delete copy[userId];
      return copy;
    })(state)
  );

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
      addToQueue(chat.id, queueId, from.id, getUsername(from));
      break;

    case "remove":
      removeFromQueue(chat.id, queueId, from.id);
      break;

    case "status":
      logStatus(chat.id, queueId);
      break;
  }
});
