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
import {
  DEFAULT_API_LIST,
  OPT_TRANS_TRANSLATEGEMMA,
} from "../config";

describe("TranslateGemma llama.cpp provider", () => {
  const apiSetting = {
    ...DEFAULT_API_LIST.find(
      (api) => api.apiType === OPT_TRANS_TRANSLATEGEMMA
    ),
    useStream: false,
    useBatchFetch: false,
  };

  test("builds a raw TranslateGemma prompt for llama.cpp /completion", async () => {
    const [url, init] = await genTransReq({
      ...apiSetting,
      texts: ["Hello, how are you?"],
      from: "English",
      to: "Traditional Chinese",
      fromLang: "en",
      toLang: "zh-TW",
      glossary: {},
    });

    expect(url).toBe("http://127.0.0.1:8081/completion");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      n_predict: 2048,
      temperature: 0.1,
      top_k: 64,
      top_p: 0.95,
      stop: ["<end_of_turn>"],
      stream: false,
      cache_prompt: true,
    });
    expect(body.prompt).toContain(
      "You are a professional English (en) to Traditional Chinese (zh-TW) translator."
    );
    expect(body.prompt).toContain(
      "Please translate the following English text into Traditional Chinese:\n\n\nHello, how are you?"
    );
    expect(body.prompt).toEndWith(
      "<end_of_turn>\n<start_of_turn>model\n"
    );
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("model");
  });

  test("parses llama.cpp completion content as a normal KISS translation", async () => {
    const result = await parseTransRes(
      {
        content: "您好，您最近怎麼樣？",
      },
      {
        texts: ["Hello, how are you?"],
        from: "English",
        to: "Traditional Chinese",
        fromLang: "en",
        toLang: "zh-TW",
        langMap: new Map(),
        apiType: OPT_TRANS_TRANSLATEGEMMA,
        useBatchFetch: false,
      }
    );

    expect(result).toEqual([["您好，您最近怎麼樣？", "en"]]);
  });
});
