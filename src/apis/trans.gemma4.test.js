jest.mock("query-string", () => ({
  stringify: (obj) => new URLSearchParams(obj).toString(),
}));

jest.mock("@streamparser/json", () =>
  jest.requireActual("../../node_modules/@streamparser/json/dist/cjs/index.js")
);

jest.mock("../libs/docInfo", () => ({
  getDocInfo: () => ({}),
}));

import { genTransReq, parseTransRes } from "./trans";
import { DEFAULT_API_LIST, OPT_TRANS_GEMMA4 } from "../config";

describe("Gemma 4 llama.cpp provider", () => {
  const apiSetting = {
    ...DEFAULT_API_LIST.find((api) => api.apiType === OPT_TRANS_GEMMA4),
    useStream: false,
    useBatchFetch: false,
  };

  test("builds an OpenAI-compatible request for the local Gemma 4 server", async () => {
    const [url, init] = await genTransReq({
      ...apiSetting,
      texts: ["Hello, how are you?"],
      from: "English",
      to: "Traditional Chinese",
      fromLang: "en",
      toLang: "zh-TW",
      glossary: {},
    });

    expect(url).toBe("http://127.0.0.1:8083/v1/chat/completions");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "gemma-4-E2B-it-abliterated.Q4_K_M.gguf",
      temperature: 0.1,
      max_tokens: 4096,
      stream: false,
    });
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]).toMatchObject({ role: "user" });
    expect(body.messages[1].content).toContain("Hello, how are you?");
    expect(init.headers).toMatchObject({
      "Content-type": "application/json",
    });
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  test("parses llama.cpp chat completion content as a normal KISS translation", async () => {
    const result = await parseTransRes(
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "您好，您最近怎麼樣？",
            },
          },
        ],
      },
      {
        texts: ["Hello, how are you?"],
        from: "English",
        to: "Traditional Chinese",
        fromLang: "en",
        toLang: "zh-TW",
        langMap: new Map(),
        apiType: OPT_TRANS_GEMMA4,
        useBatchFetch: false,
      }
    );

    expect(result).toEqual([["您好，您最近怎麼樣？"]]);
  });
});
