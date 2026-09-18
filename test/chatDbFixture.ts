/**
 * A chat.db-shaped store the `plow-messages` CLI suite runs against. The
 * schema is invented from a real `pragma table_info` dump — only the columns
 * the queries touch; the SQL semantics are executed, the column NAMES are
 * only as good as that dump.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the store sits under a home, as Messages lays it out. */
const imessageStorePath = (home: string): string => path.join(home, "Library/Messages/chat.db");

const SQLITE = "/usr/bin/sqlite3";
/** Apple's epoch: message.date counts nanoseconds from here (2001-01-01). */
const CORE_DATA_EPOCH = 978307200;
/** Seconds-ago to the nanosecond value message.date wants. */
const ns = (secsAgo: number): number =>
  (Math.floor(Date.now() / 1000) - secsAgo - CORE_DATA_EPOCH) * 1_000_000_000;

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** A captured typedstream blob, as the hex literal `X'...'` wants it. */
const FIXTURE = (name: string): string =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8").trim();

/** TZ pinned: a rendered date otherwise passes or fails on where the suite runs. */
const sqlite = (args: string[]): string =>
  execFileSync(SQLITE, args, { encoding: "utf8", stdio: "pipe", env: { ...process.env, TZ: "UTC" } });

export const SCHEMA = [
  "create table handle (ROWID integer primary key, id text);",
  "create table chat (ROWID integer primary key, guid text, chat_identifier text," +
    " display_name text, style integer);",
  "create table message (ROWID integer primary key, guid text, text text," +
    " attributedBody blob, handle_id integer, date integer," +
    " is_from_me integer default 0," +
    " associated_message_type integer default 0," +
    " item_type integer default 0);",
  "create table chat_message_join (chat_id integer, message_id integer, message_date integer);",
];

