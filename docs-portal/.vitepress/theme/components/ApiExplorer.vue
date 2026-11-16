<template>
  <div class="api-explorer-wrapper">
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

const loading = ref(true);

onMounted(async () => {
  try {
    const mod = await import('swagger-ui-dist/swagger-ui-bundle.js');
    const SwaggerUI = mod.default || mod.SwaggerUIBundle;

    const openApiUrl = withBase('/openapi.json');
    let spec;
    try {
      const res = await fetch(openApiUrl);
      if (res.ok) {
        spec = await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch OpenAPI JSON directly, falling back to URL property:', e);
    }

    loading.value = false;
    SwaggerUI({
      dom_id: '#swagger-ui-container',
      url: spec ? undefined : openApiUrl,
      spec: spec,
      deepLinking: true,
      presets: [
        SwaggerUI.presets.apis,
      ],
      layout: 'BaseLayout',
      defaultModelsExpandDepth: 1,
      docExpansion: 'list',
    });
  } catch (err) {
    console.error('Failed to initialize Swagger UI:', err);
    loading.value = false;
  }
});
</script>
