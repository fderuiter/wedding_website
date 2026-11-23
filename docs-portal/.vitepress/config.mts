import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export function normalizeBasePath(rawBase?: string): string {
  const normalized = (rawBase ?? '').trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized ? `/${normalized}/` : '/';
}

export default withMermaid(
  defineConfig({
    title: 'Wedding Platform Docs',
    description: 'Architectural specifications, deployment topologies, security models, and API reference',
    base: normalizeBasePath(process.env.VITEPRESS_BASE),
    ignoreDeadLinks: [/^\/demo(\/|$)/, /^\/storybook(\/|$)/],
    markdown: {
      languageAlias: {
        env: 'dotenv',
        caddy: 'nginx'
      },
      config(md) {
        const defaultCodeInline = md.renderer.rules.code_inline!;
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
          tokens[idx].attrSet('v-pre', '');
          return defaultCodeInline(tokens, idx, options, env, self);
        };
      }
    },
    themeConfig: {
      nav: [
        { text: 'Live Interactive Demo', link: '/demo/', target: '_self' },
        { text: 'Component Storybook', link: '/storybook/', target: '_self' },
        { text: 'Architecture', link: '/architecture/architecture' },
        { text: 'Deployment', link: '/deployment/deployment' },
        { text: 'Development', link: '/development/developer-setup' },
        { text: 'Features', link: '/features/feature-modules' },
        { text: 'Security', link: '/security/security' },
        { text: 'Guides', link: '/guides/upgrading' },
        { text: 'API Explorer', link: '/api/' }
      ],
      sidebar: [
        {
          text: 'Architecture',
          collapsed: false,
          items: [
            { text: 'System Architecture', link: '/architecture/architecture' },
            { text: 'Runtime Contract', link: '/architecture/runtime-contract' }
          ]
        },
        {
          text: 'Deployment',
          collapsed: false,
          items: [
            { text: 'Deployment Strategy', link: '/deployment/deployment' },
            { text: 'Deployment Recipes Overview', link: '/deployment/recipes' },
            { text: 'Generic Docker / VPS', link: '/deployment/docker-vps' },
            { text: 'Google Cloud Run', link: '/deployment/gcp-cloud-run' },
            { text: 'Railway & Render', link: '/deployment/railway-render' },
            { text: 'Vercel', link: '/deployment/vercel' }
          ]
        },
        {
          text: 'Development',
          collapsed: false,
          items: [
            { text: 'Project Overview', link: '/development/readme' },
            { text: 'Local Environment Setup', link: '/development/developer-setup' },
            { text: 'Testing Strategy', link: '/development/testing' },
            { text: 'Contribution Guidelines', link: '/development/contributing' },
            { text: 'Agent & Contributor Guidelines', link: '/development/agents' }
          ]
        },
        {
          text: 'Features',
          collapsed: false,
          items: [
            { text: 'Feature Modules', link: '/features/feature-modules' },
            { text: 'Asset Storage', link: '/features/asset-storage' },
            { text: '3D Technical Guide', link: '/features/3d-technical-guide' },
            { text: 'Web Scraper Pipeline', link: '/features/scraper' },
            { text: 'Guest Broadcasts & Messaging', link: '/features/broadcasts' }
          ]
        },
        {
          text: 'Security',
          collapsed: false,
          items: [
            { text: 'Security Policy', link: '/security/security' },
            { text: 'Threat Model', link: '/security/threat-model' }
          ]
        },
        {
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Upgrading Guide', link: '/guides/upgrading' },
            { text: 'Versioning Policy', link: '/guides/versioning' },
            { text: 'Changelog', link: '/guides/changelog' }
          ]
        },
        {
          text: 'API Reference',
          collapsed: false,
          items: [
            { text: 'Interactive API Explorer', link: '/api/' }
          ]
        }
      ],
      search: {
        provider: 'local',
        options: {
          miniSearch: {
            searchOptions: {
              combineWith: 'AND',
              fuzzy: 0.2
            }
          }
        }
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/fderuiter/wedding_website' }
      ],
      footer: {
        message: 'Released under the AGPL-3.0 License.',
        copyright: 'Copyright © 2026 Wedding Platform Contributors'
      }
    },
    mermaid: {
      theme: 'default'
    },
    vite: {
      optimizeDeps: {
        include: ['mermaid']
      }
    }
  })
);
