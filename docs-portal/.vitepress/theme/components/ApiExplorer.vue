<template>
  <div class="api-explorer-wrapper">
    <section class="api-explorer-server-bar" aria-label="API Explorer execution controls">
      <div class="api-explorer-toolbar-row">
        <div class="api-explorer-mode-group">
          <span id="api-explorer-mode-label" class="api-explorer-server-bar__label">
            Execution Target
          </span>
          <div
            class="api-explorer-segmented"
            role="group"
            aria-labelledby="api-explorer-mode-label"
          >
            <button
              type="button"
              class="api-explorer-segmented__btn"
              :class="{ 'is-active': executionMode === 'sandbox' }"
              :aria-pressed="executionMode === 'sandbox'"
              data-testid="explorer-mode-sandbox"
              @click="switchMode('sandbox')"
            >
              Browser Sandbox
            </button>
            <button
              type="button"
              class="api-explorer-segmented__btn"
              :class="{ 'is-active': executionMode === 'external' }"
              :aria-pressed="executionMode === 'external'"
              data-testid="explorer-mode-external"
              @click="switchMode('external')"
            >
              External Server URL
            </button>
          </div>
        </div>

        <div v-if="executionMode === 'sandbox'" class="api-explorer-persona-group">
          <span id="api-explorer-persona-label" class="api-explorer-server-bar__label">
            Active Persona
          </span>
          <div
            class="api-explorer-persona-controls"
            role="group"
            aria-labelledby="api-explorer-persona-label"
          >
            <button
              v-for="option in PERSONA_OPTIONS"
              :key="option.id"
              type="button"
              class="api-explorer-persona-btn"
              :class="{ 'is-active': sandboxState.persona === option.id }"
              :aria-pressed="sandboxState.persona === option.id"
              :data-testid="`explorer-persona-${option.id}`"
              @click="selectPersona(option.id)"
            >
              {{ option.label }}
            </button>
            <button
              type="button"
              class="api-explorer-server-bar__btn api-explorer-server-bar__btn--secondary"
              data-testid="explorer-reset-sandbox"
              @click="handleResetSandbox"
            >
              Reset Sample State
            </button>
          </div>
        </div>
      </div>

      <div v-if="executionMode === 'sandbox'" class="api-explorer-sandbox-meta">
        <p id="api-explorer-server-status" class="api-explorer-server-bar__status" aria-live="polite">
          <strong>Zero-backend Browser Sandbox active:</strong>
          <template v-if="sandboxState.persona === 'admin'">
            Authenticated as <strong>Administrator</strong> (<code>admin_auth</code> session simulated;
            <code>/api/admin/*</code> endpoints unlocked).
          </template>
          <template v-else-if="sandboxState.persona === 'setup'">
            Running in <strong>First-Run Setup</strong> mode
            (<template v-if="sandboxState.setupAuthenticated">step-1 password verified</template
            ><template v-else>unauthenticated — submit <code>password</code> to <code>POST /api/admin/setup</code></template>).
          </template>
          <template v-else>
            Browsing as <strong>Invited Guest</strong>
            <template v-if="sandboxState.guestSession">
              (household <code>{{ sandboxState.guestSession.invitationCode }}</code> —
              {{ sandboxState.guestSession.guestName }}).
            </template>
            <template v-else>
              (unverified guest session — validate an invite code or log in to unlock household routes).
            </template>
          </template>
          Sample state syncs automatically with the
          <a :href="demoHref" class="api-explorer-inline-link">Live Showcase Demo</a>.
          <span v-if="resetFeedback" class="api-explorer-reset-badge">{{ resetFeedback }}</span>
        </p>
      </div>

      <form
        v-else
        class="api-explorer-external-form"
        novalidate
        @submit.prevent="applyServerUrl"
      >
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
            aria-describedby="api-explorer-server-status api-explorer-cross-origin-note"
          />
          <button
            type="submit"
            class="api-explorer-server-bar__btn api-explorer-server-bar__btn--primary"
            data-testid="explorer-apply-url"
          >
            Connect Server
          </button>
          <button
            v-if="activeServerUrl"
            type="button"
            class="api-explorer-server-bar__btn api-explorer-server-bar__btn--secondary"
            @click="clearServerUrl"
          >
            Disconnect
          </button>
          <button
            type="button"
            class="api-explorer-server-bar__btn api-explorer-server-bar__btn--secondary"
            @click="switchMode('sandbox')"
          >
            Return to Sandbox
          </button>
        </div>

        <p v-if="validationError" class="api-explorer-server-bar__error" role="alert">
          {{ validationError }}
        </p>

        <p id="api-explorer-server-status" class="api-explorer-server-bar__status" aria-live="polite">
          <template v-if="activeServerUrl">
            Live <strong>Try it out</strong> requests target
            <code>{{ activeServerUrl }}</code>.
          </template>
          <template v-else>
            Enter an <code>http://</code> or <code>https://</code> deployment URL above to enable
            external <strong>Try it out</strong> requests, or switch back to the Browser Sandbox.
          </template>
        </p>

        <div
          id="api-explorer-cross-origin-note"
          class="api-explorer-callout"
          :class="{ 'api-explorer-callout--warning': externalOriginInfo.isCrossOrigin }"
        >
          <strong>Same-origin &amp; cross-origin browser limits:</strong>
          Session cookies (<code>admin_auth</code>, <code>guest_auth</code>, and
          <code>guest_invite_session</code>) use <code>HttpOnly</code> and
          <code>SameSite=Lax</code>, and Edge middleware rejects unauthenticated cross-origin
          <code>OPTIONS</code> preflight requests without CORS headers.
          <template v-if="activeServerUrl && externalOriginInfo.isCrossOrigin">
            Because <code>{{ externalOriginInfo.targetOrigin }}</code> differs from this portal
            origin (<code>{{ externalOriginInfo.currentOrigin }}</code>), browsers will block
            cookie-authenticated and preflighted requests; run the docs portal on the same origin
            or use the <strong>Browser Sandbox</strong> to test protected routes.
          </template>
          <template v-else>
            Target a same-origin local instance for cookie-authenticated testing, or use the
            <strong>Browser Sandbox</strong> to test all personas without a server.
          </template>
        </div>
      </form>
    </section>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading interactive API explorer...</p>
    </div>
    <div id="swagger-ui-container"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import 'swagger-ui-dist/swagger-ui.css';
import {
  createApiExplorerSandbox,
  evaluateExternalTargetOrigin,
  normalizeTargetServerUrl,
  type ApiExplorerSandboxController,
  type ExplorerMode,
  type SandboxPersona,
  type SandboxStateSnapshot,
} from '../apiExplorerSandbox';

const SUBMIT_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const PERSONA_OPTIONS: ReadonlyArray<{ id: SandboxPersona; label: string }> = [
  { id: 'guest', label: 'Invited Guest' },
  { id: 'admin', label: 'Administrator' },
  { id: 'setup', label: 'First-Run Setup' },
];

const loading = ref(true);
const executionMode = ref<ExplorerMode>('sandbox');
const serverUrlInput = ref('');
const activeServerUrl = ref('');
const validationError = ref('');
const resetFeedback = ref('');

const sandboxState = ref<SandboxStateSnapshot>({
  persona: 'guest',
  archetype: 'classic',
  isAdminSession: false,
  setupAuthenticated: false,
  guestSession: null,
  resetCounter: 0,
});

const demoHref = computed(() => withBase('/demo/'));
const externalOriginInfo = computed(() =>
  activeServerUrl.value
    ? evaluateExternalTargetOrigin(activeServerUrl.value)
    : { isCrossOrigin: false, targetOrigin: '', currentOrigin: '' }
);

interface SwaggerRequestObject {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
  userFetch?: (url: string, init: RequestInit) => Promise<Response>;
}

interface SwaggerUiFactory {
  (config: Record<string, unknown>): unknown;
  presets: {
    apis: unknown;
  };
}

let swaggerFactory: SwaggerUiFactory | null = null;
let loadedSpec: Record<string, unknown> | null = null;
let fallbackOpenApiUrl = '';
let sandboxController: ApiExplorerSandboxController | null = null;
let unsubscribeSandbox: (() => void) | null = null;
let resetFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

function resolveSandboxServerOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

function buildEffectiveSpec(
  baseSpec: Record<string, unknown> | null,
  mode: ExplorerMode,
  targetUrl: string
): Record<string, unknown> | undefined {
  if (!baseSpec) return undefined;

  if (mode === 'sandbox') {
    return {
      ...baseSpec,
      servers: [
        {
          url: resolveSandboxServerOrigin(),
          description: 'In-browser demo sandbox (zero backend)',
        },
      ],
    };
  }

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

  const isSubmitEnabled =
    executionMode.value === 'sandbox' || Boolean(activeServerUrl.value);

  swaggerFactory({
    dom_id: '#swagger-ui-container',
    url: loadedSpec ? undefined : fallbackOpenApiUrl,
    spec: buildEffectiveSpec(loadedSpec, executionMode.value, activeServerUrl.value),
    supportedSubmitMethods: isSubmitEnabled ? SUBMIT_METHODS : [],
    deepLinking: true,
    presets: [swaggerFactory.presets.apis],
    layout: 'BaseLayout',
    defaultModelsExpandDepth: 1,
    docExpansion: 'list',
    requestInterceptor: (req: SwaggerRequestObject) => {
      if (executionMode.value === 'sandbox' && sandboxController) {
        const activeSandbox = sandboxController;
        req.userFetch = (url: string, init: RequestInit) =>
          activeSandbox.executeFetch(url, init);
      }
      return req;
    },
  });
}

function switchMode(nextMode: ExplorerMode) {
  if (executionMode.value === nextMode) return;
  executionMode.value = nextMode;
  validationError.value = '';
  resetFeedback.value = '';
  renderSwaggerUi();
}

function selectPersona(persona: SandboxPersona) {
  if (!sandboxController) return;
  resetFeedback.value = '';
  sandboxState.value = sandboxController.setPersona(persona);
}

function handleResetSandbox() {
  if (!sandboxController) return;
  sandboxState.value = sandboxController.resetState();
  resetFeedback.value = 'Sample data and guest session restored to defaults.';
  if (resetFeedbackTimer) {
    clearTimeout(resetFeedbackTimer);
  }
  resetFeedbackTimer = setTimeout(() => {
    resetFeedback.value = '';
  }, 4000);
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
    sandboxController = createApiExplorerSandbox();
    sandboxState.value = sandboxController.getSnapshot();
    unsubscribeSandbox = sandboxController.subscribe((nextSnap) => {
      sandboxState.value = nextSnap;
    });

    const mod = (await import('swagger-ui-dist/swagger-ui-bundle.js')) as {
      default?: SwaggerUiFactory;
      SwaggerUIBundle?: SwaggerUiFactory;
    };
    swaggerFactory = mod.default || mod.SwaggerUIBundle || null;

    fallbackOpenApiUrl = withBase('/openapi.json');
    try {
      const res = await fetch(fallbackOpenApiUrl);
      if (res.ok) {
        loadedSpec = (await res.json()) as Record<string, unknown>;
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

onBeforeUnmount(() => {
  if (resetFeedbackTimer) {
    clearTimeout(resetFeedbackTimer);
  }
  unsubscribeSandbox?.();
  sandboxController?.destroy();
});
</script>
