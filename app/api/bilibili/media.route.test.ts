// Self-proving control-flow tests for GET app/api/bilibili/media/route.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./media/route";

const CANONICAL_URL = "https://www.bilibili.com/video/BV1xxxxxxxxx";

const viewResponse = (code = 0, cid = 999) => ({
  json: async () => (code === 0 ? { code: 0, data: { cid, title: "t" } } : { code, data: null }),
});
const navResponse = () => ({
  json: async () => ({
    data: {
      wbi_img: {
        img_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdef1234567890abcdef.png",
        sub_url: "https://i0.hdslb.com/bfs/wbi/fedcba0987654321fedcba0987654321.png",
      },
    },
  }),
});

type FetchMock = (url: string) => Promise<{ json: () => Promise<unknown> }>;

const withFetch = (impl: FetchMock, run: () => Promise<void>): Promise<void> => {
  const original = global.fetch;
  global.fetch = (async (url: string | URL | Request) => impl(String(url))) as typeof fetch;
  return run().finally(() => {
    global.fetch = original;
  });
};

const req = (url: string): Request =>
  new Request("http://x/api/bilibili/media?url=" + encodeURIComponent(url));

test("media GET: 200 happy path returns backup_url[0] over base_url and the cid", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/player/playurl")) {
        return {
          json: async () => ({
            code: 0,
            data: {
              durl: [
                {
                  url: "https://base.example/x.mp4",
                  backup_url: ["https://backup.example/x.mp4"],
                },
              ],
            },
          }),
        };
      }
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 200);
      const json = (await res.json()) as { url: string; cid: number };
      assert.equal(json.url, "https://backup.example/x.mp4");
      assert.equal(json.cid, 999);
    }
  );
});

test("media GET: -352 triggers a wbi-signed retry whose URL has no duplicate qn= key (T4 C1 regression guard)", async () => {
  const seenUrls: string[] = [];
  await withFetch(
    async (u) => {
      seenUrls.push(u);
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/web-interface/nav")) return navResponse();
      if (u.includes("/x/player/playurl")) {
        if (!u.includes("w_rid")) return { json: async () => ({ code: -352 }) };
        return {
          json: async () => ({
            code: 0,
            data: { durl: [{ url: "https://base.example/x.mp4", backup_url: ["https://backup.example/x.mp4"] }] },
          }),
        };
      }
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 200);

      const playurlCalls = seenUrls.filter((u) => u.includes("/x/player/playurl"));
      assert.equal(playurlCalls.length, 2, "expected exactly 2 calls to player/playurl (unsigned then signed retry)");

      const retryUrl = playurlCalls[1];
      const query = retryUrl.split("?")[1] ?? "";
      const keys = query.split("&").map((pair) => pair.split("=")[0]);
      const countOf = (key: string) => keys.filter((k) => k === key).length;
      assert.equal(countOf("bvid"), 1, "retry URL must not duplicate bvid=");
      assert.equal(countOf("qn"), 1, "retry URL must not duplicate qn=");
      assert.ok(retryUrl.includes("w_rid="), "retry URL must carry the wbi signature");
    }
  );
});

test("media GET: -352 persists on both attempts -> 503 (cannot resolve stream)", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/web-interface/nav")) return navResponse();
      if (u.includes("/x/player/playurl")) return { json: async () => ({ code: -352 }) };
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 503);
    }
  );
});

test("media GET: no durl in response -> 503", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/player/playurl")) return { json: async () => ({ code: 0, data: {} }) };
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 503);
    }
  );
});

test("media GET: video not found (view returns non-0 code) -> 404", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse(-404);
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 404);
    }
  );
});

test("media GET: missing url param -> 400", async () => {
  const res = await GET(new Request("http://x/api/bilibili/media"));
  assert.equal(res.status, 400);
});
