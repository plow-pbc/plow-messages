/**
 * The built Swift CLI against a chat.db-shaped store. Every assertion here is
 * on a row whose `text` column is NULL, the shape a hand-written `select ...
 * from message where text like ?` misses (#385) — Mac-only because the
 * binary is Swift.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeStore } from "./chatDbFixture.js";

const ON_MAC = process.platform === "darwin";
const itMac = it.skipIf(!ON_MAC);
const REPO = fileURLToPath(new URL("../", import.meta.url));
const BIN = path.join(REPO, "dist", "plow-messages");

/** What the two captured blobs decode to — asserted, since the decode is the
 *  whole point of the CLI existing. */
const DELIVERED = "Your order was delivered! Thank you for ordering from Super Duper Burgers.";
const COSTCO =
  "Your Costco order will arrive shortly! Your shopper will follow any instructions you may have left for delivery.";

let store = "";

beforeAll(() => {
  if (!ON_MAC) return;
  if (!fs.existsSync(BIN)) {
    execFileSync("just", ["build"], { cwd: REPO, stdio: "inherit" });
  }
  store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "plow-messages-")));
}, 120_000);

type Row = Record<string, string | number | boolean | null>;

/** Run the CLI and parse its JSON Lines, or report how it refused. TZ is
 *  pinned: `at` renders in this Mac's zone, and an assertion on it otherwise
 *  passes or fails on where the suite runs. */
function cli(...args: string[]): { rows: Row[]; stdout: string; stderr: string; code: number } {
  try {
    const out = execFileSync(BIN, ["--store", store, ...args], {
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC" },
    });
    const lines = out.trim() === "" ? [] : out.trim().split("\n");
    const rows = out.startsWith("{") ? lines.map((l) => JSON.parse(l) as Row) : [];
    return { rows, stdout: out, stderr: "", code: 0 };
  } catch (e) {
    const err = e as { status: number; stderr: string; stdout: string };
    return { rows: [], stdout: String(err.stdout ?? ""), stderr: String(err.stderr), code: err.status };
  }
}

