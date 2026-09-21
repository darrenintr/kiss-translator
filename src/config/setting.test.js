import {
  DEFAULT_INPUT_RULE,
  DEFAULT_MOUSE_HOVER_SETTING,
  DEFAULT_SETTING,
  DEFAULT_SUBTITLE_SETTING,
  DEFAULT_TRANBOX_SETTING,
} from "./setting";
import {
  DEFAULT_LOCAL_API_LIST,
  OPT_TRANS_TRANSLATEGEMMA,
} from "./api";
import { GLOBAL_KEY } from "./rules";

describe("translation box defaults", () => {
  test("translates language variants by default", () => {
    expect(DEFAULT_SETTING.translateVariants).toBe(true);
  });

  test("does not convert LaTeX in translations by default", () => {
    expect(DEFAULT_SETTING.parseLatex).toBe(false);
  });

  test("does not read the clipboard automatically by default", () => {
    expect(DEFAULT_SETTING.autoTranslateClipboard).toBe(false);
  });

  test("uses TranslateGemma for every default translation entry point", () => {
    expect(DEFAULT_INPUT_RULE.apiSlug).toBe(OPT_TRANS_TRANSLATEGEMMA);
    expect(DEFAULT_TRANBOX_SETTING.apiSlugs).toEqual([
      OPT_TRANS_TRANSLATEGEMMA,
    ]);
    expect(DEFAULT_SUBTITLE_SETTING.apiSlug).toBe(OPT_TRANS_TRANSLATEGEMMA);
    expect(DEFAULT_TRANBOX_SETTING.toLang).toBe("zh-TW");
    expect(DEFAULT_SUBTITLE_SETTING.toLang).toBe("zh-TW");
  });

  test("does not ignore any language by default", () => {
    expect(DEFAULT_TRANBOX_SETTING.skipLangs).toEqual([]);
  });

  test("uses Gemma 4 as the default local live-caption engine", () => {
    expect(DEFAULT_SUBTITLE_SETTING.localAiEngine).toBe("gemma4");
    expect(DEFAULT_SUBTITLE_SETTING.localAiLanguage).toBe("auto");
  });

  test("does not remember the subtitle position by default", () => {
    expect(DEFAULT_SUBTITLE_SETTING.rememberPosition).toBe(false);
    expect(DEFAULT_SUBTITLE_SETTING.positionRatio).toBe(0.05);
  });

  test("follows the current page rule for hover bubbles by default", () => {
    expect(DEFAULT_MOUSE_HOVER_SETTING.apiSlug).toBe(GLOBAL_KEY);
  });

  test("exposes only the local provider in fresh settings", () => {
    expect(DEFAULT_SETTING.transApis).toBe(DEFAULT_LOCAL_API_LIST);
    expect(DEFAULT_SETTING.transApis).toHaveLength(1);
    expect(DEFAULT_SETTING.transApis[0].apiType).toBe(OPT_TRANS_TRANSLATEGEMMA);
    expect(DEFAULT_SETTING).not.toHaveProperty("deletedTransApiSlugs");
  });
});
