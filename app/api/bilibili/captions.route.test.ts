// Self-proving control-flow tests for GET app/api/bilibili/captions/route.ts.
// global.fetch is mocked to scripted Bilibili API responses; the route's own
// fetch calls are inspected via the captured URL list.
import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./captions/route";

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
  new Request("http://x/api/bilibili/captions?url=" + encodeURIComponent(url));

test("captions GET: 200 happy path returns normalized sentences", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/player/wbi/v2")) {
        return {
          json: async () => ({
            code: 0,
            data: { subtitle: { subtitles: [{ lan: "en", subtitle_url: "//sub.json" }] } },
          }),
        };
      }
      if (u.includes("sub.json")) {
        return { json: async () => ({ body: [{ from: 1, to: 2, content: "hello" }] }) };
      }
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 200);
      const json = (await res.json()) as { sentences: unknown };
      assert.deepEqual(json.sentences, [{ text: "hello", audioStartMs: 1000, audioEndMs: 2000 }]);
    }
  );
});

test("captions GET: -352 triggers a wbi-signed retry whose URL has no duplicate query keys (T4 C1 regression guard)", async () => {
  const seenUrls: string[] = [];
  await withFetch(
    async (u) => {
      seenUrls.push(u);
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/web-interface/nav")) return navResponse();
      if (u.includes("/x/player/wbi/v2")) {
        if (!u.includes("w_rid")) return { json: async () => ({ code: -352 }) };
        return {
          json: async () => ({
            code: 0,
            data: { subtitle: { subtitles: [{ lan: "en", subtitle_url: "//sub.json" }] } },
          }),
        };
      }
      if (u.includes("sub.json")) {
        return { json: async () => ({ body: [{ from: 0, to: 1, content: "ok" }] }) };
      }
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 200);

      const wbiCalls = seenUrls.filter((u) => u.includes("/x/player/wbi/v2"));
      assert.equal(wbiCalls.length, 2, "expected exactly 2 calls to player/wbi/v2 (unsigned then signed retry)");

      const retryUrl = wbiCalls[1];
      const query = retryUrl.split("?")[1] ?? "";
      const keys = query.split("&").map((pair) => pair.split("=")[0]);
      const countOf = (key: string) => keys.filter((k) => k === key).length;
      assert.equal(countOf("bvid"), 1, "retry URL must not duplicate bvid=");
      assert.equal(countOf("cid"), 1, "retry URL must not duplicate cid=");
      assert.ok(retryUrl.includes("w_rid="), "retry URL must carry the wbi signature");
    }
  );
});

test("captions GET: -352 persists on both attempts -> 503 (no English sub reachable)", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/web-interface/nav")) return navResponse();
      if (u.includes("/x/player/wbi/v2")) return { json: async () => ({ code: -352 }) };
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 503);
    }
  );
});

test("captions GET: no English subtitle available -> 503", async () => {
  await withFetch(
    async (u) => {
      if (u.includes("/x/web-interface/view")) return viewResponse();
      if (u.includes("/x/player/wbi/v2")) {
        return {
          json: async () => ({
            code: 0,
            data: { subtitle: { subtitles: [{ lan: "zh", subtitle_url: "//sub.json" }] } },
          }),
        };
      }
      throw new Error("unexpected url " + u);
    },
    async () => {
      const res = await GET(req(CANONICAL_URL));
      assert.equal(res.status, 503);
    }
  );
});

test("captions GET: video not found (view returns non-0 code) -> 404", async () => {
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

test("captions GET: missing url param -> 400", async () => {
  const res = await GET(new Request("http://x/api/bilibili/captions"));
  assert.equal(res.status, 400);
});

test("captions GET: bvid-only query param (no url) -> 400", async () => {
  const res = await GET(new Request("http://x/api/bilibili/captions?bvid=BV1xxxxxxxxx"));
  assert.equal(res.status, 400);
});
