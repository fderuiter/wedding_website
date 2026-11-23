<template>
  <div class="api-explorer-wrapper">
    <form class="api-explorer-server-bar" @submit.prevent="applyServerUrl">
      <label class="api-explorer-server-bar__label" for="api-explorer-server-url">
        Target API Server URL
      </label>
      <div class="api-explorer-server-bar__controls">
        <input
          id="api-explorer-server-url"
          v-model="serverUrlInput"
          type="url"
          class="api-explorer-server-bar__input"
          placeholder="http://localhost:3000"
          autocomplete="url"
          aria-describedby="api-explorer-server-status"
        />
        <button
          type="submit"
          class="api-explorer-server-bar__btn api-explorer-server-bar__btn--primary"
        >
          Enable Try it out
        </button>
        <button
          v-if="activeServerUrl"
          type="button"
          class="api-explorer-server-bar__btn api-explorer-server-bar__btn--secondary"
          @click="clearServerUrl"
        >
          Disable Try it out
        </button>
      </div>
      <p v-if="validationError" class="api-explorer-server-bar__error" role="alert">
        {{ validationError }}
      </p>
      <p id="api-explorer-server-status" class="api-explorer-server-bar__status">
        <template v-if="activeServerUrl">
          Live <strong>Try it out</strong> requests are enabled against
          <code>{{ activeServerUrl }}</code>.
        </template>
        <template v-else>
          Interactive <strong>Try it out</strong> execution is disabled by default on static
          documentation builds to prevent HTTP 404 requests against the docs host. Enter a running
          deployment URL above to enable live requests.
        </template>
      </p>
    </form>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading interactive API explorer...</p>
    </div>
    <div id="swagger-ui-container"></div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import 'swagger-ui-dist/swagger-ui.css';

const SUBMIT_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const loading = ref(true);
const serverUrlInput = ref('');
const activeServerUrl = ref('');
const validationError = ref('');

let swaggerFactory = null;
let loadedSpec = null;
let fallbackOpenApiUrl = '';

function normalizeTargetServerUrl(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter an http:// or https:// server URL to enable live requests.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Target server URL must use http:// or https://.' };
    }
    const normalized = parsed.toString().replace(/\/+$/, '');
    return { ok: true, url: normalized };
  } catch {
    return { ok: false, error: 'Enter a valid full URL (for example http://localhost:3000).' };
  }
}

function buildEffectiveSpec(baseSpec, targetUrl) {
  if (!baseSpec) return undefined;
  if (!targetUrl) {
    return {
      ...baseSpec,
      servers: [],
    };
  }
  return {
    ...baseSpec,
    servers: [
      {
        url: targetUrl,
        description: 'Configured target deployment',
      },
    ],
  };
}

function renderSwaggerUi() {
  if (!swaggerFactory) return;

  const isLiveEnabled = Boolean(activeServerUrl.value);
  swaggerFactory({
    dom_id: '#swagger-ui-container',
    url: loadedSpec ? undefined : fallbackOpenApiUrl,
    spec: buildEffectiveSpec(loadedSpec, activeServerUrl.value),
    supportedSubmitMethods: isLiveEnabled ? SUBMIT_METHODS : [],
    deepLinking: true,
    presets: [swaggerFactory.presets.apis],
    layout: 'BaseLayout',
    defaultModelsExpandDepth: 1,
    docExpansion: 'list',
  });
}

function applyServerUrl() {
  const result = normalizeTargetServerUrl(serverUrlInput.value);
  if (!result.ok) {
    validationError.value = result.error;
    return;
  }
  validationError.value = '';
  activeServerUrl.value = result.url;
  serverUrlInput.value = result.url;
  renderSwaggerUi();
}

function clearServerUrl() {
  validationError.value = '';
  activeServerUrl.value = '';
  serverUrlInput.value = '';
  renderSwaggerUi();
}

onMounted(async () => {
  try {
    const mod = await import('swagger-ui-dist/swagger-ui-bundle.js');
    swaggerFactory = mod.default || mod.SwaggerUIBundle;

    fallbackOpenApiUrl = withBase('/openapi.json');
    try {
      const res = await fetch(fallbackOpenApiUrl);
      if (res.ok) {
        loadedSpec = await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch OpenAPI JSON directly, falling back to URL property:', e);
    }

    loading.value = false;
    renderSwaggerUi();
  } catch (err) {
    console.error('Failed to initialize Swagger UI:', err);
    loading.value = false;
  }
});
</script>
