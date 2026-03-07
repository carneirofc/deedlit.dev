import { expect, test } from "@playwright/test";

import { buildGenerationDetails } from "../../lib/metadata-utils";
import {
  extractFromComfyPromptGraph,
  findFirstValueByKeys,
  parseAutomatic1111Parameters,
} from "../../lib/metadata-parsing";
import { extractPromptInsightsFromMetadata } from "../../lib/prompt-statistics";

test.describe("metadata parsing helpers", () => {
  test("finds nested values inside JSON strings and arrays", () => {
    const metadata = {
      wrapper: [
        {
          ignored: true,
        },
        {
          nested: JSON.stringify({ sampler_name: "Euler a" }),
        },
      ],
    };

    expect(findFirstValueByKeys(metadata, ["sampler", "sampler_name"])) .toBe("Euler a");
  });

  test("parses automatic1111 parameters without forcing a positive prompt fallback", () => {
    const result = parseAutomatic1111Parameters("Sampler: Euler a, Model: modelX");

    expect(result).toEqual({
      sampler: "Euler a",
      model: "modelX",
      steps: undefined,
      cfgScale: undefined,
      seed: undefined,
      size: undefined,
    });
    expect(result.positivePrompt).toBeUndefined();
  });

  test("can opt into first-line positive prompt parsing", () => {
    const result = parseAutomatic1111Parameters("A scenic landscape\nSampler: Euler a", {
      includeFirstLineAsPositive: true,
    });

    expect(result.positivePrompt).toBe("A scenic landscape");
    expect(result.sampler).toBe("Euler a");
  });

  test("extracts core prompt details from a comfy prompt graph", () => {
    const result = extractFromComfyPromptGraph({
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: {
          ckpt_name: "model-a",
        },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "positive text",
        },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "negative text",
        },
      },
      "4": {
        class_type: "KSampler",
        inputs: {
          positive: ["2", 0],
          negative: ["3", 0],
          model: ["1", 0],
          sampler_name: "dpmpp_2m",
          cfg: 7,
          steps: 30,
          seed: 1234,
          scheduler: "normal",
        },
      },
    });

    expect(result).toMatchObject({
      positivePrompt: "positive text",
      negativePrompt: "negative text",
      model: "model-a",
      sampler: "dpmpp_2m",
      cfgScale: "7",
      steps: "30",
      seed: "1234",
      scheduler: "normal",
    });
  });
});

test.describe("metadata consumers", () => {
  test("extracts prompt insights from metadata fields", () => {
    const metadata = {
      fields: {
        parameters: "Positive prompt\nNegative prompt: bad anatomy\nSampler: Euler a, Model: dreamshaper",
      },
    };

    expect(extractPromptInsightsFromMetadata(metadata)).toEqual({
      positivePrompt: "Positive prompt",
      negativePrompt: "bad anatomy",
      model: "dreamshaper",
      sampler: "Euler a",
    });
  });

  test("builds generation details with first-line fallback from automatic1111 parameters", () => {
    const details = buildGenerationDetails({
      id: "image-1",
      rootId: "root-1",
      rootPath: "C:/images",
      absolutePath: "C:/images/a.png",
      relativePath: "a.png",
      fileName: "a.png",
      size: 100,
      modifiedAt: new Date("2026-03-07T00:00:00.000Z").toISOString(),
      metadata: {
        parameters: "A cinematic portrait\nSampler: Euler a, Steps: 28, CFG scale: 7, Seed: 11",
      },
      promptSummary: {},
    });

    expect(details.positivePrompt).toBe("A cinematic portrait");
    expect(details.sampler).toBe("Euler a");
    expect(details.steps).toBe("28");
    expect(details.cfgScale).toBe("7");
    expect(details.seed).toBe("11");
  });
});