describe("plow-messages search", () => {
  itMac("decodes a typedstream body whose text column is NULL — the #385 row shape", () => {
    const { rows } = cli("search", "Super Duper");
    expect(rows.map((r) => r.rowid)).toEqual([6001]);
    expect(rows[0].body).toBe(DELIVERED);
  });

  itMac("matches literally and case-insensitively for ASCII", () => {
    expect(cli("search", "COSTCO").rows.map((r) => r.body)).toEqual([COSTCO]);
    expect(cli("search", "costco").rows.map((r) => r.body)).toEqual([COSTCO]);
  });

  itMac("treats the phrase as a substring, never as a pattern", () => {
    // `%`/`_` are SQL LIKE wildcards and `.*` is a regex: a leak would match both fixture rows.
    for (const pattern of ["%order%", "order_", ".*order.*"]) {
      expect(cli("search", pattern).rows, `"${pattern}" matched as a pattern`).toEqual([]);
    }
  });

  itMac("orders newest first by default and oldest first on --order asc", () => {
    // 6001 is older than 6002; both bodies contain "order".
    expect(cli("search", "order").rows.map((r) => r.rowid)).toEqual([6002, 6001]);
    expect(cli("search", "order", "--order", "asc").rows.map((r) => r.rowid)).toEqual([6001, 6002]);
  });

  itMac("never surfaces a tapback, whose body reads like a message", () => {
    // 6003 is a tapback (`associated_message_type = 2000`) whose text reads like something someone said.
    expect(cli("search", "Loved").rows).toEqual([]);
  });

  itMac("carries the chat and sender a reply would need", () => {
    const row = cli("search", "Costco").rows[0];
    expect(row).toMatchObject({
      chat_guid: "chat-guid-40",
      chat_identifier: "chat40404040",
      display_name: "Deliveries",
      sender: "36246",
      is_from_me: false,
    });
    expect(String(row.at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  });

  itMac("says nothing rather than something wrong when the archive has no such row", () => {
    const { rows, code } = cli("search", "nothing in this archive says this");
    expect(rows).toEqual([]);
    // Zero rows is a SUCCESS: an empty answer and a failed read must not look alike to a caller checking only the exit code.
    expect(code).toBe(0);
  });

  itMac.each([
    // Each filter is asserted by what it EXCLUDES — a filter that silently passes everything looks identical to one that works.
    { name: "--chat-id", args: ["--chat-id", "40"], expect: [6002, 6001] },
    { name: "--chat-id elsewhere", args: ["--chat-id", "1"], expect: [] },
    { name: "--after-rowid", args: ["--after-rowid", "6001"], expect: [6002] },
  ])("scopes a search with $name", ({ args, expect: rowids }) => {
    expect(cli("search", "order", ...args).rows.map((r) => r.rowid)).toEqual(rowids);
  });

  itMac("bounds a search by date, excluding what falls outside the window", () => {
    // 6001 is ~3000s old, 6002 ~2000s; a boundary between them must keep one and drop the other, both directions.
    const between = new Date(Date.now() - 2500 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    expect(cli("search", "order", "--after", between).rows.map((r) => r.rowid)).toEqual([6002]);
    expect(cli("search", "order", "--before", between).rows.map((r) => r.rowid)).toEqual([6001]);
  });

  itMac("browses a chat with no phrase at all, bodiless rows included", () => {
    // The no-phrase path is where a bodiless row has to appear. Newest first, tapback excluded.
    const rows = cli("search", "--chat-id", "40").rows;
    expect(rows.map((r) => r.rowid)).toEqual([6002, 6005, 6004, 6001]);
    expect(rows.filter((r) => r.body === null).map((r) => r.rowid)).toEqual([6005, 6004]);
  });

  itMac.each([
    // SQLite reads a negative LIMIT as UNBOUNDED; `chats`/`search`/`thread` all refuse now.
    ["search", ["search", "order", "--limit", "-1"]],
    ["chats", ["chats", "--limit", "-1"]],
    ["thread", ["thread", "--chat-id", "40", "--limit", "0"]],
  ])("refuses a non-positive --limit on %s", (_sub, args) => {
    const { code, stderr } = cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain("--limit wants a positive number");
  });

  itMac("accepts a bare date boundary, not only a full ISO instant", () => {
    // The USAGE text documents `--after 2026-09-01`; only the instant form
    // was covered, so the day-only branch of parseBoundary was untested.
    const today = new Date();
    const day = new Date(today.getTime() - 86400 * 1000).toISOString().slice(0, 10);
    expect(cli("search", "order", "--after", day).rows.length).toBeGreaterThan(0);
    expect(cli("search", "order", "--after", "not-a-date").code).toBe(2);
  });

  itMac("honours --limit and --handle", () => {
    expect(cli("search", "order", "--limit", "1").rows.map((r) => r.rowid)).toEqual([6002]);
    expect(cli("search", "order", "--handle", "36246").rows.map((r) => r.rowid)).toEqual([6002]);
  });
});

describe("plow-messages and a body it cannot read", () => {
  itMac("survives a malformed typedstream blob instead of aborting the process", () => {
    // Before the bridging shim, an uncaught NSException from this blob killed the process.
    const { rows, code } = cli("thread", "--chat-id", "40");
    expect(code).toBe(0);
    expect(rows.map((r) => r.rowid)).toContain(6004);
    expect(rows.find((r) => r.rowid === 6004)?.body).toBeNull();
  });

  itMac("reports an attachment-only row as a message with no body, not as no message", () => {
    expect(cli("thread", "--chat-id", "40").rows.find((r) => r.rowid === 6005)?.body).toBeNull();
  });

  itMac("still names a chat whose newest message is an attachment as unreplied", () => {
    // `unreplied` selects exactly ONE row per chat, so dropping a bodiless row would take the entire chat out of the answer.
    expect(cli("unreplied").rows.map((r) => r.chat_guid)).toContain("chat-guid-41");
  });

  itMac("never lets an undecodable body match a phrase", () => {
    expect(cli("search", "streamtyped").rows).toEqual([]);
  });
});

describe("plow-messages thread", () => {
  itMac("reads oldest first and drops the tapback", () => {
    const rows = cli("thread", "--chat-id", "40").rows;
    // Oldest first, tapback (6003) gone, and the two unreadable rows (6004
    // malformed, 6005 attachment-only) still present in their places.
    expect(rows.map((r) => r.rowid)).toEqual([6001, 6004, 6005, 6002]);
    expect(rows.map((r) => r.body)).toEqual([DELIVERED, null, null, COSTCO]);
  });

  itMac("reads a person's direct chat by handle, never a group they are in", () => {
    // +15625550000 posts in group 30 (5001) and has a direct chat 31 (5101);
    // a group is other people's conversation and needs --chat-id from `chats`.
    expect(cli("thread", "--handle", "+15625550000").rows.map((r) => r.rowid)).toEqual([5101]);
    // Every --handle is matched, not just the first: two direct chats, oldest first.
    expect(cli("thread", "--handle", "+15625550000", "--handle", "+15557777777").rows.map((r) => r.rowid)).toEqual([5101, 6101]);
  });

  itMac("reads nothing for a handle that is only ever in groups", () => {
    const { rows, code } = cli("thread", "--handle", "36246");
    expect(code).toBe(0);
    expect(rows).toEqual([]);
  });

  itMac("refuses without a chat or a handle rather than reading every chat", () => {
    const { code, stderr } = cli("thread");
    expect(code).toBe(2);
    expect(stderr).toContain("--chat-id");
  });
});

describe("plow-messages chats", () => {
  itMac("names each chat's kind and the guid a send targets", () => {
    const rows = cli("chats").rows;
    const deliveries = rows.find((r) => r.chat_id === 40);
    expect(deliveries).toMatchObject({ guid: "chat-guid-40", kind: "group", display_name: "Deliveries" });
    expect(rows.find((r) => r.chat_id === 1)).toMatchObject({ kind: "direct" });
    // chat 43's identifier starts with "chat" (chatty@example.com) yet its
    // style says one-to-one: kind is decided by `chat.style`, never the text.
    expect(rows.find((r) => r.chat_id === 43)).toMatchObject({ kind: "direct" });
  });
});

describe("plow-messages chats", () => {
  itMac("ranks on real messages, so a reaction cannot make a chat look active", () => {
    // chat 42 holds only a tapback and is the newest row in the store.
    expect(cli("chats").rows.map((r) => r.guid)).not.toContain("chat-guid-42");
  });

  itMac("dates a chat by its newest real message, not by a later reaction", () => {
    // chat 40's newest real row is 6002; 6003 is a tapback that postdates it.
    const deliveries = cli("chats").rows.find((r) => r.chat_id === 40);
    const newestReal = cli("thread", "--chat-id", "40").rows.at(-1);
    expect(deliveries?.last_message).toBe(newestReal?.at);
  });
});

describe("plow-messages unreplied", () => {
  itMac("lists a direct chat awaiting a reply and no group chat", () => {
    const guids = cli("unreplied").rows.map((r) => r.chat_guid);
    // chat 4's newest real row is inbound text; chat 10's and chat 41's have
    // NO readable body (an undecodable blob, an attachment) yet still
    // qualify. chat 43's identifier starts with "chat" but must still read
    // as direct: kind is decided by `chat.style`.
    expect(new Set(guids)).toEqual(
      new Set(["chat-guid-4", "chat-guid-10", "chat-guid-41", "chat-guid-43"]));
    // chat 3's newest is outbound, chat 5's is a tapback, chat 6 is a group — none qualify.
    for (const excluded of ["chat-guid-3", "chat-guid-5", "chat-guid-6"]) {
      expect(guids).not.toContain(excluded);
    }
  });
});

describe("plow-messages contract", () => {
  itMac("prints its own contract on --help, which is what the skill points at", () => {
    const { stdout, code } = cli("--help");
    expect(code).toBe(0);
    for (const subcommand of ["search", "thread", "chats", "unreplied"]) {
      expect(stdout).toContain(subcommand);
    }
    expect(stdout).toContain("untrusted input");
  });

  itMac("refuses an unknown option rather than silently widening the answer", () => {
    const { code, stderr } = cli("search", "--sql", "select 1");
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option");
  });

  itMac("exits 1, not 2, when the store cannot be read", () => {
    // The two failures have different remedies, so exit codes must differ.
    const missing = path.join(os.tmpdir(), "plow-messages-absent", "chat.db");
    try {
      execFileSync(BIN, ["--store", missing, "chats"], { encoding: "utf8" });
      expect.unreachable("reading an absent store should fail");
    } catch (e) {
      const err = e as { status: number; stderr: string };
      expect(err.status).toBe(1);
      expect(err.stderr).toContain("Full Disk Access");
    }
  });
});