export function makeStore(dir: string): string {
  const home = dir;
  const store = imessageStorePath(home);
  fs.mkdirSync(path.dirname(store), { recursive: true });
  sqlite([
    store,
    [
      ...SCHEMA,

      // Chat 1 covers `chats` kind; 3/4/5/6/10/41/43 cover `unreplied`. `style`
      // (43 group, 45 direct) is the real discriminator, unlike identifier text.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (1, 'chat-guid-1', '+15551111111', NULL, 45);",
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (3, 'chat-guid-3', '+15552222222', NULL, 45);",
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (4, 'chat-guid-4', '+15553333333', NULL, 45);",
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (5, 'chat-guid-5', '+15554444444', NULL, 45);",
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (6, 'chat-guid-6', 'chat55555555', 'Group Six', 43);",
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (10, 'chat-guid-10', '+15559999999', NULL, 45);",

      "insert into handle (ROWID, id) values (100, '+15551111111');",
      "insert into handle (ROWID, id) values (102, '+15552222222');",
      "insert into handle (ROWID, id) values (103, '+15553333333');",
      "insert into handle (ROWID, id) values (104, '+15554444444');",
      "insert into handle (ROWID, id) values (105, 'sender-group2@icloud.com');",
      "insert into handle (ROWID, id) values (200, 'gather-sender@icloud.com');",

      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (1001, 100, ${ns(5000)}, 'ok', 1);`,
      "insert into chat_message_join (chat_id, message_id) values (1, 1001);",

      // unreplied: newest outbound (chat 3) excluded, newest inbound direct
      // (chat 4) included, tapback-only (chat 5) excluded, inbound GROUP (chat 6) excluded.
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (1003, 102, ${ns(2000)}, 'sent it', 1);`,
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (1004, 103, ${ns(3000)}, 'need reply', 0);`,
      `insert into message (ROWID, handle_id, date, text, is_from_me, associated_message_type)` +
        ` values (1005, 104, ${ns(4000)}, NULL, 0, 2000);`,
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (1006, 105, ${ns(3500)}, 'group need reply', 0);`,
      "insert into chat_message_join (chat_id, message_id) values (3, 1003);",
      "insert into chat_message_join (chat_id, message_id) values (4, 1004);",
      "insert into chat_message_join (chat_id, message_id) values (5, 1005);",
      "insert into chat_message_join (chat_id, message_id) values (6, 1006);",

      // chat 10: newest real message's body is undecodable (a non-typedstream
      // blob, not NULL) — `unreplied` must still surface a bodiless chat.
      `insert into message (ROWID, handle_id, date, text, attributedBody, is_from_me)` +
        ` values (2002, 200, ${ns(10000)}, NULL, X'68656C6C6F', 0);`,
      "insert into chat_message_join (chat_id, message_id) values (10, 2002);",

      // chat 30: a GROUP the same handle posts in, proving `thread --handle`
      // excludes group rows, not just includes the direct chat's.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (30, 'chat-guid-30', 'chat30303030', 'Dinner Group', 43);",
      "insert into handle (ROWID, id) values (400, '+15625550000');",
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (5001, 400, ${ns(7000)}, 'group message', 0);`,
      "insert into chat_message_join (chat_id, message_id) values (30, 5001);",

      // chat 31: the DIRECT chat with +15625550000, who also posts in group
      // 30 — `thread --handle` must read this and never the group. Outbound, so not unreplied.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (31, 'chat-guid-31', '+15625550000', NULL, 45);",
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (5101, 400, ${ns(2600)}, 'direct hello', 1);`,
      "insert into chat_message_join (chat_id, message_id) values (31, 5101);",

      // chat 40 carries REAL typedstream bodies with `text` NULL — the shape
      // a `text`-only query misses (#385). The two blobs are real business
      // notifications with no name, address, amount or code; a fixture is
      // committed, so what it decodes to is published. 6003 is a tapback that must never surface.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (40, 'chat-guid-40', 'chat40404040', 'Deliveries', 43);",
      "insert into handle (ROWID, id) values (500, '+12795550100');",
      "insert into handle (ROWID, id) values (501, '36246');",
      `insert into message (ROWID, handle_id, date, text, attributedBody, is_from_me)` +
        ` values (6001, 500, ${ns(3000)}, NULL, X'${FIXTURE("typedstream-order-delivered.hex")}', 0);`,
      `insert into message (ROWID, handle_id, date, text, attributedBody, is_from_me)` +
        ` values (6002, 501, ${ns(2000)}, NULL, X'${FIXTURE("typedstream-costco-delivery.hex")}', 0);`,
      `insert into message (ROWID, handle_id, date, text, is_from_me, associated_message_type)` +
        ` values (6003, 500, ${ns(1000)}, 'Loved an image', 0, 2000);`,
      "insert into chat_message_join (chat_id, message_id) values (40, 6001);",
      "insert into chat_message_join (chat_id, message_id) values (40, 6002);",
      "insert into chat_message_join (chat_id, message_id) values (40, 6003);",

      // 6004: a MALFORMED typedstream body. 6005: an attachment-only row
      // with no body at all. Both are rows a reader must survive, not drop.
      `insert into message (ROWID, handle_id, date, text, attributedBody, is_from_me)` +
        ` values (6004, 500, ${ns(2500)}, NULL, X'040b73747265616d747970656481e800FFFFFFFFFFFF', 0);`,
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (6005, 500, ${ns(2400)}, NULL, 0);`,
      "insert into chat_message_join (chat_id, message_id) values (40, 6004);",
      "insert into chat_message_join (chat_id, message_id) values (40, 6005);",

      // chat 41: a direct chat whose newest real message is an ATTACHMENT
      // with no caption — `unreplied` selects one row per chat, so dropping it drops the whole chat.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (41, 'chat-guid-41', '+15557777777', NULL, 45);",
      "insert into handle (ROWID, id) values (502, '+15557777777');",
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (6101, 502, ${ns(600)}, NULL, 0);`,
      "insert into chat_message_join (chat_id, message_id) values (41, 6101);",

      // chat 42: nothing but a tapback, and the NEWEST row in the store — a
      // `chats` query that skips the real-rows filter ranks it first.
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (42, 'chat-guid-42', '+15558888888', NULL, 45);",
      "insert into handle (ROWID, id) values (503, '+15558888888');",
      `insert into message (ROWID, handle_id, date, text, is_from_me, associated_message_type)` +
        ` values (6201, 503, ${ns(5)}, 'Loved a message', 0, 2000);`,
      "insert into chat_message_join (chat_id, message_id) values (42, 6201);",

      // chat 43: a DIRECT chat (style 45) whose identifier is an email that
      // starts with "chat" — the string a `like 'chat%'` guess misreads as a
      // group. Newest real message is inbound and recent: belongs in `unreplied`, reads as "direct".
      "insert into chat (ROWID, guid, chat_identifier, display_name, style)" +
        " values (43, 'chat-guid-43', 'chatty@example.com', NULL, 45);",
      "insert into handle (ROWID, id) values (504, 'chatty@example.com');",
      `insert into message (ROWID, handle_id, date, text, is_from_me)` +
        ` values (6301, 504, ${ns(700)}, 'need a reply', 0);`,
      "insert into chat_message_join (chat_id, message_id) values (43, 6301);",
    ].join(" "),
  ]);
  return store;
}
