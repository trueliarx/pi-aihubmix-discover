import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODELS_JSON_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");
const PROVIDER = "aihubmix";
const DEFAULT_BASE_URL = "https://api.aihubmix.com/v1";
const DEFAULT_NAME = "AiHubMix";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 4096;

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function readModelsJson() {
  if (!fs.existsSync(MODELS_JSON_PATH)) {
    return { providers: {} };
  }

  const data = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, "utf8"));
  if (!data.providers || typeof data.providers !== "object") {
    data.providers = {};
  }

  return data;
}

function writeModelsJson(data) {
  fs.mkdirSync(path.dirname(MODELS_JSON_PATH), { recursive: true });
  const tmpPath = `${MODELS_JSON_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, MODELS_JSON_PATH);
}

function getAiHubMixConfig(data) {
  const provider = data.providers[PROVIDER];

  if (!provider || typeof provider !== "object") {
    return null;
  }

  if (typeof provider.apiKey !== "string" || provider.apiKey.length === 0) {
    return null;
  }

  const name = typeof provider.name === "string" && provider.name.length > 0 ? provider.name : DEFAULT_NAME;

  const baseUrl = normalizeBaseUrl(
    typeof provider.baseUrl === "string" && provider.baseUrl.length > 0 ? provider.baseUrl : DEFAULT_BASE_URL,
  );

  return {
    name: name,
    baseUrl: baseUrl,
    apiKey: provider.apiKey,
  };
}

async function ensureConfig(ctx) {
  const data = readModelsJson();
  let provider = getAiHubMixConfig(data);

  if (provider) {
    return { data, provider };
  }

  if (!ctx.hasUI) {
    throw new Error(`AiHubMix provider not configured. Add providers.${PROVIDER} to ${MODELS_JSON_PATH}`);
  }

  const apiKey = await ctx.ui.input("AiHubMix API Key", "paste your key here");

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("API key is required");
  }

  data.providers[PROVIDER] = {
    name: DEFAULT_NAME,
    baseUrl: DEFAULT_BASE_URL,
    api: "openai-completions",
    apiKey: apiKey.trim(),
    models: [],
  };

  writeModelsJson(data);

  provider = getAiHubMixConfig(data);

  return { data, provider };
}

async function discoverModels(provider) {
  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Expected OpenAI-compatible response with a data array");
  }

  return payload.data
    .filter((model) => model && typeof model.id === "string" && model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: typeof model.name === "string" && model.name.length > 0 ? model.name : model.id,
      reasoning: model.supports_reasoning === true,
      input: model.supports_vision === true ? ["text", "image"] : ["text"],
      cost: {
        input: pricePerMillionTokens(model.input_price),
        output: pricePerMillionTokens(model.output_price),
        cacheRead: pricePerMillionTokens(model.cached_price),
        cacheWrite: pricePerMillionTokens(model.caching_price),
      },
      contextWindow: model.context_window || DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.max_output_tokens || DEFAULT_MAX_TOKENS,
    }));
}

function pricePerMillionTokens(value) {
  return (value ?? 0) * 1_000_000;
}

function updateModelsJson(data, models) {
  data.providers[PROVIDER] = {
    ...data.providers[PROVIDER],
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  };
  writeModelsJson(data);
}

export default async function (pi) {
  pi.registerCommand("aihubmix-models-sync", {
    description: "Dynamically discover AiHubMix models, update local models.json, and reload.",
    async handler(_args, ctx) {
      ctx.ui.setStatus("aihubmix-models-sync", "Discovering AiHubMix models...");

      try {
        const { data, provider } = await ensureConfig(ctx);
        const models = await discoverModels(provider);
        updateModelsJson(data, models);
        ctx.ui.notify(`Discovered ${models.length} AiHubMix model(s). Reloading...`, "success");
        if (typeof ctx.reload === "function") {
          ctx.reload();
        } else if (typeof pi.reload === "function") {
          pi.reload();
        }
      } catch (error) {
        ctx.ui.notify(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      } finally {
        ctx.ui.setStatus("aihubmix-models-sync", undefined);
      }
    },
  });

  try {
    const data = readModelsJson();
    const provider = getAiHubMixConfig(data);

    if (!provider) {
      return;
    }

    const models = await discoverModels(provider);

    if (models.length > 0) {
      pi.registerProvider(PROVIDER, {
        ...provider,
        models,
      });
    }
  } catch (error) {
    console.warn(
      `[pi-aihubmix-model-discovery] startup discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
